# Problem Exploration – Blue Demo Bank

## Date
2025-06-26

## Context

### Background
This project serves as a recruitment challenge for a **Staff Engineer** position. It focuses on demonstrating proficiency in technical decision making and applying key technologies such as **TypeScript/Node.js**, **AWS serverless (Lambda, API Gateway, DynamoDB, S3)**, **Infrastructure-as-Code**, and **CI/CD with GitHub Actions**.

Blue Labs has developed **Blue Language** – a domain-specific language for executable, verifiable contracts – and **MyOS**, a SaaS processor for Blue documents. The goal of this challenge is to build a minimal, _state-of-the-art_ demo banking application that demonstrates how a traditional bank could:

1. Handle standard internal transfers.
2. Extend those transfers to **smart transfers** driven by Blue documents and processed by MyOS.

The demo will be used both for candidate evaluation and as an example for future customers integrating with Blue.

### Business Drivers
| Driver | Description |
| ------ | ----------- |
| Showcase Blue integration | Prove that integrating Blue into an existing domain (banking) requires modest effort. |
| Smart-transfer flexibility | Demonstrate advanced scenarios such as _PayNote_ where the recipient is resolved later and conditions are embedded in the contract. |
| State-of-the-art engineering | Reflect modern cloud architecture (serverless AWS) and best practices (IaC, TDD, CI/CD). |
| Decision making clarity | Produce clear documentation to make decisions explicit |

### Success Criteria
* A user can open an account, fund it, view balance/history, and execute transfers.
* For Blue-enabled transfers, the system validates the uploaded Blue document, summarises it for the user, and delegates processing to a (mocked) MyOS agent.
* The bank responds to webhook events (`BlockFunds`, `PushOutPayment`, etc.) and updates the ledger accordingly.
* The solution is fully automated to deploy in any AWS account with minimal configuration.

## Stakeholders & Personas
* **Hiring team @ Blue Labs** – primary audience.
* **Prospective Blue customers** – potential secondary audience.

## Constraints & Assumptions
* MyOS access will be mocked; no external API keys are required.
* No regulatory compliance beyond generic security best practices.
* Simplicity in functionality, top quality in implementation
* Project will live in a single AWS account; multi-account deployment is out-of-scope.

## Scope (Phase 1 vs Phase 2)
| Phase | Scope Summary |
| ----- | ------------- |
| 1. Demo Bank | Account CRUD, login, funding, history, standard transfers. |
| 2. MyOS Integration | Upload Blue doc, LLM summary, agent creation, webhook handling, smart-transfer flow. |

