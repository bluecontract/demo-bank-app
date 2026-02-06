import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ContractSummary,
  PayNoteDeliverySummary,
} from '../../../types/api';

vi.mock('./useContracts', () => ({
  useContracts: vi.fn(),
}));

vi.mock('./useProposals', () => ({
  useProposals: vi.fn(),
}));

vi.mock('./useContractReviewState', () => ({
  useContractReviewState: vi.fn(),
}));

vi.mock('./useActiveContractSession', () => ({
  useActiveContractSession: vi.fn(),
}));

const { useContracts } = await import('./useContracts');
const { useProposals } = await import('./useProposals');
const { useContractReviewState } = await import('./useContractReviewState');
const { useActiveContractSession } = await import('./useActiveContractSession');
const { useContractsBadgeCount } = await import('./useContractsBadgeCount');

const baseContract: ContractSummary = {
  contractId: 'contract-1',
  sessionId: 'session-1',
  displayName: 'Slow Digestion PayNote',
  status: 'active',
  createdAt: '2026-02-05T00:00:00.000Z',
  updatedAt: '2026-02-05T01:00:00.000Z',
} as ContractSummary;

const baseProposal: PayNoteDeliverySummary = {
  deliveryId: 'delivery-1',
  deliverySessionId: 'proposal-session-1',
  name: 'Slow Digestion PayNote',
  clientDecisionStatus: 'pending',
  createdAt: '2026-02-05T00:00:00.000Z',
  updatedAt: '2026-02-05T01:30:00.000Z',
} as PayNoteDeliverySummary;

describe('useContractsBadgeCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useContracts).mockReturnValue({ data: [] } as any);
    vi.mocked(useProposals).mockReturnValue({ data: [] } as any);
    vi.mocked(useContractReviewState).mockReturnValue({
      reviewedMap: {},
    } as any);
    vi.mocked(useActiveContractSession).mockReturnValue({
      activeSessionId: null,
    } as any);
  });

  it('counts unread inbox items', () => {
    vi.mocked(useContracts).mockReturnValue({
      data: [baseContract],
    } as any);
    vi.mocked(useProposals).mockReturnValue({
      data: [baseProposal],
    } as any);

    const { result } = renderHook(() => useContractsBadgeCount());

    expect(result.current).toBe(2);
  });

  it('excludes the active session from the unread count', () => {
    vi.mocked(useContracts).mockReturnValue({
      data: [baseContract],
    } as any);
    vi.mocked(useProposals).mockReturnValue({
      data: [baseProposal],
    } as any);
    vi.mocked(useActiveContractSession).mockReturnValue({
      activeSessionId: 'session-1',
    } as any);

    const { result } = renderHook(() => useContractsBadgeCount());

    expect(result.current).toBe(1);
  });

  it('ignores reviewed or non-inbox items', () => {
    vi.mocked(useContracts).mockReturnValue({
      data: [baseContract],
    } as any);
    vi.mocked(useProposals).mockReturnValue({
      data: [{ ...baseProposal, clientDecisionStatus: 'rejected' }],
    } as any);
    vi.mocked(useContractReviewState).mockReturnValue({
      reviewedMap: {
        [baseContract.contractId]: '2026-02-05T02:00:00.000Z',
      },
    } as any);

    const { result } = renderHook(() => useContractsBadgeCount());

    expect(result.current).toBe(0);
  });
});
