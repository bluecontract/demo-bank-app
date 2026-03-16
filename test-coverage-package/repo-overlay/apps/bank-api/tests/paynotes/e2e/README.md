# PayNote real MyOS canaries

Ta suite ma być mała, serial i uruchamiana tylko tam, gdzie event delivery jest stabilne.

## Preferowany tryb

1. `pull-and-post`
2. `sqs-poller`
3. `direct-webhook`

## Ważne ograniczenia

- direct webhook do runnera jest ostatnią opcją,
- jeśli system pozwala tylko na jeden webhook per URL, suite musi być serial,
- jeśli działa MyOS event read API, nie zarządzaj webhookami MyOS w testach,
- forwarduj tylko `DOCUMENT_CREATED` i `DOCUMENT_EPOCH_ADVANCED`,
- trzymaj mały smoke `{ id: eventId }`, ale nie używaj go jako głównej ścieżki.
