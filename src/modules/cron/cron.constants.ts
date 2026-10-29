import * as Schema from '@wlisfes/chat-web-base-schema/chat-web-task-mysql'

/** 系统账号 UID；调度器自动触发和内置任务初始化时作为创建人、更新人。 */
export const TASK_SYSTEM_UID = '0'

/** 汇率同步任务的稳定标识，沿用 Skyline 中的任务 ID，迁移后历史执行日志仍可按任务关联。 */
export const CURRENCY_EXCHANGE_TASK_ID = '2149446185344106496'

/** 汇率同步任务处理器标识。 */
export const CURRENCY_EXCHANGE_TASK_HANDLER = 'datetask-sync-exchange-rate'

/** 默认每天 08:00、20:00（Asia/Shanghai）各执行一次；Cron 为秒、分、时、日、月、周。 */
export const CURRENCY_EXCHANGE_TASK_CRON = '0 0 8,20 * * *'

/** 供应商钱包余额同步任务的稳定标识。 */
export const SRM_WALLET_SYNC_TASK_ID = '2149446185344106497'

/** 供应商钱包余额同步任务处理器标识。 */
export const SRM_WALLET_SYNC_TASK_HANDLER = 'datetask-sync-srm-wallet-balance'

/** 每分钟第 0 秒执行一次。 */
export const SRM_WALLET_SYNC_TASK_CRON = '0 * * * * *'

/** 余额同步每分钟都会再次执行，失败只重试 1 次，避免重试堆积。 */
export const SRM_WALLET_SYNC_TASK_MAX_ATTEMPTS = 2

/** 单次执行默认最大尝试次数（含首次）。 */
export const TASK_DEFAULT_MAX_ATTEMPTS = 8

/** 系统内置周期任务定义；服务启动时幂等写入，页面不提供新增和删除入口。 */
export const TASK_CRON_DEFINITIONS: ReadonlyArray<
    Pick<Schema.TbTaskCron, 'taskId' | 'taskName' | 'module' | 'handler' | 'comment' | 'cron' | 'status' | 'body' | 'maxAttempts'>
> = [
    {
        taskId: CURRENCY_EXCHANGE_TASK_ID,
        taskName: '汇率同步定时任务',
        module: Schema.TbTaskCronModule.TASK_FINANCE,
        handler: CURRENCY_EXCHANGE_TASK_HANDLER,
        comment: '每天触发 Finance 服务拉取汇率并写入财务数据库',
        cron: CURRENCY_EXCHANGE_TASK_CRON,
        status: Schema.TbTaskCronStatus.ENABLE,
        body: {},
        maxAttempts: TASK_DEFAULT_MAX_ATTEMPTS
    },
    {
        taskId: SRM_WALLET_SYNC_TASK_ID,
        taskName: '供应商余额同步定时任务',
        module: Schema.TbTaskCronModule.TASK_FINANCE,
        handler: SRM_WALLET_SYNC_TASK_HANDLER,
        comment: '每分钟触发 Finance 服务把 Redis 中的供应商钱包余额同步到钱包表',
        cron: SRM_WALLET_SYNC_TASK_CRON,
        status: Schema.TbTaskCronStatus.ENABLE,
        body: {},
        maxAttempts: SRM_WALLET_SYNC_TASK_MAX_ATTEMPTS
    }
]

/** RabbitMQ 虚拟主机；Nacos `rabbitmq.vhost` 必须与之一致。 */
export const TASK_RABBITMQ_VHOST = '/chat-task'
/** 任务交换机，按处理器路由。 */
export const TASK_EXCHANGE = 'chat.task.exchange'
/** 任务执行主队列。 */
export const TASK_EXECUTE_QUEUE = 'chat.task.execute'
/** 任务执行路由键。 */
export const TASK_EXECUTE_ROUTING_KEY = 'task.execute'
/** 超过重试上限或遇到不可重试错误的消息进入死信队列，供人工排查。 */
export const TASK_DEAD_EXCHANGE = 'chat.task.dead.exchange'
export const TASK_DEAD_QUEUE = 'chat.task.dead'
export const TASK_DEAD_ROUTING_KEY = 'task.dead'

/**
 * 失败重试的延迟梯度（毫秒），依次为 1 分钟、5 分钟、15 分钟、30 分钟、1 小时、2 小时、4 小时。
 * 每个梯度对应一个带 TTL 的延迟队列，消息过期后经死信转回主队列，无需 RabbitMQ 延迟插件。
 */
export const TASK_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000] as const

/** 延迟重试队列名称。 */
export function taskRetryQueue(delay: number): string {
    return `chat.task.retry.${delay}`
}

/** 第 attempts 次失败后使用的重试延迟；超出梯度时取最大值。 */
export function taskRetryDelay(attempts: number): number {
    return TASK_RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), TASK_RETRY_DELAYS_MS.length - 1)]
}

/** 调度器读取任务失败后的重试间隔，避免短暂数据库抖动导致任务永久退出调度。 */
export const TASK_SCHEDULER_RETRY_DELAY_MS = 30_000

/** Node.js 单个定时器允许的最大安全延时；更远的任务在此间隔后重新计算。 */
export const TASK_MAX_TIMER_DELAY_MS = 2_147_000_000

/** 补发扫描间隔：投递失败或长时间停留在待执行的记录会被重新投递。 */
export const TASK_OUTBOX_SCAN_INTERVAL_MS = 15_000
/** 待执行超过该时长且未投递成功的记录视为需要补发。 */
export const TASK_OUTBOX_STALE_MS = 30_000
/** 执行中超过该时长视为执行器崩溃，需要重新投递。 */
export const TASK_RUNNING_STALE_MS = 10 * 60_000

/** 手动触发时同步等待执行结果的最长时间（毫秒）；超时后返回执行记录供调用方轮询。 */
export const TASK_TRIGGER_WAIT_MS = 10_000
/** 手动触发等待期间轮询执行记录的间隔。 */
export const TASK_TRIGGER_POLL_MS = 500

/** 失败原因最大长度，与表字段一致。 */
export const TASK_ERROR_MAX_LENGTH = 1024
