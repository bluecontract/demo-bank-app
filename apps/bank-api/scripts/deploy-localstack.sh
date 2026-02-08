#!/usr/bin/env bash
set -euo pipefail

# LocalStack can keep a Lambda Alias around even when CloudFormation believes it
# doesn't exist, leading to:
#   ResourceConflictException when calling the CreateAlias operation: Alias already exists
#
# This wrapper retries `samlocal deploy` once after deleting the conflicting
# alias(es). It intentionally does not delete DynamoDB tables, Secrets, or other
# persisted local resources.
#
# It also recovers from CloudFormation stacks stuck in ROLLBACK_COMPLETE by
# deleting the failed stack and retrying deploy once.

ENVIRONMENT="${ENVIRONMENT:-dev}"
# LocalStack default should avoid Lambda aliases unless explicitly enabled.
ENABLE_LAMBDA_ALIAS="${ENABLE_LAMBDA_ALIAS:-false}"

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

is_stack_rollback_complete_error() {
  local log_file="$1"
  grep -q "ROLLBACK_COMPLETE" "${log_file}" \
    && grep -Eqi "can not be updated|cannot be updated" "${log_file}"
}

is_alias_fn_sub_changeset_error() {
  local log_file="$1"
  grep -q "Undefined variable name in Fn::Sub string template 'BankLambdaFunctionAliaslive'" "${log_file}" \
    || grep -q "Undefined variable name in Fn::Sub string template 'SummaryLambdaFunctionAliaslive'" "${log_file}"
}

resolve_stack_name_from_args() {
  local arg index next
  for ((index = 0; index < ${#deploy_args[@]}; index++)); do
    arg="${deploy_args[${index}]}"
    case "${arg}" in
      --stack-name=*)
        echo "${arg#--stack-name=}"
        return 0
        ;;
      --stack-name)
        next=$((index + 1))
        if ((next < ${#deploy_args[@]})); then
          echo "${deploy_args[${next}]}"
          return 0
        fi
        ;;
    esac
  done

  return 1
}

resolve_stack_name_from_log() {
  local log_file="$1"
  local stack_name

  stack_name="$(sed -nE 's/.*stack: ([A-Za-z0-9-]+).*/\1/p' "${log_file}" | head -n 1)"
  if [[ -n "${stack_name}" ]]; then
    echo "${stack_name}"
    return 0
  fi

  stack_name="$(sed -nE 's/.*stack ([A-Za-z0-9-]+).*/\1/p' "${log_file}" | head -n 1)"
  if [[ -n "${stack_name}" ]]; then
    echo "${stack_name}"
    return 0
  fi

  return 1
}

resolve_stack_name_from_samconfig() {
  local stack_name

  if [[ ! -f "samconfig.toml" ]]; then
    return 1
  fi

  stack_name="$(awk -F '"' '
    /^\[default\.global\.parameters\]/ { in_default = 1; next }
    /^\[/ { if (in_default == 1) exit; in_default = 0 }
    in_default == 1 && /^[[:space:]]*stack_name[[:space:]]*=/ { print $2; exit }
  ' samconfig.toml)"

  if [[ -n "${stack_name}" ]]; then
    echo "${stack_name}"
    return 0
  fi

  return 1
}

resolve_stack_name() {
  local log_file="$1"

  resolve_stack_name_from_args && return 0
  resolve_stack_name_from_log "${log_file}" && return 0
  resolve_stack_name_from_samconfig && return 0

  return 1
}

delete_stack_and_wait() {
  local stack_name="$1"
  local max_attempts=30
  local attempt describe_output

  aws "${AWS_ARGS[@]}" cloudformation delete-stack --stack-name "${stack_name}"

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    describe_output="$(
      aws "${AWS_ARGS[@]}" cloudformation describe-stacks --stack-name "${stack_name}" 2>&1 || true
    )"

    if echo "${describe_output}" | grep -Eqi 'does not exist|not found'; then
      echo "Deleted failed stack '${stack_name}'."
      return 0
    fi

    sleep 1
  done

  echo "Error: Timed out waiting for LocalStack stack '${stack_name}' deletion." >&2
  echo "Recovery command: aws ${AWS_ARGS[*]} cloudformation delete-stack --stack-name ${stack_name}" >&2
  return 1
}

recover_from_rollback_complete() {
  local log_file="$1"
  local stack_name

  if ! stack_name="$(resolve_stack_name "${log_file}")"; then
    echo "Error: Detected ROLLBACK_COMPLETE but could not resolve stack name." >&2
    echo "Recovery command: aws ${AWS_ARGS[*]} cloudformation delete-stack --stack-name <stack-name>" >&2
    return 1
  fi

  if [[ "${AWS_CLI_AVAILABLE}" != "true" ]]; then
    echo "Error: Detected ROLLBACK_COMPLETE for stack '${stack_name}' but 'aws' CLI is not available." >&2
    echo "Recovery command: aws ${AWS_ARGS[*]} cloudformation delete-stack --stack-name ${stack_name}" >&2
    return 1
  fi

  echo "Detected ROLLBACK_COMPLETE for stack '${stack_name}'; deleting stack before retry..."
  delete_stack_and_wait "${stack_name}"
}

inject_enable_lambda_alias_override() {
  local desired_value="EnableLambdaAlias=${ENABLE_LAMBDA_ALIAS}"
  local index

  for index in "${!deploy_args[@]}"; do
    local arg="${deploy_args[${index}]}"
    case "${arg}" in
      --parameter-overrides=*)
        local overrides="${arg#--parameter-overrides=}"
        if [[ "${overrides}" == *"EnableLambdaAlias="* ]]; then
          return 0
        fi
        deploy_args[${index}]="--parameter-overrides=${overrides} ${desired_value}"
        return 0
        ;;
    esac
  done

  for index in "${!deploy_args[@]}"; do
    if [[ "${deploy_args[${index}]}" != "--parameter-overrides" ]]; then
      continue
    fi

    local scan_index=$((index + 1))
    local has_override=false
    while ((scan_index < ${#deploy_args[@]})); do
      local token="${deploy_args[${scan_index}]}"
      if [[ "${token}" == --* ]]; then
        break
      fi
      if [[ "${token}" == EnableLambdaAlias=* ]]; then
        has_override=true
        break
      fi
      ((scan_index++))
    done

    if [[ "${has_override}" == "true" ]]; then
      return 0
    fi

    deploy_args=(
      "${deploy_args[@]:0:${scan_index}}"
      "${desired_value}"
      "${deploy_args[@]:${scan_index}}"
    )
    return 0
  done

  deploy_args+=("--parameter-overrides" "${desired_value}")
}

echo "Running samlocal deploy..."
deploy_args=("$@")
inject_enable_lambda_alias_override

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

if [[ "${deploy_status}" -ne 0 ]] && is_stack_rollback_complete_error "${deploy_log}"; then
  recover_from_rollback_complete "${deploy_log}"

  rm -f "${deploy_log}"
  deploy_log="$(mktemp)"

  set +e
  samlocal deploy "${deploy_args[@]}" 2>&1 | tee "${deploy_log}"
  deploy_status=${PIPESTATUS[0]}
  set -e
fi

if [[ "${deploy_status}" -ne 0 ]] && is_alias_fn_sub_changeset_error "${deploy_log}"; then
  echo "Error: LocalStack CloudFormation failed with known Fn::Sub alias bug (BankLambdaFunctionAliaslive)." >&2
  echo "Explicit recovery required (no automatic fallback):" >&2
  echo "  1) ensure local aliases are disabled (EnableLambdaAlias=false; default in this script)," >&2
  echo "  2) remove the failed LocalStack stack if needed:" >&2
  echo "     aws ${AWS_ARGS[*]} cloudformation delete-stack --stack-name demo-bank-blue" >&2
  echo "  3) redeploy." >&2
fi

exit "${deploy_status}"
