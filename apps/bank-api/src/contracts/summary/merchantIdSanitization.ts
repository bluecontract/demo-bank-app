import { z } from 'zod';
import { ContractDocumentSummaryDto } from '@demo-bank-app/shared-bank-api-contract';

const FALLBACK_MERCHANT_LABEL = 'specified merchant';

const sanitizeText = (value: string, merchantIds: string[]) => {
  let next = value;
  merchantIds.forEach(merchantId => {
    const escaped = merchantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(escaped, 'gi'), FALLBACK_MERCHANT_LABEL);
  });
  next = next.replace(
    /\bmerchant\s+specified merchant\b/gi,
    FALLBACK_MERCHANT_LABEL
  );
  return next.replace(/\s{2,}/g, ' ').trim();
};

const sanitizeTextArray = (values: string[], merchantIds: string[]) =>
  values.map(value => sanitizeText(value, merchantIds));

const collectMerchantIds = (
  value: unknown,
  keyPath: string[] = [],
  out = new Set<string>()
) => {
  if (typeof value === 'string') {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? '';
    if (key.includes('merchantid')) {
      const trimmed = value.trim();
      if (trimmed) {
        out.add(trimmed);
      }
    }
    return out;
  }

  if (!value || typeof value !== 'object') {
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectMerchantIds(item, keyPath, out));
    return out;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
    collectMerchantIds(child, [...keyPath, key], out)
  );
  return out;
};

export const collectMerchantIdsFromFacts = (facts: unknown): string[] =>
  Array.from(collectMerchantIds(facts));

export const sanitizeMerchantIdsInSummary = (
  summary: z.infer<typeof ContractDocumentSummaryDto>,
  merchantIds: string[]
): z.infer<typeof ContractDocumentSummaryDto> => {
  if (!merchantIds.length) {
    return summary;
  }

  return {
    ...summary,
    story: {
      ...summary.story,
      headline: sanitizeText(summary.story.headline, merchantIds),
      overview: sanitizeTextArray(summary.story.overview, merchantIds),
      bullets: sanitizeTextArray(summary.story.bullets, merchantIds),
    },
    listPreview: sanitizeText(summary.listPreview, merchantIds),
    nextSteps: {
      ...summary.nextSteps,
      title: sanitizeText(summary.nextSteps.title, merchantIds),
      items: sanitizeTextArray(summary.nextSteps.items, merchantIds),
    },
    lastChange: {
      short: sanitizeText(summary.lastChange.short, merchantIds),
      more: sanitizeText(summary.lastChange.more, merchantIds),
    },
  };
};
