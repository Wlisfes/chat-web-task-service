import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository, In, LessThan, Repository } from '@wlisfes/chat-web-base-schema/database'
import * as Schema from '@wlisfes/chat-web-base-schema/chat-web-task-mysql'

/** 写死每天 02:30:00，不进入任务表，也不能在管理端修改。 */
export const EXECUTION_LOG_PURGE_CRON = '0 30 2 * * *'

/** 按各任务自己的保留时长清理已结束运行日志。 */
@Injectable()
export class ExecutionLogPurgeTaskHandler {
    constructor(
        @InjectRepository(Schema.TbTaskCron) private readonly cronRepository: Repository<Schema.TbTaskCron>,
        @InjectRepository(Schema.TbTaskExecution) private readonly executionRepository: Repository<Schema.TbTaskExecution>,
        private readonly logger: Logger
    ) {}

    /** 每天 02:30:00（Asia/Shanghai）执行一次。进行中的记录不删除。 */
    @Cron(EXECUTION_LOG_PURGE_CRON, { timeZone: 'Asia/Shanghai' })
    public async purgeExpiredLogs(): Promise<void> {
        const now = new Date()
        const tasks = await this.cronRepository.find()
        let deleted = 0
        for (const task of tasks) {
            deleted += await this.purgeTaskLogs(task.taskId, task.logRetention, now)
        }
        this.logger.log(`已清理 ${deleted} 条超过保留时长的已结束运行日志`, ExecutionLogPurgeTaskHandler.name)
    }

    /** 删除单个任务超过保留时长的成功或失败记录。未知保留时长直接跳过。 */
    public async purgeTaskLogs(taskId: string, retention: Schema.TbTaskCronLogRetention, now = new Date()): Promise<number> {
        const duration = Schema.fetchTaskCronLogRetentionMs(retention)
        if (!duration) {
            return 0
        }
        const result = await this.executionRepository.delete({
            taskId,
            status: In([Schema.TbTaskExecutionStatus.SUCCESS, Schema.TbTaskExecutionStatus.FAILED]),
            createTime: LessThan(new Date(now.getTime() - duration))
        })
        return result.affected ?? 0
    }
}
