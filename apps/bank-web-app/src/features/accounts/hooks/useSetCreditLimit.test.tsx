import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useSetCreditLimit } from './useSetCreditLimit';
import { apiClient } from '../../../api/client';
import { createTestWrapper } from '../../../test-utils';

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      setCreditLimit: vi.fn(),
    },
  },
}));

const mockAccount = {
  accountId: '123e4567-e89b-12d3-a456-426614174000',
  accountNumber: '1234567890',
  name: 'Credit Line',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  accountType: 'CREDIT_LINE' as const,
  creditLimitMinor: 500000,
  ledgerBalanceMinor: 500000,
  availableBalanceMinor: 450000,
  status: 'ACTIVE',
};

describe('useSetCreditLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update credit limit successfully', async () => {
    const mockResponse = {
      status: 200 as const,
      body: mockAccount,
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.setCreditLimit).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useSetCreditLimit(), {
      wrapper: createTestWrapper(),
    });

    const updateData = {
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    };

    result.current.mutate(updateData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockAccount);
  });

  it('should handle loading state during update', async () => {
    vi.mocked(apiClient.banking.setCreditLimit).mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                status: 200,
                body: mockAccount,
                headers: new Headers(),
              }),
            100
          )
        )
    );

    const { result } = renderHook(() => useSetCreditLimit(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should handle error state', async () => {
    const mockError = new Error('Update failed');

    vi.mocked(apiClient.banking.setCreditLimit).mockRejectedValue(mockError);

    const { result } = renderHook(() => useSetCreditLimit(), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(mockError);
  });

  it('should call API with correct parameters', async () => {
    const mockResponse = {
      status: 200 as const,
      body: mockAccount,
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.setCreditLimit).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useSetCreditLimit(), {
      wrapper: createTestWrapper(),
    });

    const updateData = {
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    };

    result.current.mutate(updateData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.banking.setCreditLimit).toHaveBeenCalledTimes(1);
    expect(apiClient.banking.setCreditLimit).toHaveBeenCalledWith({
      params: { accountId: updateData.accountId },
      body: { creditLimitMinor: updateData.creditLimitMinor },
      overrideClientOptions: { credentials: 'include' },
    });
  });

  it('should support onSuccess callback', async () => {
    const mockResponse = {
      status: 200 as const,
      body: mockAccount,
      headers: new Headers(),
    };

    vi.mocked(apiClient.banking.setCreditLimit).mockResolvedValue(mockResponse);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSetCreditLimit({ onSuccess }), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(onSuccess).toHaveBeenCalledWith(mockAccount);
  });

  it('should support onError callback', async () => {
    const mockError = new Error('Update failed');

    vi.mocked(apiClient.banking.setCreditLimit).mockRejectedValue(mockError);

    const onError = vi.fn();
    const { result } = renderHook(() => useSetCreditLimit({ onError }), {
      wrapper: createTestWrapper(),
    });

    result.current.mutate({
      accountId: mockAccount.accountId,
      creditLimitMinor: 600000,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it('should reset mutation state correctly', () => {
    const { result } = renderHook(() => useSetCreditLimit(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
