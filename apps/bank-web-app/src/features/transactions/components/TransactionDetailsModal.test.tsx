import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { TransactionDetailsModal } from './TransactionDetailsModal';
import { ActivityItem } from '../hooks/useActivity';

const useActivityDetailMock = vi.hoisted(() => vi.fn());
const useAccountsMock = vi.hoisted(() => vi.fn());
const useTransactionMock = vi.hoisted(() => vi.fn());
const usePayNoteDetailsMock = vi.hoisted(() => vi.fn());
const useTransactionContractsMock = vi.hoisted(() => vi.fn());
const useHoldContractsMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useActivityDetail', () => ({
  useActivityDetail: useActivityDetailMock,
}));

vi.mock('../hooks/useTransaction', () => ({
  useTransaction: useTransactionMock,
}));

vi.mock('../../accounts/hooks/useAccounts', () => ({
  useAccounts: useAccountsMock,
}));

vi.mock('../hooks/usePayNoteDetails', () => ({
  usePayNoteDetails: usePayNoteDetailsMock,
}));

vi.mock('../hooks/useTransactionContracts', () => ({
  useTransactionContracts: useTransactionContractsMock,
}));

vi.mock('../hooks/useHoldContracts', () => ({
  useHoldContracts: useHoldContractsMock,
}));

describe('TransactionDetailsModal', () => {
  const transactionActivity: ActivityItem = {
    kind: 'POSTED_TRANSACTION',
    activityId: 'TXN#txn-1',
    transactionId: 'txn-1',
    amountMinor: 1200,
    description: 'Test',
    postedAt: '2024-01-01T00:00:00.000Z',
    originHoldId: undefined,
    side: 'CREDIT',
    type: 'FUNDING',
    status: 'POSTED',
    counterpartyAccountNumber: '0987654321',
  };

  const holdActivity: ActivityItem = {
    kind: 'HOLD_CREATED',
    activityId: 'HOLD#hold-1',
    holdId: 'hold-1',
    amountMinor: 5000,
    description: 'Authorization',
    createdAt: '2024-01-02T00:00:00.000Z',
    counterpartyAccountNumber: '1234567890',
    createdByUserId: 'user-1',
    idempotencyKeyHash: 'hash',
  };

  const holdCapturedActivity: ActivityItem = {
    kind: 'HOLD_CAPTURED',
    activityId: 'HOLD#hold-1',
    holdId: 'hold-1',
    amountMinor: 5000,
    description: 'Authorization',
    capturedAt: '2024-01-02T01:00:00.000Z',
    transactionId: 'txn-1',
    counterpartyAccountNumber: '1234567890',
  } as ActivityItem;

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    accountId: 'acc-1',
    accountNumber: '1234567890',
    activityId: 'TXN#txn-1',
    selectedActivity: transactionActivity,
    currentAccountNumber: '1234567890',
    accounts: [],
  };

  beforeEach(() => {
    useAccountsMock.mockReturnValue({
      data: [],
      isLoading: false,
    });
    useActivityDetailMock.mockReset();
    useTransactionMock.mockReset();
    usePayNoteDetailsMock.mockReset();
    useTransactionContractsMock.mockReset();
    defaultProps.onClose.mockClear();
    useTransactionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: undefined,
    });
    useTransactionContractsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: undefined,
    });
    useHoldContractsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: undefined,
    });
    usePayNoteDetailsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: vi.fn(),
    });
  });

  it('renders transaction details when activity is a posted transaction', () => {
    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'CREDIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
      },
      isLoading: false,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    expect(screen.getByText('Payment number')).toBeInTheDocument();
    expect(screen.getByText('txn-1')).toBeInTheDocument();
  });

  it('falls back to transaction details query when activity detail is missing', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Primary fetch failed'),
    });

    useTransactionMock.mockReturnValue({
      data: {
        txnId: 'txn-1',
        accountId: 'acc-1',
        side: 'CREDIT',
        amountMinor: 1200,
        type: 'FUNDING',
        status: 'POSTED',
        timestamp: '2024-01-01T00:00:00.000Z',
        description: 'Fallback transaction',
        counterpartyAccountNumber: '0987654321',
      },
      isLoading: false,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    expect(screen.getByText('Fallback transaction')).toBeInTheDocument();
  });

  it('renders hold details when activity is a hold', () => {
    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'HOLD',
        activityId: 'HOLD#hold-1',
        holdId: 'hold-1',
        amountMinor: 5000,
        currency: 'USD',
        status: 'PENDING',
        description: 'Authorization',
        createdAt: '2024-01-02T00:00:00.000Z',
        timeline: [
          {
            type: 'CREATED',
            at: '2024-01-02T00:00:00.000Z',
            createdByUserId: 'user-1',
            idempotencyKeyHash: 'hash',
            payNoteDocumentId: 'doc-hold-123',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        activityId="HOLD#hold-1"
        selectedActivity={holdActivity}
      />
    );

    expect(screen.getByText('Hold Details')).toBeInTheDocument();
    expect(screen.getByText('Hold overview')).toBeInTheDocument();
    expect(screen.getByText('hold-1')).toBeInTheDocument();
    expect(screen.getByText('From account')).toBeInTheDocument();
    expect(screen.getByText('To account')).toBeInTheDocument();
    expect(screen.getByText('Hold placed')).toBeInTheDocument();
  });

  it('uses hold timeline PayNote id when available for created activity', () => {
    let latestOptions:
      | { enabled?: boolean; payNoteDocumentId?: string }
      | undefined;
    const refetchMock = vi.fn();
    usePayNoteDetailsMock.mockImplementation(options => {
      latestOptions = options as {
        enabled?: boolean;
        payNoteDocumentId?: string;
      };
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: refetchMock,
      };
    });

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'HOLD',
        activityId: 'HOLD#hold-1',
        holdId: 'hold-1',
        amountMinor: 5000,
        currency: 'USD',
        status: 'PENDING',
        description: 'Authorization',
        createdAt: '2024-01-02T00:00:00.000Z',
        timeline: [
          {
            type: 'CREATED',
            at: '2024-01-02T00:00:00.000Z',
            createdByUserId: 'user-1',
            idempotencyKeyHash: 'hash',
            payNoteDocumentId: 'doc-hold-123',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        activityId="HOLD#hold-1"
        selectedActivity={holdActivity}
      />
    );

    expect(
      screen.getByText(/This transaction is part of a PayNote transfer/i)
    ).toBeInTheDocument();
    expect(latestOptions?.enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'See details' }));

    expect(latestOptions?.payNoteDocumentId).toBe('doc-hold-123');
  });

  it('uses capture timeline PayNote id when viewing captured activity', () => {
    let latestOptions:
      | { enabled?: boolean; payNoteDocumentId?: string }
      | undefined;
    const refetchMock = vi.fn();
    usePayNoteDetailsMock.mockImplementation(options => {
      latestOptions = options as {
        enabled?: boolean;
        payNoteDocumentId?: string;
      };
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: refetchMock,
      };
    });

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'HOLD',
        activityId: 'HOLD#hold-1',
        holdId: 'hold-1',
        amountMinor: 5000,
        currency: 'USD',
        status: 'CAPTURED',
        description: 'Authorization',
        createdAt: '2024-01-02T00:00:00.000Z',
        capturedAt: '2024-01-02T01:00:00.000Z',
        captureTransactionId: 'txn-1',
        timeline: [
          {
            type: 'CREATED',
            at: '2024-01-02T00:00:00.000Z',
            payNoteDocumentId: 'doc-hold-123',
          },
          {
            type: 'CAPTURED',
            at: '2024-01-02T01:00:00.000Z',
            transactionId: 'txn-1',
            counterpartyAccountNumber: '1234567890',
            payNoteDocumentId: 'doc-capture-456',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        activityId="HOLD#hold-1"
        selectedActivity={holdCapturedActivity}
      />
    );

    expect(latestOptions?.enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'See details' }));

    expect(latestOptions?.payNoteDocumentId).toBe('doc-capture-456');
  });

  it('displays loading state while fetching activity detail', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading activity details...')).toBeInTheDocument();
  });

  it('displays error state when detail fetch fails', () => {
    useActivityDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Test failure'),
    });

    useTransactionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Fallback failure'),
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(screen.getByTestId('activity-error')).toBeInTheDocument();
    expect(screen.getByText('Activity Not Found')).toBeInTheDocument();
    expect(screen.getByText('Fallback failure')).toBeInTheDocument();
  });

  it('shows PayNote helper when payNote metadata is present for payer view', () => {
    let latestOptions: unknown;
    usePayNoteDetailsMock.mockImplementation(options => {
      latestOptions = options;
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: vi.fn(),
      };
    });

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'DEBIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
        payNote: { payNoteDocumentId: 'doc-123' },
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        selectedActivity={{ ...transactionActivity, side: 'DEBIT' }}
      />
    );

    expect(
      screen.getByText(/This transaction is part of a PayNote transfer/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'See details' })
    ).toBeInTheDocument();
    expect((latestOptions as { enabled?: boolean })?.enabled).toBe(false);
  });

  it('hides PayNote helper for receiver view even when payNote metadata exists', () => {
    let latestOptions: { enabled?: boolean } | undefined;
    usePayNoteDetailsMock.mockImplementation(options => {
      latestOptions = options;
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: vi.fn(),
      };
    });

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'CREDIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
        payNote: { payNoteDocumentId: 'doc-123' },
      },
      isLoading: false,
      isError: false,
    });

    render(<TransactionDetailsModal {...defaultProps} />);

    expect(
      screen.queryByText(/This transaction is part of a PayNote transfer/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText('Standard Transfer')).toBeInTheDocument();
    expect(latestOptions?.enabled).toBe(false);
  });

  it('switches to PayNote view and displays details when helper is activated for payer view', async () => {
    const payNoteDetails = {
      payNoteDocumentId: 'doc-123',
      document: { sample: 'yaml' },
      transactionRequest: { foo: 'bar' },
      triggerEvent: { baz: 'qux' },
      fetchedAt: '2024-01-01T00:00:00.000Z',
    };
    let latestOptions: { enabled?: boolean } | undefined;

    usePayNoteDetailsMock.mockImplementation(options => {
      latestOptions = options;
      return {
        data: options.enabled ? payNoteDetails : undefined,
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: vi.fn(),
      };
    });

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'DEBIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
        payNote: { payNoteDocumentId: 'doc-123' },
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        selectedActivity={{ ...transactionActivity, side: 'DEBIT' }}
      />
    );

    expect(latestOptions?.enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'See details' }));

    expect(latestOptions?.enabled).toBe(true);

    const payNoteView = await screen.findByTestId('paynote-details-view');
    expect(payNoteView).toBeInTheDocument();
    expect(screen.getByText('PayNote transfer details')).toBeInTheDocument();
    expect(
      await screen.findByTestId('paynote-document-section')
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('paynote-transaction-request-section')
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('paynote-trigger-event-section')
    ).toBeInTheDocument();
    expect(screen.getByText('sample: yaml')).toBeInTheDocument();
    expect(screen.getByText('foo: bar')).toBeInTheDocument();
    expect(screen.getByText('baz: qux')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('paynote-back-button'));

    await waitFor(() =>
      expect(
        screen.queryByTestId('paynote-details-view')
      ).not.toBeInTheDocument()
    );
  });

  it('renders PayNote loading state while details are fetching for payer view', async () => {
    usePayNoteDetailsMock.mockImplementation(options => ({
      data: undefined,
      isLoading: Boolean(options.enabled),
      isError: false,
      error: undefined,
      refetch: vi.fn(),
    }));

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'DEBIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
        payNote: { payNoteDocumentId: 'doc-123' },
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        selectedActivity={{ ...transactionActivity, side: 'DEBIT' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'See details' }));

    expect(await screen.findByTestId('paynote-loading')).toBeInTheDocument();
  });

  it('renders PayNote error state and allows retry for payer view', async () => {
    const refetchMock = vi.fn();
    const error = Object.assign(new Error('Unable to fetch'), { status: 500 });

    usePayNoteDetailsMock.mockImplementation(options => ({
      data: undefined,
      isLoading: false,
      isError: Boolean(options.enabled),
      error,
      refetch: refetchMock,
    }));

    useActivityDetailMock.mockReturnValue({
      data: {
        kind: 'POSTED_TRANSACTION',
        activityId: 'TXN#txn-1',
        transactionId: 'txn-1',
        amountMinor: 1200,
        description: 'Test',
        postedAt: '2024-01-01T00:00:00.000Z',
        originHoldId: null,
        side: 'DEBIT',
        type: 'FUNDING',
        status: 'POSTED',
        counterpartyAccountNumber: '0987654321',
        payNote: { payNoteDocumentId: 'doc-123' },
      },
      isLoading: false,
      isError: false,
    });

    render(
      <TransactionDetailsModal
        {...defaultProps}
        selectedActivity={{ ...transactionActivity, side: 'DEBIT' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'See details' }));

    expect(await screen.findByTestId('paynote-error')).toBeInTheDocument();
    expect(screen.getByText('Unable to fetch')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('paynote-retry-button'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
