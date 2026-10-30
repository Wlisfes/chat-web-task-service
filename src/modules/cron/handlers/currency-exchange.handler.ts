import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CURRENCY_EXCHANGE_TASK_HANDLER } from '@/modules/cron/cron.constants'
import { TaskHandler, TaskHandlerResult } from '@/modules/cron/handlers/task-handler.interface'
import * as feign from '@wlisfes/chat-web-base-schema/feign'

/** 汇率同步：只负责触发 Finance 服务，汇率拉取、过滤和持久化全部由 Finance 完成，Finance 按日期去重可安全重试。 */
@Injectable()
export class CurrencyExchangeTaskHandler implements TaskHandler {
    public readonly handler = CURRENCY_EXCHANGE_TASK_HANDLER

    constructor(
        private readonly configService: ConfigService,
        private readonly financeFeignClient: feign.FeignClientFinanceManager,
        private readonly logger: Logger
    ) {}

    /** 使用服务间凭据触发 Finance 汇率同步，保存一句结果说明和统计明细，不保存汇率数值。 */
    public async execute(): Promise<TaskHandlerResult> {
        const authorization = feign.resolveFeignServiceAuthorization(this.configService)
        this.logger.log('调用 Finance 汇率同步：POST /feign/finance/currency/exchange/sync', CurrencyExchangeTaskHandler.name)
        const startedAt = Date.now()
        const response = await this.financeFeignClient.httpBaseFinanceSyncCurrencyExchange(authorization)
        const result = this.toResult(response)
        this.logger.log(`Finance 汇率同步返回（耗时 ${Date.now() - startedAt}ms）：${result.summary}`, CurrencyExchangeTaskHandler.name)
        return result
    }

    /** 把 Finance 的同步统计转换为结果摘要；兼容旧版 Finance 只返回 date、count 的情况。 */
    public toResult(response: feign.FinanceCurrencyExchangeSyncResponse): TaskHandlerResult {
        const inserted = response.inserted ?? response.count ?? 0
        const insertedCurrencies = response.insertedCurrencies ?? response.list?.map(item => item.currency) ?? []
        const skipped = response.skipped
        const missingCurrencies = response.missingCurrencies ?? []
        const parts: string[] = []
        if (inserted > 0) parts.push(`新增 ${inserted} 个币种汇率`)
        if (skipped !== undefined && skipped > 0) parts.push(`${inserted > 0 ? '' : '汇率已存在，'}跳过 ${skipped} 个币种`)
        if (parts.length === 0) parts.push('没有需要新增的币种汇率')
        if (missingCurrencies.length > 0) parts.push(`${missingCurrencies.length} 个启用币种未返回汇率：${missingCurrencies.join('、')}`)
        const source = response.source
            ? `（来源 ${response.source}${response.fetched !== undefined ? `，外部返回 ${response.fetched} 个` : ''}）`
            : ''
        return {
            summary: `${response.date} ${parts.join('，')}${source}`,
            date: response.date,
            ...(response.source ? { source: response.source } : {}),
            ...(response.fetched !== undefined ? { fetched: response.fetched } : {}),
            ...(response.enabled !== undefined ? { enabled: response.enabled } : {}),
            inserted,
            ...(skipped !== undefined ? { skipped } : {}),
            insertedCurrencies,
            ...(response.skippedCurrencies ? { skippedCurrencies: response.skippedCurrencies } : {}),
            missingCurrencies
        }
    }
}
