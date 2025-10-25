import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useActivity } from './useActivity';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      listActivity: vi.fn(),
    },
  },
}));

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

const mockActivity = [
  {
    kind: 'POSTED_TRANSACTION' as const,
    transactionId: 'txn-123',
    amountMinor: 100_000,
    description: 'Test deposit',
    postedAt: '2023-01-01T10:00:00Z',
    originHoldId: undefined,
    side: 'CREDIT' as const,
    type: 'FUNDING',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
  },
  {
    kind: 'HOLD_CREATED' as const,
    holdId: 'hold-1',
    amountMinor: 50_000,
    description: 'Pending purchase',
    createdAt: '2023-01-02T11:00:00Z',
    counterpartyAccountNumber: '0987654321',
    createdByUserId: 'system',
    idempotencyKeyHash: 'hash',
  },
];

describe('useActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthErrorHandler as any).mockReturnValue({
      handleAuthError: vi.fn().mockReturnValue(false),
    });
  });

  it('fetches account activity successfully', async () => {
    (apiClient.banking.listActivity as any).mockResolvedValue({
      status: 200,
      body: { items: mockActivity, nextCursor: 'cursor-1' },
    });

    const { result } = renderHook(
      () => useActivity({ accountNumber: '1234567890' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      items: mockActivity,
      nextCursor: 'cursor-1',
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('handles loading state', () => {
    (apiClient.banking.listActivity as any).mockReturnValue(
      new Promise(() => {
        // intentionally unresolved
      })
    );

    const { result } = renderHook(
      () => useActivity({ accountNumber: '1234567890' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('surfaces API errors', async () => {
    (apiClient.banking.listActivity as any).mockResolvedValue({
      status: 500,
      body: { error: 'Internal server error' },
    });

    const { result } = renderHook(
      () => useActivity({ accountNumber: '1234567890' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('returns placeholder data when account number is missing', () => {
    const { result } = renderHook(() => useActivity({ accountNumber: null }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ items: [], nextCursor: undefined });
    expect(apiClient.banking.listActivity).not.toHaveBeenCalled();
  });

  it('does not execute query without account number', () => {
    renderHook(() => useActivity({ accountNumber: null }), {
      wrapper: createWrapper(),
    });

    expect(apiClient.banking.listActivity).not.toHaveBeenCalled();
  });

  it('passes parameters to API client', async () => {
    (apiClient.banking.listActivity as any).mockResolvedValue({
      status: 200,
      body: { items: [], nextCursor: undefined },
    });

    renderHook(
      () =>
        useActivity({
          accountNumber: '1234567890',
          limit: 25,
          cursor: 'cursor-123',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(apiClient.banking.listActivity).toHaveBeenCalledWith({
        params: { accountNumber: '1234567890' },
        query: { limit: 25, cursor: 'cursor-123' },
        overrideClientOptions: { credentials: 'include' },
      });
    });
  });

  it('uses default limit when not provided', async () => {
    (apiClient.banking.listActivity as any).mockResolvedValue({
      status: 200,
      body: { items: [], nextCursor: undefined },
    });

    renderHook(() => useActivity({ accountNumber: '1234567890' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.banking.listActivity).toHaveBeenCalledWith({
        params: { accountNumber: '1234567890' },
        query: { limit: 50, cursor: undefined },
        overrideClientOptions: { credentials: 'include' },
      });
    });
  });

  it('swallows handled auth errors', async () => {
    const authError = new Error('Unauthorized');
    (apiClient.banking.listActivity as any).mockRejectedValue(authError);
    const mockHandleAuthError = vi.fn().mockReturnValue(true);
    (useAuthErrorHandler as any).mockReturnValue({
      handleAuthError: mockHandleAuthError,
    });

    const { result } = renderHook(
      () => useActivity({ accountNumber: '1234567890' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(mockHandleAuthError).toHaveBeenCalled());
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual({ items: [], nextCursor: undefined });
  });
});
