#!/bin/sh
set -eu

IMAGE=${1:?Usage: deploy.sh IMAGE [COMPOSE_FILE]}
SERVICE_VERSION=${SERVICE_VERSION:-${IMAGE##*:}}
COMPOSE_FILE=${2:-compose.yml}
SERVICE=task-service
CONTAINER=chat-web-task-service
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}
PULL_ATTEMPTS=${PULL_ATTEMPTS:-8}
deployment_started=0

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "Missing $(pwd)/.env; create it from deploy/.env.example before the first deployment." >&2
    exit 1
fi

network=$(sed -n 's/^DOCKER_NETWORK=//p' .env | tail -n 1 | tr -d '\r')
network=${network:-chat-web-infrastructure}
case "$network" in
    *[!A-Za-z0-9_.-]*|'')
        echo "Invalid DOCKER_NETWORK in .env" >&2
        exit 1
        ;;
esac

if ! docker network inspect "$network" >/dev/null 2>&1; then
    echo "Required Docker network is unavailable: $network" >&2
    exit 1
fi

old_image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)

compose() {
    IMAGE="$IMAGE" SERVICE_VERSION="$SERVICE_VERSION" docker compose -f "$COMPOSE_FILE" "$@"
}

rollback() {
    echo "Deployment failed; showing the latest Task logs." >&2
    docker logs --tail 100 "$CONTAINER" 2>&1 || true

    if [ -n "$old_image" ] && [ "$old_image" != "$IMAGE" ]; then
        echo "Rolling back to $old_image" >&2
        IMAGE="$old_image" SERVICE_VERSION="${old_image##*:}" docker compose -f "$COMPOSE_FILE" up -d --no-deps "$SERVICE"
    else
        echo "No previous image is available for rollback." >&2
    fi
}

# shellcheck disable=SC2329 # Invoked indirectly by trap.
handle_interrupt() {
    trap - HUP INT TERM
    echo "Deployment interrupted by a newer version." >&2
    if [ "$deployment_started" -eq 1 ]; then
        rollback
    fi
    exit 130
}

trap handle_interrupt HUP INT TERM

attempt=1
until docker pull "$IMAGE"; do
    if [ "$attempt" -ge "$PULL_ATTEMPTS" ]; then
        echo "Failed to pull $IMAGE after $PULL_ATTEMPTS attempts." >&2
        exit 1
    fi
    delay=$((attempt * 5))
    echo "Image pull attempt $attempt failed; retrying in ${delay}s." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
done

compose config >/dev/null

# 先以临时的单库账号执行共享包提供的增量 SQL，确保新镜像启动时实体结构已经就绪。
# 部署环境中的 Nacos 数据库账号可能是管理员账号；引导脚本不会直接用该账号执行业务 DDL，
# 而是创建仅能访问 Task 数据库的临时账号，迁移结束后立即回收。
if ! docker run --rm --network "$network" --env-file .env --entrypoint node "$IMAGE" dist/cli/apply-schema-bootstrap.js; then
    echo "Task 数据库 Schema 更新失败，保留当前运行版本。" >&2
    exit 1
fi

deployment_started=1
if ! compose up -d --no-deps "$SERVICE"; then
    rollback
    exit 1
fi

elapsed=0
state=starting
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || true)
    case "$state" in
        healthy)
            break
            ;;
        exited|dead|unhealthy)
            echo "Container state: $state" >&2
            rollback
            exit 1
            ;;
    esac
    sleep 3
    elapsed=$((elapsed + 3))
done

if [ "$state" != "healthy" ]; then
    echo "Health check timed out after ${HEALTH_TIMEOUT}s." >&2
    rollback
    exit 1
fi

if ! docker exec "$CONTAINER" node -e "require('http').get('http://127.0.0.1:5010/health/live', response => process.exit(response.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; then
    echo "Task liveness endpoint failed after the container became healthy." >&2
    rollback
    exit 1
fi

# Task 服务必须注册容器网卡 IP；误配 NACOS_REGISTER_IP 会让 Gateway 访问不到实例，直接拒绝部署。
if grep -q '^NACOS_REGISTER_IP=' .env; then
    echo "Task 服务不得配置 NACOS_REGISTER_IP，请从 $(pwd)/.env 删除该项。" >&2
    rollback
    exit 1
fi

actual_image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
if [ "$actual_image" != "$IMAGE" ]; then
    echo "Running image mismatch: expected $IMAGE, got $actual_image" >&2
    rollback
    exit 1
fi

trap - HUP INT TERM
echo "Deployment succeeded: $IMAGE"
docker image prune -f >/dev/null 2>&1 || true
