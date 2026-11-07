import { Logger, Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { FeignClientFinanceManager, FeignClientSmsManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { CronExecutionService } from '@/modules/cron/cron-execution.service'
import { CronExpressionService } from '@/modules/cron/cron-expression.service'
import { CronInitializerService } from '@/modules/cron/cron-initializer.service'
import { CronSchedulerService } from '@/modules/cron/cron-scheduler.service'
import { CronService } from '@/modules/cron/cron.service'
import { CurrencyExchangeTaskHandler } from '@/modules/cron/handlers/currency-exchange.handler'
import { ExecutionLogPurgeTaskHandler } from '@/modules/cron/handlers/execution-log-purge.handler'
import { SmsTaskEnqueueTaskHandler } from '@/modules/cron/handlers/sms-task-enqueue.handler'
import { CrmWalletSyncTaskHandler } from '@/modules/cron/handlers/crm-wallet-sync.handler'
import { SrmWalletSyncTaskHandler } from '@/modules/cron/handlers/srm-wallet-sync.handler'
import { TASK_HANDLERS, TaskHandler } from '@/modules/cron/handlers/task-handler.interface'

/** 周期任务模块：调度、执行、重试和对内管理接口实现。新增任务时在 TASK_HANDLERS 中注册处理器。 */
@Module({
    imports: [ScheduleModule.forRoot(), FeignModule.register([FeignClientFinanceManager, FeignClientSmsManager])],
    providers: [
        Logger,
        CronExpressionService,
        CronExecutionService,
        CronSchedulerService,
        CronInitializerService,
        CronService,
        CurrencyExchangeTaskHandler,
        SrmWalletSyncTaskHandler,
        CrmWalletSyncTaskHandler,
        SmsTaskEnqueueTaskHandler,
        ExecutionLogPurgeTaskHandler,
        {
            provide: TASK_HANDLERS,
            inject: [CurrencyExchangeTaskHandler, SrmWalletSyncTaskHandler, CrmWalletSyncTaskHandler, SmsTaskEnqueueTaskHandler],
            useFactory: (...handlers: TaskHandler[]) => handlers
        }
    ],
    exports: [CronService]
})
export class CronModule {}
