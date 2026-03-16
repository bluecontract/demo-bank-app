# Webhook delivery modes

## pull-and-post

The test reads events from MyOS, compacts the pulled Blue nodes to match the
real MyOS webhook serializer, and then forwards that webhook-shaped payload to
the bank. This is the preferred mode.

## sqs-poller

MyOS delivers to an existing stable queue-backed target. The test poller reads
event IDs from the queue and forwards the same webhook-shaped payload the bank
would receive in production.

## direct-webhook

Use only when the runner has a stable callback URL and webhook lifecycle can be
managed deterministically.
