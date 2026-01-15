import { renderHook, waitFor } from '@testing-library/react';
import { useCardDetails } from './useCardDetails';
import { apiClient } from '../../../api/client';
import { createQueryWrapper } from '../../../test-utils';

vi.mock('../../../api/client');

vi.mock('../../../hooks/useAuthErrorHandler', () => ({
  useAuthErrorHandler: () => ({
    handleAuthError: vi.fn(() => true),
  }),
}));

const mockCard = {
  cardId: 'card-1',
  accountId: 'acc-1',
  accountNumber: '1234567890',
  cardholderName: 'Test User',
  pan: '1234567890124242',
  cvc: '123',
  panLast4: '4242',
  expiryMonth: 12,
  expiryYear: 2030,
  status: 'ACTIVE',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('useCardDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch card details successfully', async () => {
    const mockResponse = {
      status: 200,
      body: mockCard,
    };

    (apiClient.banking.getCard as any).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useCardDetails('card-1'), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockCard);
  });

  it('should handle error state', async () => {
    const mockError = new Error('Failed to fetch card details');
    (apiClient.banking.getCard as any).mockRejectedValue(mockError);

    const { result } = renderHook(() => useCardDetails('card-1'), {
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
      body: mockCard,
    };

    (apiClient.banking.getCard as any).mockResolvedValue(mockResponse);

    renderHook(() => useCardDetails('card-1'), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(apiClient.banking.getCard).toHaveBeenCalledTimes(1);
    });

    expect(apiClient.banking.getCard).toHaveBeenCalledWith({
      params: { cardId: 'card-1' },
      overrideClientOptions: { credentials: 'include' },
    });
  });
});
