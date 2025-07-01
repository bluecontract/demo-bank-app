# 004 Repository Folder Structure & Hexagonal Architecture

## Status

- 01-07-2025 Accepted

## Context

To ensure consistency, scalability, and clear separation of concerns, we need an explicit decision regarding how code is organised inside the Nx monorepo. The project already outlines Hexagonal (Ports & Adapters) principles, but the details and decision itself has never been formalised as an Architectural Decision Record (ADR).

## Decision

1. **Hexagonal layering** – Every bounded context is organised into `domain → application → infrastructure` layers. Code in an outer layer MUST NOT be imported by an inner layer.
2. **Nx library per layer** – Each layer lives in its own Nx library under `libs/<domain>/<layer>` and is tagged with `scope:<domain>,layer:<layer>`.
3. **One file ⇢ one use-case** – Application layer exposes commands/queries via single-purpose files (`commands|queries/<use-case>.ts`). Exports are named (`<UseCase>Command`, `<useCase>()`).
4. **Ports live centrally** – All abstraction interfaces for a domain are declared in `application/ports.ts` of that domain.
5. **Apps are pure adapters** – Runtime entry-points (e.g. AWS Lambda handlers, React UI, CLI) translate external protocols into command/query calls and contain no business logic.
6. **Layer guards enforced by ESLint** – `@nx/enforce-module-boundaries` plus `import/no-cycle` prevent violations (see design doc 002 for exact rules).

## Consequences

- **Positive**

  - Clear boundaries improve readability, testability, and onboarding.
  - Layer tags let Nx enforce constraints automatically, avoiding architecture erosion.
  - Application services remain UI-agnostic and backend-agnostic, easing future migrations.

- **Negative**
  - Requires discipline when adding new dependencies or cross-domain interactions.
  - Slightly higher overhead for small demo features; mitigated by tooling and generators.

## References

- Design doc – [002 Repository Folder Structure & Coding Rules](../design/002-repository-folder-structure.md)
