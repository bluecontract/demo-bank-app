#!/usr/bin/env bash
set -euo pipefail

# Wrapper around `samlocal deploy` for resilient local deployment.
# It recovers from stacks stuck in ROLLBACK_COMPLETE by deleting the failed
# stack and retrying deploy once.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCALSTACK_ENV_FILE="${LOCALSTACK_ENV_FILE:-${REPO_ROOT}/.localstack.env}"
LOCALSTACK_ENV_AUTO_LOADED=false

maybe_load_localstack_env() {
  local should_load="false"

  if [[ -z "${AWS_ENDPOINT_URL:-}" ]]; then
    should_load="true"
  fi

  if [[ "${should_load}" == "true" && -f "${LOCALSTACK_ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "${LOCALSTACK_ENV_FILE}"
    set +a
    LOCALSTACK_ENV_AUTO_LOADED=true
    echo "Loaded LocalStack environment from ${LOCALSTACK_ENV_FILE}."
  fi
}

maybe_load_localstack_env

AWS_CLI_AVAILABLE=false
if command -v aws >/dev/null 2>&1; then
  AWS_CLI_AVAILABLE=true
fi
ENVIRONMENT="${ENVIRONMENT:-dev}"

if ! command -v samlocal >/dev/null 2>&1; then
  echo "Error: 'samlocal' not found in PATH. Install with: pip3 install aws-sam-cli-local" >&2
  exit 1
fi

# Host-side tools should talk to LocalStack via localhost.
AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:${LOCALSTACK_EDGE_PORT:-4566}}"
LAMBDA_AWS_ENDPOINT_URL="${LOCALSTACK_DOCKER_ENDPOINT_URL:-http://host.docker.internal:${LOCALSTACK_EDGE_PORT:-4566}}"
export AWS_ENDPOINT_URL
AWS_ARGS=(--endpoint-url "${AWS_ENDPOINT_URL}")
deploy_log=""
local_template_file=""

cleanup_temp_files() {
  if [[ -n "${deploy_log}" ]]; then
    rm -f "${deploy_log}"
  fi
  if [[ -n "${local_template_file}" ]]; then
    rm -f "${local_template_file}"
  fi
}

trap cleanup_temp_files EXIT

has_template_file_arg() {
  local arg
  for arg in "${deploy_args[@]}"; do
    case "${arg}" in
      --template-file|--template-file=*)
        return 0
        ;;
    esac
  done
  return 1
}

has_aws_endpoint_override_arg() {
  local arg
  for arg in "${deploy_args[@]}"; do
    if [[ "${arg}" == *"AwsEndpointUrl="* ]]; then
      return 0
    fi
  done
  return 1
}

extract_aws_endpoint_override_value() {
  local value
  value="$(
    printf '%s\n' "${deploy_args[@]}" \
      | sed -nE 's/.*AwsEndpointUrl=([^[:space:]]+).*/\1/p' \
      | head -n 1
  )"
  echo "${value}"
}

replace_aws_endpoint_override_value() {
  local new_value="$1"
  local index next arg updated

  for ((index = 0; index < ${#deploy_args[@]}; index++)); do
    arg="${deploy_args[${index}]}"
    if [[ "${arg}" == --parameter-overrides=* ]]; then
      updated="$(printf '%s' "${arg}" | sed -E "s#AwsEndpointUrl=[^[:space:]]+#AwsEndpointUrl=${new_value}#g")"
      deploy_args[${index}]="${updated}"
      return 0
    fi

    if [[ "${arg}" == "--parameter-overrides" ]]; then
      next=$((index + 1))
      if ((next < ${#deploy_args[@]})); then
        updated="$(printf '%s' "${deploy_args[${next}]}" | sed -E "s#AwsEndpointUrl=[^[:space:]]+#AwsEndpointUrl=${new_value}#g")"
        deploy_args[${next}]="${updated}"
      fi
      return 0
    fi
  done
}

ensure_aws_endpoint_override_arg() {
  local index next current_override

  if has_aws_endpoint_override_arg; then
    current_override="$(extract_aws_endpoint_override_value)"
    if [[ -n "${current_override}" && "${current_override}" != "${LAMBDA_AWS_ENDPOINT_URL}" ]]; then
      if [[ "${LOCALSTACK_ENV_AUTO_LOADED}" == "true" ]]; then
        echo "Normalizing AwsEndpointUrl from '${current_override}' to '${LAMBDA_AWS_ENDPOINT_URL}' based on ${LOCALSTACK_ENV_FILE}."
        replace_aws_endpoint_override_value "${LAMBDA_AWS_ENDPOINT_URL}"
      else
        echo "Warning: AwsEndpointUrl override ('${current_override}') differs from LOCALSTACK_DOCKER_ENDPOINT_URL ('${LAMBDA_AWS_ENDPOINT_URL}')." >&2
      fi
    fi
    return 0
  fi

  for ((index = 0; index < ${#deploy_args[@]}; index++)); do
    if [[ "${deploy_args[${index}]}" == --parameter-overrides=* ]]; then
      deploy_args[${index}]="${deploy_args[${index}]} AwsEndpointUrl=${LAMBDA_AWS_ENDPOINT_URL}"
      return 0
    fi

    if [[ "${deploy_args[${index}]}" == "--parameter-overrides" ]]; then
      next=$((index + 1))
      if ((next < ${#deploy_args[@]})); then
        deploy_args[${next}]="${deploy_args[${next}]} AwsEndpointUrl=${LAMBDA_AWS_ENDPOINT_URL}"
      else
        deploy_args+=("AwsEndpointUrl=${LAMBDA_AWS_ENDPOINT_URL}")
      fi
      return 0
    fi
  done

  deploy_args+=(--parameter-overrides "AwsEndpointUrl=${LAMBDA_AWS_ENDPOINT_URL}")
}

has_api_gateway_endpoint_type_override_arg() {
  local arg
  for arg in "${deploy_args[@]}"; do
    if [[ "${arg}" == *"ApiGatewayEndpointType="* ]]; then
      return 0
    fi
  done
  return 1
}

replace_api_gateway_endpoint_type_override_value() {
  local new_value="$1"
  local index next arg updated

  for ((index = 0; index < ${#deploy_args[@]}; index++)); do
    arg="${deploy_args[${index}]}"
    if [[ "${arg}" == --parameter-overrides=* ]]; then
      updated="$(printf '%s' "${arg}" | sed -E "s#ApiGatewayEndpointType=[^[:space:]]+#ApiGatewayEndpointType=${new_value}#g")"
      deploy_args[${index}]="${updated}"
      return 0
    fi

    if [[ "${arg}" == "--parameter-overrides" ]]; then
      next=$((index + 1))
      if ((next < ${#deploy_args[@]})); then
        updated="$(printf '%s' "${deploy_args[${next}]}" | sed -E "s#ApiGatewayEndpointType=[^[:space:]]+#ApiGatewayEndpointType=${new_value}#g")"
        deploy_args[${next}]="${updated}"
      fi
      return 0
    fi
  done
}

ensure_api_gateway_endpoint_type_override_arg() {
  local index next

  if has_api_gateway_endpoint_type_override_arg; then
    replace_api_gateway_endpoint_type_override_value "REGIONAL"
    return 0
  fi

  for ((index = 0; index < ${#deploy_args[@]}; index++)); do
    if [[ "${deploy_args[${index}]}" == --parameter-overrides=* ]]; then
      deploy_args[${index}]="${deploy_args[${index}]} ApiGatewayEndpointType=REGIONAL"
      return 0
    fi

    if [[ "${deploy_args[${index}]}" == "--parameter-overrides" ]]; then
      next=$((index + 1))
      if ((next < ${#deploy_args[@]})); then
        deploy_args[${next}]="${deploy_args[${next}]} ApiGatewayEndpointType=REGIONAL"
      else
        deploy_args+=("ApiGatewayEndpointType=REGIONAL")
      fi
      return 0
    fi
  done

  deploy_args+=(--parameter-overrides "ApiGatewayEndpointType=REGIONAL")
}

ensure_localstack_endpoint_reachable() {
  local health_url="${AWS_ENDPOINT_URL%/}/_localstack/health"

  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  if curl -fsS --max-time 5 "${health_url}" >/dev/null; then
    return 0
  fi

  echo "Error: Could not connect to LocalStack endpoint '${AWS_ENDPOINT_URL}'." >&2
  if [[ -f "${LOCALSTACK_ENV_FILE}" ]]; then
    echo "Tip: run 'source ${LOCALSTACK_ENV_FILE}' before 'npm run serve:all'." >&2
  fi
  return 1
}

prepare_local_template_file() {
  if has_template_file_arg; then
    return 0
  fi

  if [[ ! -f "template.yaml" ]]; then
    return 0
  fi

  local_template_file="$(mktemp "${PWD}/.demo-bank-localstack-template.XXXXXX")"
  mv "${local_template_file}" "${local_template_file}.yaml"
  local_template_file="${local_template_file}.yaml"
  awk '
    # SAM does not allow conditional AutoPublishAlias, so LocalStack uses a
    # generated template without AutoPublishAlias.
    /AutoPublishAlias:/ { next }
    /ProvisionedConcurrencyConfig:/ { skip_lines = 3; next }
    skip_lines > 0 { skip_lines--; next }
    { print }
  ' template.yaml > "${local_template_file}"

  deploy_args+=(--template-file "${local_template_file}")
  echo "Using local SAM template without AutoPublishAlias (provisioned concurrency remains condition-driven)."
}

is_stack_rollback_complete_error() {
  local log_file="$1"
  grep -q "ROLLBACK_COMPLETE" "${log_file}"
}

is_table_already_exists_error() {
  local log_file="$1"
  grep -qi "CreateTable operation" "${log_file}" \
    && grep -qi "Table already exists:" "${log_file}"
}

is_summary_queue_already_exists_error() {
  local log_file="$1"
  grep -q "QueueAlreadyExists" "${log_file}" \
    && grep -q "CreateQueue operation" "${log_file}"
}

is_lambda_function_already_exists_error() {
  local log_file="$1"
  grep -q "ResourceConflictException" "${log_file}" \
    && grep -q "CreateFunction operation" "${log_file}" \
    && grep -q "Function already exist:" "${log_file}"
}

is_event_source_mapping_already_exists_error() {
  local log_file="$1"
  (
    grep -qi "event source mapping" "${log_file}" \
      && grep -qi "already exists" "${log_file}"
  ) || (
    grep -qi "AWS::Lambda::EventSourceMapping" "${log_file}" \
      && grep -qi "already exists" "${log_file}"
  )
}

is_existing_infra_conflict_error() {
  local log_file="$1"
  is_table_already_exists_error "${log_file}" \
    || is_summary_queue_already_exists_error "${log_file}" \
    || is_lambda_function_already_exists_error "${log_file}" \
    || is_event_source_mapping_already_exists_error "${log_file}"
}

extract_existing_table_name() {
  local log_file="$1"
  sed -nE 's/.*Table already exists:[[:space:]]*([^[:space:]]+).*/\1/p' "${log_file}" | head -n 1
}

resolve_environment_from_table_name() {
  local table_name="$1"
  if [[ "${table_name}" == *-* ]]; then
    echo "${table_name##*-}"
  else
    echo "dev"
  fi
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

resolve_stack_name_for_preflight() {
  resolve_stack_name_from_args && return 0
  resolve_stack_name_from_samconfig && return 0
  return 1
}

ensure_stack_name_arg() {
  local stack_name

  if resolve_stack_name_from_args >/dev/null; then
    return 0
  fi

  if ! stack_name="$(resolve_stack_name_from_samconfig)"; then
    echo "Error: Missing CloudFormation stack name for LocalStack deploy." >&2
    echo "Provide --stack-name explicitly or set stack_name under [default.global.parameters] in apps/bank-api/samconfig.toml." >&2
    return 1
  fi

  deploy_args+=(--stack-name "${stack_name}")
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

preflight_recover_rollback_complete_stack() {
  local stack_name stack_status

  if [[ "${AWS_CLI_AVAILABLE}" != "true" ]]; then
    return 0
  fi

  if ! stack_name="$(resolve_stack_name_for_preflight)"; then
    return 0
  fi

  stack_status="$(
    aws "${AWS_ARGS[@]}" cloudformation describe-stacks --stack-name "${stack_name}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true
  )"

  if [[ "${stack_status}" == "ROLLBACK_COMPLETE" ]]; then
    echo "Preflight: stack '${stack_name}' is ROLLBACK_COMPLETE; deleting it before deploy..."
    delete_stack_and_wait "${stack_name}"
  fi
}

preflight_recover_sam_managed_stack() {
  local managed_stack_name="aws-sam-cli-managed-default"
  local managed_stack_status

  if [[ "${AWS_CLI_AVAILABLE}" != "true" ]]; then
    return 0
  fi

  managed_stack_status="$(
    aws "${AWS_ARGS[@]}" cloudformation describe-stacks --stack-name "${managed_stack_name}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true
  )"

  if [[ -z "${managed_stack_status}" || "${managed_stack_status}" == "None" ]]; then
    return 0
  fi

  case "${managed_stack_status}" in
    CREATE_COMPLETE|UPDATE_COMPLETE)
      return 0
      ;;
    REVIEW_IN_PROGRESS|ROLLBACK_COMPLETE|CREATE_FAILED|DELETE_FAILED|UPDATE_ROLLBACK_COMPLETE|UPDATE_ROLLBACK_FAILED|ROLLBACK_FAILED)
      echo "Preflight: SAM managed stack '${managed_stack_name}' is ${managed_stack_status}; deleting it before deploy..."
      delete_stack_and_wait "${managed_stack_name}"
      return 0
      ;;
    *_IN_PROGRESS)
      echo "Error: SAM managed stack '${managed_stack_name}' is currently ${managed_stack_status}." >&2
      echo "Another SAM deploy may still be running. Wait and retry." >&2
      return 1
      ;;
    *)
      echo "Preflight: SAM managed stack '${managed_stack_name}' is ${managed_stack_status}; deleting it before deploy..."
      delete_stack_and_wait "${managed_stack_name}"
      return 0
      ;;
  esac
}

ensure_summary_event_source_mapping() {
  local environment="$1"
  local summary_function_name="blue-bank-summary-${environment}"
  local summary_queue_name="demo-bank-summary-jobs-${environment}.fifo"
  local queue_url queue_arn existing_mapping

  queue_url="$(
    aws "${AWS_ARGS[@]}" sqs get-queue-url --queue-name "${summary_queue_name}" --query 'QueueUrl' --output text
  )"

  queue_arn="$(
    aws "${AWS_ARGS[@]}" sqs get-queue-attributes --queue-url "${queue_url}" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text
  )"

  existing_mapping="$(
    aws "${AWS_ARGS[@]}" lambda list-event-source-mappings \
      --function-name "${summary_function_name}" \
      --query "EventSourceMappings[?EventSourceArn==\`${queue_arn}\`].UUID" \
      --output text
  )"

  if [[ -n "${existing_mapping}" && "${existing_mapping}" != "None" ]]; then
    echo "Summary queue event source mapping already exists (${existing_mapping})."
    return 0
  fi

  aws "${AWS_ARGS[@]}" lambda create-event-source-mapping \
    --function-name "${summary_function_name}" \
    --event-source-arn "${queue_arn}" \
    --batch-size 1 \
    --function-response-types ReportBatchItemFailures >/dev/null

  echo "Created summary queue event source mapping for ${summary_function_name}."
}

update_lambda_code_artifacts() {
  local environment="$1"
  local lambda_dir="../../dist/apps/bank-api/lambda"
  local archive="/tmp/demo-bank-lambda-${environment}-$$.zip"

  if [[ ! -d "${lambda_dir}" ]]; then
    echo "Error: Lambda artifact directory missing: ${lambda_dir}" >&2
    return 1
  fi

  if ! command -v zip >/dev/null 2>&1; then
    echo "Error: 'zip' command is required for LocalStack recovery but is not available." >&2
    return 1
  fi

  (cd "${lambda_dir}" && zip -qr "${archive}" .)

  aws "${AWS_ARGS[@]}" lambda update-function-code \
    --function-name "blue-bank-api-${environment}" \
    --zip-file "fileb://${archive}" >/dev/null

  aws "${AWS_ARGS[@]}" lambda update-function-code \
    --function-name "blue-bank-summary-${environment}" \
    --zip-file "fileb://${archive}" >/dev/null

  rm -f "${archive}"
}

recover_from_existing_infra_without_stack() {
  local log_file="$1"
  local table_name environment

  if [[ "${AWS_CLI_AVAILABLE}" != "true" ]]; then
    echo "Error: deploy failed with existing DynamoDB table, but 'aws' CLI is unavailable for automatic recovery." >&2
    return 1
  fi

  table_name="$(extract_existing_table_name "${log_file}")"
  if [[ -n "${table_name}" ]]; then
    environment="$(resolve_environment_from_table_name "${table_name}")"
    aws "${AWS_ARGS[@]}" dynamodb describe-table --table-name "${table_name}" >/dev/null 2>&1 || true
  else
    environment="${ENVIRONMENT}"
  fi

  table_name="${BANKING_DYNAMO_TABLE_NAME:-demo-bank-${environment}}"
  if ! aws "${AWS_ARGS[@]}" dynamodb describe-table --table-name "${table_name}" >/dev/null 2>&1; then
    echo "Error: Cannot apply code-only recovery because DynamoDB table '${table_name}' does not exist." >&2
    echo "CloudFormation deploy must succeed first to create base infrastructure." >&2
    return 1
  fi

  echo "Detected existing LocalStack infrastructure conflict; applying code-only recovery for environment '${environment}'..."

  if ! update_lambda_code_artifacts "${environment}"; then
    echo "Error: Failed to refresh Lambda code during LocalStack recovery." >&2
    return 1
  fi

  if ! ensure_summary_event_source_mapping "${environment}"; then
    echo "Error: Failed to ensure summary event source mapping during LocalStack recovery." >&2
    return 1
  fi
}

echo "Running samlocal deploy..."
deploy_args=("$@")
ensure_localstack_endpoint_reachable
ensure_aws_endpoint_override_arg
ensure_api_gateway_endpoint_type_override_arg
ensure_stack_name_arg
prepare_local_template_file
preflight_recover_sam_managed_stack
preflight_recover_rollback_complete_stack

deploy_log="$(mktemp)"

set +e
samlocal deploy "${deploy_args[@]}" 2>&1 | tee "${deploy_log}"
deploy_status=${PIPESTATUS[0]}
set -e

if [[ "${deploy_status}" -eq 0 ]]; then
  exit 0
fi

if [[ "${deploy_status}" -ne 0 ]] && is_existing_infra_conflict_error "${deploy_log}"; then
  if recover_from_existing_infra_without_stack "${deploy_log}"; then
    echo "LocalStack deploy recovered using existing infrastructure and refreshed Lambda code."
    deploy_status=0
  fi
fi

if [[ "${deploy_status}" -ne 0 ]] && is_stack_rollback_complete_error "${deploy_log}"; then
  recover_from_rollback_complete "${deploy_log}"

  rm -f "${deploy_log}"
  deploy_log="$(mktemp)"

  set +e
  samlocal deploy "${deploy_args[@]}" 2>&1 | tee "${deploy_log}"
  deploy_status=${PIPESTATUS[0]}
  set -e

  if [[ "${deploy_status}" -ne 0 ]] && is_existing_infra_conflict_error "${deploy_log}"; then
    if recover_from_existing_infra_without_stack "${deploy_log}"; then
      echo "LocalStack deploy recovered using existing infrastructure and refreshed Lambda code."
      deploy_status=0
    fi
  fi
fi

exit "${deploy_status}"
