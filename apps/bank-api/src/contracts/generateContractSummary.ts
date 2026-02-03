import { ServerInferRequest } from '@ts-rest/core';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  bankApiContract,
  ContractDocumentSummaryDto,
  getSupportedContractByTypeBlueId,
} from '@demo-bank-app/shared-bank-api-contract';
import type {
  ContractRecord,
  ContractRepository,
} from '@demo-bank-app/contracts';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import { BlueNode } from '@blue-labs/language';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import {
  getDeliveryStatusFromDocument,
  getPayNoteSummaryFromDocument,
} from '@demo-bank-app/paynotes';
import { buildContractSummaryPrompt } from './summaryPrompts';
import {
  ContractSummaryInputError,
  buildTypeDefinitionPack,
  collectTypeBlueIdsFromNode,
  findNonTypeBlueIdStubs,
  isOpenAiContextLimitError,
  stripResolvedTypeNodes,
  summaryBlue,
  toBlueNode,
} from './summaryUtils';

const DEFAULT_MODEL = 'gpt-5';
const SUMMARY_TIMEOUT_MS = Number(
  process.env.CONTRACT_SUMMARY_TIMEOUT_MS ?? '45000'
);
const SUMMARY_TIMEOUT = Number.isFinite(SUMMARY_TIMEOUT_MS)
  ? SUMMARY_TIMEOUT_MS
  : 45000;

const SYSTEM_PROMPT = buildContractSummaryPrompt();

const formatMinorAmount = (amountMinor?: number, currency?: string) => {
  if (typeof amountMinor !== 'number' || Number.isNaN(amountMinor)) {
    return undefined;
  }
  const major = (amountMinor / 100).toFixed(2);
  return currency ? `${major} ${currency}` : `$${major}`;
};

type ContractFactsV2 = {
  contract: {
    contractId: string;
    displayName: string;
    typeBlueId: string;
    sessionId?: string;
    documentId?: string;
    status?: string;
    statusUpdatedAt?: string;
    statusTimestamps?: Record<string, string>;
    updatedAt: string;
  };
  previousSummary?: z.infer<typeof ContractDocumentSummaryDto>;
  document: Record<string, unknown>;
  transition?: {
    triggerEvent?: unknown;
    emittedEvents?: unknown[];
  };
  viewer?: {
    channelKey: string;
  };
  types: {
    definitionsByBlueId: Record<string, unknown>;
    typeNameByBlueId: Record<string, string>;
  };
  integrationNotes?: string[];
  payNoteSummary?: {
    name?: string;
    amountMinor?: number;
    currency?: string;
    amountDisplay?: string;
  };
};

type ContractFactsV2Result = {
  facts: ContractFactsV2;
  summaryInputBlueId: string;
};

const buildFactsV2 = (input: {
  contract: {
    contractId: string;
    typeBlueId: string;
    displayName: string;
    sessionId?: string;
    documentId?: string;
    status?: string;
    statusUpdatedAt?: string;
    statusTimestamps?: Record<string, string>;
    updatedAt: string;
    document?: Record<string, unknown>;
    triggerEvent?: unknown;
    emittedEvents?: unknown[];
    previousSummary?: z.infer<typeof ContractDocumentSummaryDto>;
  };
}): ContractFactsV2Result => {
  const supportedContract = getSupportedContractByTypeBlueId(
    input.contract.typeBlueId
  );
  const viewerChannelKey = supportedContract?.userChannelKey;

  const document = input.contract.document ?? {};
  const documentNode = toBlueNode(document);
  if (!documentNode) {
    throw new ContractSummaryInputError(
      'Contract document could not be parsed as a Blue node.'
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
      `Contract document could not be serialized to JSON: ${message}`
    );
  }
  if (!documentSimpleBase || typeof documentSimpleBase !== 'object') {
    throw new ContractSummaryInputError(
      'Contract document could not be serialized to a JSON object.'
    );
  }

  const mergedDocument = documentSimpleBase as Record<string, unknown>;
  const documentStubs = findNonTypeBlueIdStubs(mergedDocument, {
    path: ['document'],
    ignoredStubKeys: new Set(['prevEntry']),
  });

  if (documentStubs.length) {
    throw new ContractSummaryInputError(
      `Contract document contains non-type {blueId} references which cannot be sent to the LLM: ${documentStubs
        .slice(0, 5)
        .map(s => `${s.blueId} @ ${s.path}`)
        .join(', ')}${
        documentStubs.length > 5 ? ` (+${documentStubs.length - 5} more)` : ''
      }`
    );
  }

  const triggerNode = toBlueNode(input.contract.triggerEvent);
  if (
    input.contract.triggerEvent !== undefined &&
    input.contract.triggerEvent !== null
  ) {
    if (!triggerNode) {
      throw new ContractSummaryInputError(
        'Trigger event could not be parsed as a Blue node.'
      );
    }
  }

  const emittedEvents = input.contract.emittedEvents ?? [];
  const emittedNodes: BlueNode[] = emittedEvents.flatMap((event, index) => {
    if (event === undefined || event === null) {
      return [];
    }
    const node = toBlueNode(event);
    if (!node) {
      throw new ContractSummaryInputError(
        `Emitted event at index ${index} could not be parsed as a Blue node.`
      );
    }
    return [node];
  });

  let triggerSimple: unknown | undefined;
  let emittedSimple: unknown[] = [];
  try {
    triggerSimple = triggerNode
      ? (summaryBlue.nodeToJson(
          stripResolvedTypeNodes(triggerNode),
          'simple'
        ) as unknown)
      : undefined;
    emittedSimple = emittedNodes.map(node =>
      summaryBlue.nodeToJson(stripResolvedTypeNodes(node), 'simple')
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `Unable to serialize transition events to JSON: ${message}`
    );
  }

  const transitionIgnoredStubKeys = new Set(['prevEntry']);
  const transitionStubs = [
    ...(triggerSimple
      ? findNonTypeBlueIdStubs(triggerSimple, {
          path: ['transition', 'triggerEvent'],
          ignoredStubKeys: transitionIgnoredStubKeys,
        })
      : []),
    ...emittedSimple.flatMap((event, index) =>
      findNonTypeBlueIdStubs(event, {
        path: ['transition', 'emittedEvents', String(index)],
        ignoredStubKeys: transitionIgnoredStubKeys,
      })
    ),
  ];

  if (transitionStubs.length) {
    throw new ContractSummaryInputError(
      `Transition events contain non-type {blueId} references which cannot be sent to the LLM: ${transitionStubs
        .slice(0, 5)
        .map(s => `${s.blueId} @ ${s.path}`)
        .join(', ')}${
        transitionStubs.length > 5
          ? ` (+${transitionStubs.length - 5} more)`
          : ''
      }`
    );
  }

  let summaryInputBlueId: string;
  try {
    const summaryInputPayload: Record<string, unknown> = {
      document: mergedDocument,
    };
    if (triggerSimple !== undefined) {
      summaryInputPayload.triggerEvent = triggerSimple;
    }
    if (emittedSimple.length) {
      summaryInputPayload.emittedEvents = emittedSimple;
    }
    const summaryInputNode = summaryBlue.jsonValueToNode(summaryInputPayload);
    summaryInputBlueId = summaryBlue.calculateBlueIdSync(summaryInputNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractSummaryInputError(
      `Unable to calculate summary input blueId: ${message}`
    );
  }

  const referencedTypeIds = new Set<string>();
  referencedTypeIds.add(input.contract.typeBlueId);
  collectTypeBlueIdsFromNode(documentNode, referencedTypeIds);

  const contractsNode = toBlueNode({
    type: (mergedDocument as Record<string, unknown>).type,
    contracts: mergedDocument.contracts,
  });
  if (contractsNode) {
    collectTypeBlueIdsFromNode(contractsNode, referencedTypeIds);
  }
  if (triggerNode) {
    collectTypeBlueIdsFromNode(triggerNode, referencedTypeIds);
  }
  emittedNodes.forEach(node =>
    collectTypeBlueIdsFromNode(node, referencedTypeIds)
  );

  const typesPack = buildTypeDefinitionPack(referencedTypeIds);

  const payNoteSummary = getPayNoteSummaryFromDocument(
    (document as { payNoteBootstrapRequest?: { document?: unknown } })
      .payNoteBootstrapRequest?.document ??
      (document as { payNote?: unknown }).payNote
  );
  const payNoteAmountDisplay = formatMinorAmount(
    payNoteSummary.amountMinor,
    payNoteSummary.currency
  );

  const payNoteDeliveryStatus = getDeliveryStatusFromDocument(document);

  const integrationNotes: string[] = [];
  if (
    payNoteDeliveryStatus.deliveryStatus ||
    payNoteDeliveryStatus.transactionIdentificationStatus ||
    payNoteDeliveryStatus.clientDecisionStatus
  ) {
    integrationNotes.push(
      'In Demo Bank, accepting a PayNote Delivery will bootstrap/start the embedded PayNote proposal.'
    );
  }
  if (
    payNoteSummary.name ||
    payNoteSummary.amountMinor ||
    payNoteSummary.currency
  ) {
    integrationNotes.push(
      'This document appears to include a PayNote proposal; the summary should explain the proposed PayNote and how the contract progresses.'
    );
  }

  return {
    summaryInputBlueId,
    facts: {
      contract: {
        contractId: input.contract.contractId,
        displayName: input.contract.displayName,
        typeBlueId: input.contract.typeBlueId,
        sessionId: input.contract.sessionId,
        documentId: input.contract.documentId,
        status: input.contract.status,
        statusUpdatedAt: input.contract.statusUpdatedAt,
        statusTimestamps: input.contract.statusTimestamps,
        updatedAt: input.contract.updatedAt,
      },
      ...(input.contract.previousSummary
        ? { previousSummary: input.contract.previousSummary }
        : {}),
      document: mergedDocument,
      ...(triggerSimple || emittedSimple.length
        ? {
            transition: {
              ...(triggerSimple ? { triggerEvent: triggerSimple } : {}),
              ...(emittedSimple.length ? { emittedEvents: emittedSimple } : {}),
            },
          }
        : {}),
      ...(viewerChannelKey
        ? {
            viewer: {
              channelKey: viewerChannelKey,
            },
          }
        : {}),
      types: typesPack,
      ...(payNoteSummary.name ||
      payNoteSummary.amountMinor ||
      payNoteSummary.currency
        ? {
            payNoteSummary: {
              ...payNoteSummary,
              ...(payNoteAmountDisplay
                ? { amountDisplay: payNoteAmountDisplay }
                : {}),
            },
          }
        : {}),
      ...(integrationNotes.length ? { integrationNotes } : {}),
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
  contractRepository: Pick<ContractRepository, 'updateContractSummary'>;
  getOpenAiApiKey: () => Promise<string>;
  logger?: PowertoolsLogger;
}): Promise<ContractSummaryGenerationResult> => {
  const contract = input.contract;

  if (!contract.document) {
    throw new ContractSummaryInputError('Contract document not available');
  }

  const model = process.env.CONTRACT_SUMMARY_MODEL || DEFAULT_MODEL;

  try {
    const { facts, summaryInputBlueId } = buildFactsV2({
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
        previousSummary: contract.summary,
      },
    });

    if (
      !input.force &&
      contract.summary &&
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
        return {
          summary: contract.summary,
          summaryUpdatedAt: contract.summaryUpdatedAt,
          summarySourceUpdatedAt:
            contract.summarySourceUpdatedAt ?? contract.updatedAt,
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

    const response = await client.responses.parse(
      {
        model,
        reasoning: { effort: 'minimal' },
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: payload,
              },
            ],
          },
        ],
        text: {
          format: zodTextFormat(
            ContractDocumentSummaryDto,
            'ContractDocumentSummary'
          ),
        },
      },
      {
        timeout: SUMMARY_TIMEOUT,
        maxRetries: 0,
      }
    );

    const summary = parseSummary(response);
    const now = new Date().toISOString();

    await input.contractRepository.updateContractSummary({
      contractId: contract.contractId,
      summary,
      summaryUpdatedAt: now,
      summarySourceUpdatedAt: contract.updatedAt,
      summaryInputBlueId,
      summaryModel: model,
      summaryError: null,
    });

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
    const now = new Date().toISOString();

    await input.contractRepository.updateContractSummary({
      contractId: contract.contractId,
      summaryError: message,
      summaryUpdatedAt: contract.summaryUpdatedAt ?? now,
      summarySourceUpdatedAt:
        contract.summarySourceUpdatedAt ?? contract.updatedAt,
    });

    throw error;
  }
};

export const prefetchContractSummaryForSessionId = async (input: {
  sessionId: string;
  contractRepository: Pick<
    ContractRepository,
    'getContractBySessionId' | 'updateContractSummary'
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

    if (contract.summary || contract.summaryError) {
      return;
    }

    await generateOrLoadContractSummary({
      contract,
      force: false,
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
  const { contractRepository, logger, getOpenAiApiKey } =
    await getDependencies();
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

  try {
    const result = await generateOrLoadContractSummary({
      contract,
      force,
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
  contractRepository: ContractRepository;
  getOpenAiApiKey: () => Promise<string>;
  logger: PowertoolsLogger;
}): Promise<ContractSummaryGenerationResult | null> => {
  const { sessionId, force, contractRepository, getOpenAiApiKey, logger } =
    input;

  const contract = await contractRepository.getContractBySessionId(sessionId);
  if (!contract) {
    logger.warn('Contract summary skipped (missing contract)', {
      sessionId,
    });
    return null;
  }

  if (!contract.document) {
    logger.warn('Contract summary skipped (missing document)', {
      sessionId,
      contractId: contract.contractId,
    });
    return null;
  }

  try {
    const result = await generateOrLoadContractSummary({
      contract,
      force,
      contractRepository,
      getOpenAiApiKey,
      logger,
    });
    logger.info('Contract summary generated', {
      sessionId,
      contractId: contract.contractId,
      cached: result.cached,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate contract summary', {
      sessionId,
      contractId: contract.contractId,
      error: message,
    });
    return null;
  }
};
