import { render, screen, fireEvent, act } from '@testing-library/react';
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
  ContractAiChatDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="ai-chat-drawer" /> : null,
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

  beforeEach(() => {
    vi.clearAllMocks();
    markReviewedMock = vi.fn();

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
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Highlights')).toBeInTheDocument();
    expect(screen.queryByText('View history')).not.toBeInTheDocument();
    expect(markReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
  });

  it('opens the AI chat drawer when Talk with AI is clicked', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Talk with AI' }));

    expect(screen.getByTestId('ai-chat-drawer')).toBeInTheDocument();
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
});
