# Demo Bank App

Demo Bank App is the end-to-end reference for modelling banking workflows using **PayNotes** and driving them through the MyOS.

A **PayNote** is a programmable payment agreement shared by a payer, payee, and guarantor.
It captures the commercial promise, the evidence required to fulfill it, and the automated actions that release or refund funds.
Everyone sees the same terms and same timeline.

## PayNote + MyOS Integration (only ~500 lines of code)

- `POST /v1/paynotes/bootstrap` → `apps/bank-api/src/paynote/bootstrapPayNote.ts` validates the uploaded PayNote, hydrates payer/payee accounts, and forwards the document plus channel bindings to MyOS `POST /documents/bootstrap` so processing begins instantly.
- `POST /v1/paynotes/webhook` → `apps/bank-api/src/paynote/webhook.ts` ingests MyOS callbacks, downloads event detail via `GET /myos-events/{eventId}`, and maps capture events to real ledger transfers.
- Together these handlers amount to **~500 lines of code** illustrating how little code is required to wrap a PayNote flow with bank-grade system.

### Flow at a Glance

1. The web app collects the PayNote (YAML or parsed PDF), prompts for source/destination accounts, then calls `POST /v1/paynotes/bootstrap`.
2. The bootstrap handler verifies the document, binds participants, and hands it to MyOS via `POST /documents/bootstrap`.
3. MyOS processes the PayNote and calls back into `POST /v1/paynotes/webhook`; the handler retrieves the full payload with `GET /myos-events/{eventId}`.
4. When capture events (for example `PayNote/Capture Funds Requested` or `PayNote/Reserve Funds and Capture Immediately Requested`) appear, the webhook performs the corresponding bank transfer and logs the result.

## 🚀 Quick Start

### Prerequisites

- **Node.js 22+ (LTS)** - JavaScript runtime environment
- **npm** - Package manager
- **Docker** - Required for LocalStack (AWS service emulation)
- **AWS SAM CLI** - Required for local Lambda development and testing
- **Localstack samlocal** - Required for local Lambda development and testing
- **AWS CLI** (optional) - Required for `npm run logs:summary`

#### Install AWS SAM CLI

Choose one of the following installation methods:

**Option 1: Using pip (Recommended)**

```bash
pip3 install aws-sam-cli
```

**Option 2: Using other methods**
See the [official AWS SAM CLI installation guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) for Windows, Linux, and other installation options.

**Verify Installation**

```bash
sam --version
```

> **⚠️ Troubleshooting SAM CLI**: If you get a "bad interpreter" error, SAM CLI may have been installed with an older Python version. Solutions:
>
> **Option 1: Reinstall with current Python**
>
> ```bash
> pip3 uninstall aws-sam-cli
> pip3 install aws-sam-cli
> ```
>
> **Option 2: Add Python bin to PATH** (if you see PATH warnings)
>
> ```bash
> # Add to your shell profile (.zshrc, .bashrc, etc.)
> export PATH="$(python3 -m site --user-base)/bin:$PATH"
> ```

#### Install samlocal

```bash
pip3 install aws-sam-cli-local
```

**Verify Installation**

```bash
samlocal --version
```

### Run the Application

```bash
# 1. Install dependencies
npm install

# 2. Ensure Docker is running
npm run docker:check

# 3. Start all services (frontend, backend, localstack)
npm run serve:all
```

The app will be available at:

- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:3000
- **LocalStack**: http://localhost:4566 (or your `LOCALSTACK_EDGE_PORT`)

### Available Scripts

| Command                        | Description                                     |
| ------------------------------ | ----------------------------------------------- |
| `npm start`                    | Start development server                        |
| `npm run dev`                  | Start development server (alias)                |
| `npm test`                     | Run tests for affected projects                 |
| `npm run test:all`             | Run tests for all projects                      |
| `npm run test:integration`     | Run integration tests for affected projects     |
| `npm run test:integration:all` | Run integration tests for all projects          |
| `npm run test:watch`           | Run tests in watch mode                         |
| `npm run e2e`                  | Run E2E tests locally                           |
| `npm run e2e:dev`              | Run E2E tests against dev environment           |
| `npm run e2e:prod`             | Run E2E tests against production environment    |
| `npm run build`                | Build affected projects                         |
| `npm run build:all`            | Build all projects                              |
| `npm run lint`                 | Lint affected projects                          |
| `npm run lint:all`             | Lint all projects                               |
| `npm run lint:fix`             | Lint and auto-fix affected issues               |
| `npm run typecheck`            | Run TypeScript type checking for all projects   |
| `npm run verify:quick`         | Lint, typecheck, build, and run affected tests  |
| `npm run verify:full`          | Lint, typecheck, build, and run full test suite |
| `npm run format`               | Format code with Prettier                       |
| `npm run format:check`         | Check code formatting                           |
| `npm run format:staged`        | Format only staged files with Prettier          |
| `npm run security:audit`       | Run security audit on production dependencies   |
| `npm run security:audit:dev`   | Run security audit on development dependencies  |
| `npm run security:audit:fix`   | Fix security vulnerabilities                    |
| `npm run pre-commit`           | Run pre-commit checks manually                  |
| `npm run validate-commit`      | Validate commit message format                  |
| `npm run generate-docs`        | Generate OpenAPI docs from TypeScript           |
| `npm run wait-for-backend`     | Wait for backend to be ready                    |
| `npm run clean`                | Reset Nx cache                                  |
| `npm run graph`                | View dependency graph                           |
| `npm run serve:all`            | Start all services with Nx                      |
| `npm run serve:stack`          | Start backend stack (LocalStack + Lambda)       |
| `npm run docker:check`         | Verify Docker is running                        |
| `npm run logs:summary`         | Tail summary lambda logs (LocalStack)           |

> **💡 Affected vs All**: By default, commands run only on "affected" projects (those changed since the last commit). Use `:all` variants to run on all projects.

### 🎯 Multi-Service Development

Start all services with Nx orchestration:

```bash
# Start all services with dependency management
npm run serve:all

# Start individual services
nx serve localstack           # ensures LocalStack is running
nx serve @demo-bank-app/bank-api  # Backend API only (starts localstack)
nx serve @demo-bank-app/bank-web-app # Frontend only

# LocalStack credentials (for bank-api)
# Uses the localstack profile defined in apps/bank-api/.aws/{config,credentials}
# so you don't need AWS SSO to run locally.

# Check service status
docker ps --filter "name=${LOCALSTACK_CONTAINER_NAME:-localstack-demo-bank-app}"

# Stop services when done
docker stop "${LOCALSTACK_CONTAINER_NAME:-localstack-demo-bank-app}"
```

### Git Worktrees + LocalStack (Parallel Agents)

Each worktree should run its own LocalStack container and ports. Use a
worktree-local `.localstack.env` plus a worktree-specific SAM env file.

#### Quick setup script

```bash
scripts/setup-worktree-localstack.sh wt1 4567 5510-5559 3001 4201 /Users/you/secrets/demo-bank-app.bank-api.json
```

This writes `.localstack.env` at the repo root and creates/updates
`apps/bank-api/env.local.worktree.json` with the matching LocalStack endpoint.
If a shared secrets file path is provided, its values are merged into the
worktree env file.
The secrets file path is stored in `.localstack.env` as `SHARED_SECRETS_FILE`.
If you place `bank-api.env.local.json` at the repo root, the script will use it
automatically.
Re-run the script per worktree with a unique port/container name.

You can also let it auto-pick the nearest free ports:

```bash
scripts/setup-worktree-localstack.sh wt1
```

Auto-pick selects the closest free ports to defaults (LocalStack 4566, API 3000,
Web 4200) and finds a free LocalStack port range if needed.
The script prints the chosen ports and stores them in `.localstack.env`.

To disable the LocalStack port range mapping, pass an empty third arg:

```bash
scripts/setup-worktree-localstack.sh wt1 "" ""
```

#### Shared secrets (one-time)

Create a JSON file outside the repo (gitignored), for example:

```json
{
  "MYOS_API_KEY": "…",
  "MYOS_ACCOUNT_ID": "…",
  "OPENAI_API_KEY": "…"
}
```

You can also use the env.local.json shape if you prefer:

```json
{
  "Parameters": {
    "MYOS_API_KEY": "…",
    "MYOS_ACCOUNT_ID": "…",
    "OPENAI_API_KEY": "…"
  }
}
```

Pass this path to the setup script and it will be merged into
`apps/bank-api/env.local.worktree.json`.

#### Stop a worktree stack

```bash
scripts/stop-worktree-localstack.sh
```

#### Manual setup

1. Create `.localstack.env` at the repo root (not committed):

```bash
LOCALSTACK_CONTAINER_NAME=localstack-demo-bank-app-wt1
LOCALSTACK_EDGE_PORT=4567
LOCALSTACK_PORT_RANGE=5510-5559
AWS_ENDPOINT_URL=http://localhost:4567
LOCALSTACK_DOCKER_ENDPOINT_URL=http://host.docker.internal:4567
BANK_API_PORT=3001
WEB_APP_PORT=4201
WEB_APP_PREVIEW_PORT=4301
BANK_API_URL=http://localhost:3001
VITE_API_URL=http://localhost:3001
E2E_BASE_URL=http://localhost:4201
ENV_VARS_FILE=env.local.worktree.json
```

- Set `LOCALSTACK_PORT_RANGE=` (empty) to skip the 4510-4559 mapping if you do
  not need it.
- `AWS_ENDPOINT_URL` is for host-side tools/tests.
- `LOCALSTACK_DOCKER_ENDPOINT_URL` is for SAM containers.
- `.localstack.env` and `env.local.worktree.json` are ignored by git.

2. Create a worktree-specific SAM env file:

```bash
cp apps/bank-api/env.local.json apps/bank-api/env.local.worktree.json
# Edit AWS_ENDPOINT_URL and AwsEndpointUrl to match LOCALSTACK_DOCKER_ENDPOINT_URL
```

3. Load the env and run:

```bash
source .localstack.env
npm run serve:all
```

#### Running two worktrees in parallel

Pick unique ports for each worktree, then run `npm run serve:all` in both:

```bash
# Worktree 1
scripts/setup-worktree-localstack.sh wt1 4567 5510-5559 3001 4201
source .localstack.env
npm run serve:all

# Worktree 2
scripts/setup-worktree-localstack.sh wt2 4568 5610-5659 3002 4202
source .localstack.env
npm run serve:all
```

### Logs

```bash
# Summary lambda (LocalStack CloudWatch)
npm run logs:summary
```

## 🧪 Testing

### Run Tests

```bash
# All tests
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (full-stack local testing)
npm run e2e

# E2E tests against remote environments
npm run e2e:dev   # Test against dev environment
npm run e2e:prod  # Test against production environment
```

**Note:** For local E2E testing, start the backend services first, then run E2E tests:

```bash
# Terminal 1: Start the full stack
npm run serve:all

# Terminal 2: Run E2E tests (includes automatic health check)
npm run e2e
```

The E2E command automatically waits for the backend to become healthy before running tests.

**Environment Variables:**

- `E2E_BASE_URL`: Frontend URL for E2E tests (default: http://localhost:4300)
- `BACKEND_URL`: Backend URL for health checks (default: http://localhost:3000)

### Security Auditing

```bash
# Run security audit (production dependencies only, moderate+)
npm run security:audit

# Run security audit (all dependencies, high+ only)
npm run security:audit:dev

# Automatically fix security vulnerabilities
npm run security:audit:fix

# Check all vulnerability levels (including low)
npm audit
```

### Build & Deploy

```bash
# Build affected projects
npm run build

# Build all projects (when needed)
npm run build:all

# Preview production build
npx nx preview bank-web-app

# Utility commands
npm run clean  # Reset Nx cache
npm run graph  # View dependency graph
```

## 📚 Project Documentation

- **[docs/problem-exploration](./docs/problem-exploration/)**: Project context and problem exploration
- **[docs/requirements/](./docs/requirements/)**: Functional requirements & UX
- **[docs/adr/](./docs/adr/)**: Architectural decisions & rationale
- **[docs/design/](./docs/design/)**: Technical design & architecture

## 🏗️ Repository Structure

This project follows a **hexagonal architecture** within an **Nx monorepo**.

```
demo-bank-app/
├── apps/                           # Deployable applications
│   ├── bank-web-app/              # React SPA (Vite + Tailwind)
│   │   ├── src/                   # Frontend source code
│   │   ├── tailwind.config.js     # Styling configuration
│   │   └── vite.config.ts         # Build configuration
│   ├── bank-api/                  # AWS Lambda backend
│   │   ├── src/                   # Lambda source code
│   │   └── project.json           # SAM local serve config
│   ├── localstack/                # LocalStack service wrapper
│   │   └── project.json           # LocalStack serve config
│   └── bank-web-app-e2e/          # Playwright E2E tests
│       ├── src/                   # E2E test suites
│       └── playwright.config.ts   # Test configuration
├── libs/                          # Shared libraries
│   ├── bank-api-contract/         # Shared API contracts (ts-rest + Zod)
│   ├── domain/                    # Domain logic (business rules)
│   ├── application/               # Use cases & application services
│   └── infrastructure/            # External adapters (DB, APIs)
├── docs/                          # Architecture & requirements
│   ├── adr/                       # Architectural Decision Records
│   ├── requirements/              # Functional & non-functional specs
│   └── design/                    # Technical design documents
└── nx.json                        # Nx workspace configuration
```

### Architectural Patterns

#### 📁 `/apps` vs `/libs` Split

- **`/apps`**: Deployable units (SPAs, Lambdas, E2E tests)
- **`/libs`**: Reusable code shared between applications

#### 🔷 Hexagonal Architecture (Ports & Adapters)

```
┌─────────────────────────────────────────────────────────────┐
│                     /apps (Adapters)                        │
├─────────────────────────────────────────────────────────────┤
│  bank-web-app/     │  bank-api/        │  bank-web-app-e2e/ │
│  (React SPA)       │  (AWS Lambda)     │  (E2E Tests)       │
└─────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼───────────────┐
                │              │               │
┌───────────────▼───┐   ┌──────▼───────┐   ┌───▼────────────┐
│   /libs/domain/   │   │ /libs/app/   │   │ /libs/infra/   │
│  (Business Logic) │   │ (Application)│   │   (Adapters)   │
│  • Accounts       │   │ • Ports      │   │ • DynamoDB     │
│  • Transfers      │   │ • Commands   │   │ • MyOS Client  │
│  • Blue Docs      │   │ • Queries    │   │ • S3 Storage   │
└───────────────────┘   └──────────────┘   └────────────────┘
```

#### 🏢 Infrastructure Colocation

Each app manages its own infrastructure-as-code:

- **`bank-web-app/`**: S3 bucket, CloudFront distribution
- **`bank-api/`**: AWS Lambda, API Gateway, DynamoDB
- **Shared resources**: Defined in dedicated infrastructure packages

## 📦 Dependency Management Strategy

### Single Version Policy

- **DevDependencies centralized at root** - All build tools, linters, and testing frameworks managed in workspace root
- **Runtime dependencies per project** - Only production dependencies live in individual app/lib package.json files
- **Nx workspace resolution** - Enables consistent tooling versions across all projects

## ⚡ Lambda Production Optimization

### Optimized Bundle Generation

- **Tree-shaking enabled**: Only used code included via esbuild bundling
- **Minification in production**: Code compression for faster cold starts
- **Source maps**: Bundled source maps for clear stack traces

```bash
# Development build (fast iteration)
nx serve bank-api        # No minification and tree shaking

# Production build (optimized)
nx build bank-api        # Minified tree-shaked bundle, all dependencies inlined
```

## 🔗 API Contract & Documentation

### Shared Contract Library (`libs/bank-api-contract`)

- **Centralized contracts**: TypeScript API definitions using ts-rest + Zod
- **Cross-app consistency**: Backend, frontend, and SDKs import the same contract
- **Type safety**: Compile-time API validation between client and server
- **Auto-completion**: Full IDE support for API endpoints and schemas

### Documentation Generation

```bash
# Generate OpenAPI docs from TypeScript contract
npm run generate-docs       # Creates docs/api/openapi.{json,yaml}
```

**Benefits:**

- 📊 Contract-first development
- 🔄 Documentation stays in sync with code
- 📱 Enables SDK generation for multiple platforms
- ✅ Single source of truth for API structure

## 🛠️ Technology Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend** Node.js, AWS Lambda, DynamoDB
- **Testing**: Vitest, Playwright
- **Build**: Nx, esbuild
- **Deployment**: AWS SAM, GitHub Actions
- **Local development** Localstack / Docker

## 🎯 Code Quality & Git Hooks

### Automatic Quality Enforcement

This project uses **automated git hooks** to ensure code quality and security:

```bash
# Pre-commit (automatic on git commit)
- Phase 1: Format staged files with Prettier + ESLint
- Phase 2: Security audit (production: moderate+, dev: high+ only)
- Phase 3: Run affected tests
- Block commit if any phase fails

# Commit message (automatic on git commit)
- Validate conventional commit format
- Ensure consistent commit history
```

### Git Hook Setup

Git hooks are automatically installed via **Husky**:

- ✅ **Pre-commit**: Formats code + security audit + runs tests
- ✅ **Commit-msg**: Validates conventional commit format
- ✅ **Security audit**: Blocks commits with vulnerabilities (moderate+ in prod, high+ in dev)
- ✅ **Staged-only formatting**: Fast iteration (formats only changed files)

**Conventional Commit Format:** `type: description` (feat, fix, docs, chore, etc.)

## 🚀 CI/CD Pipeline

### Pipeline Flow

```mermaid
graph TB
    A[Push/PR] --> B["🧪 Quality Gates<br/>Unit Tests • Lint • Build • Security"]
    B --> C["🐳 Integration Tests<br/>AWS Services via LocalStack"]
    C --> D["⚡ Local Stack E2E<br/>SAM Local + React Dev + E2E"]
    D --> E{Branch Type?}
    E -->|PR to main| F["🚀 Deploy Dev<br/>+ Cloud E2E Tests"]
    E -->|Push to main| G["🚀 Deploy Production<br/>+ Cloud E2E Tests"]

    subgraph "Pre-Deployment Test Pyramid"
        direction TB
        T1["1️⃣ Unit Tests<br/>(Fast, Isolated)"]
        T2["2️⃣ Integration Tests<br/>(AWS Services)"]
        T3["3️⃣ Local E2E<br/>(Full Stack)"]
        T1 --> T2 --> T3
    end

    subgraph "Post-Deployment"
        T4["4️⃣ Cloud E2E<br/>(Live Environment)"]
    end

    %% Connect pyramid to main flow
    B -.-> T1
    C -.-> T2
    D -.-> T3
    F -.-> T4
    G -.-> T4

    style A fill:#e1f5fe
    style E fill:#fff3e0
    style F fill:#e8f5e8
    style G fill:#fff8e1
    style T1 fill:#f3e5f5
    style T2 fill:#e8f5e8
    style T3 fill:#fff3e0
    style T4 fill:#fce4ec
```

### Test Strategy

**4-Tier Test Pyramid:**

1. **Unit Tests**: Fast, isolated tests without external dependencies
2. **Integration Tests**: AWS service integration via LocalStack containers
3. **Local Stack E2E**: Full-stack tests against local services (pre-deployment validation)
4. **Cloud E2E**: End-to-end tests against live AWS environments (post-deployment verification)

**Deployment Flow:**

- **PR to main** → Deploy to dev environment + run cloud E2E tests
- **Merge to main** → Deploy to production + run cloud E2E tests
- **Zero manual approvals** - Fully automated with proper test gates

---

_This project demonstrates modern TypeScript/Node.js development with AWS serverless architecture, following hexagonal architecture principles and industry best practices._
