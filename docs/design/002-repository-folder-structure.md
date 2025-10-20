# Technical Design – Repository Folder Structure & Coding Rules

## 0 TL;DR

| Rule                        | Summary                                                              |
| --------------------------- | -------------------------------------------------------------------- | ------------------------ |
| **One file ⇢ one use-case** | `libs/<domain>/application/commands                                  | queries/<kebab-name>.ts` |
| **Exports**                 | `<UseCase>Command` & `transferMoney()` (named, _no_ default export)  |
| **Ports live**              | `libs/<domain>/application/ports.ts`                                 |
| **Lambda role**             | Translate HTTP (ts-rest) ↔ command/query call; no business code      |
| **Layers**                  | `domain → application → infrastructure`; infra never imported inward |
| **Tags**                    | Every lib has `scope:<domain> , layer:<layer>`                       |

---

## 1 Workspace & Folder Layout

```
apps/
└─ bank-api/                    # Lambda + API Gateway mapping
   ├─ src/
   │  ├─ main.ts                # ts-rest-serverless adapter & routing
   │  ├─ auth.ts                # Authentication handlers (signUp, signIn, etc.)
   │  └─ banking.ts             # Banking handlers (transfer, accounts, etc.)

libs/
├─ banking/
│  ├─ domain/                  # Entities & value objects
│  ├─ application/
│  │  ├─ ports.ts
│  │  ├─ commands/
│  │  │   └─ transfer-money.ts
│  │  └─ queries/
│  │      └─ get-transaction-history.ts
│  └─ infrastructure/
│     └─ persistence/…
│     └─ external/…
├─ auth/
│  └─ … (same 3-layer layout)
└─ shared/                      # Cross-cutting primitives
   └─ bank-api-contract
```

---

## 2 Ports & Dependencies

- Define **only abstractions** (`AccountRepository`, `MyOSClient`) in `application/ports.ts`.
- Handlers receive deps explicitly:

```ts
export async function transferMoney(
  cmd: TransferMoneyCommand,
  { accountRepo, clock, eventBus }: Deps,
): Promise<TransferResult> { … }
```

---

## 3 Command & Query File Convention

```ts
// libs/banking/application/commands/transfer-money.ts
export type TransferMoneyCommand = { … };
export async function transferMoney(cmd: TransferMoneyCommand, deps: Deps): Promise<TransferResult> { … }
```

- **Named export** equals file name (`transferMoney`).
- Returns only lightweight tokens/ids — never read models.

---

## 4 Nx & ESLint Rules

### 4.1 Layer Guards

```jsonc
{
  "rules": {
    "@nx/enforce-module-boundaries": [
      "error",
      {
        "allowCircularSelfDependency": false,
        "enforceBuildableLibDependency": true,
        "depConstraints": [
          {
            "sourceTag": "layer:domain",
            "onlyDependOnLibsWithTags": ["layer:domain"],
            "forbidType": "circular"
          },
          {
            "sourceTag": "layer:application",
            "onlyDependOnLibsWithTags": ["layer:domain", "layer:application"],
            "forbidType": "circular"
          },
          {
            "sourceTag": "layer:infra",
            "onlyDependOnLibsWithTags": ["layer:*"]
          }
        ]
      }
    ],
    "import/no-cycle": ["error", { "maxDepth": 1 }]
  }
}
```

### 4.2 Scope Isolation (Optional)

```jsonc
{
  "sourceTag": "scope:banking,layer:application",
  "onlyDependOnLibsWithTags": [
    "scope:banking",
    "layer:domain",
    "layer:application"
  ]
}
```

_Apps in one domain *can* import **domain** libs from another domain for shared Value Objects / Domain Events, but **cannot** import each other's application layer._

---

## 5 API Gateway → Lambda Mapping with **ts-rest-serverless**

```
apps/bank-api/
└─ src/
    ├─ main.ts                 # Clean routing: assigns handlers
    ├─ auth.ts                 # Auth domain handlers (signUp, signIn, etc.)
    └─ banking.ts              # Banking domain handlers (transfer, etc.)
shared/bank-api-contract/
└─ src/
    └─ lib/
        └─ bank-api-contract.ts   # ts-rest contract: routes, schemas
```

**auth.ts**

```ts
import { signUp } from '@demo-bank-app/auth';

export const signUpHandler = async ({ body }: { body: { name: string } }) => {
  const deps = await initializeDependencies();
  const result = await signUp(body, deps);

  return {
    status: 201 as const,
    body: { userId: result.user.id, name: result.user.name },
    headers: { 'Set-Cookie': `auth=${result.token}; HttpOnly; ...` },
  };
};
```

**banking.ts**

```ts
import { transferMoney } from '@demo-bank-app/banking/application/commands/transfer-money';
import { getTransactionHistory } from '@demo-bank-app/banking/application/queries/get-transaction-history';

export const transferMoneyHandler = async ({ body }) =>
  transferMoney(body, deps);

export const getTransactionHistoryHandler = async ({ params, query }) =>
  getTransactionHistory({ ...params, ...query }, deps);
```

**main.ts** _(Clean routing only)_

```ts
import { createLambdaHandler } from '@ts-rest/serverless/aws';
import { bankApiContract } from '@demo-bank-app/shared/bank-api-contract';
import { signUpHandler } from './auth';
import { transferMoneyHandler, getTransactionHistoryHandler } from './banking';

export const handler = createLambdaHandler(bankApiContract, {
  // Health check (minimal, no business logic)
  health: async () => ({
    status: 200,
    body: { status: 'healthy', timestamp: new Date().toISOString() },
  }),

  // Auth handlers
  signUp: signUpHandler,

  // Banking handlers
  transferMoney: transferMoneyHandler,
  getTransactionHistory: getTransactionHistoryHandler,
});
```

_The same `contract` file feeds:_

1. **Validation** inside Lambda.
2. **OpenAPI export** (`ts-rest-openapi`) for docs.
3. **Client generation** for front-end (`ts-rest-client`).

---

## 6 Testing Conventions

Domain - pure unit tests  
Application - with in-memory fakes  
Infrastructure - integration tests (LocalStack / WireMock)
