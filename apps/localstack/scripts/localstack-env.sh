#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

ENV_FILE="${LOCALSTACK_ENV_FILE:-${REPO_ROOT}/.localstack.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

LOCALSTACK_CONTAINER_NAME="${LOCALSTACK_CONTAINER_NAME:-localstack-demo-bank-app}"
LOCALSTACK_EDGE_PORT="${LOCALSTACK_EDGE_PORT:-4566}"
if [[ -z "${LOCALSTACK_PORT_RANGE+x}" ]]; then
  LOCALSTACK_PORT_RANGE="4510-4559"
fi
LOCALSTACK_IMAGE="${LOCALSTACK_IMAGE:-localstack/localstack}"

export LOCALSTACK_CONTAINER_NAME
export LOCALSTACK_EDGE_PORT
export LOCALSTACK_PORT_RANGE
export LOCALSTACK_IMAGE
