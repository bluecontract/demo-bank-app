import { useCallback, useEffect, useState } from 'react';

const ACTIVE_SESSION_KEY = 'demo-bank-active-contract-session';
const ACTIVE_SESSION_EVENT = 'demo-bank-active-contract-session-change';

const readActiveSessionId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_SESSION_KEY);
};

const notifyActiveSessionChange = (value: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(ACTIVE_SESSION_EVENT, { detail: value })
  );
};

const writeActiveSessionId = (value: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (!value) {
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  } else {
    window.localStorage.setItem(ACTIVE_SESSION_KEY, value);
  }
  notifyActiveSessionChange(value);
};

export const useActiveContractSession = () => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    readActiveSessionId()
  );

  const setActiveSession = useCallback((value: string | null) => {
    setActiveSessionId(value);
    writeActiveSessionId(value);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleChange = (event: Event) => {
      setActiveSessionId(
        (event as CustomEvent<string | null>).detail ?? readActiveSessionId()
      );
    };

    window.addEventListener(ACTIVE_SESSION_EVENT, handleChange);
    return () => window.removeEventListener(ACTIVE_SESSION_EVENT, handleChange);
  }, []);

  return { activeSessionId, setActiveSession };
};
