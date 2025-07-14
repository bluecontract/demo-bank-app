import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useFundAccount } from './useFundAccount';
import { apiClient } from '../../../api/client';
import { createTestWrapper } from '../../../test-utils';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      fundAccount: vi.fn(),
    },
  },
}));

describe('useFundAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fund account successfully', async () => {
    const mockResponse = {
      status: 201 as const,
      body: {
        txnId: '123e4567-e89b-12d3-a456-426614174000',
      },
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.fundAccount).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useFundAccount(), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResponse.body);
  });

  it('should handle loading state during funding', async () => {
    vi.mocked(apiClient.banking.fundAccount).mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                status: 201,
                body: { txnId: '123' },
                headers: new Headers(),
              }),
            100
          )
        )
    );

    const { result } = renderHook(() => useFundAccount(), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should handle error state', async () => {
    const mockError = new Error('Funding failed');

    vi.mocked(apiClient.banking.fundAccount).mockRejectedValue(mockError);

    const { result } = renderHook(() => useFundAccount(), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(mockError);
  });

  it('should call API with correct parameters', async () => {
    const mockResponse = {
      status: 201 as const,
      body: { txnId: '123' },
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.fundAccount).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useFundAccount(), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.banking.fundAccount).toHaveBeenCalledTimes(1);
    expect(apiClient.banking.fundAccount).toHaveBeenCalledWith({
      params: { accountId: fundData.accountId },
      headers: {
        'idempotency-key': expect.any(String),
      },
      body: {
        amountMinor: fundData.amountMinor,
      },
      overrideClientOptions: {
        credentials: 'include',
      },
    });
  });

  it('should support onSuccess callback', async () => {
    const mockResponse = {
      status: 201 as const,
      body: { txnId: '123' },
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.fundAccount).mockResolvedValue(mockResponse);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useFundAccount({ onSuccess }), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(onSuccess).toHaveBeenCalledWith(mockResponse.body);
  });

  it('should support onError callback', async () => {
    const mockError = new Error('Funding failed');

    vi.mocked(apiClient.banking.fundAccount).mockRejectedValue(mockError);

    const onError = vi.fn();
    const { result } = renderHook(() => useFundAccount({ onError }), {
      wrapper: createTestWrapper(),
    });

    const fundData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      amountMinor: 50000,
    };

    result.current.mutate(fundData);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it('should reset mutation state correctly', () => {
    const { result } = renderHook(() => useFundAccount(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
