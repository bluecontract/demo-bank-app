import { useCallback, useEffect, useState } from 'react';
import type { ContractSummary } from '../../../types/api';
import { getContractKey } from '../lib/dedupeContracts';

const REVIEWED_KEY = 'demo-bank-contracts-reviewed';
const REVIEWED_EVENT = 'demo-bank-contracts-reviewed-change';

const readReviewedMap = (): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  const stored = window.localStorage.getItem(REVIEWED_KEY);
  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
  } catch {
    return {};
  }

  return {};
};

const notifyReviewedChange = (next: Record<string, string>) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(REVIEWED_EVENT, { detail: next }));
};

const writeReviewedMap = (next: Record<string, string>) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(REVIEWED_KEY, JSON.stringify(next));
  notifyReviewedChange(next);
};

export const useContractReviewState = () => {
  const [reviewedMap, setReviewedMap] = useState<Record<string, string>>(() =>
    readReviewedMap()
  );

  const markReviewed = useCallback((contract: ContractSummary) => {
    const key = getContractKey(contract);
    if (!key) {
      return;
    }

    const timestamp = contract.updatedAt ?? new Date().toISOString();
    setReviewedMap(prev => {
      const next = { ...prev, [key]: timestamp };
      writeReviewedMap(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleChange = (event: Event) => {
      const next =
        (event as CustomEvent<Record<string, string>>).detail ??
        readReviewedMap();
      setReviewedMap(next);
    };

    window.addEventListener(REVIEWED_EVENT, handleChange);
    return () => window.removeEventListener(REVIEWED_EVENT, handleChange);
  }, []);

  return { reviewedMap, markReviewed };
};
