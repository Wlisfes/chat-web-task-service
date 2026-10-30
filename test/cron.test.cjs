const test = require('node:test')
const assert = require('node:assert/strict')
const { HttpException } = require('@nestjs/common')
const { CronExecutionService } = require('../dist/modules/cron/cron-execution.service')
const { CronExpressionService } = require('../dist/modules/cron/cron-expression.service')
const { isRetryableTaskError, TaskNonRetryableError } = require('../dist/modules/cron/handlers/task-handler.interface')
const constants = require('../dist/modules/cron/cron.constants')
const { CurrencyExchangeTaskHandler } = require('../dist/modules/cron/handlers/currency-exchange.handler')
const { SrmWalletSyncTaskHandler } = require('../dist/modules/cron/handlers/srm-wallet-sync.handler')
const { getActiveRequestId } = require('@wlisfes/chat-web-base-schema/request-context')

const logger = { log() {}, warn() {}, error() {} }
const task = {
    taskId: '2149446185344106496',
    taskName: '汇率同步定时任务',
    handler: 'datetask-sync-exchange-rate',
    body: {},
    maxAttempts: 3
}

/** 内存版执行记录仓库，模拟唯一业务键、条件更新抢占和按状态查询。 */
function createRepository() {
    const rows = new Map()
    const match = (row, where) =>
        Object.entries(where).every(([key, value]) => (value && value._type === 'lessThan' ? row[key] < value._value : row[key] === value))
    return {
        rows,
        create: values => ({ ...values }),
        async insert(record) {
            for (const row of rows.values()) {
                if (row.bizKey === record.bizKey) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
            }
            rows.set(record.executionId, { ...record, createTime: new Date(), modifyTime: new Date() })
        },
        async findOne({ where }) {
            return [...rows.values()].find(row => match(row, where)) ?? null
        },
        async update(where, values) {
            let affected = 0
            for (const row of rows.values()) {
                if (match(row, where)) {
                    Object.assign(row, values, { modifyTime: new Date() })
                    affected += 1
                }
            }
            return { affected }
        },
        createQueryBuilder() {
            const state = {}
            const builder = {
                update: () => builder,
                set: values => ((state.set = values), builder),
                where: (_sql, params) => ((state.executionId = params.executionId), builder),
                andWhere: (_sql, params) => ((state.statuses = params.statuses), builder),
                async execute() {
                    const row = rows.get(state.executionId)
                    if (!row || !state.statuses.includes(row.status)) return { affected: 0 }
                    row.status = state.set.status
                    row.attempts += 1
                    row.nextRetryTime = null
                    row.startTime = row.startTime ?? new Date()
                    return { affected: 1 }
                }
            }
            return builder
        }
    }
}

function createService(handler, { publishFails = false } = {}) {
    const repository = createRepository()
    const published = []
    const rabbitmqService = {
        async publish(exchange, routingKey, payload) {
            if (publishFails) throw new Error('mq down')
            published.push([exchange, routingKey, payload.executionId])
        },
        async consume() {}
    }
    const handlers = handler ? [{ handler: task.handler, execute: handler }] : []
    return { service: new CronExecutionService(repository, rabbitmqService, handlers, logger), repository, published }
}

const systemInput = scheduledTime => ({ task, triggerType: 'system', scheduledTime, operatorUid: '0' })

test('系统调度同一计划时间只生成一条执行记录，多实例重复触发返回同一条', async () => {
    const { service, repository, published } = createService(async () => ({}))
    const at = new Date('2026-10-12T08:00:00+08:00')
    const first = await service.create(systemInput(at))
    const second = await service.create(systemInput(at))
    assert.equal(first.executionId, second.executionId)
    assert.equal(repository.rows.size, 1)
    assert.equal(published.length, 1)
    assert.match(first.bizKey, /^2149446185344106496:\d{14}$/)
    assert.equal(first.status, 'pending')
})

test('手动触发每次生成独立执行记录', async () => {
    const { service, repository } = createService(async () => ({}))
    await service.create({ task, triggerType: 'manual', scheduledTime: new Date(), operatorUid: '1001' })
    await service.create({ task, triggerType: 'manual', scheduledTime: new Date(), operatorUid: '1001' })
    assert.equal(repository.rows.size, 2)
    for (const row of repository.rows.values()) assert.match(row.bizKey, /:manual:\d+$/)
})

test('投递失败时执行记录仍保留为待执行且未标记投递时间，由补发扫描重投', async () => {
    const { service, repository } = createService(async () => ({}), { publishFails: true })
    const record = await service.create(systemInput(new Date()))
    const row = repository.rows.get(record.executionId)
    assert.equal(row.status, 'pending')
    assert.equal(row.publishTime, undefined)
})

test('执行成功写入结果摘要；重复投递同一条记录不会重复执行', async () => {
    let calls = 0
    let requestId
    const { service, repository } = createService(async () => {
        calls += 1
        requestId = getActiveRequestId()
        return { summary: '2026-10-12 新增 30 个币种汇率', date: '2026-10-12', inserted: 30 }
    })
    const record = await service.create(systemInput(new Date()))
    await service.consume({ executionId: record.executionId })
    await service.consume({ executionId: record.executionId })
    const row = repository.rows.get(record.executionId)
    assert.equal(calls, 1)
    assert.equal(row.status, 'success')
    assert.equal(row.attempts, 1)
    assert.deepEqual(row.result, { summary: '2026-10-12 新增 30 个币种汇率', date: '2026-10-12', inserted: 30 })
    // 每次尝试使用独立日志ID，下游 Feign 调用会通过 x-request-id 带上同一个ID。
    assert.equal(requestId, `task-${record.executionId}-1`)
})

test('可重试错误按梯度进入延迟重试队列，超过最大尝试次数后标记失败并进入死信', async () => {
    const { service, repository, published } = createService(async () => {
        throw new Error('Finance服务暂不可用')
    })
    const record = await service.create(systemInput(new Date()))
    await service.consume({ executionId: record.executionId })
    let row = repository.rows.get(record.executionId)
    assert.equal(row.status, 'retrying')
    assert.ok(row.nextRetryTime instanceof Date)
    assert.deepEqual(published.at(-1), ['', constants.taskRetryQueue(constants.TASK_RETRY_DELAYS_MS[0]), record.executionId])

    await service.consume({ executionId: record.executionId })
    assert.deepEqual(published.at(-1), ['', constants.taskRetryQueue(constants.TASK_RETRY_DELAYS_MS[1]), record.executionId])

    await service.consume({ executionId: record.executionId })
    row = repository.rows.get(record.executionId)
    assert.equal(row.attempts, 3)
    assert.equal(row.status, 'failed')
    assert.equal(row.error, 'Finance服务暂不可用')
    assert.deepEqual(published.at(-1), [constants.TASK_DEAD_EXCHANGE, constants.TASK_DEAD_ROUTING_KEY, record.executionId])
})

test('不可重试错误和未注册处理器直接标记失败', async () => {
    const nonRetryable = createService(async () => {
        throw new TaskNonRetryableError('参数错误')
    })
    const record = await nonRetryable.service.create(systemInput(new Date()))
    await nonRetryable.service.consume({ executionId: record.executionId })
    assert.equal(nonRetryable.repository.rows.get(record.executionId).status, 'failed')

    const missing = createService(undefined)
    const other = await missing.service.create(systemInput(new Date()))
    await missing.service.consume({ executionId: other.executionId })
    const row = missing.repository.rows.get(other.executionId)
    assert.equal(row.status, 'failed')
    assert.match(row.error, /未注册的任务处理器/)
})

test('错误分类：网络错误、5xx、408、429 可重试，其余 4xx 不重试', () => {
    assert.equal(isRetryableTaskError(new Error('ECONNREFUSED')), true)
    assert.equal(isRetryableTaskError(new HttpException('x', 503)), true)
    assert.equal(isRetryableTaskError(new HttpException('x', 429)), true)
    assert.equal(isRetryableTaskError(new HttpException('x', 400)), false)
    assert.equal(isRetryableTaskError(new TaskNonRetryableError('x')), false)
})

test('重试延迟梯度按尝试次数递增，超出梯度取最大值', () => {
    assert.equal(constants.taskRetryDelay(1), 60_000)
    assert.equal(constants.taskRetryDelay(2), 300_000)
    assert.equal(constants.taskRetryDelay(99), constants.TASK_RETRY_DELAYS_MS.at(-1))
})

test('Cron 表达式支持 5 段和 6 段并正确计算下次执行时间', () => {
    const cron = new CronExpressionService()
    assert.equal(cron.normalizeCron('  0  0 8,20 * * * '), '0 0 8,20 * * *')
    assert.throws(() => cron.normalizeCron('* * *'), /5段或6段/)
    assert.throws(() => cron.normalizeCron('0 0 25 * * *'), /第3段格式错误/)
    const next = cron.getNextRun('0 0 8,20 * * *', new Date(2026, 9, 12, 8, 0, 0, 500))
    assert.deepEqual([next.getHours(), next.getMinutes(), next.getSeconds()], [20, 0, 0])
    const fiveField = cron.getNextRun('30 9 * * *', new Date(2026, 9, 12, 10, 0, 0))
    assert.deepEqual([fiveField.getDate(), fiveField.getHours(), fiveField.getMinutes()], [13, 9, 30])
})

function createCurrencyHandler(response) {
    const financeFeignClient = { httpBaseFinanceSyncCurrencyExchange: async () => response }
    const configService = { get: key => (key === 'gateway.feign.service_token' ? 'service-token' : undefined) }
    return new CurrencyExchangeTaskHandler(configService, financeFeignClient, logger)
}

test('汇率任务结果包含一句说明和统计明细，不保存汇率数值', async () => {
    const result = await createCurrencyHandler({
        date: '2026-10-12',
        count: 28,
        list: [{ currency: 'CNY', rate: 7.1, date: '2026-10-12' }],
        source: 'Open Exchange Rates',
        fetched: 170,
        enabled: 30,
        inserted: 28,
        skipped: 0,
        insertedCurrencies: ['CNY', 'EUR'],
        skippedCurrencies: [],
        missingCurrencies: ['XAU', 'XAG']
    }).execute()
    assert.equal(
        result.summary,
        '2026-10-12 新增 28 个币种汇率，2 个启用币种未返回汇率：XAU、XAG（来源 Open Exchange Rates，外部返回 170 个）'
    )
    assert.equal(result.inserted, 28)
    assert.deepEqual(result.missingCurrencies, ['XAU', 'XAG'])
    assert.equal(JSON.stringify(result).includes('7.1'), false)
})

test('汇率已存在时说明跳过数量；兼容旧版只返回 date、count 的结果', async () => {
    const existing = await createCurrencyHandler({
        date: '2026-10-12',
        count: 0,
        list: [],
        source: 'Open Exchange Rates',
        fetched: 170,
        enabled: 30,
        inserted: 0,
        skipped: 30
    }).execute()
    assert.equal(existing.summary, '2026-10-12 汇率已存在，跳过 30 个币种（来源 Open Exchange Rates，外部返回 170 个）')
    const legacy = await createCurrencyHandler({ date: '2026-10-12', count: 0, list: [] }).execute()
    assert.equal(legacy.summary, '2026-10-12 没有需要新增的币种汇率')
})

function createWalletHandler(response) {
    const financeFeignClient = { httpBaseFinanceSyncSrmUserWallet: async () => response }
    const configService = { get: key => (key === 'gateway.feign.service_token' ? 'service-token' : undefined) }
    return new SrmWalletSyncTaskHandler(configService, financeFeignClient, logger)
}

test('供应商余额同步任务：每分钟执行，结果只保存统计数量', async () => {
    const definition = constants.TASK_CRON_DEFINITIONS.find(item => item.handler === 'datetask-sync-srm-wallet-balance')
    assert.equal(definition.cron, '0 * * * * *')
    assert.equal(definition.module, 'TASK_FINANCE')
    const next = new CronExpressionService().getNextRun(definition.cron, new Date(2026, 9, 12, 8, 0, 10))
    assert.deepEqual([next.getHours(), next.getMinutes(), next.getSeconds()], [8, 1, 0])
    const result = await createWalletHandler({ total: 4, updated: 1, unchanged: 2, restored: 1, invalidUserKeyIds: [10241009] }).execute()
    assert.equal(result.summary, '本轮处理 4 个余额变化账户，更新 1 个，无需更新 2 个，补齐 Redis 1 个，1 个 Redis 余额格式错误：10241009')
    const idle = await createWalletHandler({ total: 4, updated: 0, unchanged: 4, restored: 0, invalidUserKeyIds: [] }).execute()
    assert.equal(idle.summary, '本轮处理 4 个余额变化账户，数据库余额均已一致，无需更新 4 个')
    const empty = await createWalletHandler({ total: 0, updated: 0, unchanged: 0, restored: 0, invalidUserKeyIds: [] }).execute()
    assert.equal(empty.summary, '本轮无待同步余额')
})
