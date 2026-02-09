#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage: ./scripts/deploy-aws.sh <environment>

Environment variables:
  BANK_API_ENABLE_DATADOG                 true|false (default: false)
  BANK_API_DATADOG_API_KEY_SECRET_ARN     Required when Datadog is enabled
  BANK_API_DD_VERSION                      Optional (default: git sha or unknown)
  BANK_API_DATADOG_SITE                    Optional (default: datadoghq.eu)
  BANK_API_DATADOG_NODE_LAYER_VERSION      Optional (default: latest in region)
  BANK_API_DATADOG_EXTENSION_LAYER_VERSION Optional (default: latest in region)
  BANK_API_DATADOG_NODE_LAYER_NAME         Optional (default: Datadog-Node22-x)
  BANK_API_DATADOG_EXTENSION_LAYER_NAME    Optional (default: Datadog-Extension)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ENVIRONMENT="${1:-}"
if [[ -z "${ENVIRONMENT}" ]]; then
  usage
  exit 1
fi

ENABLE_DATADOG="${BANK_API_ENABLE_DATADOG:-false}"
ENABLE_DATADOG="$(echo "${ENABLE_DATADOG}" | tr '[:upper:]' '[:lower:]')"

if [[ "${ENABLE_DATADOG}" != "true" && "${ENABLE_DATADOG}" != "false" ]]; then
  echo "Error: BANK_API_ENABLE_DATADOG must be 'true' or 'false'" >&2
  exit 1
fi

cleanup_files=()
SAMCONFIG_PATH="./samconfig.toml"
DATADOG_OVERRIDES_TOKEN="{{DATADOG_PARAMETER_OVERRIDES}}"
cleanup() {
  if [[ ${#cleanup_files[@]} -gt 0 ]]; then
    rm -f "${cleanup_files[@]}"
  fi
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Error: required command '${command_name}' was not found in PATH." >&2
    exit 1
  fi
}

resolve_latest_layer_version() {
  local layer_name="$1"
  local aws_region="$2"
  local version

  version="$(
    aws lambda list-layer-versions \
      --region "${aws_region}" \
      --layer-name "${layer_name}" \
      --query 'max_by(LayerVersions,&Version).Version' \
      --output text
  )"

  if [[ -z "${version}" || "${version}" == "None" || "${version}" == "null" ]]; then
    echo "Error: could not resolve latest Datadog layer version for '${layer_name}' in region '${aws_region}'." >&2
    exit 1
  fi

  printf '%s' "${version}"
}

assert_datadog_placeholder_present() {
  if ! grep -Fq "${DATADOG_OVERRIDES_TOKEN}" "${SAMCONFIG_PATH}"; then
    echo "Error: missing '${DATADOG_OVERRIDES_TOKEN}' placeholder in ${SAMCONFIG_PATH}." >&2
    exit 1
  fi
}

escape_for_sed() {
  printf '%s' "$1" | sed -e 's/[\\&/]/\\\\&/g'
}

DATADOG_PARAMETER_OVERRIDES=""
DATADOG_NODE_LAYER_VERSION=""
DATADOG_EXTENSION_LAYER_VERSION=""
if [[ "${ENABLE_DATADOG}" == "true" ]]; then
  if [[ -z "${BANK_API_DATADOG_API_KEY_SECRET_ARN:-}" ]]; then
    echo "Error: BANK_API_DATADOG_API_KEY_SECRET_ARN is required when Datadog is enabled." >&2
    exit 1
  fi

  AWS_REGION_VALUE="${AWS_REGION:-eu-west-1}"
  DATADOG_NODE_LAYER_NAME="${BANK_API_DATADOG_NODE_LAYER_NAME:-Datadog-Node22-x}"
  DATADOG_EXTENSION_LAYER_NAME="${BANK_API_DATADOG_EXTENSION_LAYER_NAME:-Datadog-Extension}"
  DATADOG_NODE_LAYER_VERSION="${BANK_API_DATADOG_NODE_LAYER_VERSION:-}"
  DATADOG_EXTENSION_LAYER_VERSION="${BANK_API_DATADOG_EXTENSION_LAYER_VERSION:-}"

  if [[ -z "${DATADOG_NODE_LAYER_VERSION}" || -z "${DATADOG_EXTENSION_LAYER_VERSION}" ]]; then
    require_command aws
  fi
  if [[ -z "${DATADOG_NODE_LAYER_VERSION}" ]]; then
    DATADOG_NODE_LAYER_VERSION="$(resolve_latest_layer_version "${DATADOG_NODE_LAYER_NAME}" "${AWS_REGION_VALUE}")"
  fi
  if [[ -z "${DATADOG_EXTENSION_LAYER_VERSION}" ]]; then
    DATADOG_EXTENSION_LAYER_VERSION="$(
      resolve_latest_layer_version "${DATADOG_EXTENSION_LAYER_NAME}" "${AWS_REGION_VALUE}"
    )"
  fi

  DD_VERSION="${BANK_API_DD_VERSION:-${GITHUB_SHA:-unknown}}"
  DATADOG_SITE="${BANK_API_DATADOG_SITE:-datadoghq.eu}"
  DATADOG_PARAMETER_OVERRIDES="DatadogApiKeySecretArn=${BANK_API_DATADOG_API_KEY_SECRET_ARN} DDVersion=${DD_VERSION} DatadogSite=${DATADOG_SITE} DatadogNodeLayerVersion=${DATADOG_NODE_LAYER_VERSION} DatadogExtensionLayerVersion=${DATADOG_EXTENSION_LAYER_VERSION}"
fi

assert_datadog_placeholder_present
TMP_SAMCONFIG="$(mktemp /tmp/demo-bank-app-samconfig.XXXXXX)"
cleanup_files+=("${TMP_SAMCONFIG}")
DATADOG_PARAMETER_OVERRIDES_ESCAPED="$(escape_for_sed "${DATADOG_PARAMETER_OVERRIDES}")"
sed \
  -e "s/{{DATADOG_PARAMETER_OVERRIDES}}/${DATADOG_PARAMETER_OVERRIDES_ESCAPED}/g" \
  "${SAMCONFIG_PATH}" > "${TMP_SAMCONFIG}"

if [[ "${ENABLE_DATADOG}" == "true" ]]; then
  if ! grep -Fq "DatadogApiKeySecretArn=${BANK_API_DATADOG_API_KEY_SECRET_ARN}" "${TMP_SAMCONFIG}"; then
    echo "Error: Datadog parameter injection failed for DatadogApiKeySecretArn." >&2
    exit 1
  fi
  if ! grep -Fq "DatadogNodeLayerVersion=${DATADOG_NODE_LAYER_VERSION}" "${TMP_SAMCONFIG}"; then
    echo "Error: Datadog parameter injection failed for DatadogNodeLayerVersion." >&2
    exit 1
  fi
  if ! grep -Fq "DatadogExtensionLayerVersion=${DATADOG_EXTENSION_LAYER_VERSION}" "${TMP_SAMCONFIG}"; then
    echo "Error: Datadog parameter injection failed for DatadogExtensionLayerVersion." >&2
    exit 1
  fi
fi

deploy_args=(
  --config-file "${TMP_SAMCONFIG}"
  --config-env "${ENVIRONMENT}"
  --no-confirm-changeset
  --no-fail-on-empty-changeset
)

if [[ "${ENABLE_DATADOG}" == "true" ]]; then
  TMP_TEMPLATE="$(mktemp /tmp/demo-bank-app-template.datadog.XXXXXX)"
  cleanup_files+=("${TMP_TEMPLATE}")
  node ./scripts/render-datadog-template.mjs --input ./template.yaml --output "${TMP_TEMPLATE}"
  deploy_args+=(--template-file "${TMP_TEMPLATE}")
  echo "Deploying bank-api (Datadog enabled) with config env '${ENVIRONMENT}' and layers node=${DATADOG_NODE_LAYER_VERSION} extension=${DATADOG_EXTENSION_LAYER_VERSION}"
else
  echo "Deploying bank-api (Datadog disabled) with config env '${ENVIRONMENT}'"
fi

exec sam deploy "${deploy_args[@]}"
