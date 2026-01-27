import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useTransactionContracts } from './useTransactionContracts';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      listTransactionContracts: vi.fn(),
    },
  },
}));

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

const mockContracts = [
  {
    contractId: 'contract-1',
    typeBlueId: 'type-1',
    displayName: 'PayNote Voucher',
    sessionId: 'session-1',
    status: 'accepted',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T12:00:00.000Z',
  },
];

describe('useTransactionContracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch related contracts successfully', async () => {
    vi.mocked(apiClient.banking.listTransactionContracts).mockResolvedValue({
      status: 200,
      body: { items: mockContracts },
      headers: {},
    } as any);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransactionContracts({
          transactionId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockContracts);
    expect(apiClient.banking.listTransactionContracts).toHaveBeenCalledWith({
      params: { txnId: 'txn-123' },
      overrideClientOptions: { credentials: 'include' },
    });
  });

  it('should handle API error', async () => {
    vi.mocked(apiClient.banking.listTransactionContracts).mockRejectedValue(
      new Error('API Error')
    );

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransactionContracts({
          transactionId: 'txn-123',
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
    vi.mocked(apiClient.banking.listTransactionContracts).mockRejectedValue(
      authError
    );
    mockHandleAuthError.mockReturnValue(true);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransactionContracts({
          transactionId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockHandleAuthError).toHaveBeenCalledWith(authError);
  });

  it('should handle non-200 response', async () => {
    vi.mocked(apiClient.banking.listTransactionContracts).mockResolvedValue({
      status: 404,
      body: { title: 'Not Found', message: 'No contracts found' },
      headers: {},
    } as any);

    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransactionContracts({
          transactionId: 'txn-123',
        }),
      { wrapper: TestWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
  });

  it('should not fetch when transactionId is missing', () => {
    const TestWrapper = createTestWrapper();

    const { result } = renderHook(
      () =>
        useTransactionContracts({
          transactionId: null,
        }),
      { wrapper: TestWrapper }
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClient.banking.listTransactionContracts).not.toHaveBeenCalled();
  });
});
