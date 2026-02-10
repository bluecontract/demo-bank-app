import type { z } from 'zod';
import { ContractDocumentSummaryDto } from '@demo-bank-app/shared-bank-api-contract';

type RecordValue = Record<string, unknown>;

export type PayNoteSummaryMockAction = {
  title?: string;
  summary?: string;
  left?: string;
  right?: string;
};

export type PayNoteSummaryMockConfig = {
  enabled: boolean;
  summary?: string;
  details?: string;
  action?: PayNoteSummaryMockAction;
};

const toRecord = (value: unknown): RecordValue | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RecordValue;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  const record = toRecord(value);
  if (record && typeof record.value === 'boolean') {
    return record.value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return null;
};

const toText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const record = toRecord(value);
  if (record && typeof record.value === 'string') {
    const trimmed = record.value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
};

const toAction = (value: unknown): PayNoteSummaryMockAction | undefined => {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }

  const action: PayNoteSummaryMockAction = {
    title: toText(record.title),
    summary: toText(record.summary),
    left: toText(record.left),
    right: toText(record.right),
  };

  return Object.values(action).some(Boolean) ? action : undefined;
};

const buildSummary = (input: {
  headline: string;
  overview: string;
}): z.infer<typeof ContractDocumentSummaryDto> => {
  return {
    story: {
      headline: input.headline,
      overview: [input.overview],
      bullets: [],
    },
    listPreview: input.headline,
    nextSteps: {
      title: 'Next steps',
      items: [],
    },
    lastChange: {
      short: input.headline,
      more: input.headline,
    },
  };
};

export const getPayNoteSummaryMockConfig = (
  document: unknown
): PayNoteSummaryMockConfig => {
  const record = toRecord(document);
  if (!record) {
    return { enabled: false };
  }

  const flag = toBoolean(record.LLM_SUMMARY_DISABLED);
  if (!flag) {
    return { enabled: false };
  }

  const description = toRecord(record.payNoteInitialStateDescription);
  const summary = toText(description?.summary);
  const details = toText(description?.details);
  const action = toAction(description?.action);

  return {
    enabled: true,
    summary,
    details,
    ...(action ? { action } : {}),
  };
};

export const buildMockContractSummary = (input: {
  config: PayNoteSummaryMockConfig;
  fallbackHeadline: string;
}) => {
  const headline = input.config.summary ?? input.fallbackHeadline;
  const overview = input.config.details ?? input.config.summary ?? headline;
  return buildSummary({ headline, overview });
};

export const buildMockProposalSummary = (input: {
  config: PayNoteSummaryMockConfig;
  fallbackHeadline: string;
}) => {
  const headline = input.config.summary ?? input.fallbackHeadline;
  const overview = input.config.summary ?? input.config.details ?? headline;
  return buildSummary({ headline, overview });
};
