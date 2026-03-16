# Fixture requirements for `LLM_SUMMARY_DISABLED`

## What the bank does

If a document contains:

```yaml
LLM_SUMMARY_DISABLED: true
```

the bank skips OpenAI summary generation and reads summary text directly from
the document.

## Required fields

### Required for contract summary

```yaml
LLM_SUMMARY_DISABLED: true
payNoteInitialStateDescription:
  summary: <text>
  details: <markdown or plain text>
```

### Required for proposal / delivery summary

```yaml
payNoteInitialStateDescription:
  initialMessage: <proposal teaser>
```

### Still required from the PayNote itself

```yaml
name: <display name>
currency: USD
amount:
  total: <minor units>
```

## Recommended minimal template

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
    Example deterministic details shown instead of an LLM summary.
  initialMessage: Example proposal teaser shown before acceptance.
```

## OpenAI requirement

A real OpenAI key is not required for the main suite when fixtures satisfy the
rules above. If local boot still requires the secret to exist, use:

```json
{ "openAiApiKey": "dummy-not-used" }
```
