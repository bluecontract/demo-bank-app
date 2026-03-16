# Runner decision matrix

## Use local live integration when

- the flow can be reproduced against LocalStack and the in-process bank handler
- deterministic debugging is more important than external realism
- the scenario depends on reusable setup helpers and bank-side state inspection

## Use a real MyOS canary when

- the local harness has already proven the flow shape
- the remaining risk is the live MyOS event-feed and callback surface
- a small serial smoke is enough to validate the production-like integration

## Prefer pull-and-post when

- the runner can access the MyOS read API
- the runner does not have a stable public callback URL
- deterministic event-by-event replay matters more than webhook lifecycle
