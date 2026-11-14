# Task 服务部署与故障恢复手册

## 职责与边界

- 负责全部周期任务的调度与执行；业务数据（汇率等）由下游服务保存，task 库只存调度定义和执行状态。
- 接口不对外暴露：Gateway 只配置 `/feign/task`，不配置 `/api/task`；容器与其他服务一致发布宿主机端口 `5010`（由 Windows 防火墙限制入口），不配置 `NACOS_REGISTER_IP`。
- Skyline 崩溃不影响调度与执行，只会让管理页面暂时不可用；本服务多实例部署时任一实例崩溃不影响其他实例。

## Nacos 配置（`chat-web-task-service.yaml`）

```yaml
server:
  port: 5010

# 服务间调用：调用 Finance 等服务时使用的网关地址、超时和服务间凭据（与其他服务一致）。
gateway:
  feign:
    url: http://chat-web-gateway-service:5000
    timeout: 10000
    service_token: <与其他服务一致的服务间凭据>
  principal:
    secret: <与 Gateway 一致>
    maxAgeSeconds: 60

# Task 专属 MySQL，账号只授权 chat-web-task 库。
database:
  chat-web-task:
    host: mysql
    port: 3306
    database: chat-web-task
    username: chat_web_task_service
    password: <密码>
    charset: utf8mb4
    timezone: "+08:00"

# Task 专属 RabbitMQ 虚拟主机，必须为 /chat-task。
rabbitmq:
  host: chat-web-rabbitmq
  port: 5672
  vhost: /chat-task
  username: chat_web_task_service
  password: <密码>
  prefetch: 10
```

Skyline 的 Nacos 配置需补充 `gateway.feign.task_timeout: 15000`：手动触发会在 Task 服务端最多等待 10 秒。

## 队列拓扑

| 名称 | 说明 |
|---|---|
| `chat.task.exchange` → `chat.task.execute` | 主交换机和执行队列 |
| `chat.task.retry.<毫秒>` | 延迟重试队列（1 分钟、5 分钟、15 分钟、30 分钟、1 小时、2 小时、4 小时），TTL 到期后转回主队列 |
| `chat.task.dead.exchange` → `chat.task.dead` | 最终失败的消息，供人工排查 |

拓扑由服务启动和每次重连时自动声明，无需手工创建。

## 从 Skyline 迁移任务数据

迁移已完成。来源表 `tb_skyline_datetask_system`、`tb_skyline_datetask_log` 已删除，不要再执行旧的插入语句。当前任务和执行记录分别在 `tb_task_cron`、`tb_task_execution`。
## 上线验证

1. `docker port chat-web-task-service` 输出 `5010/tcp -> 0.0.0.0:5010`。
2. `docker exec chat-web-task-service node -e "require('http').get('http://127.0.0.1:5010/health/live', r => process.exit(r.statusCode === 200 ? 0 : 1))"` 返回 0。
3. 公网 `https://chat-web.lisfes.cn/api/task/health/live` 返回业务 404。
4. RabbitMQ 管理台 `/chat-task` 虚拟主机中可见 `chat.task.execute` 及其消费者。
5. 管理端“系统任务管理”页面可以列表、启停、改 Cron、手动触发并查看执行日志。

## 日志排障

```bash
docker logs --tail 200 chat-web-task-service
```

- `执行记录投递失败，等待补发`：RabbitMQ 暂不可用，恢复后补发扫描会自动重投，无需处理。
- `任务执行最终失败`：已超过最大尝试次数，消息进入 `chat.task.dead`；排查原因后在管理端手动触发一次即可补执行。
- `RabbitMQ重连失败`：检查 `chat-web-rabbitmq` 容器、虚拟主机和账号权限。
