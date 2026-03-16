# Strategy and split

## Cel

Celem suite’y nie jest tylko sprawdzenie pojedynczego handlera. Celem jest potwierdzenie, że bank stabilnie obsługuje end-to-end flow PayNote: delivery, reserve, capture, pending actions, mandate, reverse auth, linked voucher oraz integrację z MyOS.

## Warstwy

### L0 — unit / use-case

Tu zostają szczegółowe edge-case’y, mapowania i walidacje.

### L1 — local live integration

To jest główna warstwa do PR gate.

SUT-em jest bank.

Charakterystyka:

- handler / API banku uruchamiane jak w obecnych integration tests,
- AWS zależności przez LocalStack,
- MyOS zastąpiony przez cienki protocol harness,
- webhook do banku dostarczany po `eventId`,
- asercje po bank API, aktywności konta, holdach/txn oraz po zapisanych outbound calls do MyOS harness.

### L2 — complex local live scenarios

Ta sama infrastruktura co L1, ale scenariusze są serial i wieloetapowe.

Tu trafiają:

- milestones,
- subscription,
- voucher/reverse auth/monitoring,
- pending action z inputami typu timestamp.

### L3 — real MyOS E2E canaries

Mała, serial suite na prawdziwym MyOS. Nie jest głównym PR gate’em.

## Zasady projektowe

1. Webhook do banku wysyłaj po `eventId`, a nie pełnym payloadzie.
2. Setup użytkowników/kont/kart rób helperami przez bank API.
3. Konto do flow płatniczego ma być zasilone buforem.
4. Flow kartowe mają używać helpera tworzącego konto + funding + kartę.
5. Nowe proste/scaled scenariusze trzymają kwoty < 100_000 minor units.
6. Asercje i waitery mają być reużywalne.
7. Brak ślepych sleepów.
8. Jeśli bug blokuje test, zostaw test i udokumentuj bug. Nie naprawiaj implementacji banku w tym torze.

## Dlaczego nie pełne MyOS E2E na wszystko

Bo będzie:

- wolne,
- mniej deterministyczne,
- trudniejsze w diagnozie,
- zależne od zewnętrznego webhook lifecycle.

## Dlaczego nie samo payload injection

Bo nie przetestuje:

- pobierania eventu po `eventId`,
- pobierania dokumentu po `sessionId`,
- outbound calls banku do MyOS,
- auth/idempotency/HTTP contract drift.
