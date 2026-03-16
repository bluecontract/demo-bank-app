#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/localstack-env.sh"

LOCALSTACK_START_TIMEOUT_SECONDS="${LOCALSTACK_START_TIMEOUT_SECONDS:-60}"
LOCALSTACK_START_POLL_INTERVAL_SECONDS="${LOCALSTACK_START_POLL_INTERVAL_SECONDS:-2}"

wait_for_localstack() {
  local health_url="http://localhost:${LOCALSTACK_EDGE_PORT}/_localstack/health"
  local elapsed=0

  echo "Waiting for LocalStack health check..."

  while (( elapsed < LOCALSTACK_START_TIMEOUT_SECONDS )); do
    if curl -fs "${health_url}" >/dev/null; then
      echo "LocalStack health check passed."
      return 0
    fi

    sleep "${LOCALSTACK_START_POLL_INTERVAL_SECONDS}"
    elapsed=$((elapsed + LOCALSTACK_START_POLL_INTERVAL_SECONDS))
  done

  echo "LocalStack failed to become healthy within ${LOCALSTACK_START_TIMEOUT_SECONDS}s." >&2
  docker logs "${LOCALSTACK_CONTAINER_NAME}" --tail 100 >&2 || true
  return 1
}

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not available. Start Docker and retry."
  exit 1
fi

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
  wait_for_localstack
  exit $?
fi

if docker ps -a --filter "name=${LOCALSTACK_CONTAINER_NAME}" --format '{{.Names}}' | grep -q "^${LOCALSTACK_CONTAINER_NAME}$"; then
  echo "Removing stopped LocalStack container (${LOCALSTACK_CONTAINER_NAME})..."
  docker rm "${LOCALSTACK_CONTAINER_NAME}" >/dev/null
fi

echo "Starting LocalStack container (${LOCALSTACK_CONTAINER_NAME})..."
if [[ ${#port_range_flag[@]} -gt 0 ]]; then
  docker run "${docker_args[@]}" "${port_range_flag[@]}" "${LOCALSTACK_IMAGE}"
else
  docker run "${docker_args[@]}" "${LOCALSTACK_IMAGE}"
fi

wait_for_localstack
