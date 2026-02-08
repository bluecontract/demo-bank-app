import { ServerInferRequest } from '@ts-rest/core';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  bankApiContract,
  ContractDocumentSummaryDto,
} from '@demo-bank-app/shared-bank-api-contract';
import type { PayNoteDeliveryRecord } from '@demo-bank-app/paynotes';
import { getPayNoteSummaryFromDocument } from '@demo-bank-app/paynotes';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import { buildProposalSummaryPrompt } from '../contracts/summaryPrompts';
import { normalizeContractSummary } from '../contracts/summaryNormalization';
import {
  ContractSummaryInputError,
  buildTypeDefinitionPack,
  collectTypeBlueIdsFromNode,
  findNonTypeBlueIdStubs,
  isOpenAiContextLimitError,
  stripResolvedTypeNodes,
  summaryBlue,
  toBlueNode,
} from '../contracts/summaryUtils';

const DEFAULT_MODEL = 'gpt-5';
const SUMMARY_TIMEOUT_MS = Number(
  process.env.CONTRACT_SUMMARY_TIMEOUT_MS ?? '45000'
);
const SUMMARY_TIMEOUT = Number.isFinite(SUMMARY_TIMEOUT_MS)
  ? SUMMARY_TIMEOUT_MS
  : 45000;

const formatMinorAmount = (amountMinor?: number, currency?: string) => {
  if (typeof amountMinor !== 'number' || Number.isNaN(amountMinor)) {
    return undefined;
  }
  const major = (amountMinor / 100).toFixed(2);
  const normalizedCurrency = currency?.trim().toUpperCase();
  if (!normalizedCurrency || normalizedCurrency === 'USD') {
    return `$${major}`;
  }
  return `${normalizedCurrency} ${major}`;
};

const buildProposalFacts = (input: {
  record: PayNoteDeliveryRecord;
  payNoteDocument: Record<string, unknown>;
}): {
  facts: {
    contract: {
      contractId: string;
      displayName: string;
      typeBlueId: string;
      sessionId?: string;
      documentId?: string;
      status?: string;
      statusUpdatedAt?: string;
      updatedAt: string;
    };
    previousSummary?: z.infer<typeof ContractDocumentSummaryDto>;
    document: Record<string, unknown>;
    types: {
      definitionsByBlueId: Record<string, unknown>;
      typeNameByBlueId: Record<string, string>;
    };
    payNoteSummary?: {
      name?: string;
      amountMinor?: number;
      currency?: string;
      amountDisplay?: string;
    };
    integrationNotes?: string[];
  };
  summaryInputBlueId: string;
} => {
  const { record, payNoteDocument } = input;

  const documentNode = toBlueNode(payNoteDocument);
  if (!documentNode) {
    throw new ContractSummaryInputError(
      'PayNote proposal could not be parsed as a Blue node.'
    );
  }

  let documentSimpleBase: unknown;
  try {
    documentSimpleBase = summaryBlue.nodeToJson(
      stripResolvedTypeNodes(documentNode),
      'simple'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `PayNote proposal could not be serialized to JSON: ${message}`
    );
  }
  if (!documentSimpleBase || typeof documentSimpleBase !== 'object') {
    throw new ContractSummaryInputError(
      'PayNote proposal could not be serialized to a JSON object.'
    );
  }

  const mergedDocument = documentSimpleBase as Record<string, unknown>;

  const stubs = findNonTypeBlueIdStubs(mergedDocument, {
    path: ['document'],
    ignoredStubKeys: new Set(['prevEntry']),
  });
  if (stubs.length) {
    throw new ContractSummaryInputError(
      `PayNote proposal contains non-type {blueId} references which cannot be sent to the LLM: ${stubs
        .slice(0, 5)
        .map(item => `${item.blueId} @ ${item.path}`)
        .join(', ')}${stubs.length > 5 ? ` (+${stubs.length - 5} more)` : ''}`
    );
  }

  let summaryInputBlueId: string;
  try {
    const summaryInputNode = summaryBlue.jsonValueToNode({
      document: mergedDocument,
      deliveryStatus: record.deliveryStatus ?? null,
      clientDecisionStatus: record.clientDecisionStatus ?? null,
      transactionIdentificationStatus:
        record.transactionIdentificationStatus ?? null,
    });
    summaryInputBlueId = summaryBlue.calculateBlueIdSync(summaryInputNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `Unable to calculate summary input blueId: ${message}`
    );
  }

  const referencedTypeIds = new Set<string>();
  const typeBlueId = documentNode.getType()?.getBlueId();
  if (typeBlueId) {
    referencedTypeIds.add(typeBlueId);
  }
  collectTypeBlueIdsFromNode(documentNode, referencedTypeIds);

  const contractsNode = toBlueNode({
    type: (mergedDocument as Record<string, unknown>).type,
    contracts: mergedDocument.contracts,
  });
  if (contractsNode) {
    collectTypeBlueIdsFromNode(contractsNode, referencedTypeIds);
  }

  const typesPack = buildTypeDefinitionPack(referencedTypeIds);
  const payNoteSummary = getPayNoteSummaryFromDocument(payNoteDocument);
  const payNoteAmountDisplay = formatMinorAmount(
    payNoteSummary.amountMinor,
    payNoteSummary.currency
  );
  const displayName = payNoteSummary.name || 'PayNote proposal';

  const previousSummary = record.summary
    ? ContractDocumentSummaryDto.safeParse(record.summary)
    : null;

  const integrationNotes = [
    'This is a PayNote proposal that has not started yet. Accepting it creates the PayNote contract.',
  ];

  return {
    summaryInputBlueId,
    facts: {
      contract: {
        contractId: record.deliveryId,
        displayName,
        typeBlueId: typeBlueId ?? 'unknown',
        sessionId: record.deliverySessionId,
        documentId: record.deliveryDocumentId,
        status: record.clientDecisionStatus,
        statusUpdatedAt:
          record.decisionRecordedAt ??
          record.deliveryUpdatedAt ??
          record.updatedAt,
        updatedAt: record.updatedAt,
      },
      ...(previousSummary && previousSummary.success
        ? { previousSummary: previousSummary.data }
        : {}),
      document: mergedDocument,
      types: typesPack,
      payNoteSummary: {
        ...payNoteSummary,
        ...(payNoteAmountDisplay
          ? { amountDisplay: payNoteAmountDisplay }
          : {}),
      },
      integrationNotes,
    },
  };
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

type ProposalSummaryGenerationResult = {
  summary: z.infer<typeof ContractDocumentSummaryDto>;
  summaryUpdatedAt: string;
  summarySourceUpdatedAt: string;
  summaryInputBlueId?: string;
  cached: boolean;
  model?: string;
};

const generateOrLoadProposalSummary = async (input: {
  record: PayNoteDeliveryRecord;
  payNoteDocument: Record<string, unknown>;
  force: boolean;
  getOpenAiApiKey: () => Promise<string>;
  payNoteDeliveryRepository: {
    updateDeliverySummary: (input: {
      deliveryId: string;
      summary?: Record<string, unknown>;
      summaryUpdatedAt?: string;
      summarySourceUpdatedAt?: string;
      summarySourceEpoch?: number;
      summaryInputBlueId?: string;
      summaryModel?: string;
      summaryError?: string | null;
    }) => Promise<void>;
  };
  logger?: PowertoolsLogger;
}): Promise<ProposalSummaryGenerationResult> => {
  const { record, payNoteDocument } = input;
  const model = process.env.CONTRACT_SUMMARY_MODEL || DEFAULT_MODEL;
  const sourceEpoch = record.deliveryEpoch;

  const { facts, summaryInputBlueId } = buildProposalFacts({
    record,
    payNoteDocument,
  });

  if (
    !input.force &&
    record.summary &&
    !record.summaryError &&
    record.summaryUpdatedAt
  ) {
    const hasMatchingSummaryInput =
      record.summaryInputBlueId &&
      record.summaryInputBlueId === summaryInputBlueId;
    const hasMatchingTimestamp =
      !record.summaryInputBlueId &&
      record.summarySourceUpdatedAt ===
        (record.deliveryUpdatedAt ?? record.updatedAt);
    const hasMatchingEpoch =
      sourceEpoch === undefined || record.summarySourceEpoch === sourceEpoch;
    const parsedSummary = ContractDocumentSummaryDto.safeParse(record.summary);

    if (
      parsedSummary.success &&
      (hasMatchingSummaryInput || hasMatchingTimestamp) &&
      hasMatchingEpoch
    ) {
      return {
        summary: parsedSummary.data,
        summaryUpdatedAt: record.summaryUpdatedAt,
        summarySourceUpdatedAt:
          record.summarySourceUpdatedAt ??
          record.deliveryUpdatedAt ??
          record.updatedAt,
        summaryInputBlueId: record.summaryInputBlueId ?? summaryInputBlueId,
        cached: true,
        model: record.summaryModel,
      };
    }
  }

  const openai = new OpenAI({ apiKey: await input.getOpenAiApiKey() });
  const prompt = buildProposalSummaryPrompt();
  const payload = `<facts>${JSON.stringify(facts)}</facts>`;

  input.logger?.debug?.('PayNote proposal summary LLM input', {
    deliveryId: record.deliveryId,
    sessionId: record.deliverySessionId,
    summaryInputBlueId,
    model,
    systemPrompt: prompt,
    facts,
    payload,
  });

  try {
    const response = await openai.responses.parse(
      {
        model,
        reasoning: { effort: 'minimal' },
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: prompt }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: payload }],
          },
        ],
        text: {
          format: zodTextFormat(ContractDocumentSummaryDto, 'proposal_summary'),
        },
      },
      {
        timeout: SUMMARY_TIMEOUT,
        maxRetries: 0,
      }
    );

    const summary = parseSummary(response);
    const now = new Date().toISOString();
    const sourceUpdatedAt = record.deliveryUpdatedAt ?? record.updatedAt;

    await input.payNoteDeliveryRepository.updateDeliverySummary({
      deliveryId: record.deliveryId,
      summary,
      summaryUpdatedAt: now,
      summarySourceUpdatedAt: sourceUpdatedAt,
      summarySourceEpoch: sourceEpoch,
      summaryInputBlueId,
      summaryModel: model,
      summaryError: null,
    });

    return {
      summary,
      summaryUpdatedAt: now,
      summarySourceUpdatedAt: sourceUpdatedAt,
      summaryInputBlueId,
      cached: false,
      model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    const sourceUpdatedAt = record.deliveryUpdatedAt ?? record.updatedAt;

    await input.payNoteDeliveryRepository.updateDeliverySummary({
      deliveryId: record.deliveryId,
      summaryError: message,
      summaryUpdatedAt: record.summaryUpdatedAt ?? now,
      summarySourceUpdatedAt: record.summarySourceUpdatedAt ?? sourceUpdatedAt,
      summarySourceEpoch: record.summarySourceEpoch ?? sourceEpoch,
      summaryInputBlueId: record.summaryInputBlueId ?? summaryInputBlueId,
      summaryModel: record.summaryModel ?? model,
    });

    throw error;
  }
};

const resolvePayNoteProposalDocument = (
  record: PayNoteDeliveryRecord
): Record<string, unknown> | null => {
  const deliveryDocument = record.deliveryDocument as
    | {
        payNoteBootstrapRequest?: { document?: Record<string, unknown> };
        payNote?: Record<string, unknown>;
      }
    | undefined;

  return (
    deliveryDocument?.payNoteBootstrapRequest?.document ??
    deliveryDocument?.payNote ??
    record.payNoteDocument ??
    null
  );
};

export const generatePayNoteDeliverySummaryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['generatePayNoteDeliverySummary']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { payNoteDeliveryRepository, logger, getOpenAiApiKey } =
    await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;
  const force = Boolean(request.body?.force);

  logger.info('Generating PayNote proposal summary', {
    userId,
    sessionId,
    force,
  });

  const record = await payNoteDeliveryRepository.getDeliveryBySessionId(
    sessionId
  );
  const canonicalSessionId =
    record?.deliverySessionId ?? record?.deliverySessionIds?.[0] ?? null;

  if (
    !record ||
    canonicalSessionId !== sessionId ||
    record.userId !== userId ||
    record.transactionIdentificationStatus !== 'identified'
  ) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote delivery not found',
    });
  }

  const payNoteDocument = resolvePayNoteProposalDocument(record);
  if (!payNoteDocument) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote proposal not available',
    });
  }

  if (!force) {
    const cachedSummary = ContractDocumentSummaryDto.safeParse(record.summary);
    if (cachedSummary.success && record.summaryUpdatedAt) {
      const payNoteName =
        record.payNoteDocument &&
        typeof record.payNoteDocument.name === 'string'
          ? record.payNoteDocument.name
          : null;
      const normalizedSummary = normalizeContractSummary(
        cachedSummary.data,
        payNoteName ?? 'PayNote proposal'
      );
      if (!normalizedSummary) {
        return problemResponse({
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'PayNote proposal summary is invalid',
        });
      }

      return {
        status: 200 as const,
        body: {
          summary: normalizedSummary,
          summaryUpdatedAt: record.summaryUpdatedAt,
          summarySourceUpdatedAt:
            record.summarySourceUpdatedAt ??
            record.deliveryUpdatedAt ??
            record.updatedAt,
          summaryInputBlueId: record.summaryInputBlueId,
          cached: true,
          model: record.summaryModel,
        },
      };
    }

    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote proposal summary not available',
    });
  }

  try {
    const result = await generateOrLoadProposalSummary({
      record,
      payNoteDocument,
      force,
      getOpenAiApiKey,
      payNoteDeliveryRepository,
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

    logger.error('Failed to generate PayNote proposal summary', {
      userId,
      sessionId,
      error: message,
    });

    return problemResponse({
      status: isInputError ? 400 : 500,
      code: isInputError
        ? ERROR_CODES.VALIDATION_ERROR
        : ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to generate PayNote proposal summary',
      detail: message,
    });
  }
};

export const generatePayNoteDeliverySummaryForSessionId = async (input: {
  sessionId: string;
  force: boolean;
  payNoteDeliveryRepository: {
    getDeliveryBySessionId: (
      sessionId: string
    ) => Promise<PayNoteDeliveryRecord | null>;
    updateDeliverySummary: (input: {
      deliveryId: string;
      summary?: Record<string, unknown>;
      summaryUpdatedAt?: string;
      summarySourceUpdatedAt?: string;
      summarySourceEpoch?: number;
      summaryInputBlueId?: string;
      summaryModel?: string;
      summaryError?: string | null;
    }) => Promise<void>;
  };
  getOpenAiApiKey: () => Promise<string>;
  logger: PowertoolsLogger;
}): Promise<ProposalSummaryGenerationResult | null> => {
  const {
    sessionId,
    force,
    payNoteDeliveryRepository,
    getOpenAiApiKey,
    logger,
  } = input;

  const record = await payNoteDeliveryRepository.getDeliveryBySessionId(
    sessionId
  );
  if (!record) {
    logger.warn('PayNote proposal summary skipped (missing delivery)', {
      sessionId,
    });
    return null;
  }
  const canonicalSessionId =
    record.deliverySessionId ?? record.deliverySessionIds?.[0] ?? null;
  if (canonicalSessionId && canonicalSessionId !== sessionId) {
    logger.info('PayNote proposal summary skipped (non-canonical session)', {
      sessionId,
      canonicalSessionId,
      deliveryId: record.deliveryId,
    });
    return null;
  }

  const payNoteDocument = resolvePayNoteProposalDocument(record);
  if (!payNoteDocument) {
    logger.warn('PayNote proposal summary skipped (missing document)', {
      sessionId,
      deliveryId: record.deliveryId,
    });
    return null;
  }

  try {
    const result = await generateOrLoadProposalSummary({
      record,
      payNoteDocument,
      force,
      getOpenAiApiKey,
      payNoteDeliveryRepository,
      logger,
    });
    logger.info('PayNote proposal summary generated', {
      sessionId,
      deliveryId: record.deliveryId,
      cached: result.cached,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate PayNote proposal summary', {
      sessionId,
      deliveryId: record.deliveryId,
      error: message,
    });
    throw error;
  }
};
