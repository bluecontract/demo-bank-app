# Fixture requirements for `LLM_SUMMARY_DISABLED`

## Co robi bank

Jeśli dokument ma:

```yaml
LLM_SUMMARY_DISABLED: true
```

bank nie używa OpenAI do summary i bierze treść z dokumentu.

## Pola, które trzeba dostarczyć

### Obowiązkowe dla contract summary

```yaml
LLM_SUMMARY_DISABLED: true
payNoteInitialStateDescription:
  summary: <tekst>
  details: <tekst markdown/plain>
```

Znaczenie:

- `summary` – headline / fallback dla mock contract summary,
- `details` – overview dla mock contract summary.

### Obowiązkowe dla proposal / delivery summary

```yaml
payNoteInitialStateDescription:
  initialMessage: <tekst dla oferty/propozycji>
```

Znaczenie:

- delivery/proposal summary nadpisuje headline przez `initialMessage`,
- to samo pole jest używane jako proposal teaser w ścieżce delivery.

### Nadal potrzebne podstawowe pola PayNote

```yaml
name: <display name>
currency: USD
amount:
  total: <minor>
```

Znaczenie:

- `name`, `currency`, `amount.total` dalej zasilają dane delivery / contract niezależnie od summary.

## Minimalny zalecany template

```yaml
name: Example scenario
LLM_SUMMARY_DISABLED: true
type: PayNote/Card Transaction PayNote
currency: USD
amount:
  total: 1200
payNoteInitialStateDescription:
  summary: Example summary headline
  details: |
    Example deterministic details shown instead of LLM-generated summary.
  initialMessage: Example proposal teaser shown before acceptance.
```

## Pole obecnie nieużywane przez bank API

`payNoteInitialStateDescription.action` jest parsowane przez helper mock summary, ale w obecnej implementacji banku nie jest materializowane do odpowiedzi summary API. Nie opieraj testów na tym polu.

## Czy realny OpenAI key jest potrzebny?

Nie dla głównej suite, jeśli używasz poprawnych fixture’ów z `LLM_SUMMARY_DISABLED: true`.
Jeżeli jednak lokalny bootstrap wymaga istnienia sekretu, dummy placeholder jest wystarczający:

```json
{ "openAiApiKey": "dummy-not-used" }
```

## Zasada dla fixture’ów w tej suite

Każdy nowy fixture live/fast z `LLM_SUMMARY_DISABLED: true` powinien mieć komplet:

- `summary`,
- `details`,
- `initialMessage`,
- `name`,
- `currency`,
- `amount.total`.
