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
      'Avoid setup-only wording that does not help customers'
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
      '- `story.overview`: array of 2-3 short plain-language sentences.'
    );
    expect(prompt).toContain('Tool available: `resolve_merchant_names`.');
    expect(prompt).toContain('you MUST call this tool');
    expect(prompt).toContain(
      'Use a generic fallback like "specified merchant" only for IDs returned as unresolved'
    );
  });
});
