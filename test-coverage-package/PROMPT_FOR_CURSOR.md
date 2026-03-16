# Prompt dla Cursor / Cursor Cloud

Pracujesz w repo demo banku. Repo bazowe jest **pełnym codebase'em**. Masz dostarczoną paczkę z blueprintem dla testów PayNote. Twoim zadaniem jest **dowieźć możliwie solidną suite testów integracyjnych, live scenarios i dokumentację w repo**, iteracyjnie, z małymi commitami, z raportowaniem i **bez wprowadzania zmian w implementacji banku**.

## Twarde zasady

1. **Priorytet: testy, helpery testowe, config i docs.**
   Możesz zmieniać:

   - testy,
   - fixture’y,
   - helpery testowe,
   - config testów,
   - targety testowe,
   - dokumentację w `docs/*`.

2. **Nie zmieniaj logiki biznesowej banku ani logiki PayNote.**
   Jeśli odkryjesz bug blokujący test, to:

   - zostaw test lub szkic testu,
   - zainwestyguj root cause,
   - udokumentuj blocker w `docs/paynotes-testing/bug-register.md`,
   - nie naprawiaj kodu produkcyjnego w tym zadaniu.

3. **Buduj iteracyjnie.**
   Każdy etap ma kończyć się:

   - aktualizacją workloga,
   - `npm run format:check`,
   - `npm run lint`,
   - `npm run typecheck`,
   - uruchomieniem możliwie najmniejszego zestawu testów,
   - małym commitem.

4. **Nie zgaduj route’ów ani komend, ale korzystaj z pełnego repo.**
   Zacznij od tych plików:

   - `libs/shared/bank-api-contract/src/lib/bank-api-contract.ts`
   - `apps/bank-api/src/main.integration.test.ts`
   - `apps/bank-api/src/paynote/webhook.ts`
   - `libs/paynotes/src/infrastructure/httpMyOsGateway.ts`
   - `apps/bank-api/src/contracts/payNoteSummaryMock.ts`
   - `apps/bank-api/src/shared/openAiSecrets.ts`
   - `libs/banking/src/infrastructure/CardIssuingConfiguration.ts`
   - `apps/bank-api/env.local.example.json`
   - `apps/bank-api/env.local.json`
   - `package.json`
   - `apps/bank-api/project.json`

5. **Ładuj MyOS credentiale z `.env.agent`.**
   Traktuj plik `.env.agent` w repo jako wejściowe źródło prawdy dla:

   - `MYOS_BASE_URL`,
   - `MYOS_API_KEY`, // api key merchanta w myos (do wysyłania sendPayNote na sesji Synchrony Merchant)
   - `MYOS_ACCOUNT_ID`, // konto merchanta w myos
   - `BANK_MYOS_ACCOUNT_ID` // konto banku w myos (do konfiguracji backendu banku)
   - `BANK_MYOS_API_KEY` // api key banku w myos

   Jeśli Twoja implementacja potrzebuje nazw `MYOS_E2E_BASE_URL`, `MYOS_E2E_API_KEY`, `MYOS_E2E_ACCOUNT_ID`, zmapuj je z `.env.agent` albo wspieraj oba warianty.

6. **Czytelne API testowe.**
   Każdy flow ma używać helperów typu:

   - funded account setup,
   - funded account + linked card setup,
   - transfer pair setup,
   - reusable assertions,
   - reusable waiters,
   - reusable reporting,
   - jawny event sync helper do MyOS.

7. **Kwoty testowe mają być małe i w minor units.**
   PayNote operuje na minor units, więc `100 = 1 USD`.
   Dla nowych prostych i scaled scenariuszy trzymaj się kwot **< 100_000 minor units**.
   Konto ma być zawsze zasilone z buforem, aby uniknąć false negative przez insufficient funds.

8. **Nie używaj background interval jako głównego mechanizmu synchronizacji.**
   Event sync ma być **jawny w teście**, ale helper może wewnętrznie wykonywać polling.
   Preferowany wzorzec:

   - akcja biznesowa,
   - `await eventPump.flushUntilSettled(...)`,
   - asercje.

9. **Nie wymagaj realnego OpenAI w głównej suite.**
   W overlay fixture’ach i nowych fixture’ach używaj `LLM_SUMMARY_DISABLED: true`, ale tylko razem z kompletem pól z `docs/paynotes-testing/12-summary-disabled-fixture-requirements.md`.
   To nie jest zmiana logiki banku – to ustawienie danych testowych.

   Jeżeli jakiś lokalny bootstrap lub secret seeding wymaga obecności sekretu OpenAI, użyj dummy placeholdera. Poprawny JSON sekretu to:

   ```json
   { "openAiApiKey": "dummy-not-used" }
   ```

   Nie zakładaj realnego OpenAI key, dopóki nie udowodnisz, że jest niezbędny. Jeśli okaże się konieczny, użytkownik poda nazwę env var z prawdziwym kluczem.

10. **Domyślny realny token procesora w banku.**
    Jeśli `CARD_PROCESSOR_TOKEN` nie jest nadpisany, bank domyślnie używa `demo-bank-processor-token`.
    Dla lokalnego banku możesz używać tego defaultu lub jawnego override, ale trzymaj to spójnie w helperach i env.

11. **Główny mechanizm live/e2e ma dawać realny case webhooka.**
    Dla live/e2e:
    - pobieraj z MyOS tylko `DOCUMENT_CREATED` i `DOCUMENT_EPOCH_ADVANCED`,
    - pobieraj **pełny payload eventu** z `GET /myos-events/:eventId`,
    - forwarduj ten payload do bankowego `/v1/paynotes/webhook` bez modyfikacji,
    - body `{ id: eventId }` zostaw tylko jako mały smoke test kompatybilności dla fallback `fetchEvent`.

## Znane komendy repo, od których zacznij

Zweryfikuj je w repo i używaj po discovery:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:all`
- `npm run security:audit:dev`
- `npm run verify:quick`
- `npm run verify:full`

Jeśli dodasz nowe targety PayNote, korzystaj z nich do targeted runs.
`format:check` traktuj jako repo-odpowiednik prettier/prettier-check.

## Kolejność pracy

### Faza 0 — discovery

- przeczytaj pliki z paczki,
- zinwentaryzuj repo,
- potwierdź route’y w `bankApiContract`,
- potwierdź aktualne integration tests i LocalStack bootstrap,
- potwierdź dokładny format payloadu `DOCUMENT_CREATED` / `DOCUMENT_EPOCH_ADVANCED`,
- potwierdź jak działa MyOS HTTP surface używany przez bank,
- potwierdź summary mock path oparty o `LLM_SUMMARY_DISABLED`,
- potwierdź default `CARD_PROCESSOR_TOKEN`,
- potwierdź jak w praktyce załadować `.env.agent` do runnera i helperów testowych.

Na końcu fazy 0:

- utwórz `docs/paynotes-testing/agent-worklog.md` z template,
- utwórz `docs/paynotes-testing/bug-register.md` z template,
- wpisz discovery findings,
- zrób pierwszy mały commit tylko z dokumentacją i scaffoldingiem, jeśli przechodzi `format:check`, lint i typecheck dla dodanych plików.

### Faza 1 — infra testowe

Dowieź:

- strukturę katalogów testów PayNote,
- helpery wait/assert/reporting,
- helpery setup:
  - funded account,
  - funded account with card,
  - transfer pair,
- thin MyOS live client,
- jawny `EventPump` / `EventSync` dla `pull-and-post`,
- fallback `WebhookQueuePoller` tylko jeśli potrzebny,
- env examples,
- loading / normalization `.env.agent`,
- targety vitest / nx dla suite fast/serial/e2e,
- bez zmian w produkcyjnej logice banku.

Po fazie 1 uruchom:

- `npm run format:check`,
- `npm run lint`,
- `npm run typecheck`,
- najwęższy sensowny test smoke dla helperów.

### Faza 2 — PR-fast scenarios

Dowieź co najmniej:

- card delivery → accept → capture,
- transfer reserve → capture,
- pending action install/approval → capture,
- webhook idempotency / duplicate,
- fetch-by-id fallback smoke.

Każdy scenariusz ma mieć:

- czytelny setup,
- małe kwoty,
- reusable assertions,
- evidencję po stronie banku i MyOS.

### Faza 3 — live / complex scenarios

Dowieź iteracyjnie:

- milestones partial captures,
- subscription init capture + mandate bootstrap + next cycle,
- refrigerator satisfaction + voucher monitoring smoke.

Jeśli któryś z flow blokuje bug w banku lub niespójność kontraktu:

- nie poprawiaj implementacji banku,
- zostaw test w formie `it.skip` / `describe.skip` / TODO tylko jeśli to konieczne,
- wpisz pełny blocker z root cause i dowodami.

### Faza 4 — real MyOS e2e

Tryb: `pull-and-post`

Nie twórz i nie zarządzaj webhookami MyOS, jeśli `pull-and-post` działa.

Dowieź małą canary suite:

- card delivery happy path,
- subscription one follow-up cycle,
- voucher smoke,
- fetch-by-id compatibility smoke.

### Faza 5 — zamknięcie

Na końcu zostaw:

- zaktualizowany worklog,
- bug register,
- docs o rozszerzaniu suite’y,
- listę gotowych scenariuszy,
- listę blockerów i braków,
- finalny commit set.

## Commit policy

- commity małe, tematyczne,
- przed commitem zawsze uruchom realne komendy repo: `format:check` + lint + typecheck + najwęższy test,
- gdy coś nie przechodzi, nie commituj na ślepo; najpierw udokumentuj problem,
- commit message ma opisywać konkretny krok, np. `test(paynotes): add funded account and card setup helpers`.

## Reporting policy

Utrzymuj na bieżąco:

- `docs/paynotes-testing/agent-worklog.md`
- `docs/paynotes-testing/bug-register.md`

W worklogu zapisuj:

- co zostało dowiezione,
- jakie komendy uruchomiono,
- co przeszło / nie przeszło,
- jaki jest kolejny krok.

W bug register zapisuj:

- symptom,
- scenariusz,
- warstwa testu,
- root cause,
- dowody,
- czy blocker jest twardy czy miękki.

## Event sync / runner policy

Preferencja:

1. `pull-and-post`: test pobiera z MyOS tylko `DOCUMENT_CREATED` / `DOCUMENT_EPOCH_ADVANCED`, pobiera pełny payload eventu i forwarduje go do banku,

Event sync ma być jawny w testach. Nie uruchamiaj globalnego background interval na starcie suite’y jako głównego mechanizmu, bo utrudnia debugowanie, dedup i powtarzalność.

## Twarde warunki zakończenia

Zadanie jest zamknięte dopiero wtedy, gdy jednocześnie są spełnione wszystkie poniższe punkty:

1. W repo istnieje dokumentacja `docs/paynotes-testing/*` opisująca:

   - split suite,
   - scenariusze,
   - event sync,
   - wymagania e2e,
   - zasady rozszerzania,
   - raportowanie,
   - znane blokery.

2. Istnieje czytelna warstwa helperów:

   - funded account,
   - funded account + card,
   - transfer pair,
   - assert / wait / reporting,
   - MyOS event polling,
   - webhook delivery helper,
   - loading / normalization `.env.agent`.

3. Zostały dodane wszystkie planowane testy z tej paczki albo ich status jest jawnie udokumentowany jako blocker.

4. Celem jest, żeby **wszystkie dodane testy przeszły**. Jeżeli którykolwiek nie przechodzi:

   - agent musi maksymalnie zainwestygować root cause,
   - ustalić, czy problem jest w teście, danych, środowisku czy implementacji banku,
   - jeżeli problem wymagałby zmiany implementacji banku, nie naprawiać go, tylko zostawić test i wpisać blocker do raportu.

5. Przed finalnym oddaniem agent musi uruchomić i zapisać wynik:

   - `npm run format:check`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test:all`
   - odpowiednie suite’y PayNote
   - `npm run security:audit:dev`

6. Jeżeli któreś z powyższych jest niemożliwe do uruchomienia przez ograniczenie środowiska, musi istnieć jawny wpis w worklogu z przyczyną i dowodami.
