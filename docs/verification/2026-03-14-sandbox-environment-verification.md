# Sandbox environment verification - 2026-03-14

## Scope

Goal:

- verify whether this sandbox can run `npm run serve:all`
- verify whether this sandbox can run `npm run verify:full`
- record blockers and prepare a minimally invasive sandbox-compatible setup

Raw execution log:

- `agents/skills/tests/executions/env_verify_20260314T151618Z.log`

## Baseline sandbox differences

Initial sandbox state differed from the repository assumptions:

- `docker` was not installed
- `sam` / `samlocal` were not installed
- `aws` CLI was not installed
- `node_modules` was absent
- the terminal metadata path from task input was not present in this sandbox

## What failed in the default flow

### 1. `npm run serve:all` failed on the first run

Observed failure chain:

1. `apps/localstack/scripts/start-localstack.sh` started the container and returned after a fixed 5 second wait.
2. LocalStack was still booting, so `apps/bank-api/scripts/deploy-localstack.sh` failed immediately because `http://localhost:4566` was not ready yet.

This is a race condition in the current local start flow.

### 2. `host.docker.internal` is not available in this Linux sandbox

The generated `LOCALSTACK_DOCKER_ENDPOINT_URL` and worktree env file assumed
`host.docker.internal`. In this sandbox, bridge-network containers cannot resolve
that hostname, so Lambda containers cannot reach LocalStack unless a different
Docker-host endpoint is used.

### 3. Local SAM emulation failed with `arm64` on an `amd64` host

`apps/bank-api/template.yaml` defines:

- `Globals.Function.Architectures: [arm64]`

That is valid for deployment, but local `sam local start-api` on this `amd64`
sandbox failed to start runtime containers until the local emulation template
was switched to `x86_64`.

## Sandbox-compatible setup prepared in repo

### Added bootstrap

- `scripts/setup-sandbox-env.sh`
- `.cursor/environment.json`
- `.cursor/Dockerfile.cloud`
- `scripts/start-cursor-cloud.sh`

What it does:

- installs `docker.io`, `jq`, `unzip`
- installs `awscli` and `aws-sam-cli-local`
- exposes `aws`, `sam`, `samlocal` in `/usr/local/bin`
- starts Docker with sandbox-safe flags:
  - `--iptables=false`
  - `--storage-driver=vfs`
- creates a worktree-local `.localstack.env`

### LocalStack readiness fix

Updated:

- `apps/localstack/scripts/start-localstack.sh`

Change:

- wait for LocalStack health with retry/timeout instead of sleeping a fixed 5 seconds

Impact:

- removes the `serve:all` race where backend deploy started before LocalStack was ready

### Docker-host endpoint fix for Linux sandboxes

Updated:

- `scripts/setup-worktree-localstack.sh`

Change:

- when Docker bridge metadata is available on Linux, `.localstack.env` now uses
  the bridge gateway (for example `172.17.0.1`) for
  `LOCALSTACK_DOCKER_ENDPOINT_URL`
- otherwise it falls back to `host.docker.internal`

Impact:

- Lambda containers can reach LocalStack in this sandbox

### Local SAM architecture fix

Added:

- `apps/bank-api/scripts/start-local-api.sh`

Updated:

- `apps/bank-api/project.json`

Change:

- `bank-api:serve` now starts through a wrapper that:
  - detects local host architecture
  - creates a temporary SAM template for local emulation
  - rewrites the local emulation architecture to `x86_64` on `amd64` hosts
  - passes a matching Lambda base image to `sam local start-api`

Impact:

- local `sam local start-api` works in this sandbox while production deploy
  settings remain unchanged in `template.yaml`
- Cursor Cloud can now bootstrap the required Docker + SAM toolchain at the repo
  environment level instead of depending on per-run manual setup

## Verified sandbox path

The following sandbox-specific sequence was verified successfully:

```bash
scripts/setup-sandbox-env.sh sbx
source .localstack.env
npm install
npm run serve:all
```

The critical backend health probe succeeded after applying the sandbox changes:

- `GET http://localhost:3000/health` -> `200 OK`

Verified supporting conditions:

- Docker daemon running with restricted-kernel-safe flags
- LocalStack healthy on `http://localhost:4566`
- SAM local API reachable on `http://localhost:3000`
- frontend reachable on `http://localhost:4200`

## Remaining notes

- `verify:full` still assumes the stack is already running before it reaches `npm run e2e`.
- This matches the current project design (`npm run e2e` expects a running local stack).
- For cloud sandboxes, the bootstrap script should be treated as the required pre-step before local E2E verification.

## Recommended permanent environment update

Because this sandbox required system package installation and a non-default
Docker daemon startup mode, the cloud agent base environment should be updated
so future agents do not need to repeat the same bootstrap manually.
