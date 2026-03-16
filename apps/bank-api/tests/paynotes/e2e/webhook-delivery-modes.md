# Webhook delivery modes

## pull-and-post

The test reads events from MyOS, downloads the full event payload, and forwards
it to the bank. This is the preferred mode.

## sqs-poller

MyOS delivers to an existing stable queue-backed target. The test poller reads
event IDs from the queue and forwards the full payload to the bank.

## direct-webhook

Use only when the runner has a stable callback URL and webhook lifecycle can be
managed deterministically.
