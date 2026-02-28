import { useState } from 'react';
import {
  act,
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../api/client';
import { createQueryWrapper } from '../../../test-utils';
import { useContractAiChat } from '../hooks/useContractAiChat';
import { useRunContractOperation } from '../hooks/useRunContractOperation';
import {
  parseContractAiChatDockState,
  useContractAiChatDockState,
} from '../hooks/useContractAiChatDockState';
import { ContractAiChatDock } from './ContractAiChatDock';

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

const buildState = () => ({
  version: 1 as const,
  mode: 'collapsed' as const,
  messages: [
    {
      id: 'welcome',
      role: 'assistant' as const,
      content:
        'How can I help you? I know everything about the document: “Contract”.',
    },
  ],
  draft: '',
  pendingOperation: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

type HarnessState = ReturnType<typeof buildState>;

type ChatDockHarnessProps = {
  initialState: HarnessState;
};

function ChatDockHarness({ initialState }: ChatDockHarnessProps) {
  const [state, setState] = useState(initialState);

  return (
    <ContractAiChatDock
      sessionId="session-1"
      documentTitle="Contract"
      contractUpdatedAt="2026-01-01T00:00:00.000Z"
      state={state}
      onModeChange={mode =>
        setState(previous => ({
          ...previous,
          mode,
          updatedAt: '2026-01-01T00:00:01.000Z',
        }))
      }
      onDraftChange={draft =>
        setState(previous => ({
          ...previous,
          draft,
          updatedAt: '2026-01-01T00:00:01.000Z',
        }))
      }
      onMessagesChange={messages =>
        setState(previous => ({
          ...previous,
          messages,
          updatedAt: '2026-01-01T00:00:01.000Z',
        }))
      }
      onPendingOperationChange={pendingOperation =>
        setState(previous => ({
          ...previous,
          pendingOperation,
          updatedAt: '2026-01-01T00:00:01.000Z',
        }))
      }
    />
  );
}

describe('ContractAiChatDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockUseContractAiChat.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      reset: vi.fn(),
    });

    mockUseRunContractOperation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders collapsed mode with input only', () => {
    render(<ChatDockHarness initialState={buildState()} />, {
      wrapper: createQueryWrapper(),
    });

    expect(
      screen.getByRole('heading', { name: 'Talk with AI' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.queryByText('How can I help you?')).not.toBeInTheDocument();
  });

  it('sends message and appends assistant reply', async () => {
    const chatMutateAsync = vi.fn().mockResolvedValue({
      assistantMessage: 'Status captured.',
      status: 'done',
      nextProcessingState: 'idle',
      focus: null,
      operationRequest: null,
    });

    mockUseContractAiChat.mockReturnValue({
      mutateAsync: chatMutateAsync,
      isPending: false,
      reset: vi.fn(),
    });

    mockUseRunContractOperation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
    });

    render(
      <ChatDockHarness initialState={{ ...buildState(), mode: 'expanded' }} />,
      {
        wrapper: createQueryWrapper(),
      }
    );

    const input = screen.getByRole('textbox', { name: 'AI chat input' });
    fireEvent.change(input, { target: { value: 'Do the thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(chatMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(screen.getByText('Status captured.')).toBeInTheDocument();
  });

  it('requests operation confirmation and confirms it', async () => {
    const chatMutateAsync = vi.fn().mockResolvedValue({
      assistantMessage: 'Please confirm operation.',
      status: 'ready',
      nextProcessingState: 'confirm',
      focus: null,
      operationRequest: {
        type: 'Conversation/Operation Request',
        operation: 'incrementCounter',
        request: { by: 2 },
      },
    });
    const runOperationMutate = vi.fn((_vars: any, options?: any) => {
      options?.onSuccess?.();
      options?.onSettled?.();
    });

    mockUseContractAiChat.mockReturnValue({
      mutateAsync: chatMutateAsync,
      isPending: false,
      reset: vi.fn(),
    });

    mockUseRunContractOperation.mockReturnValue({
      mutate: runOperationMutate,
      isPending: false,
      reset: vi.fn(),
    });

    (apiClient.banking.getContractDetails as any).mockResolvedValue({
      status: 200,
      body: {
        updatedAt: '2026-01-01T00:00:05.000Z',
      },
    });

    render(
      <ChatDockHarness initialState={{ ...buildState(), mode: 'expanded' }} />,
      { wrapper: createQueryWrapper() }
    );

    const input = screen.getByRole('textbox', { name: 'AI chat input' });
    fireEvent.change(input, { target: { value: 'Run action' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Confirm operation')).toBeInTheDocument();
    });
    expect(screen.getByText('incrementCounter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(runOperationMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });

  it('does not duplicate assistant message when operation request is malformed', async () => {
    const chatMutateAsync = vi.fn().mockResolvedValue({
      assistantMessage: 'Could not parse.',
      status: 'ready',
      nextProcessingState: 'confirm',
      focus: null,
      operationRequest: null,
    });

    mockUseContractAiChat.mockReturnValue({
      mutateAsync: chatMutateAsync,
      isPending: false,
      reset: vi.fn(),
    });
    mockUseRunContractOperation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
    });

    render(
      <ChatDockHarness initialState={{ ...buildState(), mode: 'expanded' }} />,
      { wrapper: createQueryWrapper() }
    );

    const input = screen.getByRole('textbox', { name: 'AI chat input' });
    fireEvent.change(input, { target: { value: 'Run action' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Sorry — I could not understand the operation request. Please try again.'
        )
      ).toBeInTheDocument();
    });
  });

  it('minimizes and restores dock modes', () => {
    const state = buildState();
    const { rerender } = render(
      <ContractAiChatDock
        sessionId="session-1"
        documentTitle="Contract"
        contractUpdatedAt="2026-01-01T00:00:00.000Z"
        state={{ ...state, mode: 'minimized' }}
        onModeChange={vi.fn()}
        onDraftChange={vi.fn()}
        onMessagesChange={vi.fn()}
        onPendingOperationChange={vi.fn()}
      />,
      { wrapper: createQueryWrapper() }
    );

    expect(
      screen.queryByRole('button', { name: 'Send message' })
    ).not.toBeInTheDocument();

    rerender(
      <ContractAiChatDock
        sessionId="session-1"
        documentTitle="Contract"
        contractUpdatedAt="2026-01-01T00:00:00.000Z"
        state={{ ...state, mode: 'collapsed' }}
        onModeChange={vi.fn()}
        onDraftChange={vi.fn()}
        onMessagesChange={vi.fn()}
        onPendingOperationChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Talk with AI' })
    ).toBeInTheDocument();
  });
});

describe('useContractAiChatDockState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores persisted state for the same session', () => {
    const key = 'demo-bank-contract-ai-chat:v1:user-1:session-1';
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        mode: 'expanded',
        draft: 'Draft text',
        pendingOperation: {
          operation: 'transfer',
          request: { amount: 10 },
        },
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'hello',
          },
        ],
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    const { result, unmount } = renderHook(() =>
      useContractAiChatDockState({
        sessionId: 'session-1',
        userId: 'user-1',
        documentTitle: 'Contract',
      })
    );

    expect(result.current.state.mode).toBe('expanded');
    expect(result.current.state.draft).toBe('Draft text');
    expect(result.current.state.pendingOperation).toMatchObject({
      operation: 'transfer',
      request: { amount: 10 },
    });
    expect(result.current.state.messages).toHaveLength(1);
    unmount();

    const { result: remounted } = renderHook(() =>
      useContractAiChatDockState({
        sessionId: 'session-1',
        userId: 'user-1',
        documentTitle: 'Contract',
      })
    );

    expect(remounted.current.state.mode).toBe('expanded');
    expect(remounted.current.state.draft).toBe('Draft text');
    expect(remounted.current.state.messages[0].content).toBe('hello');
  });

  it('persists state updates and falls back on invalid stored state', async () => {
    localStorage.setItem(
      'demo-bank-contract-ai-chat:v1:user-1:session-1',
      '{ invalid json '
    );
    const { result } = renderHook(() =>
      useContractAiChatDockState({
        sessionId: 'session-1',
        userId: 'user-1',
        documentTitle: 'Contract',
      })
    );

    const parsed = parseContractAiChatDockState(
      JSON.stringify({
        version: 1,
        mode: 'minimized',
        draft: 'Draft text',
        pendingOperation: null,
        messages: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      'Contract'
    );
    expect(parsed).toMatchObject({ mode: 'minimized', draft: 'Draft text' });

    expect(result.current.state.mode).toBe('collapsed');
    expect(result.current.state.messages).toHaveLength(1);

    act(() => {
      result.current.setMode('expanded');
      result.current.setDraft('new draft');
      result.current.setMessages([
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'persist',
        },
      ]);
      result.current.setPendingOperation({
        operation: 'op',
        request: { value: 1 },
      });
    });

    await waitFor(() => {
      expect(
        localStorage.getItem('demo-bank-contract-ai-chat:v1:user-1:session-1')
      ).toContain('"mode":"expanded"');
    });
  });
});
