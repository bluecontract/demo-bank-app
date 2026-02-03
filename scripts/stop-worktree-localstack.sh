#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/demo-bank-app-localstack-ports.lock"
REGISTRY_FILE="${TMPDIR:-/tmp}/demo-bank-app-localstack-ports.registry"
REGISTRY_TTL_SECONDS="${LOCALSTACK_PORT_REGISTRY_TTL_SECONDS:-86400}"
LOCK_STALE_SECONDS="${LOCALSTACK_PORT_LOCK_STALE_SECONDS:-120}"

get_mtime() {
  local target="$1"
  if stat -f %m "${target}" >/dev/null 2>&1; then
    stat -f %m "${target}"
    return 0
  fi
  stat -c %Y "${target}"
}

acquire_lock() {
  local start
  local now
  start=$(date +%s)
  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    local lock_ts=""
    if [[ -f "${LOCK_DIR}/timestamp" ]]; then
      lock_ts=$(cat "${LOCK_DIR}/timestamp" 2>/dev/null || true)
    else
      lock_ts=$(get_mtime "${LOCK_DIR}" 2>/dev/null || true)
    fi
    now=$(date +%s)
    if [[ -n "${lock_ts}" && "${lock_ts}" =~ ^[0-9]+$ ]]; then
      if (( now - lock_ts > LOCK_STALE_SECONDS )); then
        echo "Stale port lock detected; clearing..." >&2
        rm -rf "${LOCK_DIR}"
        continue
      fi
    fi
    if (( now - start > 30 )); then
      echo "Timed out waiting for port lock (${LOCK_DIR})." >&2
      exit 1
    fi
    sleep 0.2
  done
  echo "$$" > "${LOCK_DIR}/pid"
  date +%s > "${LOCK_DIR}/timestamp"
}

release_lock() {
  rm -rf "${LOCK_DIR}"
}

cleanup_registry() {
  [[ -f "${REGISTRY_FILE}" ]] || return 0
  local now
  now=$(date +%s)
  local tmp="${REGISTRY_FILE}.tmp.$$"
  : > "${tmp}"
  while IFS='|' read -r id ts edge range bank web preview; do
    [[ -z "${id}" || "${id}" == \#* ]] && continue
    if [[ ! "${ts}" =~ ^[0-9]+$ ]]; then
      continue
    fi
    if (( now - ts <= REGISTRY_TTL_SECONDS )); then
      echo "${id}|${ts}|${edge}|${range}|${bank}|${web}|${preview}" >> "${tmp}"
    fi
  done < "${REGISTRY_FILE}"
  mv "${tmp}" "${REGISTRY_FILE}"
}

remove_registry_entry() {
  [[ -f "${REGISTRY_FILE}" ]] || return 0
  local tmp="${REGISTRY_FILE}.tmp.$$"
  : > "${tmp}"
  while IFS='|' read -r id ts edge range bank web preview; do
    [[ -z "${id}" || "${id}" == \#* ]] && continue
    if [[ "${id}" != "${WORKTREE_ID}" ]]; then
      echo "${id}|${ts}|${edge}|${range}|${bank}|${web}|${preview}" >> "${tmp}"
    fi
  done < "${REGISTRY_FILE}"
  mv "${tmp}" "${REGISTRY_FILE}"
}

ENV_FILE="${LOCALSTACK_ENV_FILE:-${REPO_ROOT}/.localstack.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run scripts/setup-worktree-localstack.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

WORKTREE_ID="${LOCALSTACK_WORKTREE_ID:-}"
if [[ -z "${WORKTREE_ID}" && -n "${LOCALSTACK_CONTAINER_NAME:-}" ]]; then
  WORKTREE_ID="${LOCALSTACK_CONTAINER_NAME#localstack-demo-bank-app-}"
  if [[ "${WORKTREE_ID}" == "${LOCALSTACK_CONTAINER_NAME}" ]]; then
    WORKTREE_ID=""
  fi
fi

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

CONTAINER_STOPPED="false"
CONTAINER_SKIPPED="false"
if [[ -n "${LOCALSTACK_CONTAINER_NAME:-}" ]]; then
  label_key="com.demo-bank-app.worktree"
  if docker inspect "${LOCALSTACK_CONTAINER_NAME}" >/dev/null 2>&1; then
    if [[ -n "${WORKTREE_ID}" ]]; then
      label_value=$(docker inspect -f "{{ index .Config.Labels \"${label_key}\" }}" "${LOCALSTACK_CONTAINER_NAME}" 2>/dev/null || true)
      if [[ -n "${label_value}" && "${label_value}" != "<no value>" && "${label_value}" != "${WORKTREE_ID}" ]]; then
        echo "LocalStack container label mismatch (${label_value}); skipping stop."
        CONTAINER_SKIPPED="true"
      else
        echo "Stopping LocalStack container ${LOCALSTACK_CONTAINER_NAME}"
        docker rm -f "${LOCALSTACK_CONTAINER_NAME}" >/dev/null 2>&1 || true
        CONTAINER_STOPPED="true"
      fi
    else
      echo "Stopping LocalStack container ${LOCALSTACK_CONTAINER_NAME}"
      docker rm -f "${LOCALSTACK_CONTAINER_NAME}" >/dev/null 2>&1 || true
      CONTAINER_STOPPED="true"
    fi
  fi
fi

if [[ -n "${WORKTREE_ID}" && "${CONTAINER_SKIPPED}" == "false" ]]; then
  acquire_lock
  trap release_lock EXIT
  cleanup_registry
  remove_registry_entry
fi
