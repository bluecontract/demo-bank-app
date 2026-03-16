# Scenario catalog

## Zasada ogólna

Katalog ma obejmować pełne spektrum: od bardzo prostych flow do dokument-heavy live scenarios. Przy nowych mechanizmach katalog trzeba rozszerzać razem z testami.

## Warstwa L1 — fast / parallel

### 1. card-delivery-capture

- konto zasilone,
- karta dopięta do konta,
- auth kartowa przez bank API,
- PayNote Delivery dostarczone po webhook `eventId` z sesji Synchrony Merchant (przykład bootstrap payload demo-bank-app/test-coverage-package/repo-overlay/docs/paynotes-testing/synchrony-merch-boot.local.yaml)
- akceptacja delivery,
- capture holda.

Kwota testowa: 1_200.

### 2. transfer-reserve-capture

- konto payera zasilone,
- paynote transferowy robi reserve,
- capture zamyka reserve i tworzy posting.

Kwota testowa: 1_800.

### 3. pending-install-approval-capture

- paynote kartowy prosi o potwierdzenie instalacji,
- pending action staje się aktywne,
- approval użytkownika powoduje dalszy capture.

Kwota testowa: 2_200.

### 4. webhook-idempotency

- replay tego samego `eventId` nie duplikuje efektów.

### 5. ordering-smoke

- out-of-order lub duplicate dostarczenie eventów nie robi podwójnego reserve/capture.

## Warstwa L2 — serial / complex

### 6. milestones-partial-captures

Źródło: scaled variant `DemoMilestones`.

Docelowe capture’y:

- 8_000,
- 12_000,
- 7_000,
- 9_000.

Łącznie: 36_000.

### 7. subscription-mandate-cycle

Źródło: `DemoSubscription`.

- init capture,
- bootstrap Payment Mandate,
- activate mandate,
- one follow-up linked charge.

Kwota miesięczna: 1_200.

### 8. refrigerator-voucher-monitoring

Źródło: scaled variant `RefridgeratorInstallVoucherCashBack`.

- delivery confirm,
- satisfaction / concern / timestamp reschedule,
- final capture,
- voucher reverse auth,
- monitoring,
- cashback capture.

Kwota purchase: 12_000.
Kwota reserve vouchera: 1_000.

### 9. reverse-auth-voucher-smoke

- główny paynote kończy flow,
- linked voucher paynote startuje przez reverse auth,
- payout śledzony po reportach.

## Warstwa L3 — real MyOS E2E canaries

### 10. real-myos-card-delivery-happy-path

### 11. real-myos-subscription-one-follow-up-cycle

### 12. real-myos-voucher-smoke

## Backlog resilience

- duplicate transaction report,
- stale / non-canonical session,
- rejected mandate bootstrap,
- failed mandate bootstrap,
- sourceAccount unsupported,
- webhook delivery broken / duplicate registration.
