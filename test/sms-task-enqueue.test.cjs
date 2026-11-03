const test = require('node:test')
const assert = require('node:assert/strict')
const { SmsTaskEnqueueTaskHandler } = require('../dist/modules/cron/handlers/sms-task-enqueue.handler')

test('每小时扫描调用短信服务入队并记录数量', async () => {
    const calls = []
    const handler = new SmsTaskEnqueueTaskHandler(
        { get: () => 'token' },
        {
            async httpBaseSmsTaskEnqueue(authorization, input) {
                calls.push([authorization, input])
                return { scanned: 3, enqueued: 2, skipped: 1 }
            }
        },
        { log() {} }
    )
    const result = await handler.execute()
    assert.equal(calls.length, 1)
    assert.deepEqual(result, {
        summary: '扫描 3 个，入队 2 个，跳过 1 个',
        scanned: 3,
        enqueued: 2,
        skipped: 1
    })
})
