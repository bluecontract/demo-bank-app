import { renderHook, waitFor } from '@testing-library/react';
import { useIssueCard } from './useIssueCard';
import { apiClient } from '../../../api/client';
import { createQueryWrapper } from '../../../test-utils';

vi.mock('../../../api/client');

const mockIssuedCard = {
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
  pan: '1234567890124242',
  cvc: '123',
};

describe('useIssueCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should issue a card successfully', async () => {
    const mockResponse = {
      status: 201,
      body: mockIssuedCard,
    };

    (apiClient.banking.issueCard as any).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useIssueCard(), {
      wrapper: createQueryWrapper(),
    });

    result.current.mutate({ accountId: 'acc-1' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockIssuedCard);
  });

  it('should handle error state', async () => {
    const mockError = new Error('Failed to issue card');
    (apiClient.banking.issueCard as any).mockRejectedValue(mockError);

    const { result } = renderHook(() => useIssueCard(), {
      wrapper: createQueryWrapper(),
    });

    result.current.mutate({ accountId: 'acc-1' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(mockError);
  });

  it('should call API with correct parameters', async () => {
    const mockResponse = {
      status: 201,
      body: mockIssuedCard,
    };

    (apiClient.banking.issueCard as any).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useIssueCard(), {
      wrapper: createQueryWrapper(),
    });

    result.current.mutate({ accountId: 'acc-1', cardholderName: 'Test User' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiClient.banking.issueCard).toHaveBeenCalledTimes(1);
    expect(apiClient.banking.issueCard).toHaveBeenCalledWith({
      body: { accountId: 'acc-1', cardholderName: 'Test User' },
      overrideClientOptions: { credentials: 'include' },
    });
  });
});
