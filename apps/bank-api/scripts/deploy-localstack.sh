#!/usr/bin/env bash
set -euo pipefail

# LocalStack can keep a Lambda Alias around even when CloudFormation believes it
# doesn't exist, leading to:
#   ResourceConflictException when calling the CreateAlias operation: Alias already exists
#
# This wrapper retries `samlocal deploy` once after deleting the conflicting
# alias(es). It intentionally does not delete DynamoDB tables, Secrets, or other
# persisted local resources.

ENVIRONMENT="${ENVIRONMENT:-dev}"

AWS_CLI_AVAILABLE=false
if command -v aws >/dev/null 2>&1; then
  AWS_CLI_AVAILABLE=true
fi
AWS_CLI_MISSING_WARNED=false

if ! command -v samlocal >/dev/null 2>&1; then
  echo "Error: 'samlocal' not found in PATH. Install with: pip3 install aws-sam-cli-local" >&2
  exit 1
fi

# Host-side tools should talk to LocalStack via localhost.
AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:${LOCALSTACK_EDGE_PORT:-4566}}"
export AWS_ENDPOINT_URL
AWS_ARGS=(--endpoint-url "${AWS_ENDPOINT_URL}")

delete_lambda_alias() {
  local function_name="$1"
  local alias_name="$2"

  if [[ "${AWS_CLI_AVAILABLE}" != "true" ]]; then
    if [[ "${AWS_CLI_MISSING_WARNED}" != "true" ]]; then
      echo "Warning: 'aws' CLI not found; cannot auto-delete LocalStack Lambda aliases (needed to recover from alias conflicts)." >&2
      AWS_CLI_MISSING_WARNED=true
    fi
    return 0
  fi

  aws "${AWS_ARGS[@]}" lambda delete-alias --function-name "${function_name}" --name "${alias_name}" >/dev/null 2>&1 || true
}

is_lambda_alias_conflict() {
  local log_file="$1"
  grep -q "ResourceConflictException" "${log_file}" \
    && grep -q "CreateAlias operation" "${log_file}" \
    && grep -q "Alias already exists" "${log_file}"
}

delete_conflicting_aliases_from_log() {
  local log_file="$1"
  local -a arns=()

  while IFS= read -r arn; do
    [[ -z "${arn}" ]] && continue
    arns+=("${arn}")
  done < <(grep -oE 'arn:aws:lambda:[^[:space:]]+' "${log_file}" | grep ':function:' | sort -u || true)

  if [[ ${#arns[@]} -eq 0 ]]; then
    # Fall back to deleting the known alias names for this stack.
    delete_lambda_alias "blue-bank-api-${ENVIRONMENT}" "live"
    delete_lambda_alias "blue-bank-summary-${ENVIRONMENT}" "live"
    return 0
  fi

  local arn function_part function_name alias_name
  for arn in "${arns[@]}"; do
    function_part="${arn##*:function:}"
    if [[ "${function_part}" != *:* ]]; then
      continue
    fi
    alias_name="${function_part##*:}"
    function_name="${function_part%:*}"
    if [[ -n "${function_name}" && -n "${alias_name}" ]]; then
      delete_lambda_alias "${function_name}" "${alias_name}"
    fi
  done
}

echo "Running samlocal deploy..."
deploy_args=("$@")

deploy_log="$(mktemp)"
trap 'rm -f "${deploy_log}"' EXIT

set +e
samlocal deploy "${deploy_args[@]}" 2>&1 | tee "${deploy_log}"
deploy_status=${PIPESTATUS[0]}
set -e

if [[ "${deploy_status}" -eq 0 ]]; then
  exit 0
fi

if is_lambda_alias_conflict "${deploy_log}"; then
  echo "Detected Lambda alias conflict; deleting existing alias(es) and retrying samlocal deploy..."
  delete_conflicting_aliases_from_log "${deploy_log}"

  rm -f "${deploy_log}"
  deploy_log="$(mktemp)"

  set +e
  samlocal deploy "${deploy_args[@]}" 2>&1 | tee "${deploy_log}"
  deploy_status=${PIPESTATUS[0]}
  set -e
fi

exit "${deploy_status}"
