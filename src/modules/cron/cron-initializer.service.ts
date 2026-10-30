import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { TASK_CRON_DEFINITIONS, TASK_SYSTEM_UID } from '@/modules/cron/cron.constants'
import * as Schema from '@wlisfes/chat-web-base-schema/chat-web-task-mysql'

/**
 * 幂等写入系统内置周期任务。
 *
 * 已存在的任务只同步名称、模块、处理器和描述；Cron、状态和最大尝试次数允许在管理端调整，启动时不覆盖。
 */
@Injectable()
export class CronInitializerService implements OnModuleInit {
    constructor(
        @InjectRepository(Schema.TbTaskCron) private readonly repository: Repository<Schema.TbTaskCron>,
        private readonly logger: Logger
    ) {}

    /** 服务启动时确保所有内置任务存在。 */
    public async onModuleInit(): Promise<void> {
        for (const definition of TASK_CRON_DEFINITIONS) {
            const existing = await this.repository.findOne({ where: { taskId: definition.taskId } })
            if (!existing) {
                try {
                    await this.repository.insert(
                        this.repository.create({ ...definition, createBy: TASK_SYSTEM_UID, modifyBy: TASK_SYSTEM_UID })
                    )
                    this.logger.log(`已初始化周期任务：${definition.taskName}（${definition.taskId}）`, CronInitializerService.name)
                } catch (error) {
                    // 多实例同时启动时其他实例可能已经写入，唯一索引冲突视为已初始化。
                    if (!this.isDuplicateKeyError(error)) throw error
                }
                continue
            }
            const changed =
                existing.taskName !== definition.taskName ||
                existing.module !== definition.module ||
                existing.handler !== definition.handler ||
                existing.comment !== definition.comment
            if (!changed) continue
            await this.repository.update(
                { taskId: definition.taskId },
                {
                    taskName: definition.taskName,
                    module: definition.module,
                    handler: definition.handler,
                    comment: definition.comment,
                    modifyBy: TASK_SYSTEM_UID
                }
            )
            this.logger.log(`已同步周期任务定义：${definition.taskName}（${definition.taskId}）`, CronInitializerService.name)
        }
    }

    private isDuplicateKeyError(error: unknown): boolean {
        const value = error as { code?: unknown; errno?: unknown; driverError?: { code?: unknown; errno?: unknown } } | undefined
        return (
            value?.code === 'ER_DUP_ENTRY' ||
            Number(value?.errno) === 1062 ||
            value?.driverError?.code === 'ER_DUP_ENTRY' ||
            Number(value?.driverError?.errno) === 1062
        )
    }
}
