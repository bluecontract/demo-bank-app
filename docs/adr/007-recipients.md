# 007. Recipient Identifier Design

## Status

- 2025-07-05 Accepted

## Context

We want to let the frontend interact with saved recipients using a stable identifier, while keeping account numbers private. Recipients are keyed in DynamoDB by account number (for uniqueness). Adding a UUID would require a GSI or mapping layer to resolve recipientId → accountNumber.

### Constraints

- Must not leak account numbers in URLs, logs, or API payloads
- Must enforce per-user uniqueness
- Must allow efficient lookup and mutation

## Decision

We will derive the recipient ID from the account number using a one-way HMAC hash. This ID will:

- Serve as the DynamoDB sort key suffix
- Be used in all frontend/backend communications
- Mask the raw account number from external systems

## Consequences

- Deterministic and opaque recipient IDs
- No need for additional indexes or mapping tables
- Enforces uniqueness and privacy

* Hashing logic must be consistent and secure (use HMAC-SHA256)
* Account number changes require delete + insert
* Public-facing ID is now immutable and tied to account number

## Alternatives Considered

### 1. Use `accountNumber` directly as ID

- **Pros:** Simple, no extra computation or mapping needed.
- **Cons:** Leaks sensitive data in URLs, logs, and API payloads. Exposes internal identifiers to external systems, violating privacy and security requirements.

### 2. Use UUID

- **Pros:** Fully opaque, does not leak account numbers. Universally unique and widely supported.
- **Cons:** Requires a lookup or GSI to resolve recipientId → accountNumber, adding complexity and cost. Breaks direct uniqueness enforcement by account number in DynamoDB.

### 3. Use hash(accountNumber) ← **chosen**

- **Pros:** Deterministic and opaque. Enforces uniqueness per user. No need for additional indexes or mapping tables. Simple to implement and reason about. Satisfies privacy and security requirements.
- **Cons:** Hashing logic must be consistent and secure. If the hash secret is leaked, IDs could be reversed (mitigation: rotate secret, monitor access). Account number changes require delete + insert. Public-facing ID is immutable and tied to account number.
