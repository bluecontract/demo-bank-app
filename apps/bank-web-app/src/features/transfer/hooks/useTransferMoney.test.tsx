import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useTransferMoney } from './useTransferMoney';
import { apiClient } from '../../../api/client';
import { createTestWrapper } from '../../../test-utils';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      transferMoney: vi.fn(),
    },
  },
}));

describe('useTransferMoney', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should transfer money successfully', async () => {
    const mockResponse = {
      status: 201 as const,
      body: {
        txnId: '123e4567-e89b-12d3-a456-426614174000',
      },
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.transferMoney).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useTransferMoney(), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
      description: 'Test transfer',
    };

    result.current.mutate(transferData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResponse.body);
  });

  it('should handle loading state during transfer', async () => {
    vi.mocked(apiClient.banking.transferMoney).mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                status: 201 as const,
                body: { txnId: '123' },
                headers: new Headers(),
              }),
            100
          )
        )
    );

    const { result } = renderHook(() => useTransferMoney(), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
    };

    result.current.mutate(transferData);

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should handle error state', async () => {
    const mockError = new Error('Transfer failed');

    vi.mocked(apiClient.banking.transferMoney).mockRejectedValue(mockError);

    const { result } = renderHook(() => useTransferMoney(), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
    };

    result.current.mutate(transferData);

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

    vi.mocked(apiClient.banking.transferMoney).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useTransferMoney(), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
      description: 'Test transfer',
    };

    result.current.mutate(transferData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.banking.transferMoney).toHaveBeenCalledTimes(1);
    expect(apiClient.banking.transferMoney).toHaveBeenCalledWith({
      headers: {
        'idempotency-key': expect.any(String),
      },
      body: transferData,
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

    vi.mocked(apiClient.banking.transferMoney).mockResolvedValue(mockResponse);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useTransferMoney({ onSuccess }), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
    };

    result.current.mutate(transferData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(onSuccess).toHaveBeenCalledWith(mockResponse.body);
  });

  it('should support onError callback', async () => {
    const mockError = new Error('Transfer failed');

    vi.mocked(apiClient.banking.transferMoney).mockRejectedValue(mockError);

    const onError = vi.fn();
    const { result } = renderHook(() => useTransferMoney({ onError }), {
      wrapper: createTestWrapper(),
    });

    const transferData = {
      sourceAccountId: '123e4567-e89b-12d3-a456-426614174000',
      destinationAccountNumber: '9876543210',
      amountMinor: 10000,
    };

    result.current.mutate(transferData);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it('should reset mutation state correctly', () => {
    const { result } = renderHook(() => useTransferMoney(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
