# Technical Design – Repository Folder Structure & Coding Rules

## 0 TL;DR

| Rule                        | Summary                                                              |
| --------------------------- | -------------------------------------------------------------------- | ------------------------ |
| **One file ⇢ one use-case** | `libs/<domain>/application/commands                                  | queries/<kebab-name>.ts` |
| **Exports**                 | `<UseCase>Command` & `transferMoney()` (named, _no_ default export)  |
| **Ports live**              | `libs/<domain>/application/ports.ts`                                 |
| **Lambda role**             | Translate HTTP (ts-rest) ↔ command/query call; no business code      |
| **Layers**                  | `domain → application → infrastructure`; infra never imported inward |
| **Tags**                    | Every lib has `scope:<domain> , layer:<layer>`                       |

---

## 1 Workspace & Folder Layout

```
apps/
└─ bank-api/                    # Lambda + API Gateway mapping
   ├─ src/
   │  ├─ handler.ts             # ts-rest-serverless adapter
   │  └─ routing.ts             # maps contract routes -> command/query fns

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

## 2 Ports & Dependencies

- Define **only abstractions** (`AccountRepository`, `MyOSClient`) in `application/ports.ts`.
- Handlers receive deps explicitly:

```ts
export async function transferMoney(
  cmd: TransferMoneyCommand,
  { accountRepo, clock, eventBus }: Deps,
): Promise<TransferResult> { … }
```

---

## 3 Command & Query File Convention

```ts
// libs/banking/application/commands/transfer-money.ts
export type TransferMoneyCommand = { … };
export async function transferMoney(cmd: TransferMoneyCommand, deps: Deps): Promise<TransferResult> { … }
```

- **Named export** equals file name (`transferMoney`).
- Returns only lightweight tokens/ids — never read models.

---

## 4 Nx & ESLint Rules

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

## 5 API Gateway → Lambda Mapping with **ts-rest-serverless**

```
apps/bank-api/
└─ src/
    ├─ routing.ts              # (req) -> call handler -> (res)
    └─ handler.ts              # exports { handler } for AWS, configures ts-rest
shared/bank-api-contract/
└─ src/
    └─ lib/
        └─ bank-api-contract.ts   # ts-rest contract: routes, schemas
```

**routing.ts**

```ts
import { transferMoney }  from '@demo-blue/banking/application/commands/transfer-money";
import { getTransactionHistory } from '@demo-blue/banking/application/queries/get-transaction-history";

export const handlers = {
  transferMoney: async ({ body }) => transferMoney(body, deps),
  getTransactionHistory: async ({ params, query }) =>
    getTransactionHistory({ ...params, ...query }, deps),
};
```

**lambda.ts**

```ts
import { createLambdaHandler } from '@ts-rest/serverless/aws';
import { bankApiContract } from '@demo-blue/shared/bank-api-contract';
import { handlers } from './routing';
export const handler = createLambdaHandler(bankApiContract, handlers);
```

_The same `contract` file feeds:_

1. **Validation** inside Lambda.
2. **OpenAPI export** (`ts-rest-openapi`) for docs.
3. **Client generation** for front-end (`ts-rest-client`).

---

## 6 Testing Conventions

Domain - pure unit tests  
Application - with in-memory fakes  
Infrastructure - integration tests (LocalStack / WireMock)
