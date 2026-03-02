import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Spinner } from '../../../ui/Spinner';
import type {
  ContractAiChatMessage,
  ContractAiChatResponse,
} from '../../../types/api';
import { useContractAiChat } from '../hooks/useContractAiChat';
import { useRunContractOperation } from '../hooks/useRunContractOperation';

type ChatMessage = ContractAiChatMessage & { id: string };

type PendingOperation = {
  operation: string;
  request?: unknown;
};

type ChatStoragePayloadV1 = {
  version: 1;
  messages: ChatMessage[];
  draft: string;
  pendingOperation: PendingOperation | null;
  updatedAt: string;
};

type ContractAiChatDrawerProps = {
  isOpen: boolean;
  sessionId: string;
  documentTitle: string;
  contractUpdatedAt: string;
  userId?: string | null;
  onClose: () => void;
};

const MAX_HISTORY_MESSAGES = 20;
const CHAT_STORAGE_VERSION = 1;

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

const createGreetingMessage = (documentTitle: string): ChatMessage => ({
  id: createId(),
  role: 'assistant',
  content: `How can I help you? I know everything about the document: “${documentTitle}”.`,
});

const isValidMessage = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === 'string' &&
    (message.role === 'assistant' || message.role === 'user') &&
    typeof message.content === 'string'
  );
};

const sanitizePendingOperation = (value: unknown): PendingOperation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const pendingOperation = value as Partial<PendingOperation>;
  if (typeof pendingOperation.operation !== 'string') {
    return null;
  }

  return {
    operation: pendingOperation.operation,
    request: pendingOperation.request,
  };
};

const readStoredChat = (storageKey: string): ChatStoragePayloadV1 | null => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ChatStoragePayloadV1>;
    if (
      parsed.version !== CHAT_STORAGE_VERSION ||
      !Array.isArray(parsed.messages) ||
      typeof parsed.draft !== 'string'
    ) {
      return null;
    }

    const messages = parsed.messages.filter(isValidMessage);
    if (messages.length === 0) {
      return null;
    }

    return {
      version: CHAT_STORAGE_VERSION,
      messages,
      draft: parsed.draft,
      pendingOperation: sanitizePendingOperation(parsed.pendingOperation),
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Failed to restore contract AI chat state', error);
    return null;
  }
};

export function ContractAiChatDrawer({
  isOpen,
  sessionId,
  documentTitle,
  contractUpdatedAt,
  userId,
  onClose,
}: ContractAiChatDrawerProps) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingOperation, setPendingOperation] =
    useState<PendingOperation | null>(null);
  const [isStorageHydrated, setStorageHydrated] = useState(false);
  const chat = useContractAiChat();
  const runOperation = useRunContractOperation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatResetRef = useRef<(() => void) | undefined>(undefined);
  const runOperationResetRef = useRef<(() => void) | undefined>(undefined);
  const storageKey = useMemo(
    () => `demo-bank-contract-ai-chat:v1:${userId ?? 'anonymous'}:${sessionId}`,
    [sessionId, userId]
  );

  const appendAssistantMessage = (text: string) => {
    setMessages(prev => [
      ...prev,
      { id: createId(), role: 'assistant', content: text },
    ]);
  };

  const handleAiResponse = (response: ContractAiChatResponse) => {
    appendAssistantMessage(response.assistantMessage);

    if (response.status === 'ready') {
      if (!response.operationRequest) {
        appendAssistantMessage(
          'Sorry — I could not understand the operation request. Please try again.'
        );
        setPendingOperation(null);
        return;
      }

      setPendingOperation({
        operation: response.operationRequest.operation,
        request: response.operationRequest.request,
      });
      return;
    }

    setPendingOperation(null);
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending || runOperation.isPending) {
      return;
    }

    setPendingOperation(null);

    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: createId(), role: 'user', content: trimmed },
    ];

    setMessages(nextMessages);
    setDraft('');

    try {
      const response = await chat.mutateAsync({
        sessionId,
        messages: nextMessages.slice(-MAX_HISTORY_MESSAGES),
      });

      handleAiResponse(response);
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? (error as { status?: unknown }).status
          : undefined;

      if (typeof status === 'number') {
        appendAssistantMessage(
          `Sorry — the assistant request failed (${status}). Try again.`
        );
        return;
      }

      appendAssistantMessage(
        'Sorry — I could not reach the assistant. Try again.'
      );
    }
  };

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

  const handleConfirmOperation = async () => {
    if (!pendingOperation || runOperation.isPending) {
      return;
    }

    const cachedContract = queryClient.getQueryData([
      'contract-details',
      sessionId,
    ]) as { updatedAt?: string } | undefined;
    const baselineUpdatedAt = cachedContract?.updatedAt ?? contractUpdatedAt;

    runOperation.mutate(
      {
        sessionId,
        operation: pendingOperation.operation,
        body: pendingOperation.request ?? {},
      },
      {
        onSuccess: () => {
          appendAssistantMessage('Done.');
          void refreshContractDetailsIfUpdated(baselineUpdatedAt);
        },
        onError: () => {
          appendAssistantMessage('Sorry — the operation failed to submit.');
        },
        onSettled: () => {
          setPendingOperation(null);
        },
      }
    );
  };

  useEffect(() => {
    chatResetRef.current = chat.reset;
  }, [chat.reset]);

  useEffect(() => {
    runOperationResetRef.current = runOperation.reset;
  }, [runOperation.reset]);

  useEffect(() => {
    setStorageHydrated(false);
    chatResetRef.current?.();
    runOperationResetRef.current?.();

    const stored = readStoredChat(storageKey);
    if (stored) {
      setMessages(stored.messages);
      setDraft(stored.draft);
      setPendingOperation(stored.pendingOperation);
      setStorageHydrated(true);
      return;
    }

    setMessages([createGreetingMessage(documentTitle)]);
    setDraft('');
    setPendingOperation(null);
    setStorageHydrated(true);
  }, [storageKey, documentTitle]);

  useEffect(() => {
    if (!isStorageHydrated) {
      return;
    }

    const payload: ChatStoragePayloadV1 = {
      version: CHAT_STORAGE_VERSION,
      messages,
      draft,
      pendingOperation,
      updatedAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist contract AI chat state', error);
    }
  }, [isStorageHydrated, messages, draft, pendingOperation, storageKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const payloadPreview = pendingOperation
    ? formatJson(pendingOperation.request ?? {})
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4 py-4 lg:items-stretch lg:justify-start lg:px-0 lg:py-0">
      <div
        className="w-full max-w-[720px] h-full max-h-full bg-[color:var(--color-surface)] flex flex-col rounded-2xl overflow-hidden lg:rounded-none"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Talk with AI"
      >
        <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-200 bg-white/80">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
            {`Talk with AI: ${documentTitle}`}
          </h2>
          <button
            type="button"
            className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-600 hover:text-slate-900"
            onClick={onClose}
            aria-label="Close"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-[#f5f7fa]">
          {messages.map(message => {
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
                  <p className="mt-3 text-xs text-slate-600">AI Assistant</p>
                )}
              </div>
            );
          })}

          {chat.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Spinner size="sm" color="green" />
              Thinking...
            </div>
          )}

          {pendingOperation && (
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Confirm operation
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {pendingOperation.operation}
                </p>
              </div>
              {payloadPreview && (
                <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-700">
                  {payloadPreview}
                </pre>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingOperation(null)}
                  disabled={runOperation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConfirmOperation}
                  disabled={runOperation.isPending}
                >
                  {runOperation.isPending ? 'Submitting...' : 'Confirm'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="p-4 border-t border-slate-200 bg-white/80">
          <form
            className="flex items-center gap-2"
            onSubmit={event => {
              event.preventDefault();
              void sendMessage(draft);
            }}
          >
            <div className="flex-1">
              <Input
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder="Ask questions about the contract or make operations"
                disabled={chat.isPending || runOperation.isPending}
                className="rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50"
              disabled={
                !draft.trim() || chat.isPending || runOperation.isPending
              }
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
        </footer>
      </div>

      <div
        className="hidden lg:block flex-1"
        role="presentation"
        onClick={() => {
          if (!runOperation.isPending) {
            onClose();
          }
        }}
      />
    </div>
  );
}
