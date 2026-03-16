# Extension policy

## Definition of Done for a new PayNote mechanism

A new PayNote mechanism is not done until it has:

1. the narrow unit or use-case coverage it needs
2. at least one local live scenario in L1 or L2
3. a catalog update
4. an explicit decision on whether it also needs a real MyOS canary

## Extension rules

- add reusable setup/assert/wait helpers before duplicating boilerplate in
  scenarios
- keep new simple/scaled scenario amounts below `100_000` minor units
- if a flow is document-heavy, add or reuse fixtures
- if a flow is multi-step or callback constrained, mark it serial

## Always update

- `docs/paynotes-testing/02-scenario-catalog.md`
- the relevant test scenario
- environment docs when new secrets or env vars appear
- `agent-worklog.md` and `bug-register.md` during implementation
