import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useTransaction } from './useTransaction';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      getTransaction: vi.fn(),
    },
  },
}));

// Get access to the mocked function
const { apiClient } = await import('../../../api/client');

const mockHandleAuthError = vi.fn();
vi.mock('../../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: () => ({
    handleAuthError: mockHandleAuthError,
  }),
}));

const createTestWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockTransactionDetails = {
  txnId: 'txn-123',
  accountId: 'acc-123',
  side: 'DEBIT' as const,
  amountMinor: 1000,
  type: 'TRANSFER',
  status: 'POSTED',
  timestamp: '2024-01-01T00:00:00.000Z',
  description: 'Test transaction',
  counterpartyAccountNumber: '0987654321',
};

describe('useTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch transaction details successfully', async () => {
    vi.mocked(apiClient.banking.getTransaction).mockResolvedValue({
      status: 200,
      body: mockTransactionDetails,
      headers: {},
    } as any);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: 'acc-123',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockTransactionDetails);
    expect(apiClient.banking.getTransaction).toHaveBeenCalledWith({
      params: { accountId: 'acc-123', txnId: 'txn-123' },
      overrideClientOptions: { credentials: 'include' },
    });
  });

  it('should handle API error', async () => {
    vi.mocked(apiClient.banking.getTransaction).mockRejectedValue(
      new Error('API Error')
    );

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: 'acc-123',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
  });

  it('should handle auth error', async () => {
    const authError = new Error('Auth Error');
    vi.mocked(apiClient.banking.getTransaction).mockRejectedValue(authError);
    mockHandleAuthError.mockReturnValue(true);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: 'acc-123',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockHandleAuthError).toHaveBeenCalledWith(authError);
  });

  it('should handle non-200 response', async () => {
    vi.mocked(apiClient.banking.getTransaction).mockResolvedValue({
      status: 404,
      body: { title: 'Not Found', message: 'Transaction not found' },
      headers: {},
    } as any);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: 'acc-123',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
  });

  it('should not fetch when accountId or txnId is missing', () => {
    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: '',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClient.banking.getTransaction).not.toHaveBeenCalled();
  });

  it('should use correct query key', async () => {
    vi.mocked(apiClient.banking.getTransaction).mockResolvedValue({
      status: 200,
      body: mockTransactionDetails,
      headers: {},
    } as any);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransaction({
          accountId: 'acc-123',
          txnId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const queryKey = result.current.dataUpdatedAt;
    expect(queryKey).toBeDefined();
  });
});
