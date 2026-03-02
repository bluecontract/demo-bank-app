import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { vi } from 'vitest';
import { ContractDetailsPage } from './index';
import { createQueryWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  useActiveContractSession,
  useContractDetails,
  useContractHistory,
  useContractReviewState,
  useRelatedContracts,
  useProposalDetails,
  useProposalSummary,
  useProposalDecision,
  useArchiveContract,
  useUnarchiveContract,
} from '../../features/contracts/hooks';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/contracts/components/ContractAiChatDrawer', () => ({
  ContractAiChatDrawer: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="ai-chat-drawer">
        <button type="button" aria-label="Close AI chat" onClick={onClose}>
          Close AI chat
        </button>
      </div>
    ) : null,
}));

vi.mock('../../features/contracts/hooks', () => ({
  useActiveContractSession: vi.fn(),
  useContractDetails: vi.fn(),
  useContractHistory: vi.fn(),
  useContractReviewState: vi.fn(),
  useRelatedContracts: vi.fn(),
  useProposalDetails: vi.fn(),
  useProposalSummary: vi.fn(),
  useProposalDecision: vi.fn(),
  useArchiveContract: vi.fn(),
  useUnarchiveContract: vi.fn(),
}));

vi.mock('../../features/dashboard/components', () => ({
  DashboardShell: vi.fn(({ header, children, 'data-testid': testId }) => (
    <div data-testid={testId || 'dashboard-shell'}>
      {header}
      {children}
    </div>
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
    useParams: vi.fn(),
  };
});

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseContractDetails = useContractDetails as ReturnType<typeof vi.fn>;
const mockUseContractHistory = useContractHistory as ReturnType<typeof vi.fn>;
const mockUseContractReviewState = useContractReviewState as ReturnType<
  typeof vi.fn
>;
const mockUseRelatedContracts = useRelatedContracts as ReturnType<typeof vi.fn>;
const mockUseProposalDetails = useProposalDetails as ReturnType<typeof vi.fn>;
const mockUseProposalSummary = useProposalSummary as ReturnType<typeof vi.fn>;
const mockUseArchiveContract = useArchiveContract as ReturnType<typeof vi.fn>;
const mockUseUnarchiveContract = useUnarchiveContract as ReturnType<
  typeof vi.fn
>;
const mockUseProposalDecision = useProposalDecision as ReturnType<typeof vi.fn>;
const mockUseActiveContractSession = useActiveContractSession as ReturnType<
  typeof vi.fn
>;
const mockUseParams = useParams as ReturnType<typeof vi.fn>;
const mockUseLocation = useLocation as ReturnType<typeof vi.fn>;
const mockUseNavigate = useNavigate as ReturnType<typeof vi.fn>;

describe('ContractDetailsPage', () => {
  let markReviewedMock: ReturnType<typeof vi.fn>;
  let markItemReviewedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    markReviewedMock = vi.fn();
    markItemReviewedMock = vi.fn();

    mockUseAuth.mockReturnValue({
      user: { email: 'alex@example.com', userId: 'user-1' },
      signOut: vi.fn(),
    });

    mockUseActiveContractSession.mockReturnValue({
      activeSessionId: null,
      setActiveSession: vi.fn(),
    });

    mockUseProposalDecision.mockReturnValue({
      accept: vi.fn(),
      reject: vi.fn(),
      isPending: false,
    });

    mockUseContractReviewState.mockReturnValue({
      reviewedMap: {},
      markReviewed: markReviewedMock,
      markItemReviewed: markItemReviewedMock,
    });

    mockUseContractHistory.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseRelatedContracts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseArchiveContract.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseUnarchiveContract.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseProposalSummary.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      timedOut: false,
    });

    mockUseNavigate.mockReturnValue(vi.fn());
  });

  it('renders the contract shell when contract data is available', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'GE Refrigerator Order',
        updatedAt: '2026-01-02T00:00:00.000Z',
        document: { name: 'GE Refrigerator Order' },
        summary: {
          story: {
            headline: 'GE Refrigerator Order',
            overview: ['Funds will be held until delivery is confirmed.'],
            bullets: ['Payment held until delivery.'],
          },
          listPreview: 'Funds are held until delivery.',
          nextSteps: {
            title: 'Next steps',
            items: ['Awaiting client approval.'],
          },
          lastChange: {
            short: 'Proposal received.',
            more: 'A new proposal is awaiting client approval.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(
      screen.getByRole('heading', { name: 'Contract', level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'GE Refrigerator Order',
        level: 2,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Funds will be held until delivery is confirmed.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest update')).not.toBeInTheDocument();
    expect(screen.queryByText('Next steps')).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText(/^More$/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Pending actions will appear here once they are available.'
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Talk with AI' })
    ).toBeInTheDocument();
    expect(markReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
  });

  it('opens and closes AI chat drawer from header trigger', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'GE Refrigerator Order',
        document: { name: 'GE Refrigerator Order' },
        updatedAt: '2026-01-02T00:00:00.000Z',
        summary: {
          story: {
            headline: 'GE Refrigerator Order',
            overview: ['Funds will be held until delivery is confirmed.'],
            bullets: [],
          },
          listPreview: 'Funds will be held until delivery is confirmed.',
          nextSteps: {
            title: 'Next steps',
            items: ['Awaiting client approval.'],
          },
          lastChange: {
            short: 'Proposal pending.',
            more: 'Awaiting client approval.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(screen.queryByTestId('ai-chat-drawer')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Talk with AI' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Talk with AI' }));
    expect(screen.getByTestId('ai-chat-drawer')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Talk with AI' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close AI chat' }));
    expect(screen.queryByTestId('ai-chat-drawer')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Talk with AI' })
    ).toBeInTheDocument();
  });

  it('closes AI chat drawer when contract session changes', () => {
    const configureContract = (
      session: string,
      title: string,
      updatedAt: string
    ) => {
      mockUseParams.mockReturnValue({ sessionId: session });
      mockUseLocation.mockReturnValue({
        state: { from: '/contracts', kind: 'contract' },
        pathname: `/contracts/${session}`,
        search: '',
      });

      mockUseContractDetails.mockReturnValue({
        data: {
          sessionId: session,
          typeBlueId: 'PayNote/Contract',
          displayName: title,
          updatedAt,
          document: { name: title },
          summary: {
            story: {
              headline: title,
              overview: ['Summary'],
              bullets: [],
            },
            listPreview: 'Summary',
            nextSteps: { title: 'Next steps', items: [] },
            lastChange: { short: 'Change', more: 'Change details' },
          },
        },
        isLoading: false,
        isError: false,
        error: null,
      });

      mockUseProposalDetails.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      });
    };

    configureContract('session-1', 'Contract One', '2026-01-02T00:00:00.000Z');

    const { rerender } = render(<ContractDetailsPage />, {
      wrapper: createQueryWrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Talk with AI' }));
    expect(screen.getByTestId('ai-chat-drawer')).toBeInTheDocument();

    configureContract('session-2', 'Contract Two', '2026-01-03T00:00:00.000Z');
    rerender(<ContractDetailsPage />);

    expect(screen.queryByTestId('ai-chat-drawer')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Talk with AI' })
    ).toBeInTheDocument();
  });

  it('renders proposal actions when the proposal view is active', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-2' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-2',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'pending',
        payNote: {
          name: 'Slow Digestion PayNote',
          amountMinor: 100,
          currency: 'USD',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(
      screen.getByRole('heading', {
        name: 'Slow Digestion PayNote',
        level: 2,
      })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('renders mocked pending action card for contract view when PayNote mock action is provided', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'Mocked Contract',
        document: {
          name: 'Mocked Contract',
          LLM_SUMMARY_DISABLED: true,
          payNoteInitialStateDescription: {
            action: {
              title: 'Consent to data processing',
              summary: 'Approve data sharing for this voucher.',
              left: 'Reject',
              right: 'Accept',
            },
          },
        },
        summary: {
          story: {
            headline: 'Mocked summary',
            overview: ['Mocked details'],
            bullets: [],
          },
          listPreview: 'Mocked summary',
          nextSteps: {
            title: 'Next steps',
            items: [],
          },
          lastChange: {
            short: 'Mocked summary',
            more: 'Mocked summary',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(screen.getByText('Consent to data processing')).toBeInTheDocument();
    expect(
      screen.getByText('Approve data sharing for this voucher.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Pending actions will appear here once they are available.'
      )
    ).not.toBeInTheDocument();
  });

  it('renders mocked contract details as markdown when PayNote mock summary is enabled', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'Mocked Contract',
        document: {
          name: 'Mocked Contract',
          LLM_SUMMARY_DISABLED: true,
        },
        summary: {
          story: {
            headline: 'Mock summary headline',
            overview: ['#### Participants\n* **Payer**: Alice'],
            bullets: [],
          },
          listPreview: 'Mock summary headline',
          nextSteps: {
            title: 'Next steps',
            items: [],
          },
          lastChange: {
            short: 'Mock summary headline',
            more: 'Mock summary headline',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(
      screen.getByRole('heading', { name: 'Participants', level: 4 })
    ).toBeInTheDocument();
    expect(screen.getByText('Payer')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('does not render history section in proposal view', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-2' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-2',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-2',
        contractId: 'contract-2',
        typeBlueId: 'PayNote/Contract',
        displayName: 'Accepted Contract',
        document: { name: 'Accepted Contract' },
        summary: {
          story: {
            headline: 'Accepted Contract',
            overview: ['Contract is active.'],
            bullets: [],
          },
          listPreview: 'Contract is active.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: { short: 'Accepted', more: 'Accepted by client.' },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'pending',
        payNote: {
          name: 'Slow Digestion PayNote',
          amountMinor: 100,
          currency: 'USD',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseContractHistory.mockReturnValue({
      data: {
        items: [
          {
            id: 'history-1',
            short: 'Contract accepted',
            more: 'Accepted by client.',
            createdAt: '2026-02-08T10:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(screen.queryByText('View history')).not.toBeInTheDocument();
    expect(mockUseContractHistory).toHaveBeenCalledWith(null, false);
  });

  it('refetches history when summaryUpdatedAt changes for the active contract session', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    const historyRefetchMock = vi.fn();
    const contractState = {
      summaryUpdatedAt: '2026-02-08T10:00:00.000Z',
    };

    mockUseContractDetails.mockImplementation(() => ({
      data: {
        sessionId: 'session-1',
        contractId: 'contract-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'GE Refrigerator Order',
        document: { name: 'GE Refrigerator Order' },
        summaryUpdatedAt: contractState.summaryUpdatedAt,
        summary: {
          story: {
            headline: 'GE Refrigerator Order',
            overview: ['Funds will be held until delivery is confirmed.'],
            bullets: [],
          },
          listPreview: 'Funds are held until delivery.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: {
            short: 'Proposal received.',
            more: 'A new proposal is awaiting client approval.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    }));

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseContractHistory.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: historyRefetchMock,
    });

    const { rerender } = render(<ContractDetailsPage />, {
      wrapper: createQueryWrapper(),
    });

    expect(historyRefetchMock).not.toHaveBeenCalled();

    contractState.summaryUpdatedAt = '2026-02-08T10:00:01.000Z';
    act(() => {
      rerender(<ContractDetailsPage />);
    });

    expect(historyRefetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not render linked contracts section while related contracts are still loading without resolved items', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'GE Refrigerator Order',
        document: { name: 'GE Refrigerator Order' },
        relatedTransactionIds: ['txn-1'],
        summary: {
          story: {
            headline: 'GE Refrigerator Order',
            overview: ['Funds will be held until delivery is confirmed.'],
            bullets: [],
          },
          listPreview: 'Funds are held until delivery.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: {
            short: 'Proposal received.',
            more: 'A new proposal is awaiting client approval.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseRelatedContracts.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(screen.queryByText('Linked Contracts')).not.toBeInTheDocument();
    expect(screen.queryByText('Linked Transactions')).not.toBeInTheDocument();
  });

  it('does not show linked proposal items when contract view is active', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-1' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'contract' },
      pathname: '/contracts/session-1',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-1',
        contractId: 'contract-1',
        typeBlueId: 'PayNote/Contract',
        displayName: 'GE Refrigerator Order',
        document: { name: 'GE Refrigerator Order' },
        relatedTransactionIds: ['txn-1'],
        summary: {
          story: {
            headline: 'GE Refrigerator Order',
            overview: ['Funds will be held until delivery is confirmed.'],
            bullets: [],
          },
          listPreview: 'Funds are held until delivery.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: {
            short: 'Proposal received.',
            more: 'A new proposal is awaiting client approval.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseRelatedContracts.mockReturnValue({
      data: [
        {
          sessionId: 'contract-session-2',
          contractId: 'contract-2',
          typeBlueId: 'PayNote/Contract',
          displayName: 'Linked Contract',
          documentName: 'Linked Contract Visible',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
        {
          kind: 'proposal',
          deliveryId: 'delivery-1',
          deliverySessionId: 'proposal-session-1',
          name: 'Hidden Proposal Item',
          clientDecisionStatus: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(screen.queryByText('More')).not.toBeInTheDocument();
    const linkedContractsSummary = screen.getByText('Linked Contracts');
    expect(linkedContractsSummary).toBeInTheDocument();
    fireEvent.click(linkedContractsSummary);
    expect(
      screen.getAllByText('Linked Contract Visible').length
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Hidden Proposal Item')).not.toBeInTheDocument();
  });

  it('uses proposal view when kind is specified in the query string', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-3' });
    mockUseLocation.mockReturnValue({
      state: null,
      pathname: '/contracts/session-3',
      search: '?kind=proposal',
    });

    mockUseContractDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-3',
        clientDecisionStatus: 'pending',
        payNote: {
          name: 'Slow Digestion PayNote',
        },
        accountNumber: '1234',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(mockUseContractDetails).toHaveBeenCalledWith('session-3');
    expect(mockUseProposalDetails).toHaveBeenCalledWith('session-3');
    expect(screen.getByText('Approve the Contract')).toBeInTheDocument();
  });

  it('does not request proposal details after navigating from proposal to contract session', () => {
    type MockLocationState = {
      from: string;
      kind: 'proposal' | 'contract';
    };
    type MockLocation = {
      state: MockLocationState | null;
      pathname: string;
      search: string;
    };

    let currentSessionId = 'proposal-session';
    let currentLocation: MockLocation = {
      state: { from: '/contracts', kind: 'proposal' as const },
      pathname: '/contracts/proposal-session',
      search: '',
    };

    mockUseParams.mockImplementation(() => ({ sessionId: currentSessionId }));
    mockUseLocation.mockImplementation(() => currentLocation);

    mockUseContractDetails.mockImplementation((sessionId: string | null) => {
      if (sessionId === 'contract-session') {
        return {
          data: {
            sessionId: 'contract-session',
            typeBlueId: 'PayNote/Contract',
            displayName: 'Accepted Contract',
            document: { name: 'Accepted Contract' },
            summary: {
              story: {
                headline: 'Accepted Contract',
                overview: ['Contract is active.'],
                bullets: [],
              },
              listPreview: 'Contract is active.',
              nextSteps: { title: 'Next steps', items: [] },
              lastChange: { short: 'Accepted', more: 'Accepted by client.' },
            },
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }

      return {
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      };
    });

    mockUseProposalDetails.mockImplementation((sessionId: string | null) => {
      if (sessionId === 'proposal-session') {
        return {
          data: {
            deliveryId: 'delivery-1',
            deliverySessionId: 'proposal-session',
            clientDecisionStatus: 'pending',
            payNote: { name: 'Proposal Contract' },
            accountNumber: '1234',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }

      return {
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      };
    });

    const { rerender } = render(<ContractDetailsPage />, {
      wrapper: createQueryWrapper(),
    });

    expect(mockUseProposalDetails).toHaveBeenCalledWith('proposal-session');

    currentSessionId = 'contract-session';
    currentLocation = {
      state: {
        from: '/contracts/proposal-session',
        kind: 'contract',
      },
      pathname: '/contracts/contract-session',
      search: '',
    };

    act(() => {
      rerender(<ContractDetailsPage />);
    });

    expect(mockUseProposalDetails).toHaveBeenLastCalledWith(null);
    expect(mockUseContractDetails).toHaveBeenLastCalledWith('contract-session');
  });

  it('triggers proposal decision mutations when actions are clicked', () => {
    const acceptMock = vi.fn();
    const rejectMock = vi.fn();

    mockUseProposalDecision.mockReturnValue({
      accept: acceptMock,
      reject: rejectMock,
      isPending: false,
    });

    mockUseParams.mockReturnValue({ sessionId: 'session-2' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-2',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'pending',
        payNote: {
          name: 'Slow Digestion PayNote',
          amountMinor: 100,
          currency: 'USD',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(mockUseProposalDecision).toHaveBeenCalled();
    const proposalDecisionArgs = mockUseProposalDecision.mock.calls[0]?.[0];
    expect(proposalDecisionArgs?.sessionId).toBe('session-2');

    const acceptButton = screen.getByRole('button', { name: 'Accept' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });

    expect(acceptButton).not.toHaveAttribute('disabled');
    expect(rejectButton).not.toHaveAttribute('disabled');

    act(() => {
      acceptButton.click();
      rejectButton.click();
    });

    expect(acceptMock).toHaveBeenCalled();
    expect(rejectMock).toHaveBeenCalled();
  });

  it('shows the accepted message once a decision is recorded', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-2' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-2',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'accepted',
        payNote: {
          name: 'Slow Digestion PayNote',
          amountMinor: 100,
          currency: 'USD',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    expect(
      screen.queryByRole('button', { name: 'Accept' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Thank you for accepting Slow Digestion PayNote.')
    ).toBeInTheDocument();
  });

  it('marks proposal as reviewed when accept callback succeeds', () => {
    mockUseParams.mockReturnValue({ sessionId: 'session-2' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-2',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: {
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'pending',
        from: { name: 'Merchant' },
        payNote: {
          name: 'Slow Digestion PayNote',
          amountMinor: 100,
          currency: 'USD',
        },
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDecision.mockImplementation(({ onAccepted }) => ({
      accept: () => onAccepted?.(),
      reject: vi.fn(),
      isPending: false,
    }));

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(markItemReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'proposal',
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-2',
        clientDecisionStatus: 'accepted',
      })
    );
  });

  it('falls back to contract view when proposal endpoint returns 404 for the same session', async () => {
    const navigateMock = vi.fn();
    mockUseNavigate.mockReturnValue(navigateMock);

    mockUseParams.mockReturnValue({ sessionId: 'session-3' });
    mockUseLocation.mockReturnValue({
      state: null,
      pathname: '/contracts/session-3',
      search: '?kind=proposal',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-3',
        contractId: 'contract-3',
        typeBlueId: 'PayNote/Contract',
        displayName: 'Started PayNote',
        document: { name: 'Started PayNote' },
        summary: {
          story: {
            headline: 'Started PayNote',
            overview: ['Contract started successfully.'],
            bullets: [],
          },
          listPreview: 'Contract started successfully.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: {
            short: 'Contract started.',
            more: 'The PayNote contract has started.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        {
          pathname: '/contracts/session-3',
          search: '',
        },
        {
          replace: true,
          state: {
            kind: 'contract',
          },
        }
      );
    });

    expect(
      screen.getByRole('heading', { name: 'Started PayNote', level: 2 })
    ).toBeInTheDocument();
  });

  it('normalizes state-only proposal navigation to contract when proposal endpoint returns 404', async () => {
    const navigateMock = vi.fn();
    mockUseNavigate.mockReturnValue(navigateMock);

    mockUseParams.mockReturnValue({ sessionId: 'session-4' });
    mockUseLocation.mockReturnValue({
      state: { from: '/contracts', kind: 'proposal' },
      pathname: '/contracts/session-4',
      search: '',
    });

    mockUseContractDetails.mockReturnValue({
      data: {
        sessionId: 'session-4',
        contractId: 'contract-4',
        typeBlueId: 'PayNote/Contract',
        displayName: 'Resolved Contract',
        document: { name: 'Resolved Contract' },
        summary: {
          story: {
            headline: 'Resolved Contract',
            overview: ['Contract is available.'],
            bullets: [],
          },
          listPreview: 'Contract is available.',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: {
            short: 'Contract started.',
            more: 'Contract started.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseProposalDetails.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });

    render(<ContractDetailsPage />, { wrapper: createQueryWrapper() });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        {
          pathname: '/contracts/session-4',
          search: '',
        },
        {
          replace: true,
          state: {
            from: '/contracts',
            kind: 'contract',
          },
        }
      );
    });
  });
});
