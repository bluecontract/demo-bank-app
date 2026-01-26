import { renderHook, waitFor } from '@testing-library/react';
import { useCards } from './useCards';
import { apiClient } from '../../../api/client';
import { createQueryWrapper } from '../../../test-utils';

vi.mock('../../../api/client');

vi.mock('../../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: () => ({
    handleAuthError: vi.fn(() => true),
  }),
}));

const mockCards = [
  {
    cardId: 'card-1',
    accountId: 'acc-1',
    accountNumber: '1234567890',
    cardholderName: 'Test User',
    panLast4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

describe('useCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch cards successfully', async () => {
    const mockResponse = {
      status: 200,
      body: { cards: mockCards },
    };

    (apiClient.banking.listCards as any).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useCards({ accountId: 'acc-1' }), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockCards);
  });

  it('should handle error state', async () => {
    const mockError = new Error('Failed to fetch cards');
    (apiClient.banking.listCards as any).mockRejectedValue(mockError);

    const { result } = renderHook(() => useCards({ accountId: 'acc-1' }), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(mockError);
  });

  it('should call API with correct parameters', async () => {
    const mockResponse = {
      status: 200,
      body: { cards: [] },
    };

    (apiClient.banking.listCards as any).mockResolvedValue(mockResponse);

    renderHook(() => useCards({ accountId: 'acc-1' }), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.banking.listCards).toHaveBeenCalledTimes(1);
    });

    expect(apiClient.banking.listCards).toHaveBeenCalledWith({
      query: { accountId: 'acc-1' },
      overrideClientOptions: { credentials: 'include' },
    });
  });
});
