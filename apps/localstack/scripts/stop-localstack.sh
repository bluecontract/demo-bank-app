#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/localstack-env.sh"

if docker inspect "${LOCALSTACK_CONTAINER_NAME}" >/dev/null 2>&1; then
  if [[ -n "${LOCALSTACK_WORKTREE_ID:-}" ]]; then
    label_key="com.demo-bank-app.worktree"
    label_value=$(docker inspect -f "{{ index .Config.Labels \"${label_key}\" }}" "${LOCALSTACK_CONTAINER_NAME}" 2>/dev/null || true)
    if [[ -n "${label_value}" && "${label_value}" != "<no value>" && "${label_value}" != "${LOCALSTACK_WORKTREE_ID}" ]]; then
      echo "LocalStack container label mismatch (${label_value}); skipping stop."
      exit 0
    fi
  fi
  docker stop "${LOCALSTACK_CONTAINER_NAME}" || true
fi
