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

首次上线、确认本服务已启动并完成建表后，在 MySQL 中执行一次（需要能同时访问两个库的管理员账号）：

```sql
INSERT INTO `chat-web-task`.`tb_task_cron`
    (task_id, task_name, module, handler, comment, cron, status, body, max_attempts, last_time, next_time, create_by, modify_by)
SELECT task_id, task_name, 'TASK_FINANCE', handler, comment, cron,
       CASE WHEN status IN ('running', 'wait') THEN 'enable' ELSE 'disable' END,
       body, 8, last_time, next_time, create_by, modify_by
  FROM `chat-web-skyline`.`tb_skyline_datetask_system`
ON DUPLICATE KEY UPDATE cron = VALUES(cron), status = VALUES(status), last_time = VALUES(last_time);
```

- 执行后重启 Task 服务，使调度器按迁移后的 Cron 和状态重新加载。
- Skyline 的历史执行日志不迁移，旧表 `tb_skyline_datetask_system`、`tb_skyline_datetask_log` 保留到确认稳定后再删除。

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
