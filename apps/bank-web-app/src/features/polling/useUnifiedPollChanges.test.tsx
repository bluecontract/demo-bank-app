import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnifiedPollChanges } from './useUnifiedPollChanges';
import { apiClient } from '../../api/client';
import { useAuthErrorHandler } from '../../hooks/useAuthErrorHandler';

vi.mock('../../api/client', () => ({
  apiClient: {
    banking: {
      pollChanges: vi.fn(),
    },
  },
}));

vi.mock('../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: vi.fn(),
}));

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useUnifiedPollChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthErrorHandler).mockReturnValue({
      handleAuthError: vi.fn().mockReturnValue(false),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invalidates contracts and proposals when the respective scopes changed', async () => {
    vi.mocked(apiClient.banking.pollChanges).mockResolvedValue({
      status: 200,
      body: {
        serverTime: '2026-03-06T10:00:00.000Z',
        contracts: {
          cursor: 'contracts-cursor-1',
          changed: true,
          latestUpdatedAt: '2026-03-06T09:59:59.000Z',
        },
        proposals: {
          cursor: 'proposals-cursor-1',
          changed: true,
          latestUpdatedAt: '2026-03-06T09:59:58.000Z',
        },
      },
    } as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useUnifiedPollChanges(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(apiClient.banking.pollChanges).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(2));

    expect(apiClient.banking.pollChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          includeContracts: true,
          includeProposals: true,
          includeActivity: false,
        }),
      })
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contracts'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['proposals'] });
  });

  it('invalidates activity only for the active account when activity changed', async () => {
    vi.mocked(apiClient.banking.pollChanges).mockResolvedValue({
      status: 200,
      body: {
        serverTime: '2026-03-06T10:00:00.000Z',
        contracts: {
          cursor: 'contracts-cursor-1',
          changed: false,
        },
        proposals: {
          cursor: 'proposals-cursor-1',
          changed: false,
        },
        activity: {
          accountNumber: '1234567890',
          cursor: 'activity-cursor-1',
          changed: true,
          latestActivityAt: '2026-03-06T09:59:57.000Z',
        },
      },
    } as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(
      () =>
        useUnifiedPollChanges({
          activityAccountNumber: '1234567890',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() =>
      expect(apiClient.banking.pollChanges).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));

    expect(apiClient.banking.pollChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          includeContracts: true,
          includeProposals: true,
          includeActivity: true,
          activityAccountNumber: '1234567890',
        }),
      })
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['activity', '1234567890'],
    });
  });

  it('forces initial activity invalidation for a newly tracked account even when changed is false', async () => {
    vi.mocked(apiClient.banking.pollChanges).mockResolvedValue({
      status: 200,
      body: {
        serverTime: '2026-03-06T10:00:00.000Z',
        contracts: {
          cursor: 'contracts-cursor-1',
          changed: false,
        },
        proposals: {
          cursor: 'proposals-cursor-1',
          changed: false,
        },
        activity: {
          accountNumber: '1234567890',
          cursor: 'activity-cursor-1',
          changed: false,
          latestActivityAt: '2026-03-06T09:59:57.000Z',
        },
      },
    } as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(
      () =>
        useUnifiedPollChanges({
          activityAccountNumber: '1234567890',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() =>
      expect(apiClient.banking.pollChanges).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['activity', '1234567890'],
    });
  });

  it('polls every 3 seconds from a single hook instance', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.banking.pollChanges).mockResolvedValue({
      status: 200,
      body: {
        serverTime: '2026-03-06T10:00:00.000Z',
        contracts: {
          cursor: 'contracts-cursor-1',
          changed: false,
        },
        proposals: {
          cursor: 'proposals-cursor-1',
          changed: false,
        },
      },
    } as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useUnifiedPollChanges(), {
      wrapper: createWrapper(queryClient),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(apiClient.banking.pollChanges).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.resolve();
    expect(apiClient.banking.pollChanges).toHaveBeenCalledTimes(2);
  });
});
