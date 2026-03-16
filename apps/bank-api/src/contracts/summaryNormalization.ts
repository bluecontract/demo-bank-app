import { z } from 'zod';
import { ContractDocumentSummaryDto } from '@demo-bank-app/shared-bank-api-contract';

const LegacyContractSummaryDto = z.object({
  title: z.string().optional(),
  oneLiner: z.string().optional(),
  state: z
    .object({
      statusLabel: z.string().optional(),
      explanation: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
  keyFacts: z
    .array(
      z.object({
        label: z.string().optional(),
        value: z.string().optional(),
      })
    )
    .optional(),
  warnings: z.array(z.string()).optional(),
});

const cleanText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const dedupe = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const parseNextSteps = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const steps = lines
    .map(line => line.trim())
    .filter(line => line.startsWith('- ') || line.startsWith('• '))
    .map(line => line.replace(/^[-•]\s+/, '').trim())
    .filter(Boolean);
  return steps;
};

export const normalizeContractSummary = (
  raw: unknown,
  fallbackTitle?: string | null
): z.infer<typeof ContractDocumentSummaryDto> | null => {
  if (!raw) {
    return null;
  }

  const parsedSummary = ContractDocumentSummaryDto.safeParse(raw);
  if (parsedSummary.success) {
    const parsedValue = parsedSummary.data as Record<string, unknown>;
    if (
      parsedValue &&
      typeof parsedValue === 'object' &&
      'story' in parsedValue &&
      'listPreview' in parsedValue &&
      'nextSteps' in parsedValue &&
      'lastChange' in parsedValue
    ) {
      return parsedSummary.data;
    }
  }

  const legacySummary = LegacyContractSummaryDto.safeParse(raw);
  if (!legacySummary.success) {
    return null;
  }

  const legacy = legacySummary.data;
  const fallbackHeadline =
    cleanText(legacy.title) ?? cleanText(fallbackTitle) ?? 'Contract';
  const overviewItems = [
    cleanText(legacy.oneLiner),
    cleanText(legacy.state?.explanation),
  ].filter((value): value is string => Boolean(value));
  const storyOverview =
    overviewItems.length > 0
      ? dedupe(overviewItems)
      : ['Contract update available.'];

  const keyFacts =
    legacy.keyFacts?.flatMap(fact => {
      const label = cleanText(fact.label);
      const value = cleanText(fact.value);
      if (label && value) {
        return [`${label}: ${value}`];
      }
      if (value) {
        return [value];
      }
      return label ? [label] : [];
    }) ?? [];

  const warnings = legacy.warnings?.map(warning => `Warning: ${warning}`) ?? [];

  const storyBullets = dedupe([...keyFacts, ...warnings]);

  const listPreview =
    cleanText(legacy.oneLiner) ??
    cleanText(legacy.state?.statusLabel) ??
    cleanText(legacy.title) ??
    fallbackHeadline;

  const nextStepItems = parseNextSteps(legacy.state?.explanation);
  const nextSteps =
    nextStepItems.length > 0 ? nextStepItems : ['Review the contract details.'];

  const lastChangeShort = cleanText(legacy.state?.statusLabel) ?? listPreview;
  const lastChangeMore =
    cleanText(legacy.state?.explanation) ??
    cleanText(legacy.oneLiner) ??
    listPreview;

  return {
    story: {
      headline: fallbackHeadline,
      overview: storyOverview,
      bullets: storyBullets,
    },
    listPreview,
    nextSteps: {
      title: 'Next steps',
      items: nextSteps,
    },
    lastChange: {
      short: lastChangeShort,
      more: lastChangeMore,
    },
  };
};
