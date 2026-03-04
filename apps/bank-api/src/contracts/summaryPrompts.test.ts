import { describe, expect, it } from 'vitest';
import {
  buildContractSummaryPrompt,
  buildProposalSummaryPrompt,
} from './summaryPrompts';

describe('summary prompts', () => {
  it('guides contract summaries to produce two-layer overview text', () => {
    const prompt = buildContractSummaryPrompt();

    expect(prompt).toContain('story.overview[0]');
    expect(prompt).toContain('story.overview[1...]');
    expect(prompt).toContain('Do not force bullet points');
    expect(prompt).toContain('non-technical bank customer');
    expect(prompt).toContain(
      'Treat lifecycle-only setup events (for example `Core/Document Processing Initiated`) as technical noise'
    );
    expect(prompt).toContain(
      'document.payNoteBootstrapRequest.document.description'
    );
    expect(prompt).toContain(
      'Treat that description as the primary narrative source for customer wording and intent'
    );
    expect(prompt).toContain(
      '`previousHistoryEntry`: the most recent `contractUpdated` history entry currently shown to the customer'
    );
    expect(prompt).toContain('what they are buying/agreeing to');
    expect(prompt).toContain('what has just happened');
    expect(prompt).toContain('what (if anything) is required from them now');
    expect(prompt).toContain(
      'Avoid setup-only wording that does not help customers'
    );
    expect(prompt).toContain(
      'Never describe participant setup/initialization progress'
    );
    expect(prompt).toContain(
      'Treat setup/initialization internals as hidden implementation details'
    );
    expect(prompt).toContain('"reserve request" -> prefer');
    expect(prompt).toContain('"payment mandate" -> prefer');
    expect(prompt).toContain('outcome-first');
    expect(prompt).toContain('Tool available: `resolve_merchant_names`.');
    expect(prompt).toContain('you MUST call this tool');
    expect(prompt).toContain(
      'Use a generic fallback like "specified merchant" only for IDs returned as unresolved'
    );
    expect(prompt).toContain('Do not show raw merchant IDs.');
    expect(prompt).toContain(
      'Write UI text to the customer in second person ("you", "your").'
    );
    expect(prompt).toContain(
      'Never say "the bank approves" when describing customer payment approvals; use "you approve" / "waiting for your approval".'
    );
    expect(prompt).toContain(
      '`PayNote/Capture Funds Requested` (without `PayNote/Funds Captured`): payment is requested/in progress (future tense).'
    );
    expect(prompt).toContain(
      '`PayNote/Funds Captured`: payment is completed/paid (past tense).'
    );
    expect(prompt).toContain(
      '`Conversation/Customer Action Responded` with `transition.actorIsViewer=true`: "You approved/responded/sent ...".'
    );
    expect(prompt).toContain(
      'avoid repeating the same `lastChange` wording when transition stage changed'
    );
    expect(prompt).toContain('both start with "Setup started"');
    expect(prompt).toContain('do not repeat unchanged wording across stages');
    expect(prompt).toContain('avoid "captured from existing hold" phrasing.');
    expect(prompt).toContain(
      '"card hold"/"existing hold" -> prefer "authorized card payment" or "amount already set aside from your card payment"'
    );
    expect(prompt).toContain(
      '"captured" (money movement) -> prefer "paid" or "charged"'
    );
    expect(prompt).toContain('Never output raw event labels');
    expect(prompt).not.toContain(
      'Use "You" only when `transition.actorIsViewer` is true.'
    );
    expect(prompt).not.toContain(
      '`story.overview`: array of 1-2 short sentences total.'
    );
  });

  it('guides proposal summaries toward customer-friendly acceptance effects', () => {
    const prompt = buildProposalSummaryPrompt();

    expect(prompt).toContain(
      'Keep `story.headline` as the latest update, but phrase it in customer language'
    );
    expect(prompt).toContain(
      '- If `contract.transactionId` is present, explain that acceptance finalizes the current purchase.'
    );
    expect(prompt).toContain(
      '- If facts suggest recurring/subscription charges, explain that acceptance asks for approval of future automatic payments.'
    );
    expect(prompt).toContain(
      '- Treat merchant-authored description in `document` as the primary explanation of agreement intent and rules, but always verify against contract facts.'
    );
    expect(prompt).toContain(
      '- For recurring charges and mandate-like approvals, the approver is the customer using the bank app. Do not describe this as the bank approving charges.'
    );
    expect(prompt).toContain(
      '- Keep proposal text customer-oriented: make clear what the customer buys/gets, what has already happened, and what decision (if any) is now waiting for them.'
    );
    expect(prompt).toContain(
      '- Do not copy merchant-authored description verbatim; paraphrase in customer-facing UI language.'
    );
    expect(prompt).toContain(
      '- `story.overview`: array of 2-3 short plain-language sentences.'
    );
    expect(prompt).toContain('Tool available: `resolve_merchant_names`.');
    expect(prompt).toContain('you MUST call this tool');
    expect(prompt).toContain(
      'Use a generic fallback like "specified merchant" only for IDs returned as unresolved'
    );
  });
});
