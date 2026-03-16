# Known gaps and blockers

Ten dokument służy do katalogowania odkrytych problemów. W tym torze **nie naprawiamy implementacji banku**, tylko maksymalnie rzetelnie dokumentujemy blocker.

## Typowe klasy blockerów

### 1. Niespójność route / contract

Symptom:

- helper testowy nie trafia w realny endpoint lub shape payloadu.

Akcja:

- dopnij helper do faktycznego kontraktu,
- jeśli brakuje stabilnego read modelu, opisz to jako testability gap.

### 2. Summary coupling

Symptom:

- kontrakt / pending action staje się widoczny dopiero po summary path,
- bez tego flow nie daje się wiarygodnie assercjonować.

Akcja:

- nie wyłączaj implementacji banku w ciemno,
- udokumentuj zależność,
- jeśli brak test-friendly ścieżki blokuje suite, wpisz blocker.

### 3. Hardcoded retry / timing

Symptom:

- testy są wolne lub niedeterministyczne z powodu wbudowanego retry.

Akcja:

- nie patchuj banku w tym torze,
- dokumentuj wpływ na stabilność i czas testów.

### 4. Example-doc inconsistencies

Przykłady dokumentów mogą mieć luki domenowe. To nadal jest wartościowa informacja testowa.

Przykłady do sprawdzenia:

- concern path w milestones,
- subscription follow-up cycle idempotency,
- voucher monitoring report ordering.
