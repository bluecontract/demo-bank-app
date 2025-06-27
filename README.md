# Blue Demo Bank

A modern banking application demonstrating Blue Language integration and state-of-the-art serverless architecture.

## 🚀 Quick Start

### Prerequisites

- Node.js 22+ (LTS)
- npm

### Run the Application

```bash
# Install dependencies
npm install

# Start the development server
npm start
```

The app will be available at `http://localhost:4200`

### Available Scripts

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm start`            | Start development server          |
| `npm test`             | Run tests for affected projects   |
| `npm run test:all`     | Run tests for all projects        |
| `npm run test:watch`   | Run tests in watch mode           |
| `npm run e2e`          | Run E2E tests                     |
| `npm run build`        | Build affected projects           |
| `npm run build:all`    | Build all projects                |
| `npm run lint`         | Lint affected projects            |
| `npm run lint:all`     | Lint all projects                 |
| `npm run lint:fix`     | Lint and auto-fix affected issues |
| `npm run format`       | Format code with Prettier         |
| `npm run format:check` | Check code formatting             |
| `npm run clean`        | Reset Nx cache                    |
| `npm run graph`        | View dependency graph             |

> **💡 Affected vs All**: By default, commands run only on "affected" projects (those changed since the last commit). Use `:all` variants to run on all projects.

## 🧪 Testing & Quality

### Run Tests

```bash
# All tests
npm test

# Unit tests in watch mode
npm run test:watch

# E2E tests (Playwright)
npm run e2e
```

### Code Quality

```bash
# Lint all projects
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Format with Prettier
npm run format

# Check formatting
npm run format:check
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

## 🏗️ Repository Structure

This project follows a **hexagonal architecture** within an **Nx monorepo**.

```
demo-blue/
├── apps/                           # Deployable applications
│   ├── bank-web-app/              # React SPA (Vite + Tailwind)
│   │   ├── src/                   # Frontend source code
│   │   ├── tailwind.config.js     # Styling configuration
│   │   └── vite.config.ts         # Build configuration
│   └── bank-web-app-e2e/          # Playwright E2E tests
│       ├── src/                   # E2E test suites
│       └── playwright.config.ts   # Test configuration
├── libs/                          # Shared libraries (future)
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
│                     /apps (Adapters)                       │
├─────────────────────────────────────────────────────────────┤
│  bank-web-app/     │  bank-lambda/     │  bank-web-app-e2e/ │
│  (React SPA)       │  (AWS Lambda)     │  (E2E Tests)       │
└─────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
┌───────────────▼───┐   ┌──────▼─────┐   ┌───▼────────────┐
│   /libs/domain/   │   │ /libs/app/ │   │ /libs/infra/   │
│  (Business Logic) │   │ (Use Cases)│   │   (Adapters)   │
│  • Accounts       │   │ • Services │   │ • DynamoDB     │
│  • Transfers      │   │ • Commands │   │ • MyOS Client  │
│  • Blue Docs      │   │ • Queries  │   │ • S3 Storage   │
└───────────────────┘   └────────────┘   └────────────────┘
```

#### 🏢 Infrastructure Colocation

Each app manages its own infrastructure-as-code:

- **`bank-web-app/`**: S3 bucket, CloudFront distribution
- **`bank-lambda/`**: AWS Lambda, API Gateway, DynamoDB
- **Shared resources**: Defined in dedicated infrastructure packages

## 🛠️ Technology Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend** Node.js, AWS Lambda, DynamoDB
- **Testing**: Vitest, Playwright
- **Build**: Nx, esbuild
- **Deployment**: AWS SAM, GitHub Actions
- **Local development** Docker Compose, Localstack

## 📚 Project Documentation

- **[docs/problem-exploration](./docs/problem-exploration/)**: Project context and problem exploration
- **[docs/requirements/](./docs/requirements/)**: Functional requirements & UX
- **[docs/adr/](./docs/adr/)**: Architectural decisions & rationale
- **[docs/design/](./docs/design/)**: Technical design & architecture

---

_This project demonstrates modern TypeScript/Node.js development with AWS serverless architecture, following hexagonal architecture principles and industry best practices._
