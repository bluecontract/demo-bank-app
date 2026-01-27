import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const notifyReviewedChange = (
  next: Record<string, string>,
  sourceId?: string
) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(REVIEWED_EVENT, { detail: { map: next, sourceId } })
  );
};

const writeReviewedMap = (next: Record<string, string>, sourceId?: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(REVIEWED_KEY, JSON.stringify(next));
  notifyReviewedChange(next, sourceId);
};

export const useContractReviewState = () => {
  const initialReviewedMap = useMemo(() => readReviewedMap(), []);
  const instanceIdRef = useRef(
    `contracts-reviewed-${Math.random().toString(36).slice(2)}`
  );
  const reviewedMapRef = useRef(initialReviewedMap);
  const [reviewedMap, setReviewedMap] =
    useState<Record<string, string>>(initialReviewedMap);

  useEffect(() => {
    reviewedMapRef.current = reviewedMap;
  }, [reviewedMap]);

  const markReviewed = useCallback((contract: ContractSummary) => {
    const key = getContractKey(contract);
    if (!key) {
      return;
    }

    const timestamp = contract.updatedAt ?? new Date().toISOString();
    const next = { ...reviewedMapRef.current, [key]: timestamp };
    reviewedMapRef.current = next;
    setReviewedMap(next);
    writeReviewedMap(next, instanceIdRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          map?: Record<string, string>;
          sourceId?: string;
        }>
      ).detail;
      if (detail?.sourceId === instanceIdRef.current) {
        return;
      }
      const next = detail?.map ?? readReviewedMap();
      reviewedMapRef.current = next;
      setReviewedMap(next);
    };

    window.addEventListener(REVIEWED_EVENT, handleChange);
    return () => window.removeEventListener(REVIEWED_EVENT, handleChange);
  }, []);

  return { reviewedMap, markReviewed };
};
