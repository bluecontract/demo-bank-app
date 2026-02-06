import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ContractsPage } from './index';
import { createTestWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  useContracts,
  useContractReviewState,
  useProposals,
  useProposalDecision,
} from '../../features/contracts/hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ContractSummary, PayNoteDeliverySummary } from '../../types/api';

vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/contracts/hooks', () => ({
  useContracts: vi.fn(),
  useContractReviewState: vi.fn(),
  useProposals: vi.fn(),
  useProposalDecision: vi.fn(),
}));

vi.mock('../../features/dashboard/components', () => ({
  SidebarNav: vi.fn(() => <div data-testid="sidebar-nav" />),
  DashboardShell: vi.fn(
    ({ header, children }: { header: ReactNode; children: ReactNode }) => (
      <div data-testid="dashboard-shell">
        {header}
        {children}
      </div>
    )
  ),
  DashboardHeader: vi.fn(({ title }: { title: string }) => (
    <div data-testid="dashboard-header">{title}</div>
  )),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useLocation: vi.fn(),
    useNavigate: vi.fn(),
  };
});

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseContracts = useContracts as ReturnType<typeof vi.fn>;
const mockUseProposals = useProposals as ReturnType<typeof vi.fn>;
const mockUseContractReviewState = useContractReviewState as ReturnType<
  typeof vi.fn
>;
const mockUseProposalDecision = useProposalDecision as ReturnType<typeof vi.fn>;
const mockUseLocation = useLocation as ReturnType<typeof vi.fn>;
const mockUseNavigate = useNavigate as ReturnType<typeof vi.fn>;

const contractSummary = {
  contractId: 'contract-1',
  sessionId: 'contract-1',
  displayName: 'GE Refrigerator Order',
  documentName: 'GE Refrigerator Order',
  status: 'ACTIVE',
  updatedAt: '2026-02-04T07:20:00.000Z',
} as ContractSummary;

const proposalSummary = {
  deliveryId: 'proposal-1',
  deliverySessionId: 'proposal-1',
  name: 'Slow Digestion PayNote',
  clientDecisionStatus: 'pending',
  amountMinor: 100,
  currency: 'USD',
  createdAt: '2026-02-04T07:15:00.000Z',
  updatedAt: '2026-02-04T07:21:00.000Z',
  payNoteSessionIds: [],
} as PayNoteDeliverySummary;

describe('ContractsPage', () => {
  let navigateMock: ReturnType<typeof vi.fn>;
  let markReviewedMock: ReturnType<typeof vi.fn>;
  let markItemReviewedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    navigateMock = vi.fn();
    markReviewedMock = vi.fn();
    markItemReviewedMock = vi.fn();

    mockUseAuth.mockReturnValue({
      user: { email: 'alex@example.com', userId: 'user-1' },
    });

    mockUseContracts.mockReturnValue({
      data: [contractSummary],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    mockUseProposals.mockReturnValue({
      data: [proposalSummary],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    mockUseContractReviewState.mockReturnValue({
      reviewedMap: {},
      markReviewed: markReviewedMock,
      markItemReviewed: markItemReviewedMock,
    });

    mockUseProposalDecision.mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      isPending: false,
    });

    mockUseLocation.mockReturnValue({
      pathname: '/contracts',
      search: '',
      state: null,
    });

    mockUseNavigate.mockReturnValue(navigateMock);
  });

  it('shows contracts and proposals in the inbox list', () => {
    render(<ContractsPage />, { wrapper: createTestWrapper() });

    expect(screen.getAllByText('GE Refrigerator Order').length).toBeGreaterThan(
      0
    );
    expect(
      screen.getAllByText('Slow Digestion PayNote').length
    ).toBeGreaterThan(0);
  });

  it('navigates to archive list when archive link is clicked', () => {
    render(<ContractsPage />, { wrapper: createTestWrapper() });

    fireEvent.click(screen.getByRole('button', { name: /Archive/i }));

    expect(navigateMock).toHaveBeenCalledWith('/contracts/archive');
  });

  it('navigates to contract details and marks reviewed when a contract row is clicked', () => {
    render(<ContractsPage />, { wrapper: createTestWrapper() });

    const [contractLabel] = screen.getAllByText('GE Refrigerator Order');
    const contractRow = contractLabel.closest('[role="button"]');

    expect(contractRow).not.toBeNull();
    fireEvent.click(contractRow as HTMLElement);

    expect(markItemReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'contract-1' })
    );
    expect(navigateMock).toHaveBeenCalledWith('/contracts/contract-1', {
      state: {
        from: '/contracts',
        kind: 'contract',
      },
    });
  });

  it('shows quick decision actions for pending proposals', () => {
    render(<ContractsPage />, { wrapper: createTestWrapper() });

    expect(
      screen.getAllByRole('button', {
        name: /Accept Slow Digestion PayNote/i,
      }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', {
        name: /Reject Slow Digestion PayNote/i,
      }).length
    ).toBeGreaterThan(0);
  });
});
