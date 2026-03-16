# Webhook delivery modes

## pull-and-post

Test sam czyta event source MyOS, pobiera pełny payload eventu i dostarcza go do banku. To jest tryb preferowany.

## sqs-poller

MyOS wysyła webhook do istniejącego, stabilnego targetu. Test poller czyta eventy z SQS i uruchamia bank webhook z payloadem albo po dodatkowym pobraniu payloadu z MyOS.

To jest dobry fallback dla Cursor Cloud i dla środowisk, gdzie runner nie ma stabilnego publicznego URL.

## direct-webhook

Tylko dla stabilnego publicznego endpointu i jawnego zarządzania lifecycle webhooka. Serial only.
