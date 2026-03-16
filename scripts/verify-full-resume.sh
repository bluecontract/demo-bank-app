#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  npm run verify:full:resume -- <step>
  npm run verify:full:resume -- --from <step>
  npm run verify:full:resume -- --list

Examples:
  npm run verify:full:resume -- e2e
  npm run verify:full:resume -- --from test-integration-all

Allowed steps:
  web-build
  lint
  typecheck
  build-all
  test-all
  test-integration-all
  e2e
EOF
}

normalize_step() {
  case "$1" in
    web-build|frontend-build)
      echo "web-build"
      ;;
    lint)
      echo "lint"
      ;;
    typecheck|types)
      echo "typecheck"
      ;;
    build|build-all)
      echo "build-all"
      ;;
    test|unit|test-all)
      echo "test-all"
      ;;
    integration|test-integration|test-integration-all)
      echo "test-integration-all"
      ;;
    e2e|end-to-end)
      echo "e2e"
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

case "${1}" in
  -h|--help)
    usage
    exit 0
    ;;
  --list)
    usage
    exit 0
    ;;
  --from)
    if [[ $# -lt 2 ]]; then
      echo "Missing step name after --from." >&2
      usage
      exit 1
    fi
    requested_step="$2"
    shift 2
    ;;
  *)
    requested_step="$1"
    shift
    ;;
esac

if [[ $# -gt 0 ]]; then
  echo "Unexpected extra arguments: $*" >&2
  usage
  exit 1
fi

if ! step_from="$(normalize_step "${requested_step}")"; then
  echo "Invalid step: ${requested_step}" >&2
  usage
  exit 1
fi

VERIFY_FULL_STEP_FROM="${step_from}" exec bash scripts/verify-full-stepwise.sh
