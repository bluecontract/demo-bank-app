import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContractAiChatMessage } from '../../../types/api';

const STORAGE_KEY_PREFIX = 'demo-bank-contract-ai-chat';
const STORAGE_VERSION = 1 as const;
const STORAGE_STATE_VERSION = `${STORAGE_KEY_PREFIX}:v${STORAGE_VERSION}`;

export type ContractAiChatDockMode = 'minimized' | 'collapsed' | 'expanded';

export type ContractAiChatDockMessage = ContractAiChatMessage & {
  id: string;
};

export type ContractAiChatDockPendingOperation = {
  operation: string;
  request?: unknown;
} | null;

export type ContractAiChatDockState = {
  version: typeof STORAGE_VERSION;
  mode: ContractAiChatDockMode;
  messages: ContractAiChatDockMessage[];
  draft: string;
  pendingOperation: ContractAiChatDockPendingOperation;
  updatedAt: string;
};

type UseContractAiChatDockStateArgs = {
  sessionId: string | null;
  userId?: string | null;
  documentTitle: string;
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createWelcomeMessage = (
  documentTitle: string
): ContractAiChatDockMessage => {
  const title = documentTitle.trim() || 'this document';

  return {
    id: createId(),
    role: 'assistant',
    content: `How can I help you? I know everything about the document: “${title}”.`,
  };
};

const getStorageKey = (sessionId: string | null, userId?: string | null) => {
  if (!sessionId) {
    return null;
  }

  return `${STORAGE_STATE_VERSION}:${
    userId?.trim() || 'anonymous'
  }:${sessionId}`;
};

const isChatMessage = (value: unknown): value is ContractAiChatDockMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof (value as ContractAiChatDockMessage).id === 'string' &&
    ((value as ContractAiChatDockMessage).role === 'user' ||
      (value as ContractAiChatDockMessage).role === 'assistant') &&
    typeof (value as ContractAiChatDockMessage).content === 'string'
  );
};

const isDockMode = (value: unknown): value is ContractAiChatDockMode => {
  return value === 'minimized' || value === 'collapsed' || value === 'expanded';
};

const normalizeMessages = (value: unknown): ContractAiChatDockMessage[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isChatMessage);
};

const normalizePendingOperation = (
  value: unknown
): ContractAiChatDockPendingOperation => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { operation?: unknown; request?: unknown };

  if (
    typeof candidate.operation !== 'string' ||
    candidate.operation.length === 0
  ) {
    return null;
  }

  return {
    operation: candidate.operation,
    request: candidate.request,
  };
};

const normalizeState = (
  input: unknown,
  documentTitle: string
): ContractAiChatDockState => {
  if (!input || typeof input !== 'object') {
    return {
      version: STORAGE_VERSION,
      mode: 'collapsed',
      messages: [createWelcomeMessage(documentTitle)],
      draft: '',
      pendingOperation: null,
      updatedAt: new Date().toISOString(),
    };
  }

  const state = input as Record<string, unknown>;
  const rawMode = state.mode;
  const rawMessages = normalizeMessages(state.messages);
  const rawDraft = state.draft;
  const rawPending = normalizePendingOperation(state.pendingOperation);
  const draft = typeof rawDraft === 'string' ? rawDraft : '';
  const messages =
    rawMessages.length > 0
      ? rawMessages
      : [createWelcomeMessage(documentTitle)];
  const mode = isDockMode(rawMode) ? rawMode : 'collapsed';

  return {
    version: STORAGE_VERSION,
    mode,
    messages,
    draft,
    pendingOperation: rawPending,
    updatedAt:
      typeof state.updatedAt === 'string'
        ? state.updatedAt
        : new Date().toISOString(),
  };
};

const buildDefaultState = (documentTitle: string): ContractAiChatDockState => ({
  version: STORAGE_VERSION,
  mode: 'collapsed',
  messages: [createWelcomeMessage(documentTitle)],
  draft: '',
  pendingOperation: null,
  updatedAt: new Date().toISOString(),
});

const readPersistedState = (
  storageKey: string | null,
  documentTitle: string
): ContractAiChatDockState => {
  if (!storageKey || typeof window === 'undefined') {
    return buildDefaultState(documentTitle);
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return buildDefaultState(documentTitle);
    }

    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== STORAGE_VERSION
    ) {
      return buildDefaultState(documentTitle);
    }

    return normalizeState(parsed, documentTitle);
  } catch {
    return buildDefaultState(documentTitle);
  }
};

export const parseContractAiChatDockState = (
  raw: string,
  documentTitle: string
): ContractAiChatDockState | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== STORAGE_VERSION
    ) {
      return null;
    }

    return normalizeState(parsed, documentTitle);
  } catch {
    return null;
  }
};

export const useContractAiChatDockState = ({
  sessionId,
  userId,
  documentTitle,
}: UseContractAiChatDockStateArgs) => {
  const storageKey = useMemo(
    () => getStorageKey(sessionId, userId),
    [sessionId, userId]
  );

  const [state, setState] = useState<ContractAiChatDockState>(() => {
    return readPersistedState(storageKey, documentTitle);
  });

  useEffect(() => {
    setState(readPersistedState(storageKey, documentTitle));
  }, [storageKey, documentTitle]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage may fail in restricted environments.
    }
  }, [state, storageKey]);

  const setMode = useCallback((mode: ContractAiChatDockMode) => {
    setState(previous => ({
      ...previous,
      mode,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const setDraft = useCallback((draft: string) => {
    setState(previous => ({
      ...previous,
      draft,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const setMessages = useCallback((messages: ContractAiChatDockMessage[]) => {
    setState(previous => ({
      ...previous,
      messages,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const setPendingOperation = useCallback(
    (pendingOperation: ContractAiChatDockPendingOperation) => {
      setState(previous => ({
        ...previous,
        pendingOperation,
        version: STORAGE_VERSION,
        updatedAt: new Date().toISOString(),
      }));
    },
    []
  );

  return {
    state,
    setMode,
    setDraft,
    setMessages,
    setPendingOperation,
  };
};
