import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../api/client';
import { createQueryWrapper } from '../../../test-utils';
import { useContractAiChat } from '../hooks/useContractAiChat';
import { useRunContractOperation } from '../hooks/useRunContractOperation';
import { ContractAiChatDrawer } from './ContractAiChatDrawer';

vi.mock('../hooks/useContractAiChat', () => ({
  useContractAiChat: vi.fn(),
}));

vi.mock('../hooks/useRunContractOperation', () => ({
  useRunContractOperation: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
  apiClient: {
    banking: {
      getContractDetails: vi.fn(),
    },
  },
}));

const mockUseContractAiChat = useContractAiChat as ReturnType<typeof vi.fn>;
const mockUseRunContractOperation = useRunContractOperation as ReturnType<
  typeof vi.fn
>;

describe('ContractAiChatDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires confirmation before running an operation and confirms submission', async () => {
    const chatMutateAsync = vi.fn().mockResolvedValue({
      assistantMessage: 'Ready to run.',
      status: 'ready',
      nextProcessingState: 'confirm',
      focus: null,
      operationRequest: {
        type: 'Conversation/Operation Request',
        operation: 'incrementCounter',
        request: { by: 2 },
      },
    });

    mockUseContractAiChat.mockReturnValue({
      mutateAsync: chatMutateAsync,
      isPending: false,
      reset: vi.fn(),
    });

    const runOperationMutate = vi.fn((_vars: any, options?: any) => {
      options?.onSuccess?.();
      options?.onSettled?.();
    });

    mockUseRunContractOperation.mockReturnValue({
      mutate: runOperationMutate,
      isPending: false,
      reset: vi.fn(),
    });

    (apiClient.banking.getContractDetails as any).mockResolvedValueOnce({
      status: 200,
      body: {
        updatedAt: '2026-02-02T00:00:00.000Z',
      },
    });

    const wrapper = createQueryWrapper();
    render(
      <ContractAiChatDrawer
        isOpen
        sessionId="sess-1"
        documentTitle="Test contract"
        contractUpdatedAt="2026-02-01T00:00:00.000Z"
        onClose={() => undefined}
      />,
      { wrapper }
    );

    const input = screen.getByPlaceholderText('Write what you want');
    fireEvent.change(input, { target: { value: 'Run it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(chatMutateAsync).toHaveBeenCalled();
    });

    expect(runOperationMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(runOperationMutate).toHaveBeenCalled();
    await screen.findByText('Done.');

    await waitFor(
      () => {
        expect(apiClient.banking.getContractDetails).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );
  });
});
