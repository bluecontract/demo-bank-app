import { FormEvent, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Spinner } from '../../../ui/Spinner';
import type { ContractAiChatResponse } from '../../../types/api';
import type {
  ContractAiChatDockMode,
  ContractAiChatDockMessage,
  ContractAiChatDockPendingOperation,
  ContractAiChatDockState,
} from '../hooks/useContractAiChatDockState';
import { useContractAiChat } from '../hooks/useContractAiChat';
import { useRunContractOperation } from '../hooks/useRunContractOperation';

type ChatMessage = ContractAiChatDockMessage;

export type ContractAiChatDockPlacement = 'bottom' | 'side';

type ContractAiChatDockProps = {
  sessionId: string;
  documentTitle: string;
  contractUpdatedAt: string;
  placement: ContractAiChatDockPlacement;
  state: ContractAiChatDockState;
  onPlacementChange: (placement: ContractAiChatDockPlacement) => void;
  onModeChange: (mode: ContractAiChatDockMode) => void;
  onDraftChange: (draft: string) => void;
  onMessagesChange: (messages: ChatMessage[]) => void;
  onPendingOperationChange: (
    operation: ContractAiChatDockPendingOperation
  ) => void;
};

const MAX_HISTORY_MESSAGES = 20;

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatJson = (value: unknown) => {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
};

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    window.setTimeout(resolve, ms);
  });

export function ContractAiChatDock({
  sessionId,
  documentTitle,
  contractUpdatedAt,
  placement,
  state,
  onPlacementChange,
  onModeChange,
  onDraftChange,
  onMessagesChange,
  onPendingOperationChange,
}: ContractAiChatDockProps) {
  const queryClient = useQueryClient();
  const chat = useContractAiChat();
  const runOperation = useRunContractOperation();
  const { isPending: isChatPending, mutateAsync: sendChatMessage } = chat;
  const { isPending: isRunOperationPending, mutate: runOperationMutate } =
    runOperation;

  const isExpanded = state.mode === 'expanded';
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isBottomPlacement = placement === 'bottom';
  const isSidePlacement = placement === 'side';
  const sectionClassName = isBottomPlacement
    ? 'fixed bottom-0 z-30 pb-4 left-4 right-4 sm:left-6 sm:right-6 lg:left-[calc(240px+2.5rem)] lg:right-10'
    : '';
  const shellClassName = isBottomPlacement
    ? 'mx-auto w-full rounded-2xl border-4 border-slate-400 bg-slate-100 p-1 shadow-[0_32px_70px_rgba(15,23,42,0.32)] ring-2 ring-slate-300/70'
    : 'w-full rounded-xl border border-slate-200 bg-white';
  const contentClassName = isBottomPlacement
    ? 'rounded-xl border border-slate-300 bg-white shadow-inner'
    : 'rounded-xl bg-white';
  const headerClassName = isBottomPlacement
    ? 'flex items-center justify-between gap-3 rounded-t-xl px-4 py-3 border-b border-slate-300 bg-gradient-to-r from-slate-100 via-white to-slate-100'
    : 'flex items-center justify-between gap-3 rounded-t-xl border-b border-slate-200 bg-white px-4 py-3';
  const messagesListClassName = isBottomPlacement
    ? 'max-h-[45vh] min-h-[220px] overflow-y-auto bg-[#f5f7fa] p-4 space-y-4 border-t border-slate-200/80'
    : 'max-h-[45vh] min-h-[220px] overflow-y-auto bg-white p-4 space-y-4 border-t border-slate-200/80';
  const formClassName = isBottomPlacement
    ? 'flex items-center gap-2 rounded-b-xl border-t border-slate-200 bg-white/80 p-4'
    : 'flex items-center gap-2 rounded-b-xl border-t border-slate-200 bg-white p-4';
  const payloadPreview = useMemo(
    () =>
      state.pendingOperation
        ? formatJson(state.pendingOperation.request)
        : null,
    [state.pendingOperation]
  );

  const appendAssistantMessage = useCallback(
    (text: string, baseMessages: ChatMessage[]) => {
      onMessagesChange([
        ...baseMessages,
        {
          id: createId(),
          role: 'assistant' as const,
          content: text,
        },
      ]);
    },
    [onMessagesChange]
  );

  const handleAiResponse = useCallback(
    (response: ContractAiChatResponse, currentMessages: ChatMessage[]) => {
      const responseMessages = [
        ...currentMessages,
        {
          id: createId(),
          role: 'assistant' as const,
          content: response.assistantMessage,
        },
      ];

      if (response.status === 'ready') {
        if (!response.operationRequest) {
          appendAssistantMessage(
            'Sorry — I could not understand the operation request. Please try again.',
            responseMessages
          );
          onPendingOperationChange(null);
          return;
        }

        onMessagesChange(responseMessages);
        onPendingOperationChange({
          operation: response.operationRequest.operation,
          request: response.operationRequest.request,
        });
        return;
      }

      onMessagesChange(responseMessages);
      onPendingOperationChange(null);
    },
    [appendAssistantMessage, onMessagesChange, onPendingOperationChange]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isChatPending || isRunOperationPending) {
        return;
      }

      onPendingOperationChange(null);

      const nextMessages: ChatMessage[] = [
        ...state.messages,
        {
          id: createId(),
          role: 'user' as const,
          content: trimmed,
        },
      ];

      onMessagesChange(nextMessages);
      onDraftChange('');

      try {
        const response = await sendChatMessage({
          sessionId,
          messages: nextMessages.slice(-MAX_HISTORY_MESSAGES),
        });

        handleAiResponse(response, nextMessages);
      } catch (error) {
        const status =
          error && typeof error === 'object' && 'status' in error
            ? (error as { status?: unknown }).status
            : undefined;

        if (typeof status === 'number') {
          appendAssistantMessage(
            `Sorry — the assistant request failed (${status}). Try again.`,
            nextMessages
          );
        } else {
          appendAssistantMessage(
            'Sorry — I could not reach the assistant. Try again.',
            nextMessages
          );
        }
      }
    },
    [
      appendAssistantMessage,
      isChatPending,
      isRunOperationPending,
      sendChatMessage,
      handleAiResponse,
      onDraftChange,
      onMessagesChange,
      onPendingOperationChange,
      sessionId,
      state.messages,
    ]
  );

  const refreshContractDetailsIfUpdated = async (
    baselineUpdatedAt: string
  ): Promise<void> => {
    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      await sleep(1200);
      const response = await apiClient.banking.getContractDetails({
        params: { sessionId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        continue;
      }

      if (response.body.updatedAt !== baselineUpdatedAt) {
        queryClient.setQueryData(
          ['contract-details', sessionId],
          response.body
        );
        queryClient.invalidateQueries({ queryKey: ['contracts'] });
        return;
      }
    }
  };

  const handleConfirmOperation = () => {
    if (!state.pendingOperation || isRunOperationPending) {
      return;
    }

    const cachedContract = queryClient.getQueryData([
      'contract-details',
      sessionId,
    ]) as { updatedAt?: string } | undefined;
    const baselineUpdatedAt = cachedContract?.updatedAt ?? contractUpdatedAt;

    const operationPayload = [...state.messages];
    runOperationMutate(
      {
        sessionId,
        operation: state.pendingOperation.operation,
        body: state.pendingOperation.request ?? {},
      },
      {
        onSuccess: () => {
          appendAssistantMessage('Done.', operationPayload);
          void refreshContractDetailsIfUpdated(baselineUpdatedAt);
        },
        onError: () => {
          appendAssistantMessage(
            'Sorry — the operation failed to submit.',
            operationPayload
          );
        },
        onSettled: () => {
          onPendingOperationChange(null);
        },
      }
    );
  };

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void sendMessage(state.draft);
    },
    [sendMessage, state.draft]
  );

  const handleCollapseClick = () => {
    onModeChange('collapsed');
  };

  if (!isExpanded) {
    return null;
  }

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      if (typeof messagesContainer.scrollTo === 'function') {
        messagesContainer.scrollTo({
          top: messagesContainer.scrollHeight,
        });
        return;
      }

      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [state.messages.length, isChatPending, state.pendingOperation]);

  const isSendDisabled =
    !state.draft.trim() || isChatPending || isRunOperationPending;
  const isAiPending = isChatPending || isRunOperationPending;

  return (
    <section
      className={sectionClassName}
      role="complementary"
      aria-label="AI chat dock"
    >
      <div className={shellClassName}>
        <div className={contentClassName}>
          <header className={headerClassName}>
            <h2 className="text-base font-semibold text-slate-900">
              Talk with AI
            </h2>
            <div className="flex items-center gap-1">
              <div className="mr-1 flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5">
                <Button
                  type="button"
                  variant={isBottomPlacement ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => onPlacementChange('bottom')}
                  disabled={isBottomPlacement}
                  aria-label="Chat at bottom"
                >
                  Bottom
                </Button>
                <Button
                  type="button"
                  variant={isSidePlacement ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => onPlacementChange('side')}
                  disabled={isSidePlacement}
                  aria-label="Chat at side"
                >
                  Side
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={handleCollapseClick}>
                Collapse
              </Button>
            </div>
          </header>

          {isExpanded && (
            <div
              ref={messagesContainerRef}
              data-testid="ai-chat-messages"
              className={messagesListClassName}
            >
              {state.messages.map(message => {
                const isAssistant = message.role === 'assistant';
                return (
                  <div
                    key={message.id}
                    className={`w-full border border-slate-200 p-4 text-sm text-slate-800 ${
                      isAssistant
                        ? 'bg-[#ccf1cf] rounded-tl-lg rounded-tr-lg rounded-br-lg'
                        : 'bg-[#f5f7fa] rounded-tl-lg rounded-tr-lg rounded-bl-lg'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {message.content}
                    </p>
                    {isAssistant && (
                      <p className="mt-3 text-xs text-slate-600">
                        AI Assistant
                      </p>
                    )}
                  </div>
                );
              })}

              {isChatPending && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Spinner size="sm" color="green" />
                  Thinking...
                </div>
              )}

              {state.pendingOperation && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Confirm operation
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {state.pendingOperation.operation}
                    </p>
                  </div>
                  {payloadPreview && (
                    <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                      {payloadPreview}
                    </pre>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onPendingOperationChange(null)}
                      disabled={isRunOperationPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleConfirmOperation}
                      disabled={isRunOperationPending}
                    >
                      {isRunOperationPending ? 'Submitting...' : 'Confirm'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className={formClassName}>
            <div className="flex-1">
              <Input
                value={state.draft}
                onChange={event => onDraftChange(event.target.value)}
                placeholder="Ask questions about the contract or make operations"
                disabled={isAiPending}
                className="rounded-lg"
                aria-label="AI chat input"
              />
              <p className="sr-only">You are chatting about {documentTitle}</p>
            </div>
            <button
              type="submit"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50"
              disabled={isSendDisabled}
              aria-label="Send message"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M22 2L11 13"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M22 2L15 22l-4-9-9-4 20-7z"
                />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
