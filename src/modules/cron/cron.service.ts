import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { DataBaseService, In, InjectRepository, LessThan, Repository } from '@wlisfes/chat-web-base-schema/database'
import { fetchUntiePagination, isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as Schema from '@wlisfes/chat-web-base-schema/chat-web-task-mysql'
import * as FeignSchema from '@wlisfes/chat-web-base-schema/feign'
import * as constants from '@/modules/cron/cron.constants'
import { CronExecutionService } from '@/modules/cron/cron-execution.service'
import { CronExpressionService } from '@/modules/cron/cron-expression.service'
import { CronSchedulerService } from '@/modules/cron/cron-scheduler.service'

/** 周期任务与执行记录的查询、启停、改 Cron 和手动触发；只通过 /feign/task 被 Skyline 调用。 */
@Injectable()
export class CronService implements OnApplicationBootstrap, OnModuleDestroy {
    private purgeTimer?: NodeJS.Timeout

    constructor(
        @InjectRepository(Schema.TbTaskCron) private readonly repository: Repository<Schema.TbTaskCron>,
        @InjectRepository(Schema.TbTaskExecution) private readonly executionRepository: Repository<Schema.TbTaskExecution>,
        private readonly database: DataBaseService,
        private readonly cronExpressionService: CronExpressionService,
        private readonly cronSchedulerService: CronSchedulerService,
        private readonly cronExecutionService: CronExecutionService,
        private readonly logger: Logger
    ) {}

    /** 启动后按各任务的保留时长清理一次，之后每小时再清理。 */
    public onApplicationBootstrap(): void {
        void this.purgeExpiredLogs().catch(error => this.logPurgeError(error))
        this.purgeTimer = setInterval(
            () => void this.purgeExpiredLogs().catch(error => this.logPurgeError(error)),
            constants.TASK_LOG_PURGE_INTERVAL_MS
        )
    }

    /** 停止日志清理定时器。 */
    public onModuleDestroy(): void {
        if (this.purgeTimer) {
            clearInterval(this.purgeTimer)
        }
        this.purgeTimer = undefined
    }

    /** 分页查询周期任务。 */
    public async httpBaseTaskColumnCron(input: FeignSchema.TaskColumnCronInput): Promise<FeignSchema.TaskCronPage> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            if (isNotEmpty(input.taskName?.trim())) {
                qb.andWhere('t.taskName LIKE :taskName', { taskName: `%${input.taskName?.trim()}%` })
            }
            if (isNotEmpty(input.module)) {
                qb.andWhere('t.module = :module', { module: input.module })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(([list, total]) => ({ page, size, total, list }))
        })
    }

    /** 获取周期任务详情。 */
    public async httpBaseTaskCronResolver(input: FeignSchema.TaskCronKeyInput): Promise<Schema.TbTaskCron> {
        return this.findRequired(input.taskId)
    }

    /** 启用或停用周期任务，并同步调度。 */
    public async httpBaseTaskCronStatusUpdate(input: FeignSchema.TaskCronStatusUpdateInput): Promise<Schema.TbTaskCron> {
        await this.findRequired(input.taskId)
        await this.repository.update({ taskId: input.taskId }, { status: input.status, modifyBy: input.operatorUid })
        if (input.status === Schema.TbTaskCronStatus.ENABLE) {
            this.cronSchedulerService.schedule(input.taskId)
        } else {
            this.cronSchedulerService.unschedule(input.taskId)
        }
        return this.findRequired(input.taskId)
    }

    /** 修改周期任务 Cron 表达式和运行日志保留时长；启用中的任务立即按新表达式重新调度。 */
    public async httpBaseTaskUpdateCron(input: FeignSchema.TaskCronUpdateInput): Promise<Schema.TbTaskCron> {
        const cron = this.cronExpressionService.normalizeCron(input.cron)
        if (!this.cronExpressionService.getNextRun(cron)) {
            throw new BadRequestException('Cron表达式在一年内没有可执行时间')
        }
        if (!Schema.fetchTaskCronLogRetentionMs(input.logRetention)) {
            throw new BadRequestException('运行日志保留时长无效')
        }
        const task = await this.findRequired(input.taskId)
        await this.repository.update({ taskId: input.taskId }, { cron, logRetention: input.logRetention, modifyBy: input.operatorUid })
        if (task.status === Schema.TbTaskCronStatus.ENABLE) {
            this.cronSchedulerService.schedule(input.taskId)
        }
        await this.purgeTaskLogs(input.taskId, input.logRetention).catch(error => this.logPurgeError(error))
        return this.findRequired(input.taskId)
    }

    /**
     * 手动触发周期任务：停用的任务也允许手动执行。
     * 执行记录投递后最多等待数秒，期间结束则直接返回结果，否则返回待执行或执行中的记录供调用方轮询。
     */
    public async httpBaseTaskTriggerCron(input: FeignSchema.TaskTriggerCronInput): Promise<FeignSchema.TaskTriggerCronResult> {
        const task = await this.findRequired(input.taskId)
        if (!this.cronExecutionService.hasHandler(task.handler)) {
            throw new BadRequestException(`未注册的任务处理器：${task.handler}`)
        }
        const created = await this.cronExecutionService.create({
            task,
            triggerType: Schema.TbTaskExecutionTrigger.MANUAL,
            scheduledTime: new Date(),
            operatorUid: input.operatorUid
        })
        let execution = created
        const deadline = Date.now() + constants.TASK_TRIGGER_WAIT_MS
        while (!this.cronExecutionService.isFinished(execution) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, constants.TASK_TRIGGER_POLL_MS))
            execution = (await this.cronExecutionService.findByExecutionId(created.executionId)) ?? execution
        }
        return { executionId: created.executionId, finished: this.cronExecutionService.isFinished(execution), execution }
    }

    /** 分页查询某个任务的执行记录，按计划执行时间倒序。 */
    public async httpBaseTaskColumnExecution(input: FeignSchema.TaskColumnExecutionInput): Promise<FeignSchema.TaskExecutionPage> {
        await this.findRequired(input.taskId)
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.executionRepository, async qb => {
            qb.where('t.taskId = :taskId', { taskId: input.taskId })
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            qb.orderBy('t.scheduledTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(([list, total]) => ({ page, size, total, list }))
        })
    }

    /** 获取单条执行记录。 */
    public async httpBaseTaskExecutionResolver(input: FeignSchema.TaskExecutionResolverInput): Promise<Schema.TbTaskExecution> {
        const execution = await this.cronExecutionService.findByExecutionId(input.executionId)
        if (!execution) {
            throw new NotFoundException('执行记录不存在')
        }
        return execution
    }

    /** 按各任务配置删除超过保留时长的已结束执行记录。进行中的记录不删除。 */
    public async purgeExpiredLogs(now = new Date()): Promise<void> {
        const tasks = await this.repository.find()
        for (const task of tasks) {
            await this.purgeTaskLogs(task.taskId, task.logRetention, now)
        }
    }

    /** 删除单个任务超过保留时长的成功或失败记录。 */
    public async purgeTaskLogs(taskId: string, retention: Schema.TbTaskCronLogRetention, now = new Date()): Promise<void> {
        const duration = Schema.fetchTaskCronLogRetentionMs(retention)
        if (!duration) {
            return
        }
        await this.executionRepository.delete({
            taskId,
            status: In([Schema.TbTaskExecutionStatus.SUCCESS, Schema.TbTaskExecutionStatus.FAILED]),
            createTime: LessThan(new Date(now.getTime() - duration))
        })
    }

    private logPurgeError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`清理过期运行日志失败：${message}`, CronService.name)
    }

    private async findRequired(taskId: string): Promise<Schema.TbTaskCron> {
        const task = await this.repository.findOne({ where: { taskId } })
        if (!task) {
            throw new NotFoundException('周期任务不存在')
        }
        return task
    }
}
