#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/localstack-env.sh"

docker_args=(
  --name "${LOCALSTACK_CONTAINER_NAME}"
  -p "127.0.0.1:${LOCALSTACK_EDGE_PORT}:4566"
  -v /var/run/docker.sock:/var/run/docker.sock
  -d
)

port_range_flag=()
if [[ -n "${LOCALSTACK_CONTAINER_LABEL:-}" ]]; then
  docker_args+=(--label "${LOCALSTACK_CONTAINER_LABEL}")
fi

if [[ -n "${LOCALSTACK_PORT_RANGE}" ]]; then
  port_range_flag=("-p" "127.0.0.1:${LOCALSTACK_PORT_RANGE}:4510-4559")
fi

if docker ps --filter "name=${LOCALSTACK_CONTAINER_NAME}" --format '{{.Names}}' | grep -q "^${LOCALSTACK_CONTAINER_NAME}$"; then
  echo "LocalStack container already running (${LOCALSTACK_CONTAINER_NAME})."
  exit 0
fi

if docker ps -a --filter "name=${LOCALSTACK_CONTAINER_NAME}" --format '{{.Names}}' | grep -q "^${LOCALSTACK_CONTAINER_NAME}$"; then
  echo "Removing stopped LocalStack container (${LOCALSTACK_CONTAINER_NAME})..."
  docker rm "${LOCALSTACK_CONTAINER_NAME}" >/dev/null
fi

echo "Starting LocalStack container (${LOCALSTACK_CONTAINER_NAME})..."
docker run "${docker_args[@]}" "${port_range_flag[@]}" "${LOCALSTACK_IMAGE}"

echo "Waiting for LocalStack health check..."
sleep 5
if curl -fs "http://localhost:${LOCALSTACK_EDGE_PORT}/_localstack/health" >/dev/null; then
  echo "LocalStack health check passed."
else
  echo "LocalStack may still be starting."
fi
