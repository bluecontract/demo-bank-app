# Secrets handoff checklist

## 1. Plik `.env.agent`

Agent ma korzystać z pliku `.env.agent` w repo. Minimalnie wpisz tam:

```dotenv
MYOS_BASE_URL=https://myos-sandbox.example
MYOS_API_KEY=replace-me
MYOS_ACCOUNT_ID=replace-me
```

To jest preferowane źródło prawdy dla:

- MyOS baseUrl,
- MyOS apiKey,
- MyOS account / tenant id.

Jeżeli agent w implementacji użyje nazw `MYOS_E2E_*`, powinien zmapować je z `.env.agent` albo zaczytać oba warianty.

## 2. Minimalny handoff dla agenta

### Preferowany tryb: pull-and-post

- MyOS sandbox base URL
- MyOS API key
- MyOS account / tenant id
- potwierdzenie, że agent może czytać:
  - `GET /myos-events?ref=...&type=DOCUMENT_CREATED`
  - `GET /myos-events?ref=...&type=DOCUMENT_EPOCH_ADVANCED`
  - `GET /myos-events/:eventId`
  - `GET /documents/:sessionId`
  - `POST /documents/bootstrap`
  - `POST /documents/:sessionId/:operation`
- bank test base URL **albo** możliwość uruchomienia banku lokalnie przez LocalStack/SAM
- card processor token używany przez endpointy `authorizeCard` / `captureCardAuthorization`
  - jeśli nie nadpisujesz env banku, default banku to `demo-bank-processor-token`

## 3. Summary / AI

- realny OpenAI key **nie jest wymagany**, jeśli testowe fixture’y mają `LLM_SUMMARY_DISABLED: true`
- jeśli startup/seeding lokalnego banku wymaga obecności sekretu, agent może ustawić **dummy value**
- poprawny format JSON sekretu OpenAI dla banku to:

```json
{ "openAiApiKey": "dummy-not-used" }
```

- bank akceptuje też sekret-string, ale helpery w tej paczce używają jawnie `openAiApiKey`
- jeżeli w którymś kroku okaże się, że realny OpenAI key jest jednak potrzebny, użytkownik dostarczy nazwę env var z prawdziwym keyem w osobnym promptcie; nie zakładaj tego z góry

## 4. Sekrety LocalStack / local bank

Do lokalnego uruchomienia zwykle wystarczą:

- `AWS_REGION`
- `AWS_ENDPOINT_URL` // localstack
- `AWS_ACCESS_KEY_ID` // dummy with localstack
- `AWS_SECRET_ACCESS_KEY` // dummy with localstack
- `JWT_SECRET_ARN`
- `MYOS_SECRET_ARN`
- `OPENAI_API_KEY_SECRET_ARN`

## 5. Format sekretów seedowanych do LocalStack

### MyOS

```json
{
  "apiKey": "...",
  "accountId": "...",
  "baseUrl": "..."
}
```

### OpenAI placeholder

```json
{
  "openAiApiKey": "dummy-not-used"
}
```

## 6. Niewrażliwe i wrażliwe dane

- `MYOS_BASE_URL` i `MYOS_ACCOUNT_ID` możesz bezpiecznie przekazać przez `.env.agent`
- `MYOS_API_KEY` też może iść przez `.env.agent`, jeśli tak Ci wygodniej w Cursor Cloud
- webhook admin / callback URL **nie są potrzebne domyślnie**, jeśli `pull-and-post` działa
