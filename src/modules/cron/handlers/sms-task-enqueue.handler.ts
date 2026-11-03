import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SMS_TASK_ENQUEUE_TASK_HANDLER } from '@/modules/cron/cron.constants'
import { TaskHandler, TaskHandlerResult } from '@/modules/cron/handlers/task-handler.interface'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

/** 每小时触发短信服务，把进入 3 小时发送窗口的待发送任务推入队列。 */
@Injectable()
export class SmsTaskEnqueueTaskHandler implements TaskHandler {
    public readonly handler = SMS_TASK_ENQUEUE_TASK_HANDLER

    constructor(
        private readonly configService: ConfigService,
        private readonly smsFeignClient: feign.FeignClientSmsManager,
        private readonly logger: Logger
    ) {}

    /** 使用服务间凭据调用短信服务入队。入队失败由短信服务计入 skipped，接口失败则交给任务重试。 */
    public async execute(): Promise<TaskHandlerResult> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        this.logger.log('调用 SMS 扫描并推送进入发送窗口的任务：POST /feign/sms/task/enqueue', SmsTaskEnqueueTaskHandler.name)
        const startedAt = Date.now()
        const response = await this.smsFeignClient.httpBaseSmsTaskEnqueue(authorization, {})
        const summary = `扫描 ${response.scanned} 个，入队 ${response.enqueued} 个，跳过 ${response.skipped} 个`
        this.logger.log(`SMS 任务入队返回（耗时 ${Date.now() - startedAt}ms）：${summary}`, SmsTaskEnqueueTaskHandler.name)
        return { summary, scanned: response.scanned, enqueued: response.enqueued, skipped: response.skipped }
    }
}
