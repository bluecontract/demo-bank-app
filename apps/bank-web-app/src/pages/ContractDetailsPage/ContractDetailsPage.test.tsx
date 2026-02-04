import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ContractDetailsPage } from './index';
import { createQueryWrapper } from '../../test-utils';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  useAcceptPayNoteDelivery,
  useActiveContractSession,
  useContractDetails,
  useProposalDetails,
  useRejectPayNoteDelivery,
} from '../../features/contracts/hooks';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

vi.mock('../../app/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/contracts/hooks', () => ({
  useAcceptPayNoteDelivery: vi.fn(),
  useActiveContractSession: vi.fn(),
  useContractDetails: vi.fn(),
  useProposalDetails: vi.fn(),
  useRejectPayNoteDelivery: vi.fn(),
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
const mockUseProposalDetails = useProposalDetails as ReturnType<typeof vi.fn>;
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
  beforeEach(() => {
    vi.clearAllMocks();

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
      screen.getByText('Story details are being prepared.')
    ).toBeInTheDocument();
    expect(screen.getByText('View details')).toBeInTheDocument();
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
    expect(rejectMock).toHaveBeenCalledWith({ sessionId: 'session-2' });
  });
});
