import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTransactions } from './useTransactions';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

// Mock the API client
vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      listTransactions: vi.fn(),
    },
  },
}));

// Mock the auth error handler
vi.mock('../../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: vi.fn(),
}));

const createWrapper = () => {
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

const mockTransactions = [
  {
    txnId: 'txn-123',
    accountId: 'acc-456',
    side: 'CREDIT' as const,
    amountMinor: 100000,
    type: 'FUNDING',
    status: 'COMPLETED',
    timestamp: '2023-01-01T10:00:00Z',
    description: 'Test deposit',
    counterpartyAccountNumber: '1234567890',
  },
  {
    txnId: 'txn-124',
    accountId: 'acc-456',
    side: 'DEBIT' as const,
    amountMinor: 50000,
    type: 'TRANSFER',
    status: 'COMPLETED',
    timestamp: '2023-01-02T11:00:00Z',
    description: 'Test transfer',
    counterpartyAccountNumber: '0987654321',
  },
];

describe('useTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthErrorHandler as any).mockReturnValue({
      handleAuthError: vi.fn().mockReturnValue(false),
    });
  });

  it('should fetch transactions successfully', async () => {
    const mockApiResponse = {
      status: 200,
      body: { items: mockTransactions },
    };

    (apiClient.banking.listTransactions as any).mockResolvedValue(
      mockApiResponse
    );

    const { result } = renderHook(
      () => useTransactions({ accountId: 'acc-456' }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ items: mockTransactions });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle loading state', () => {
    const mockApiResponse = new Promise(() => {
      // Never resolving promise for loading state test
    });
    (apiClient.banking.listTransactions as any).mockReturnValue(
      mockApiResponse
    );

    const { result } = renderHook(
      () => useTransactions({ accountId: 'acc-456' }),
      {
        wrapper: createWrapper(),
      }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('should handle error state', async () => {
    const mockApiResponse = {
      status: 500,
      body: { error: 'Internal server error' },
    };

    (apiClient.banking.listTransactions as any).mockResolvedValue(
      mockApiResponse
    );

    const { result } = renderHook(
      () => useTransactions({ accountId: 'acc-456' }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });

  it('should return empty array when no account ID provided', async () => {
    const { result } = renderHook(() => useTransactions({ accountId: null }), {
      wrapper: createWrapper(),
    });

    // When accountId is null, the query should be disabled but should still return success with empty data
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ items: [] });
    expect(apiClient.banking.listTransactions).not.toHaveBeenCalled();
  });

  it('should not fetch when account ID is null', () => {
    const { result } = renderHook(() => useTransactions({ accountId: null }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(apiClient.banking.listTransactions).not.toHaveBeenCalled();
  });

  it('should pass correct parameters to API', async () => {
    const mockApiResponse = {
      status: 200,
      body: { items: [] },
    };

    (apiClient.banking.listTransactions as any).mockResolvedValue(
      mockApiResponse
    );

    renderHook(
      () =>
        useTransactions({
          accountId: 'acc-456',
          limit: 25,
          cursor: 'cursor-123',
        }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(apiClient.banking.listTransactions).toHaveBeenCalledWith({
        params: { accountId: 'acc-456' },
        query: { limit: 25, cursor: 'cursor-123' },
        overrideClientOptions: { credentials: 'include' },
      });
    });
  });

  it('should use default limit when not provided', async () => {
    const mockApiResponse = {
      status: 200,
      body: { items: [] },
    };

    (apiClient.banking.listTransactions as any).mockResolvedValue(
      mockApiResponse
    );

    renderHook(() => useTransactions({ accountId: 'acc-456' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.banking.listTransactions).toHaveBeenCalledWith({
        params: { accountId: 'acc-456' },
        query: { limit: 50, cursor: undefined },
        overrideClientOptions: { credentials: 'include' },
      });
    });
  });

  it('should handle empty transactions response', async () => {
    const mockApiResponse = {
      status: 200,
      body: { items: [] },
    };

    (apiClient.banking.listTransactions as any).mockResolvedValue(
      mockApiResponse
    );

    const { result } = renderHook(
      () => useTransactions({ accountId: 'acc-456' }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ items: [] });
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle auth errors', async () => {
    const mockAuthError = new Error('Unauthorized');
    (apiClient.banking.listTransactions as any).mockRejectedValue(
      mockAuthError
    );

    const mockHandleAuthError = vi.fn().mockReturnValue(true);
    (useAuthErrorHandler as any).mockReturnValue({
      handleAuthError: mockHandleAuthError,
    });

    const { result } = renderHook(
      () => useTransactions({ accountId: 'acc-456' }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(false);
    });

    expect(mockHandleAuthError).toHaveBeenCalledWith(mockAuthError);
  });
});
