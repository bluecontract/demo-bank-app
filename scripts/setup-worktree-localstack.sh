#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/setup-worktree-localstack.sh <worktree-id> [edge-port] [port-range] [bank-api-port] [web-app-port] [shared-secrets-file]

Examples:
  scripts/setup-worktree-localstack.sh wt1 4567 5510-5559 3001 4201 /Users/you/secrets/demo-bank-app.bank-api.json
  scripts/setup-worktree-localstack.sh wt2

Notes:
- This writes .localstack.env in the repo root (gitignored).
- It creates apps/bank-api/env.local.worktree.json (gitignored) if missing.
- ports are optional; when omitted, the script picks the closest free ports to defaults.
- port-range is optional; omit or pass empty to disable the 4510-4559 mapping.
- If shared-secrets-file is omitted and bank-api.env.local.json exists at the repo root,
  it will be used automatically.
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" || ${1:-} == "" ]]; then
  usage
  exit 1
fi

WORKTREE_ID="$1"
EDGE_PORT="${2:-}"
PORT_RANGE="${3:-}"
BANK_API_PORT="${4:-}"
WEB_APP_PORT="${5:-}"
SHARED_SECRETS_FILE="${6:-${SHARED_SECRETS_FILE:-}}"
AUTO_PICKED_PORTS=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

is_port_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  python3 - <<'PY' "${port}" || exit 1
import socket, sys
port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind(("127.0.0.1", port))
    print("free")
    sys.exit(0)
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
}

declare -a RESERVED_PORTS=()
reserve_port() {
  RESERVED_PORTS+=("$1")
}

is_port_available() {
  local port="$1"
  for reserved in "${RESERVED_PORTS[@]-}"; do
    if [[ "${port}" == "${reserved}" ]]; then
      return 1
    fi
  done
  is_port_free "${port}"
}

find_nearest_free_port() {
  local base="$1"
  local max_offset="${2:-200}"
  local candidate=""
  for ((i=0; i<=max_offset; i++)); do
    candidate=$((base + i))
    if [[ "${candidate}" -ge 1024 ]] && is_port_available "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
    if [[ "${i}" -ne 0 ]]; then
      candidate=$((base - i))
      if [[ "${candidate}" -ge 1024 ]] && is_port_available "${candidate}"; then
        echo "${candidate}"
        return 0
      fi
    fi
  done
  return 1
}

find_free_range() {
  local base_start="$1"
  local size="$2"
  local step="$3"
  local max_steps="${4:-20}"
  local start=""
  local candidate=""
  for ((i=0; i<=max_steps; i++)); do
    for candidate in $((base_start + (i * step))) $((base_start - (i * step))); do
      if [[ "${candidate}" -lt 1024 ]]; then
        continue
      fi
      local ok="true"
      for ((p=candidate; p<candidate+size; p++)); do
        if ! is_port_available "${p}"; then
          ok="false"
          break
        fi
      done
      if [[ "${ok}" == "true" ]]; then
        echo "${candidate}-$((candidate + size - 1))"
        return 0
      fi
    done
  done
  return 1
}

if [[ -z "${EDGE_PORT}" ]]; then
  EDGE_PORT="$(find_nearest_free_port 4566 500)" || {
    echo "Failed to find free LocalStack edge port near 4566." >&2
    exit 1
  }
  AUTO_PICKED_PORTS+=("LOCALSTACK_EDGE_PORT")
else
  if ! is_port_available "${EDGE_PORT}"; then
    echo "LocalStack edge port ${EDGE_PORT} is in use. Omit the port to auto-pick." >&2
    exit 1
  fi
fi
reserve_port "${EDGE_PORT}"

if [[ -z "${BANK_API_PORT}" ]]; then
  BANK_API_PORT="$(find_nearest_free_port 3000 500)" || {
    echo "Failed to find free bank-api port near 3000." >&2
    exit 1
  }
  AUTO_PICKED_PORTS+=("BANK_API_PORT")
else
  if ! is_port_available "${BANK_API_PORT}"; then
    echo "Bank API port ${BANK_API_PORT} is in use. Omit the port to auto-pick." >&2
    exit 1
  fi
fi
reserve_port "${BANK_API_PORT}"

if [[ -z "${WEB_APP_PORT}" ]]; then
  WEB_APP_PORT="$(find_nearest_free_port 4200 500)" || {
    echo "Failed to find free web-app port near 4200." >&2
    exit 1
  }
  AUTO_PICKED_PORTS+=("WEB_APP_PORT")
else
  if ! is_port_available "${WEB_APP_PORT}"; then
    echo "Web app port ${WEB_APP_PORT} is in use. Omit the port to auto-pick." >&2
    exit 1
  fi
fi
reserve_port "${WEB_APP_PORT}"

WEB_APP_PREVIEW_PORT="$((WEB_APP_PORT + 100))"
if ! is_port_available "${WEB_APP_PREVIEW_PORT}"; then
  WEB_APP_PREVIEW_PORT="$(find_nearest_free_port "${WEB_APP_PREVIEW_PORT}" 200)" || {
    echo "Failed to find free web preview port near $((WEB_APP_PORT + 100))." >&2
    exit 1
  }
  AUTO_PICKED_PORTS+=("WEB_APP_PREVIEW_PORT")
fi
reserve_port "${WEB_APP_PREVIEW_PORT}"

if [[ -z "${PORT_RANGE+x}" ]]; then
  PORT_RANGE="$(find_free_range 4510 50 100)" || PORT_RANGE=""
  AUTO_PICKED_PORTS+=("LOCALSTACK_PORT_RANGE")
else
  if [[ -n "${PORT_RANGE}" ]]; then
    if [[ "${PORT_RANGE}" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      range_start="${BASH_REMATCH[1]}"
      range_end="${BASH_REMATCH[2]}"
      if [[ "${range_end}" -lt "${range_start}" ]]; then
        echo "Invalid PORT_RANGE '${PORT_RANGE}' (end < start)." >&2
        exit 1
      fi
      for ((p=range_start; p<=range_end; p++)); do
        if ! is_port_available "${p}"; then
          echo "Port range ${PORT_RANGE} conflicts with port ${p}. Omit to auto-pick." >&2
          exit 1
        fi
      done
    else
      echo "Invalid PORT_RANGE format '${PORT_RANGE}'. Use start-end (e.g., 5510-5559)." >&2
      exit 1
    fi
  fi
fi

if [[ -z "${SHARED_SECRETS_FILE}" ]]; then
  DEFAULT_SHARED="${REPO_ROOT}/bank-api.env.local.json"
  if [[ -f "${DEFAULT_SHARED}" ]]; then
    SHARED_SECRETS_FILE="${DEFAULT_SHARED}"
  fi
fi

ENV_FILE="${REPO_ROOT}/.localstack.env"

cat > "${ENV_FILE}" <<EOF_ENV
export LOCALSTACK_CONTAINER_NAME=localstack-demo-bank-app-${WORKTREE_ID}
export LOCALSTACK_EDGE_PORT=${EDGE_PORT}
export LOCALSTACK_PORT_RANGE=${PORT_RANGE}
export AWS_ENDPOINT_URL=http://localhost:${EDGE_PORT}
export LOCALSTACK_DOCKER_ENDPOINT_URL=http://host.docker.internal:${EDGE_PORT}
export BANK_API_PORT=${BANK_API_PORT}
export WEB_APP_PORT=${WEB_APP_PORT}
export WEB_APP_PREVIEW_PORT=${WEB_APP_PREVIEW_PORT}
export BANK_API_URL=http://localhost:${BANK_API_PORT}
export VITE_API_URL=http://localhost:${BANK_API_PORT}
export E2E_BASE_URL=http://localhost:${WEB_APP_PORT}
export SHARED_SECRETS_FILE=${SHARED_SECRETS_FILE}
export ENV_VARS_FILE=env.local.worktree.json
EOF_ENV

echo "Wrote ${ENV_FILE}"
echo "Selected ports:"
echo "  LOCALSTACK_EDGE_PORT=${EDGE_PORT}"
if [[ -n "${PORT_RANGE}" ]]; then
  echo "  LOCALSTACK_PORT_RANGE=${PORT_RANGE}"
else
  echo "  LOCALSTACK_PORT_RANGE=disabled"
fi
echo "  BANK_API_PORT=${BANK_API_PORT}"
echo "  WEB_APP_PORT=${WEB_APP_PORT}"
echo "  WEB_APP_PREVIEW_PORT=${WEB_APP_PREVIEW_PORT}"
if [[ "${#AUTO_PICKED_PORTS[@]}" -gt 0 ]]; then
  echo "Auto-picked: ${AUTO_PICKED_PORTS[*]}"
fi

WORKTREE_ENV_JSON="${REPO_ROOT}/apps/bank-api/env.local.worktree.json"
SOURCE_ENV_JSON="${REPO_ROOT}/apps/bank-api/env.local.json"

if [[ ! -f "${WORKTREE_ENV_JSON}" ]]; then
  cp "${SOURCE_ENV_JSON}" "${WORKTREE_ENV_JSON}"
  echo "Created ${WORKTREE_ENV_JSON}"
fi

cd "${REPO_ROOT}"
node <<'NODE'
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, 'apps/bank-api/env.local.worktree.json');
const localstackEnv = path.join(repoRoot, '.localstack.env');

if (!fs.existsSync(envPath) || !fs.existsSync(localstackEnv)) {
  process.exit(0);
}

const envRaw = fs.readFileSync(localstackEnv, 'utf8');
const env = Object.fromEntries(
  envRaw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const normalized = line.replace(/^export\s+/, '');
      const idx = normalized.indexOf('=');
      return [normalized.slice(0, idx), normalized.slice(idx + 1)];
    })
);

const dockerEndpoint = env.LOCALSTACK_DOCKER_ENDPOINT_URL;
const sharedSecretsFile =
  env.SHARED_SECRETS_FILE || process.env.SHARED_SECRETS_FILE;
if (!dockerEndpoint) {
  process.exit(0);
}

const raw = fs.readFileSync(envPath, 'utf8');
const json = JSON.parse(raw);

const applyEndpoint = section => {
  if (!section || typeof section !== 'object') return;
  section.AWS_ENDPOINT_URL = dockerEndpoint;
  if ('AwsEndpointUrl' in section) {
    section.AwsEndpointUrl = dockerEndpoint;
  }
};

applyEndpoint(json.Parameters);
applyEndpoint(json.BankLambdaFunction);
applyEndpoint(json.SummaryLambdaFunction);

const applySecrets = (section, values) => {
  if (!section || typeof section !== 'object' || !values) return;
  Object.assign(section, values);
};

if (sharedSecretsFile && fs.existsSync(sharedSecretsFile)) {
  const secretsRaw = fs.readFileSync(sharedSecretsFile, 'utf8');
  const secretsJson = JSON.parse(secretsRaw);

  if (
    secretsJson &&
    typeof secretsJson === 'object' &&
    ('Parameters' in secretsJson ||
      'BankLambdaFunction' in secretsJson ||
      'SummaryLambdaFunction' in secretsJson)
  ) {
    applySecrets(json.Parameters, secretsJson.Parameters);
    applySecrets(
      json.BankLambdaFunction,
      secretsJson.BankLambdaFunction || secretsJson.Parameters
    );
    applySecrets(
      json.SummaryLambdaFunction,
      secretsJson.SummaryLambdaFunction || secretsJson.Parameters
    );
  } else if (secretsJson && typeof secretsJson === 'object') {
    applySecrets(json.Parameters, secretsJson);
    applySecrets(json.BankLambdaFunction, secretsJson);
    applySecrets(json.SummaryLambdaFunction, secretsJson);
  }
}

fs.writeFileSync(envPath, JSON.stringify(json, null, 2) + '\n');
NODE

echo "Updated apps/bank-api/env.local.worktree.json with LOCALSTACK_DOCKER_ENDPOINT_URL"
