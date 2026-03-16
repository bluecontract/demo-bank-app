# Extension policy

## Definition of Done dla nowego mechanizmu PayNote

Nowy mechanizm nie jest gotowy, dopóki nie ma:

1. testu unit / use-case, jeśli logika trafia do domeny,
2. co najmniej jednego live scenario w warstwie L1 lub L2,
3. aktualizacji katalogu scenariuszy,
4. decyzji, czy wymaga real MyOS canary.

## Zasady rozszerzania

- dodaj najpierw helper setup/assert/wait jeśli nowy flow go potrzebuje,
- nie duplikuj boilerplate w scenariuszach,
- trzymaj kwoty proste i małe dla nowych scenariuszy,
- jeśli nowy flow jest dokument-heavy, dodaj fixture lub scaled fixture,
- jeśli flow jest wieloetapowy albo zależny od jednego webhooka/URL, oznacz go jako serial.

## Przy nowych mechanizmach aktualizuj zawsze

- `docs/paynotes-testing/02-scenario-catalog.md`,
- odpowiedni scenariusz testowy,
- env docs jeśli dochodzą nowe sekrety,
- worklog / bug register podczas implementacji.
