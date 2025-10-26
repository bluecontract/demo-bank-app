import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { useActivityDetail } from './useActivityDetail';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      getActivityDetail: vi.fn(),
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

describe('useActivityDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthErrorHandler as any).mockReturnValue({
      handleAuthError: vi.fn().mockReturnValue(false),
    });
  });

  it('fetches activity detail successfully', async () => {
    (apiClient.banking.getActivityDetail as any).mockResolvedValue({
      status: 200,
      body: {
        kind: 'HOLD',
        activityId: 'HOLD#hold-1',
        holdId: 'hold-1',
        amountMinor: 5000,
        currency: 'USD',
        status: 'PENDING',
        description: 'Test hold',
        createdAt: '2024-01-01T00:00:00.000Z',
        timeline: [
          {
            type: 'CREATED',
            at: '2024-01-01T00:00:00.000Z',
            createdByUserId: 'system-test',
          },
        ],
      },
    });

    const { result } = renderHook(
      () =>
        useActivityDetail({
          accountNumber: '1234567890',
          activityId: 'HOLD#hold-1',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kind).toBe('HOLD');
    expect(apiClient.banking.getActivityDetail).toHaveBeenCalledWith({
      params: { accountNumber: '1234567890', activityId: 'HOLD--hold-1' },
      overrideClientOptions: { credentials: 'include' },
    });
  });

  it('does not execute query when account number or activityId is missing', async () => {
    renderHook(
      () =>
        useActivityDetail({
          accountNumber: null,
          activityId: 'HOLD#hold-1',
        }),
      { wrapper: createWrapper() }
    );

    renderHook(
      () =>
        useActivityDetail({
          accountNumber: '1234567890',
          activityId: null,
        }),
      { wrapper: createWrapper() }
    );

    expect(apiClient.banking.getActivityDetail).not.toHaveBeenCalled();
  });

  it('surfaces API errors', async () => {
    (apiClient.banking.getActivityDetail as any).mockResolvedValue({
      status: 500,
      body: { error: 'Internal server error' },
    });

    const { result } = renderHook(
      () =>
        useActivityDetail({
          accountNumber: '1234567890',
          activityId: 'HOLD#hold-1',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
