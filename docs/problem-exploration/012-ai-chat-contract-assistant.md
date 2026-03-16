# Problem Exploration - AI Chat Contract Assistant (Demo Bank)

## Date

2026-02-04

## Context

The demo bank app supports contract-driven operations (Blue `Conversation/Operation`
contracts) and contract summaries. We want to add an "AI chat" experience that
lets a user (the contract owner) interact with a specific contract session in a
natural, conversational way:

- Ask questions about the contract (what it is, current state, what happens
  next).
- Ask the assistant to execute an eligible operation, including collecting and
  confirming operation input parameters in a human-friendly flow.

The UI already filters and displays "eligible operations" for a contract by
channel assignment (for example `payeeChannel`). We want the assistant to use
the same eligibility rules as the UI and to support only eligible operations.
Some documents assign operations to a `Conversation/Composite Timeline Channel`
that groups multiple participant channels; when the user’s channel is part of
that composite, the operation should be considered eligible.

For this MVP, chat history should be ephemeral (client-only) and scoped to a
single session view. We will hook the entry point to an existing mocked "Talk
with AI" affordance on the contract card (after rebasing onto the base branch).

## Stakeholders & Personas

- Bank client (customer) — understands a contract in plain language and performs
  actions without navigating complex forms.
- Integration developer — ensures the assistant is safe and cannot execute
  unauthorized operations or invent contract state.
- Product/UX — validates the assistant UX against the "Talk with AI" design.

## Scope / Use-Case Scenarios

1. A user opens a contract and clicks "Talk with AI" to open a chat drawer/modal.
2. The user asks a question about the contract; the assistant answers grounded
   in the contract session document state.
3. The user asks what actions they can perform; the assistant lists only
   eligible operations (same filter rules as the UI).
4. The user asks to run an eligible operation; the assistant:
   - collects any required input values,
   - summarizes what will happen,
   - asks for explicit confirmation,
   - triggers the operation execution via the app,
   - then confirms the outcome.
5. The assistant refuses requests to run non-eligible operations and provides a
   safe alternative (for example, listing eligible ones).

## Constraints & Assumptions

- The assistant must not invent contract state; it should answer using the
  current contract session document and server-provided metadata.
- Operations are limited to the eligible operation set derived from the contract
  document and the contract type's configured operations channel key.
- `supportedContract.operationsChannelKey` and `supportedContract.userChannelKey`
  are expected to be the same for the acting user in this experience.
- Every operation execution requires an explicit confirmation step in the UI.
- Chat history is ephemeral (client-only) for the MVP; persistence and cross-device
  continuity are out of scope.
