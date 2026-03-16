#!/usr/bin/env bash
set -euo pipefail

npx_command="${NPX_COMMAND:-npx}"
npm_command="${NPM_COMMAND:-npm}"
step_from="${VERIFY_FULL_STEP_FROM:-web-build}"

steps=(
  "web-build"
  "lint"
  "typecheck"
  "build-all"
  "test-all"
  "test-integration-all"
  "e2e"
)

run_step() {
  local step_name="$1"
  shift

  echo
  echo "==> Running step: ${step_name}"
  echo "    Command: $*"
  "$@"
}

step_index=-1
for index in "${!steps[@]}"; do
  if [[ "${steps[${index}]}" == "${step_from}" ]]; then
    step_index="${index}"
    break
  fi
done

if (( step_index < 0 )); then
  echo "Invalid VERIFY_FULL_STEP_FROM='${step_from}'." >&2
  echo "Allowed values: ${steps[*]}" >&2
  exit 1
fi

for current_index in "${!steps[@]}"; do
  if (( current_index < step_index )); then
    continue
  fi

  case "${steps[${current_index}]}" in
    web-build)
      run_step "web-build" "${npx_command}" nx run @demo-bank-app/bank-web-app:build
      ;;
    lint)
      run_step "lint" "${npm_command}" run lint
      ;;
    typecheck)
      run_step "typecheck" "${npm_command}" run typecheck
      ;;
    build-all)
      run_step "build-all" "${npm_command}" run build:all
      ;;
    test-all)
      run_step "test-all" "${npm_command}" run test:all
      ;;
    test-integration-all)
      run_step "test-integration-all" "${npm_command}" run test:integration:all
      ;;
    e2e)
      run_step "e2e" "${npm_command}" run e2e
      ;;
  esac
done
