#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

resolve_worktree_id() {
  if [[ -n "${CURSOR_CLOUD_WORKTREE_ID:-}" ]]; then
    echo "${CURSOR_CLOUD_WORKTREE_ID}"
    return 0
  fi

  local raw_id
  raw_id="$(basename "${REPO_ROOT}" | tr -cd '[:alnum:]')"

  if [[ -z "${raw_id}" ]]; then
    echo "cld"
    return 0
  fi

  if [[ ${#raw_id} -le 5 ]]; then
    echo "${raw_id}"
    return 0
  fi

  echo "${raw_id: -5}"
}

ensure_docker_daemon() {
  if docker version >/dev/null 2>&1; then
    sudo chmod 666 /var/run/docker.sock || true
    return 0
  fi

  sudo service docker start >/tmp/demo-bank-app-docker-service.log 2>&1 || true

  if docker version >/dev/null 2>&1; then
    sudo chmod 666 /var/run/docker.sock || true
    return 0
  fi

  sudo pkill -f 'dockerd' >/dev/null 2>&1 || true
  sudo bash -lc 'nohup /usr/bin/dockerd >/tmp/demo-bank-app-dockerd.log 2>&1 &'

  for _ in {1..30}; do
    if [[ -S /var/run/docker.sock ]]; then
      sudo chmod 666 /var/run/docker.sock || true
    fi

    if docker version >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "Docker daemon did not become ready. Check /tmp/demo-bank-app-docker-service.log and /tmp/demo-bank-app-dockerd.log" >&2
  return 1
}

cd "${REPO_ROOT}"
ensure_docker_daemon
"${REPO_ROOT}/scripts/setup-worktree-localstack.sh" "$(resolve_worktree_id)"
