# 002 Project Setup & Development Stack

## Status
- 2025-06-26 Accepted

## Context
The demo must be quick to scaffold yet representative of production-grade engineering. Choices should maximise developer productivity, enable clean modular design, and minimise boilerplate while remaining familiar to interviewers.

## Decision
1. **Nx Monorepo** – Use Nx to host all sources.  
   • `/apps` = primary delivery artefacts (REST API, React SPA).  
   • `/libs` = domain, application, and infrastructure packages shared by apps.  
   *Alternatives*: **Turborepo** Nx chosen for prior experience with the tool and no clear benefits of Turborepo.
2. **Single-Version Policy** – All packages share one dependency graph & version lockstep. Simplifies dependency management for a small codebase and assures compatibility within a shared codebase.
3. **Hexagonal Architecture** – Domain + application logic kept framework-free inside `/libs/domain/**`; deployable applications / adapters (lambda) implemented in `/apps`. Adapters like DynamoDB repository implemented in `libs/**`. Clean code structure and component boundaries.
4. **Infrastructure-as-Code with AWS SAM** – Use AWS Serverless Application Model for packaging/deploying; leverage `sam local` together with LocalStack for full-local execution.  
   *Alternative*: SST (Serverless Stack) gives hot-reloading but adds an extra framework and still depends on LocalStack for AWS parity. It also spawns non-0 cost resources for live development in AWS. Terraform/CDK - seems overkill for simple project.
5. **Frontend Stack** – React + **Vite** for instant dev‐server startup and Hot Module Replacement.
6. **Testing** – Unit tests with **Vitest** (ESM-native and fast). AWS Components emulation for integration & e2e tests with LocalStack.  
   *Alternative*: Jest. Vitest aligns with Vite ecosystem + opportunity to try new tool.
7. **API Documentation** – Adopt **ts-rest** with the OpenAPI plugin to auto-emit spec & client code.  
   *Alternative*: Swagger annotations or API Gateway's native export – less type-safe. No api client autogeneration.
8. **Monitoring** – Rely on CloudWatch Logs & Metrics with a minimal dashboard. Use AWS Powertools. Alerts are out-of-scope but note that real projects would implement SLO-driven alerts & error budgets. 

## Consequences
* **Pros**: Consistent monorepo workflows, rapid local feedback loop (`sam local` + Vite), strong testability, automatic API docs, minimal cognitive load for reviewers familiar with Nx.  
* **Cons**: single-version policy can hinder selective upgrades (not an issue for this project); CloudWatch only covers AWS – no synthetic or frontend monitoring.
