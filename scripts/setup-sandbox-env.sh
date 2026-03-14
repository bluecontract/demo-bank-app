#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

resolve_worktree_id() {
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return 0
  fi

  local raw_id
  raw_id="$(basename "${REPO_ROOT}" | tr -cd '[:alnum:]')"

  if [[ -z "${raw_id}" ]]; then
    echo "sbx"
    return 0
  fi

  if [[ ${#raw_id} -le 5 ]]; then
    echo "${raw_id}"
    return 0
  fi

  echo "${raw_id: -5}"
}

ensure_symlink() {
  local source_path="$1"
  local target_path="$2"

  if [[ -x "${source_path}" ]]; then
    sudo ln -sf "${source_path}" "${target_path}"
  fi
}

ensure_docker_daemon() {
  if docker version >/dev/null 2>&1; then
    sudo chmod 666 /var/run/docker.sock || true
    return 0
  fi

  if sudo docker version >/dev/null 2>&1; then
    sudo chmod 666 /var/run/docker.sock || true
    return 0
  fi

  sudo pkill -f 'dockerd --iptables=false --storage-driver=vfs' >/dev/null 2>&1 || true
  sudo bash -lc 'nohup /usr/bin/dockerd --iptables=false --storage-driver=vfs >/tmp/demo-bank-app-dockerd.log 2>&1 &'

  for _ in {1..30}; do
    if [[ -S /var/run/docker.sock ]]; then
      sudo chmod 666 /var/run/docker.sock || true
    fi

    if docker version >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "Docker daemon did not become ready. Check /tmp/demo-bank-app-dockerd.log" >&2
  return 1
}

WORKTREE_ID="$(resolve_worktree_id "${1:-}")"

sudo apt-get update
sudo apt-get install -y docker.io jq unzip
python3 -m pip install --user --upgrade awscli aws-sam-cli-local

ensure_symlink "${HOME}/.local/bin/aws" "/usr/local/bin/aws"
ensure_symlink "${HOME}/.local/bin/sam" "/usr/local/bin/sam"
ensure_symlink "${HOME}/.local/bin/samlocal" "/usr/local/bin/samlocal"

ensure_docker_daemon

cd "${REPO_ROOT}"
"${REPO_ROOT}/scripts/setup-worktree-localstack.sh" "${WORKTREE_ID}"

cat <<EOF
Sandbox environment is ready.

Next steps:
  source .localstack.env
  npm install
  npm run serve:all
  npm run verify:full
EOF
