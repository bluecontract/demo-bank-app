import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { HoldDetails } from './HoldDetails';
import { ActivityDetail } from '../hooks/useActivityDetail';
import { useActiveContractSession } from '../../contracts/hooks';
import { navigateTo } from '../../../lib/navigation';

vi.mock('../../../lib/formatCurrency', () => ({
  formatCurrency: vi.fn((amount: number) => `$${(amount / 100).toFixed(2)}`),
}));

vi.mock('../../../lib/formatAccountNumber', () => ({
  formatAccountNumber: vi.fn((number: string) => {
    if (!number) return '****';
    return `**** ${number.slice(-4)}`;
  }),
}));

vi.mock('../../contracts/hooks', () => ({
  useActiveContractSession: vi.fn(),
}));

vi.mock('../../../lib/navigation', () => ({
  navigateTo: vi.fn(),
}));

const mockUseActiveContractSession = useActiveContractSession as ReturnType<
  typeof vi.fn
>;
const mockNavigateTo = navigateTo as ReturnType<typeof vi.fn>;

const mockHold: Extract<ActivityDetail, { kind: 'HOLD' }> = {
  kind: 'HOLD',
  activityId: 'HOLD#hold-123',
  holdId: 'hold-123',
  amountMinor: 1000,
  capturedAmountMinor: 0,
  remainingAmountMinor: 1000,
  currency: 'USD',
  status: 'PENDING',
  description: 'Authorization',
  createdAt: '2024-01-01T00:00:00.000Z',
  expiresAt: '2024-01-02T00:00:00.000Z',
  counterpartyAccountNumber: '0987654321',
  timeline: [
    {
      type: 'CREATED',
      at: '2024-01-01T00:00:00.000Z',
      createdByUserId: 'user-1',
      idempotencyKeyHash: 'hash',
    },
  ],
};

const mockAccounts = [
  {
    accountId: 'acc-123',
    accountNumber: '1234567890',
    name: 'Test Account 1',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 50000,
    availableBalanceMinor: 45000,
    status: 'active',
  },
];

describe('HoldDetails', () => {
  const defaultProps = {
    hold: mockHold,
    accounts: mockAccounts,
    accountId: 'acc-123',
    currentAccountNumber: '1234567890',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveContractSession.mockReturnValue({
      activeSessionId: null,
      setActiveSession: vi.fn(),
    });
  });

  it('shows empty related contracts state by default', () => {
    render(<HoldDetails {...defaultProps} />);

    expect(screen.getByText('Related contracts')).toBeInTheDocument();
    expect(screen.getByText('No related contracts found.')).toBeInTheDocument();
  });

  it('renders related contracts list when provided', () => {
    render(
      <HoldDetails
        {...defaultProps}
        relatedContracts={[
          {
            contractId: 'contract-1',
            typeBlueId: 'type-1',
            displayName: 'PayNote Voucher',
            sessionId: 'session-1',
            status: 'accepted',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T12:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getAllByText('PayNote Voucher')).toHaveLength(2);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(
      screen.queryByText('No related contracts found.')
    ).not.toBeInTheDocument();
  });

  it('renders related proposal when provided', () => {
    render(
      <HoldDetails
        {...defaultProps}
        relatedContracts={[
          {
            kind: 'proposal',
            deliveryId: 'delivery-1',
            deliverySessionId: 'session-delivery-1',
            name: 'Slow Digestion PayNote',
            amountMinor: 1200,
            currency: 'USD',
            clientDecisionStatus: 'pending',
            transactionId: 'txn-123',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText('Slow Digestion PayNote')).toBeInTheDocument();
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('hides proposal when matching contract exists', () => {
    render(
      <HoldDetails
        {...defaultProps}
        relatedContracts={[
          {
            contractId: 'contract-1',
            typeBlueId: 'type-1',
            displayName: 'PayNote',
            sessionId: 'session-1',
            status: 'accepted',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T12:00:00.000Z',
          },
          {
            kind: 'proposal',
            deliveryId: 'delivery-1',
            deliverySessionId: 'delivery-session-1',
            payNoteSessionIds: ['session-1'],
            name: 'Slow Digestion PayNote',
            amountMinor: 1200,
            currency: 'USD',
            clientDecisionStatus: 'accepted',
            transactionId: 'txn-123',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getAllByText('PayNote').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Slow Digestion PayNote')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Proposal')).not.toBeInTheDocument();
  });

  it('keeps proposals visible when no contracts exist even with paynote session ids', () => {
    render(
      <HoldDetails
        {...defaultProps}
        relatedContracts={[
          {
            kind: 'proposal',
            deliveryId: 'delivery-2',
            deliverySessionId: 'delivery-session-2',
            payNoteSessionIds: ['session-99'],
            name: 'Delayed PayNote',
            amountMinor: 2400,
            currency: 'USD',
            clientDecisionStatus: 'pending',
            transactionId: 'txn-456',
            createdAt: '2024-01-05T00:00:00.000Z',
            updatedAt: '2024-01-06T00:00:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText('Delayed PayNote')).toBeInTheDocument();
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('navigates to proposal details when clicking a linked proposal', () => {
    const setActiveSession = vi.fn();
    mockUseActiveContractSession.mockReturnValue({
      activeSessionId: null,
      setActiveSession,
    });

    render(
      <HoldDetails
        {...defaultProps}
        relatedContracts={[
          {
            kind: 'proposal',
            deliveryId: 'delivery-1',
            deliverySessionId: 'session-delivery-1',
            name: 'Slow Digestion PayNote',
            amountMinor: 1200,
            currency: 'USD',
            clientDecisionStatus: 'pending',
            transactionId: 'txn-123',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ]}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Slow Digestion PayNote/i })
    );

    expect(setActiveSession).toHaveBeenCalledWith('session-delivery-1');
    expect(mockNavigateTo).toHaveBeenCalledWith(
      '/contracts/session-delivery-1?kind=proposal'
    );
  });
});
