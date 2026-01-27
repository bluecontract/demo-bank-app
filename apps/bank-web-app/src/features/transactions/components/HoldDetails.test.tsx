import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { HoldDetails } from './HoldDetails';
import { ActivityDetail } from '../hooks/useActivityDetail';

vi.mock('../../../lib/formatCurrency', () => ({
  formatCurrency: vi.fn((amount: number) => `$${(amount / 100).toFixed(2)}`),
}));

vi.mock('../../../lib/formatAccountNumber', () => ({
  formatAccountNumber: vi.fn((number: string) => {
    if (!number) return '****';
    return `**** ${number.slice(-4)}`;
  }),
}));

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
});
