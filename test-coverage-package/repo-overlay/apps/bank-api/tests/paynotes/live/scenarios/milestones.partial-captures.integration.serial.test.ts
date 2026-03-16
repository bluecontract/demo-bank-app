import { describe, it } from 'vitest';

/**
 * Blueprint serial scenario.
 * Use scaled fixture `DemoMilestones.scaled.local.txt` and reusable helpers.
 */
describe('PayNote live scenario: milestones partial captures', () => {
  it('captures each milestone after matching customer approval', async () => {
    // TODO(agent):
    // 1. bootstrap scaled milestones paynote,
    // 2. assert pending action milestone 1,
    // 3. approve milestone 1 -> capture 8000,
    // 4. approve milestone 2 -> capture 12000,
    // 5. approve milestone 3 -> capture 7000,
    // 6. approve milestone 4 -> capture 9000,
    // 7. assert total capture 36000 and no duplicates after replay.
  });
});
