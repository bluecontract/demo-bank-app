# Problem Exploration – Simplified Core Banking (Accounts & Internal Transfers)

## Date

2025-07-05

## Context

Blue Demo Bank currently showcases user‑level authentication and UI but lacks a credible _core banking_ slice.  
For evaluators to move digital money between demo users we need a minimal yet forward‑compatible ledger that supports:

- Bank **account creation**
- **Funding** an account with demo money (no external rails)
- **Internal transfers** between accounts
- **Balance & transaction history** views

External payments, card holds, FX, overdrafts, fees and reconciliation are _acknowledged_ and the design must avoid blocking them, but they remain out‑of‑scope for the first milestone.

## Stakeholders & Personas

- **Demo Evaluator** – wants to open an account, add play money and transfer it to a colleague within minutes; expects integrity, immutability and auditable history
- **Demo Developer** – presents architectural consciousness and extensibility of the solution; acts in limited time constraints.

## Scope / Use‑Case Scenarios

1. **Account Opening**  
   Visitor presses _“Create Account”_ → system issues unique **account number**, **account_id** and currency = USD.

2. **Funding**  
   User enters an _amount_ in the _Funding_ UI. A **credit** transaction adds demo money to their account.

3. **Internal Transfer**  
   User selects a destination account number, amount and optional memo → system validates and posts debit/credit.

4. **View Balance & History**  
   User sees **ledger balance**, **available balance**, and paginated transaction feed.

## Constraints & Assumptions

| Area          | Assumption                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------- |
| Currency      | Single currency **USD** for milestone‑1.                                                     |
| Users         | One user == one account for now; multi‑account per user is deferred but model must allow it. |
| Numbering     | Internal opaque `account_id` plus a 10‑digit public **account number** validated as numeric. |
| Funding       | No external payment rail; money is minted via a privileged “FUNDING” transaction type.       |
| Consistency   | Synchronous **available balance** check                                                      |
| Observability | CloudWatch logs & metrics only                                                               |

## Out‑of‑Scope / Risks

- KYC / AML, real money movement, PCI‑DSS scope.
- Multi‑currency, overdrafts, fees, interest, standing orders.
- Clearing networks (ACH, SEPA, FedNow) and card schemes.
- Fraud heuristics (velocity checks, device fingerprinting).
