import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SRM_WALLET_SYNC_TASK_HANDLER } from '@/modules/cron/cron.constants'
import { TaskHandler, TaskHandlerResult } from '@/modules/cron/handlers/task-handler.interface'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

/** 供应商钱包余额同步：只负责触发 Finance；变化标记认领、Redis 读取和钱包表回写都由 Finance 完成，可安全重试。 */
@Injectable()
export class SrmWalletSyncTaskHandler implements TaskHandler {
    public readonly handler = SRM_WALLET_SYNC_TASK_HANDLER

    constructor(
        private readonly configService: ConfigService,
        private readonly financeFeignClient: feign.FeignClientFinanceManager,
        private readonly logger: Logger
    ) {}

    /** 使用服务间凭据触发待同步账户的余额回写，只保存统计数量，不保存余额。 */
    public async execute(): Promise<TaskHandlerResult> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        const startedAt = Date.now()
        const result = this.toResult(await this.financeFeignClient.httpBaseFinanceSyncSrmUserWallet(authorization))
        this.logger.log(`Finance 供应商余额同步返回（耗时 ${Date.now() - startedAt}ms）：${result.summary}`, SrmWalletSyncTaskHandler.name)
        return result
    }

    /** 把 Finance 的同步统计转换为结果摘要。 */
    public toResult(response: feign.FinanceSrmUserWalletSyncResponse): TaskHandlerResult {
        const invalidUserKeyIds = response.invalidUserKeyIds ?? []
        const parts = [response.total > 0 ? `本轮处理 ${response.total} 个余额变化账户` : '本轮无待同步余额']
        if (response.total > 0) parts.push(response.updated > 0 ? `更新 ${response.updated} 个` : '数据库余额均已一致')
        if (response.unchanged > 0) parts.push(`无需更新 ${response.unchanged} 个`)
        if (response.restored > 0) parts.push(`补齐 Redis ${response.restored} 个`)
        if (invalidUserKeyIds.length > 0) parts.push(`${invalidUserKeyIds.length} 个 Redis 余额格式错误：${invalidUserKeyIds.join('、')}`)
        return {
            summary: parts.join('，'),
            total: response.total,
            updated: response.updated,
            unchanged: response.unchanged,
            restored: response.restored,
            invalidUserKeyIds
        }
    }
}
