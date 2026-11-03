import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import mysql, { RowDataPacket } from 'mysql2/promise'
import { assertMysqlDatabaseIsolation } from '@wlisfes/chat-web-base-schema/database'
import { getDatabaseName, loadLocalEnvironment, loadTaskDatabaseConfig } from '@/cli/database-config'

type MigrationRow = RowDataPacket & { checksum: string }
type LockRow = RowDataPacket & { acquired?: number | string | null }
type ColumnRow = RowDataPacket & {
    columnType: string
    isNullable: string
    columnDefault: string | null
}
const MIGRATION_TABLE = 'tb_task_schema_migration'
export const SCHEMA_MIGRATION_LOCK_NAME = 'chat-web-task:schema-migration'
export const TASK_CRON_LOG_RETENTION_MIGRATION = '20261103213000__tb_task_cron__add_log_retention.sql'
const TASK_CRON_LOG_RETENTION_COMMENT =
    '运行日志最大保留时长：24h=24小时（只保留最近24小时内已结束的执行记录）；3d=3天（只保留最近3天内已结束的执行记录）；7d=7天（只保留最近7天内已结束的执行记录）；15d=15天（只保留最近15天内已结束的执行记录）；30d=30天（只保留最近30天内已结束的执行记录）；60d=60天（只保留最近60天内已结束的执行记录）；90d=90天（只保留最近90天内已结束的执行记录）'

/** 找到公共包中随版本发布的 Task 增量 SQL。 */
function changesDirectory(): string {
    const schemaEntry = createRequire(__filename).resolve('@wlisfes/chat-web-base-schema/chat-web-task-mysql')
    return path.join(path.resolve(path.dirname(schemaEntry), '../../../..'), 'src/schema/chat-web-task-mysql/sql/changes')
}

/**
 * 兼容已经存在 log_retention、但迁移台账尚未记录的库。
 * 直接执行 ADD COLUMN 会因重复列失败，发布因此中止并继续跑旧版任务服务，管理端就拿不到保留时长。
 * 返回 true 表示执行了结构变更，false 表示列已符合预期、只补记台账。
 */
export async function ensureTaskCronLogRetentionColumn(connection: mysql.Connection, sql: string): Promise<boolean> {
    const [rows] = await connection.query<ColumnRow[]>(
        `SELECT COLUMN_TYPE AS columnType,
                IS_NULLABLE AS isNullable,
                COLUMN_DEFAULT AS columnDefault
           FROM information_schema.columns
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'tb_task_cron'
            AND COLUMN_NAME = 'log_retention'`
    )
    if (!rows.length) {
        await connection.query(sql)
        return true
    }

    await connection.query("UPDATE `tb_task_cron` SET `log_retention` = '7d' WHERE `log_retention` IS NULL OR `log_retention` = ''")
    const column = rows[0]
    const columnDefault = String(column.columnDefault ?? '').replace(/^'(.*)'$/, '$1')
    const aligned = String(column.columnType).toLowerCase() === 'varchar(32)' && column.isNullable === 'NO' && columnDefault === '7d'
    if (aligned) return false

    await connection.query(
        `ALTER TABLE \`tb_task_cron\`
            MODIFY COLUMN \`log_retention\` varchar(32) NOT NULL DEFAULT '7d'
            COMMENT '${TASK_CRON_LOG_RETENTION_COMMENT}'`
    )
    return true
}

/** 获取跨进程 Schema 迁移锁，避免多个发布任务同时执行 DDL 和写入迁移台账。 */
export async function acquireSchemaMigrationLock(connection: mysql.Connection): Promise<void> {
    const [rows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 30) AS acquired', [SCHEMA_MIGRATION_LOCK_NAME])
    if (Number(rows[0]?.acquired) !== 1) throw new Error('获取 Task Schema 迁移锁超时，请稍后重试')
}

/** 释放跨进程 Schema 迁移锁。 */
export async function releaseSchemaMigrationLock(connection: mysql.Connection): Promise<void> {
    await connection.query('SELECT RELEASE_LOCK(?)', [SCHEMA_MIGRATION_LOCK_NAME])
}

/** 按文件名顺序幂等执行 Task 数据库增量 SQL；已执行文件的校验和变化时中止。 */
export async function applySchema(): Promise<void> {
    loadLocalEnvironment()
    const config = await loadTaskDatabaseConfig()
    const database = getDatabaseName(config)
    const connection = await mysql.createConnection({
        host: process.env.TASK_MYSQL_HOST?.trim() || config.host,
        port: Number(process.env.TASK_MYSQL_PORT || config.port || 3306),
        user: process.env.TASK_MYSQL_USERNAME?.trim() || config.username,
        password: process.env.TASK_MYSQL_PASSWORD ?? config.password,
        database,
        charset: process.env.TASK_MYSQL_CHARSET || config.charset || 'utf8mb4',
        multipleStatements: true
    })

    let migrationLockAcquired = false
    try {
        await acquireSchemaMigrationLock(connection)
        migrationLockAcquired = true
        const [grantRows] = await connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()')
        assertMysqlDatabaseIsolation(
            grantRows.flatMap(row => Object.values(row).filter((value): value is string => typeof value === 'string')),
            database
        )
        await connection.query(
            `CREATE TABLE IF NOT EXISTS \`${MIGRATION_TABLE}\` (
                \`filename\` varchar(255) NOT NULL,
                \`checksum\` char(64) NOT NULL,
                \`applied_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (\`filename\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Task Schema增量记录表'`
        )
        const directory = changesDirectory()
        const filenames = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()
        for (const filename of filenames) {
            const sql = await readFile(path.join(directory, filename), 'utf8')
            const checksum = createHash('sha256').update(sql).digest('hex')
            const [rows] = await connection.execute<MigrationRow[]>(`SELECT checksum FROM \`${MIGRATION_TABLE}\` WHERE filename = ?`, [
                filename
            ])
            if (rows.length) {
                if (rows[0].checksum !== checksum) throw new Error(`已应用增量 SQL 校验和变化：${filename}`)
                process.stdout.write(`Schema migration skipped: ${filename}\n`)
                continue
            }
            const applied =
                filename === TASK_CRON_LOG_RETENTION_MIGRATION
                    ? await ensureTaskCronLogRetentionColumn(connection, sql)
                    : await connection.query(sql).then(() => true)
            await connection.execute(`INSERT INTO \`${MIGRATION_TABLE}\` (filename, checksum) VALUES (?, ?)`, [filename, checksum])
            process.stdout.write(
                applied ? `Schema migration applied: ${filename}\n` : `Schema migration skipped (log_retention 列已存在): ${filename}\n`
            )
        }
    } finally {
        if (migrationLockAcquired) {
            try {
                await releaseSchemaMigrationLock(connection)
            } catch (error) {
                process.stderr.write(`释放 Task Schema 迁移锁失败：${error instanceof Error ? error.message : String(error)}\n`)
            }
        }
        await connection.end()
    }
}

if (require.main === module) {
    applySchema().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
    })
}
