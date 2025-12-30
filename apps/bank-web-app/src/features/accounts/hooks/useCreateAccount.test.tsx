import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateAccount } from './useCreateAccount';
import { apiClient } from '../../../api/client';
import { ReactNode } from 'react';

// Mock the API client
vi.mock('../../../api/client');

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockCreatedAccount = {
  accountId: '123e4567-e89b-12d3-a456-426614174000',
  accountNumber: '1234567890',
  name: 'My Savings Account',
  currency: 'USD' as const,
  createdAt: '2023-01-01T00:00:00Z',
  ledgerBalanceMinor: 0,
  availableBalanceMinor: 0,
  status: 'ACTIVE',
};

describe('useCreateAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create account successfully', async () => {
    const mockApiResponse = {
      status: 201,
      body: mockCreatedAccount,
    };

    (apiClient.banking.createAccount as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();

    // Call the mutate function
    result.current.mutate({ name: 'My Savings Account' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockCreatedAccount);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle loading state during creation', async () => {
    const mockApiResponse = new Promise(() => {
      // Never resolving promise for loading state test
    });
    (apiClient.banking.createAccount as any).mockReturnValue(mockApiResponse);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    // Call the mutate function
    result.current.mutate({ name: 'My Savings Account' });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('should handle error state', async () => {
    const mockError = new Error('Failed to create account');
    (apiClient.banking.createAccount as any).mockRejectedValue(mockError);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    // Call the mutate function
    result.current.mutate({ name: 'My Savings Account' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(mockError);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(false);
  });

  it('should call API with correct parameters', async () => {
    const mockApiResponse = {
      status: 201,
      body: mockCreatedAccount,
    };

    (apiClient.banking.createAccount as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    const createData = { name: 'My Savings Account' };

    // Call the mutate function with data
    result.current.mutate(createData);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.banking.createAccount).toHaveBeenCalledTimes(1);
    expect(apiClient.banking.createAccount).toHaveBeenCalledWith({
      body: createData,
      overrideClientOptions: {
        credentials: 'include',
      },
    });
  });

  it('should support onSuccess callback', async () => {
    const mockApiResponse = {
      status: 201,
      body: mockCreatedAccount,
    };

    (apiClient.banking.createAccount as any).mockResolvedValue(mockApiResponse);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    // Call the mutate function with onSuccess callback
    result.current.mutate({ name: 'My Savings Account' }, { onSuccess });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const [data, variables, context] = onSuccess.mock.calls[0] ?? [];
    expect(data).toEqual(mockCreatedAccount);
    expect(variables).toEqual({ name: 'My Savings Account' });
    expect(context).toBeUndefined();
  });

  it('should support onError callback', async () => {
    const mockError = new Error('Failed to create account');
    (apiClient.banking.createAccount as any).mockRejectedValue(mockError);

    const onError = vi.fn();
    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    // Call the mutate function with onError callback
    result.current.mutate({ name: 'My Savings Account' }, { onError });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, variables, context] = onError.mock.calls[0] ?? [];
    expect(error).toEqual(mockError);
    expect(variables).toEqual({ name: 'My Savings Account' });
    expect(context).toBeUndefined();
  });

  it('should reset mutation state correctly', async () => {
    const mockApiResponse = {
      status: 201,
      body: mockCreatedAccount,
    };

    (apiClient.banking.createAccount as any).mockResolvedValue(mockApiResponse);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    // Call the mutate function
    result.current.mutate({ name: 'My Savings Account' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual(mockCreatedAccount);

    // Reset the mutation state
    result.current.reset();

    await waitFor(() => {
      expect(result.current.isIdle).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
