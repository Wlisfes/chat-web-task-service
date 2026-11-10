# 部署变更记录

## 2026-11-10：发布宿主机端口与 Nacos 长轮询超时

- 影响机器：`chat-home-server`。
- 变更内容：Compose 增加 `5010` 宿主机端口映射，与其他服务保持一致；升级 `@wlisfes/chat-web-base-schema` 到 1.7.38，Nacos 配置长轮询客户端超时由 40 秒延长到 180 秒。
- 验证命令：`docker port chat-web-task-service` 输出 `5010/tcp -> 0.0.0.0:5010`；容器健康检查通过。
- 回滚方法：恢复上一版本 Compose 并回退到上一镜像。

## 2026-10-12：修复 RabbitMQ 首次连接未声明拓扑

- 影响机器：`chat-home-server`。
- 变更内容：升级 `@wlisfes/chat-web-base-schema` 到 1.6.87，修复首次连接时未创建通道、未声明 `/chat-task` 队列拓扑、未订阅 `chat.task.execute` 的问题。
- 验证命令：`docker exec chat-web-rabbitmq rabbitmqctl list_queues -p /chat-task name messages consumers`，`chat.task.execute` 消费者数为 1。
- 回滚方法：回退到上一镜像（回退后任务无法投递，仅用于紧急排障）。

## 2026-10-12：Task 服务接管定时任务

- 影响机器：`chat-home-server`。
- 变更内容：定时任务从 Skyline 迁出到本服务；本服务负责 Cron 调度、执行记录、RabbitMQ 投递、失败重试与死信。只开放 `/feign/task` 服务间接口，管理端经 Skyline 转发；容器不发布宿主机端口。
- 部署方式：新增 GitHub Actions 发布流水线，`main` 推送后构建镜像并由 `chat-home-server` 的 self-hosted runner（`/home/runner/actions-runner-task`）部署到 `/opt/chat-web-task-service`；部署前会从 `.env` 删除 `NACOS_REGISTER_IP`，部署后校验未发布宿主机端口且 Gateway 的 `/api/task` 不可访问。
- 依赖：发布包含 `chat-web-task-mysql`、Task Feign 契约和 RabbitMQ 运行时模块的新版 `@wlisfes/chat-web-base-schema`；Gateway 增加 `/feign/task` 路由；Skyline 与管理端同步发布。
- 机器侧操作（已于 2026-10-12 全部完成，迁移 1 条任务）：
    1. MySQL 新建 `chat-web-task` 库和只授权该库的 `chat_web_task_service` 账号。
    2. RabbitMQ 新建虚拟主机 `/chat-task` 和只授权该虚拟主机的账号。
    3. Nacos 新建 `chat-web-task-service.yaml`（见 RUNBOOK），Skyline 的 Nacos 配置补充 `gateway.feign.task_timeout: 15000`。
    4. 部署后执行 RUNBOOK 中的“从 Skyline 迁移任务数据”。
- 验证命令：见 RUNBOOK“上线验证”。
- 回滚方法：回退 Skyline、管理端到迁出前的版本（Skyline 旧表仍保留，可直接恢复调度）；停止本服务容器。
