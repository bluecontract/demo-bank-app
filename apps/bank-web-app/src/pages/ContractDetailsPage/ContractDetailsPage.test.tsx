import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ContractDetailsPage } from './index';
import { createQueryWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  useAcceptPayNoteDelivery,
  useActiveContractSession,
  useContractDetails,
  useContractReviewState,
  useProposalDetails,
  useProposalSummary,
  useRejectPayNoteDelivery,
  useArchiveContract,
  useUnarchiveContract,
} from '../../features/contracts/hooks';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/contracts/hooks', () => ({
  useAcceptPayNoteDelivery: vi.fn(),
  useActiveContractSession: vi.fn(),
  useContractDetails: vi.fn(),
  useContractReviewState: vi.fn(),
  useProposalDetails: vi.fn(),
  useProposalSummary: vi.fn(),
  useRejectPayNoteDelivery: vi.fn(),
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
const mockUseContractReviewState = useContractReviewState as ReturnType<
  typeof vi.fn
>;
const mockUseProposalDetails = useProposalDetails as ReturnType<typeof vi.fn>;
const mockUseProposalSummary = useProposalSummary as ReturnType<typeof vi.fn>;
const mockUseArchiveContract = useArchiveContract as ReturnType<typeof vi.fn>;
const mockUseUnarchiveContract = useUnarchiveContract as ReturnType<
  typeof vi.fn
>;
const mockUseAcceptPayNoteDelivery = useAcceptPayNoteDelivery as ReturnType<
  typeof vi.fn
>;
const mockUseRejectPayNoteDelivery = useRejectPayNoteDelivery as ReturnType<
  typeof vi.fn
>;
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

    mockUseAcceptPayNoteDelivery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseRejectPayNoteDelivery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseContractReviewState.mockReturnValue({
      reviewedMap: {},
      markReviewed: markReviewedMock,
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
          title: 'GE Refrigerator Order',
          oneLiner: 'Funds will be held until delivery is confirmed.',
          state: {
            statusLabel: 'Proposal pending',
            explanation: 'Awaiting client approval.',
            updatedAt: null,
          },
          keyFacts: [
            { label: 'Amount', value: '$120.00' },
            { label: 'Currency', value: 'USD' },
          ],
          warnings: [],
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
    expect(screen.getByText('View details')).toBeInTheDocument();
    expect(screen.queryByText('View history')).not.toBeInTheDocument();
    expect(markReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
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

    expect(mockUseContractDetails).toHaveBeenCalledWith(null);
    expect(mockUseProposalDetails).toHaveBeenCalledWith('session-3');
    expect(screen.getByText('Approve the Contract')).toBeInTheDocument();
  });

  it('triggers proposal decision mutations when actions are clicked', () => {
    const acceptMock = vi.fn();
    const rejectMock = vi.fn();

    mockUseAcceptPayNoteDelivery.mockReturnValue({
      mutate: acceptMock,
      isPending: false,
    });

    mockUseRejectPayNoteDelivery.mockReturnValue({
      mutate: rejectMock,
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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(acceptMock).toHaveBeenCalledWith('session-2');
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('hides the proposal action card once a decision is recorded', () => {
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
  });
});
