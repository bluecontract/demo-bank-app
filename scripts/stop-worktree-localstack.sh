#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${LOCALSTACK_ENV_FILE:-${REPO_ROOT}/.localstack.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run scripts/setup-worktree-localstack.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

if command -v lsof >/dev/null 2>&1; then
  for port in "${BANK_API_PORT:-}" "${WEB_APP_PORT:-}" "${WEB_APP_PREVIEW_PORT:-}"; do
    if [[ -n "${port}" ]]; then
      pids=$(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)
      if [[ -n "${pids}" ]]; then
        echo "Stopping processes on port ${port}: ${pids}"
        kill ${pids} >/dev/null 2>&1 || true
      fi
    fi
  done
else
  echo "lsof not found; skipping port-based process stop."
fi

if [[ -n "${LOCALSTACK_CONTAINER_NAME:-}" ]]; then
  echo "Stopping LocalStack container ${LOCALSTACK_CONTAINER_NAME}"
  docker rm -f "${LOCALSTACK_CONTAINER_NAME}" >/dev/null 2>&1 || true
fi
