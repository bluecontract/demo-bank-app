#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
LOCALSTACK_ENV_FILE="${LOCALSTACK_ENV_FILE:-${REPO_ROOT}/.localstack.env}"

if [[ -f "${LOCALSTACK_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${LOCALSTACK_ENV_FILE}"
  set +a
fi

resolve_local_sam_architecture() {
  case "${LOCAL_SAM_ARCHITECTURE:-$(uname -m)}" in
    x86_64|amd64)
      echo "x86_64"
      ;;
    arm64|aarch64)
      echo "arm64"
      ;;
    *)
      echo "x86_64"
      ;;
  esac
}

LOCAL_SAM_ARCHITECTURE="$(resolve_local_sam_architecture)"
ENV_VARS_FILE="${ENV_VARS_FILE:-env.local.json}"
SAM_LOCAL_PORT="${BANK_API_PORT:-3000}"
SAM_LOCAL_WARM_CONTAINERS="${SAM_LOCAL_WARM_CONTAINERS:-LAZY}"
SAM_CLI_CONTAINER_CONNECTION_TIMEOUT="${SAM_CLI_CONTAINER_CONNECTION_TIMEOUT:-60}"
export SAM_CLI_CONTAINER_CONNECTION_TIMEOUT

TEMPLATE_FILE="${APP_DIR}/template.yaml"
TEMP_TEMPLATE_FILE=""

cleanup() {
  if [[ -n "${TEMP_TEMPLATE_FILE}" ]]; then
    rm -f "${TEMP_TEMPLATE_FILE}"
  fi
}

trap cleanup EXIT

TEMP_TEMPLATE_FILE="$(mktemp "${APP_DIR}/.sam-local-template.XXXXXX.yaml")"
python3 - "${TEMPLATE_FILE}" "${TEMP_TEMPLATE_FILE}" "${LOCAL_SAM_ARCHITECTURE}" <<'PY'
from pathlib import Path
import re
import sys

src, dst, arch = sys.argv[1:]
text = Path(src).read_text()
updated = re.sub(
    r"(^[ \t]*Architectures:\s*\[)[^]]+(\][ \t]*$)",
    rf"\1{arch}\2",
    text,
    count=1,
    flags=re.MULTILINE,
)
Path(dst).write_text(updated)
PY

INVOKE_IMAGE="${LOCAL_SAM_INVOKE_IMAGE:-public.ecr.aws/lambda/nodejs:22-${LOCAL_SAM_ARCHITECTURE}}"

sam local start-api \
  --template "${TEMP_TEMPLATE_FILE}" \
  --invoke-image "${INVOKE_IMAGE}" \
  --port "${SAM_LOCAL_PORT}" \
  --warm-containers "${SAM_LOCAL_WARM_CONTAINERS}" \
  --no-memory-limit \
  --docker-volume-basedir . \
  --env-vars "${ENV_VARS_FILE}" \
  "$@"
