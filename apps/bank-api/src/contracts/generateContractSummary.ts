import { ServerInferRequest } from '@ts-rest/core';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  bankApiContract,
  ContractDocumentSummaryDto,
} from '@demo-bank-app/shared-bank-api-contract';
import type {
  ContractRecord,
  ContractRepository,
} from '@demo-bank-app/contracts';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { buildContractSummaryPrompt } from './summaryPrompts';
import {
  ContractSummaryInputError,
  isOpenAiContextLimitError,
} from './summaryUtils';
import { buildContractSummaryFacts } from './summary/buildFacts';
import {
  runStructuredSummaryWithMerchantLookup,
  type MerchantDirectoryLookupRepository,
} from './summary/merchantNameToolCalling';
import {
  buildMockContractSummary,
  getPayNoteSummaryMockConfig,
} from './payNoteSummaryMock';

const DEFAULT_MODEL = 'gpt-5';
const SUMMARY_TIMEOUT_MS = Number(
  process.env.CONTRACT_SUMMARY_TIMEOUT_MS ?? '45000'
);
const SUMMARY_TIMEOUT = Number.isFinite(SUMMARY_TIMEOUT_MS)
  ? SUMMARY_TIMEOUT_MS
  : 45000;

const SYSTEM_PROMPT = buildContractSummaryPrompt();

const normalizeSummaryText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveSummaryPreview = (input: {
  summary?: z.infer<typeof ContractDocumentSummaryDto> | null;
  fallbackPreview?: string | null;
}): string | undefined =>
  normalizeSummaryText(input.summary?.story?.headline) ??
  normalizeSummaryText(input.summary?.lastChange?.short) ??
  normalizeSummaryText(input.summary?.listPreview) ??
  normalizeSummaryText(input.fallbackPreview);

const getJsonSizeBytes = (value: unknown): number => {
  if (value === undefined) {
    return 0;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return -1;
  }
};

const isDynamoItemSizeError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message =
    'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return message.includes('Item size has exceeded the maximum allowed size');
};

const isFiniteInteger = (value: number) =>
  Number.isFinite(value) && Number.isInteger(value);

const parseSourceEpoch = (value: unknown): number | undefined => {
  if (typeof value === 'number' && isFiniteInteger(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.value === 'number' && isFiniteInteger(record.value)) {
    return record.value;
  }
  if (typeof record.epoch === 'number' && isFiniteInteger(record.epoch)) {
    return record.epoch;
  }
  if (
    record.epoch &&
    typeof record.epoch === 'object' &&
    typeof (record.epoch as Record<string, unknown>).value === 'number'
  ) {
    const nestedEpochValue = (record.epoch as Record<string, unknown>)
      .value as number;
    if (isFiniteInteger(nestedEpochValue)) {
      return nestedEpochValue;
    }
  }
  return undefined;
};

const resolveSummarySourceEpoch = (contract: ContractRecord): number => {
  const fromSummary = parseSourceEpoch(contract.summarySourceEpoch);
  if (fromSummary !== undefined) {
    return fromSummary;
  }
  const fromTriggerEvent = parseSourceEpoch(contract.triggerEvent);
  if (fromTriggerEvent !== undefined) {
    return fromTriggerEvent;
  }
  return 0;
};

type OpenAiResponsesParseResult = Awaited<
  ReturnType<OpenAI['responses']['parse']>
>;

const parseSummary = (response: OpenAiResponsesParseResult) => {
  const parsed = (response as { output_parsed?: unknown }).output_parsed;
  if (!parsed) {
    throw new Error('Summary missing in provider response.');
  }

  return ContractDocumentSummaryDto.parse(parsed);
};

type ContractSummaryGenerationResult = {
  summary: z.infer<typeof ContractDocumentSummaryDto>;
  summaryUpdatedAt: string;
  summarySourceUpdatedAt: string;
  summaryInputBlueId?: string;
  cached: boolean;
  model?: string;
};

const generateOrLoadContractSummary = async (input: {
  contract: ContractRecord;
  force: boolean;
  historyEventId?: string;
  merchantDirectoryRepository?: MerchantDirectoryLookupRepository;
  contractRepository: Pick<
    ContractRepository,
    'updateContractSummary' | 'addContractHistoryEntry' | 'listContractHistory'
  >;
  getOpenAiApiKey: () => Promise<string>;
  logger?: PowertoolsLogger;
}): Promise<ContractSummaryGenerationResult> => {
  const contract = input.contract;

  if (!contract.document) {
    throw new ContractSummaryInputError('Contract document not available');
  }

  const parsedSummary = ContractDocumentSummaryDto.safeParse(contract.summary);
  const cachedSummary = parsedSummary.success ? parsedSummary.data : null;
  const cachedSummaryPreview = resolveSummaryPreview({
    summary: cachedSummary,
    fallbackPreview: contract.summaryPreview,
  });
  const previousSummary = cachedSummary ?? undefined;
  const model = process.env.CONTRACT_SUMMARY_MODEL || DEFAULT_MODEL;
  const summarySourceEpoch = resolveSummarySourceEpoch(contract);
  const mockConfig = getPayNoteSummaryMockConfig(contract.document);

  if (mockConfig.enabled) {
    const mockSummary = buildMockContractSummary({
      config: mockConfig,
      fallbackHeadline: contract.displayName || 'Contract',
    });
    const now = new Date().toISOString();
    const summarySourceUpdatedAt = contract.updatedAt;

    await input.contractRepository.updateContractSummary({
      contractId: contract.contractId,
      summary: mockSummary,
      summaryPreview: resolveSummaryPreview({ summary: mockSummary }),
      summaryUpdatedAt: now,
      summarySourceUpdatedAt,
      summarySourceEpoch,
      summaryInputBlueId: null,
      summaryModel: null,
      summaryError: null,
      summaryDocumentName: contract.documentName,
      summaryStatus: contract.status,
      summaryStatusUpdatedAt: contract.statusUpdatedAt,
      summaryStatusTimestamps: contract.statusTimestamps,
      userId: contract.userId,
      relatedTransactionIds: contract.relatedTransactionIds,
      relatedHoldIds: contract.relatedHoldIds,
    });

    const historyShort = mockConfig.summary ?? mockSummary.listPreview;
    const historyMore = mockConfig.summary ?? mockSummary.listPreview;
    const historyId = input.historyEventId ?? `mock:${contract.updatedAt}`;
    const historyEntries = await input.contractRepository.listContractHistory(
      contract.contractId
    );
    const hasExistingId = historyEntries.some(entry => entry.id === historyId);

    if (!hasExistingId) {
      await input.contractRepository.addContractHistoryEntry({
        contractId: contract.contractId,
        kind: 'contractUpdated',
        short: historyShort,
        more: historyMore,
        createdAt: contract.updatedAt,
        id: historyId,
      });
    }

    return {
      summary: mockSummary,
      summaryUpdatedAt: now,
      summarySourceUpdatedAt,
      cached: false,
    };
  }

  try {
    const { facts, summaryInputBlueId, triggerEventMeta } =
      buildContractSummaryFacts({
        contract: {
          contractId: contract.contractId,
          typeBlueId: contract.typeBlueId,
          displayName: contract.displayName,
          sessionId: contract.sessionId,
          documentId: contract.documentId,
          status: contract.status,
          statusUpdatedAt: contract.statusUpdatedAt,
          statusTimestamps: contract.statusTimestamps,
          updatedAt: contract.updatedAt,
          document: contract.document,
          triggerEvent: contract.triggerEvent,
          emittedEvents: contract.emittedEvents,
          previousSummary,
        },
      });

    if (
      !input.force &&
      cachedSummary &&
      !contract.summaryError &&
      contract.summaryUpdatedAt
    ) {
      const hasMatchingSummaryInput =
        contract.summaryInputBlueId &&
        contract.summaryInputBlueId === summaryInputBlueId;
      const hasMatchingTimestamp =
        !contract.summaryInputBlueId &&
        contract.summarySourceUpdatedAt === contract.updatedAt;
      if (hasMatchingSummaryInput || hasMatchingTimestamp) {
        const summarySourceUpdatedAt =
          contract.summarySourceUpdatedAt ?? contract.updatedAt;
        await input.contractRepository.updateContractSummary({
          contractId: contract.contractId,
          summaryPreview: cachedSummaryPreview,
          summaryUpdatedAt: contract.summaryUpdatedAt,
          summarySourceUpdatedAt,
          summarySourceEpoch,
          summaryInputBlueId: contract.summaryInputBlueId ?? summaryInputBlueId,
          summaryError: null,
          summaryDocumentName: contract.documentName,
          userId: contract.userId,
          relatedTransactionIds: contract.relatedTransactionIds,
          relatedHoldIds: contract.relatedHoldIds,
        });

        return {
          summary: cachedSummary,
          summaryUpdatedAt: contract.summaryUpdatedAt,
          summarySourceUpdatedAt,
          summaryInputBlueId: contract.summaryInputBlueId ?? summaryInputBlueId,
          cached: true,
          model: contract.summaryModel,
        };
      }
    }

    const apiKey = await input.getOpenAiApiKey();
    const client = new OpenAI({ apiKey });

    const payload = `<facts>\n${JSON.stringify(facts)}\n</facts>`;

    input.logger?.debug?.('Contract summary LLM input', {
      contractId: contract.contractId,
      sessionId: contract.sessionId,
      summaryInputBlueId,
      model,
      systemPrompt: SYSTEM_PROMPT,
      facts,
      payload,
    });

    const response = await runStructuredSummaryWithMerchantLookup({
      client,
      model,
      systemPrompt: SYSTEM_PROMPT,
      facts,
      schema: ContractDocumentSummaryDto,
      schemaName: 'ContractDocumentSummary',
      timeoutMs: SUMMARY_TIMEOUT,
      merchantDirectoryRepository: input.merchantDirectoryRepository,
      logger: input.logger,
      logContext: {
        contractId: contract.contractId,
        sessionId: contract.sessionId,
      },
    });

    const summary = parseSummary(response);
    const now = new Date().toISOString();

    const summaryPreview = resolveSummaryPreview({ summary });

    const summarySnapshotPayload = {
      summaryStatus: contract.status,
      summaryStatusUpdatedAt: contract.statusUpdatedAt,
      summaryStatusTimestamps: contract.statusTimestamps,
      summarySourceUpdatedAt: contract.updatedAt,
      summarySourceEpoch,
      summaryUpdatedAt: now,
      summaryInputBlueId,
      summaryDocumentName: contract.documentName,
    };
    const snapshotSizeBytes = getJsonSizeBytes(summarySnapshotPayload);
    input.logger?.debug?.('Contract summary snapshot size', {
      contractId: contract.contractId,
      sessionId: contract.sessionId,
      snapshotSizeBytes,
    });

    try {
      await input.contractRepository.updateContractSummary({
        contractId: contract.contractId,
        summary,
        summaryPreview,
        summaryUpdatedAt: now,
        summarySourceUpdatedAt: contract.updatedAt,
        summarySourceEpoch,
        summaryInputBlueId,
        summaryModel: model,
        summaryError: null,
        summaryDocumentName: contract.documentName,
        summaryStatus: contract.status,
        summaryStatusUpdatedAt: contract.statusUpdatedAt,
        summaryStatusTimestamps: contract.statusTimestamps,
        userId: contract.userId,
        relatedTransactionIds: contract.relatedTransactionIds,
        relatedHoldIds: contract.relatedHoldIds,
      });
    } catch (error) {
      if (isDynamoItemSizeError(error)) {
        input.logger?.error?.('Contract summary snapshot exceeds size limit', {
          contractId: contract.contractId,
          sessionId: contract.sessionId,
          snapshotSizeBytes,
          fieldSizes: {
            summaryStatus: getJsonSizeBytes(contract.status),
            summaryStatusUpdatedAt: getJsonSizeBytes(contract.statusUpdatedAt),
            summaryStatusTimestamps: getJsonSizeBytes(
              contract.statusTimestamps
            ),
            summarySourceUpdatedAt: getJsonSizeBytes(contract.updatedAt),
            summarySourceEpoch: getJsonSizeBytes(summarySourceEpoch),
            summaryUpdatedAt: getJsonSizeBytes(now),
            summaryInputBlueId: getJsonSizeBytes(summaryInputBlueId),
            summaryDocumentName: getJsonSizeBytes(contract.documentName),
            summary: getJsonSizeBytes(summary),
          },
        });
      }
      throw error;
    }

    const historyShort = summary.lastChange.short || summary.listPreview;
    const historyMore = summary.lastChange.more;
    const historyKind = 'contractUpdated' as const;
    const historyEntries = await input.contractRepository.listContractHistory(
      contract.contractId
    );
    const triggerMeta = triggerEventMeta ?? null;
    const historyId =
      input.historyEventId ??
      triggerMeta?.blueId ??
      `init:${contract.documentId ?? contract.contractId}`;
    const historyCreatedAt = triggerMeta?.createdAt ?? contract.updatedAt;
    const hasExistingId = historyEntries.some(entry => entry.id === historyId);

    if (!hasExistingId) {
      await input.contractRepository.addContractHistoryEntry({
        contractId: contract.contractId,
        kind: historyKind,
        short: historyShort,
        more: historyMore,
        createdAt: historyCreatedAt,
        id: historyId,
      });
    }

    return {
      summary,
      summaryUpdatedAt: now,
      summarySourceUpdatedAt: contract.updatedAt,
      summaryInputBlueId,
      cached: false,
      model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await input.contractRepository.updateContractSummary({
      contractId: contract.contractId,
      summarySourceUpdatedAt: contract.updatedAt,
      summarySourceEpoch,
      summaryError: message,
    });

    throw error;
  }
};

export const prefetchContractSummaryForSessionId = async (input: {
  sessionId: string;
  merchantDirectoryRepository?: MerchantDirectoryLookupRepository;
  contractRepository: Pick<
    ContractRepository,
    | 'getContractBySessionId'
    | 'updateContractSummary'
    | 'addContractHistoryEntry'
    | 'listContractHistory'
  >;
  getOpenAiApiKey: () => Promise<string>;
  logger: PowertoolsLogger;
}) => {
  try {
    const contract = await input.contractRepository.getContractBySessionId(
      input.sessionId
    );

    if (!contract?.document) {
      return;
    }

    const parsedSummary = ContractDocumentSummaryDto.safeParse(
      contract.summary
    );
    const hasSummary =
      parsedSummary.success && Boolean(contract.summaryPreview);

    if (hasSummary || contract.summaryError) {
      return;
    }

    await generateOrLoadContractSummary({
      contract,
      force: false,
      merchantDirectoryRepository: input.merchantDirectoryRepository,
      contractRepository: input.contractRepository,
      getOpenAiApiKey: input.getOpenAiApiKey,
      logger: input.logger,
    });

    input.logger.info('Prefetched contract summary', {
      sessionId: input.sessionId,
      contractId: contract.contractId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.error('Failed to prefetch contract summary', {
      sessionId: input.sessionId,
      error: message,
    });
  }
};

export const generateContractSummaryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['generateContractSummary']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    contractRepository,
    logger,
    getOpenAiApiKey,
    merchantDirectoryRepository,
  } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;
  const force = Boolean(request.body?.force);

  logger.info('Generating contract summary', { userId, sessionId, force });

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  if (!contract.document) {
    return problemResponse({
      status: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Contract document not available',
    });
  }

  if (!force) {
    const cachedSummary = ContractDocumentSummaryDto.safeParse(
      contract.summary
    );
    if (cachedSummary.success && contract.summaryUpdatedAt) {
      return {
        status: 200 as const,
        body: {
          summary: cachedSummary.data,
          summaryUpdatedAt: contract.summaryUpdatedAt,
          summarySourceUpdatedAt:
            contract.summarySourceUpdatedAt ?? contract.updatedAt,
          summaryInputBlueId: contract.summaryInputBlueId,
          cached: true,
          model: contract.summaryModel,
        },
      };
    }

    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract summary not available',
    });
  }

  try {
    const result = await generateOrLoadContractSummary({
      contract,
      force,
      merchantDirectoryRepository,
      contractRepository,
      getOpenAiApiKey,
      logger,
    });
    return {
      status: 200 as const,
      body: {
        summary: result.summary,
        summaryUpdatedAt: result.summaryUpdatedAt,
        summarySourceUpdatedAt: result.summarySourceUpdatedAt,
        summaryInputBlueId: result.summaryInputBlueId,
        cached: result.cached,
        model: result.model,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isInputError =
      error instanceof ContractSummaryInputError ||
      isOpenAiContextLimitError(error);
    logger.error('Failed to generate contract summary', {
      userId,
      sessionId,
      error: message,
    });

    return problemResponse({
      status: isInputError ? 400 : 500,
      code: isInputError
        ? ERROR_CODES.VALIDATION_ERROR
        : ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to generate contract summary',
      detail: message,
    });
  }
};

export const generateContractSummaryForSessionId = async (input: {
  sessionId: string;
  force: boolean;
  historyEventId?: string;
  merchantDirectoryRepository?: MerchantDirectoryLookupRepository;
  contractRepository: ContractRepository;
  getOpenAiApiKey: () => Promise<string>;
  logger: PowertoolsLogger;
}): Promise<ContractSummaryGenerationResult | null> => {
  const { sessionId, contractRepository, logger } = input;
  const contract = await contractRepository.getContractBySessionId(sessionId);
  if (!contract) {
    logger.warn('Contract summary skipped (missing contract)', {
      sessionId,
    });
    return null;
  }

  return generateContractSummaryForContract({
    ...input,
    contract,
  });
};

export const generateContractSummaryForContract = async (input: {
  contract: ContractRecord;
  force: boolean;
  historyEventId?: string;
  merchantDirectoryRepository?: MerchantDirectoryLookupRepository;
  contractRepository: ContractRepository;
  getOpenAiApiKey: () => Promise<string>;
  logger: PowertoolsLogger;
}): Promise<ContractSummaryGenerationResult | null> => {
  const { contract, force, contractRepository, getOpenAiApiKey, logger } =
    input;

  if (!contract.document) {
    logger.warn('Contract summary skipped (missing document)', {
      sessionId: contract.sessionId,
      contractId: contract.contractId,
    });
    return null;
  }

  try {
    const result = await generateOrLoadContractSummary({
      contract,
      force,
      historyEventId: input.historyEventId,
      merchantDirectoryRepository: input.merchantDirectoryRepository,
      contractRepository,
      getOpenAiApiKey,
      logger,
    });
    logger.info('Contract summary generated', {
      sessionId: contract.sessionId,
      contractId: contract.contractId,
      cached: result.cached,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate contract summary', {
      sessionId: contract.sessionId,
      contractId: contract.contractId,
      error: message,
    });
    throw error;
  }
};
