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

LOCALSTACK_WORKTREE_ID="${LOCALSTACK_WORKTREE_ID:-}"
if [[ -z "${LOCALSTACK_CONTAINER_NAME:-}" ]]; then
  if [[ -n "${LOCALSTACK_WORKTREE_ID}" ]]; then
    LOCALSTACK_CONTAINER_NAME="localstack-demo-bank-app-${LOCALSTACK_WORKTREE_ID}"
  else
    LOCALSTACK_CONTAINER_NAME="localstack-demo-bank-app"
  fi
fi
LOCALSTACK_EDGE_PORT="${LOCALSTACK_EDGE_PORT:-4566}"
if [[ -z "${LOCALSTACK_PORT_RANGE+x}" ]]; then
  LOCALSTACK_PORT_RANGE="4510-4559"
fi
LOCALSTACK_IMAGE="${LOCALSTACK_IMAGE:-localstack/localstack}"
LOCALSTACK_CONTAINER_LABEL="${LOCALSTACK_CONTAINER_LABEL:-}"
if [[ -z "${LOCALSTACK_CONTAINER_LABEL}" && -n "${LOCALSTACK_WORKTREE_ID}" ]]; then
  LOCALSTACK_CONTAINER_LABEL="com.demo-bank-app.worktree=${LOCALSTACK_WORKTREE_ID}"
fi

export LOCALSTACK_CONTAINER_NAME
export LOCALSTACK_WORKTREE_ID
export LOCALSTACK_CONTAINER_LABEL
export LOCALSTACK_EDGE_PORT
export LOCALSTACK_PORT_RANGE
export LOCALSTACK_IMAGE
