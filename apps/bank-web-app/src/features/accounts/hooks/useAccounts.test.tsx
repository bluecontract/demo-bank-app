import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { useAccounts } from './useAccounts';
import { apiClient } from '../../../api/client';
import { ReactNode } from 'react';

// Mock the API client
vi.mock('../../../api/client');

// Mock the auth error handler
vi.mock('../../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: () => ({
    handleAuthError: vi.fn(() => true), // Return true so errors are handled, not thrown
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </BrowserRouter>
  );
};

const mockAccounts = [
  {
    accountId: '123e4567-e89b-12d3-a456-426614174000',
    accountNumber: '1234567890',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 1030000,
    availableBalanceMinor: 1030000,
    status: 'ACTIVE',
  },
  {
    accountId: '123e4567-e89b-12d3-a456-426614174001',
    accountNumber: '1234567891',
    currency: 'USD' as const,
    createdAt: '2023-01-01T00:00:00Z',
    ledgerBalanceMinor: 500000,
    availableBalanceMinor: 500000,
    status: 'ACTIVE',
  },
];

describe('useAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch accounts successfully', async () => {
    const mockApiResponse = {
      status: 200,
      body: { accounts: mockAccounts },
    };

    (apiClient.banking.listAccounts as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockAccounts);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle loading state', () => {
    const mockApiResponse = new Promise(() => {
      // Never resolving promise for loading state test
    });
    (apiClient.banking.listAccounts as any).mockReturnValue(mockApiResponse);

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('should handle error state', async () => {
    const mockError = new Error('Failed to fetch accounts');
    (apiClient.banking.listAccounts as any).mockRejectedValue(mockError);

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(mockError);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('should refetch accounts when refetch is called', async () => {
    const mockApiResponse = {
      status: 200,
      body: { accounts: mockAccounts },
    };

    (apiClient.banking.listAccounts as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Clear mock and setup new response
    vi.clearAllMocks();
    (apiClient.banking.listAccounts as any).mockResolvedValue(mockApiResponse);

    await result.current.refetch();

    expect(apiClient.banking.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('should call API with correct parameters', async () => {
    const mockApiResponse = {
      status: 200,
      body: { accounts: [] },
    };

    (apiClient.banking.listAccounts as any).mockResolvedValue(mockApiResponse);

    renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    // Wait for the query to be called
    await waitFor(() => {
      expect(apiClient.banking.listAccounts).toHaveBeenCalledTimes(1);
    });

    expect(apiClient.banking.listAccounts).toHaveBeenCalledWith({
      overrideClientOptions: {
        credentials: 'include',
      },
    });
  });

  it('should handle empty accounts response', async () => {
    const mockApiResponse = {
      status: 200,
      body: { accounts: [] },
    };

    (apiClient.banking.listAccounts as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
