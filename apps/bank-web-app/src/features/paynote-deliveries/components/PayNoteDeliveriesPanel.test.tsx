import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PayNoteDeliveriesPanel } from './PayNoteDeliveriesPanel';
import { usePayNoteDeliveries } from '../hooks/usePayNoteDeliveries';
import { usePayNoteDeliveryDetails } from '../hooks/usePayNoteDeliveryDetails';
import { useRunContractOperation } from '../hooks/useRunContractOperation';

vi.mock('../hooks/usePayNoteDeliveries', () => ({
  usePayNoteDeliveries: vi.fn(),
}));

vi.mock('../hooks/usePayNoteDeliveryDetails', () => ({
  usePayNoteDeliveryDetails: vi.fn(),
}));

vi.mock('../hooks/useRunContractOperation', () => ({
  useRunContractOperation: vi.fn(),
}));

describe('PayNoteDeliveriesPanel', () => {
  it('renders loading state', () => {
    (usePayNoteDeliveries as any).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
    });
    (usePayNoteDeliveryDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    (useRunContractOperation as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      variables: null,
    });

    render(<PayNoteDeliveriesPanel />);

    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('invokes contract operation when accepting a delivery', () => {
    const mutateMock = vi.fn();

    (usePayNoteDeliveries as any).mockReturnValue({
      data: [
        {
          deliveryId: 'delivery-1',
          deliverySessionId: 'session-1',
          name: 'Invoice 42',
          amountMinor: 1200,
          currency: 'USD',
          deliveryStatus: 'Conversation/Status Pending',
          transactionIdentificationStatus: 'identified',
          clientDecisionStatus: 'pending',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });
    (usePayNoteDeliveryDetails as any).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    (useRunContractOperation as any).mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      error: null,
      variables: null,
    });

    render(<PayNoteDeliveriesPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mutateMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      operation: 'markPayNoteAcceptedByClient',
      deliveryId: 'delivery-1',
    });
  });
});
