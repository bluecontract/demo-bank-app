import { z } from 'zod';
import { BlueNode } from '@blue-labs/language';
import {
  ContractDocumentSummaryDto,
  getSupportedContractByTypeBlueId,
  resolveContractChannelKeys,
} from '@demo-bank-app/shared-bank-api-contract';
import { formatMinorAmountWithCurrency } from '@demo-bank-app/shared-core';
import {
  buildChannelBindingsFromContracts,
  getDeliveryStatusFromDocument,
  getPayNoteSummaryFromDocument,
} from '@demo-bank-app/paynotes';
import {
  ContractSummaryInputError,
  buildTypeDefinitionPack,
  collectTypeBlueIdsFromNode,
  findNonTypeBlueIdStubs,
  stripResolvedTypeNodes,
  summaryBlue,
  toBlueNode,
} from '../summaryUtils';

export type TriggerEventMeta = {
  blueId?: string;
  createdAt?: string;
  actorAccountId?: string;
  actorEmail?: string;
};

export type ContractFactsV2 = {
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
    triggerMeta?: TriggerEventMeta;
    actorIsViewer?: boolean;
  };
  viewer?: {
    channelKey: string;
    accountId?: string;
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

export type ContractFactsV2Result = {
  facts: ContractFactsV2;
  summaryInputBlueId: string;
  triggerEventMeta?: TriggerEventMeta;
};

type BuildFactsInput = {
  contract: {
    contractId: string;
    typeBlueId: string;
    displayName: string;
    customerChannelKey?: string;
    sessionId?: string;
    documentId?: string;
    status?: string;
    statusUpdatedAt?: string;
    statusTimestamps?: Record<string, string>;
    updatedAt: string;
    accountNumber?: string;
    document?: Record<string, unknown>;
    triggerEvent?: unknown;
    emittedEvents?: unknown[];
    previousSummary?: z.infer<typeof ContractDocumentSummaryDto>;
  };
};

const getStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.value === 'string') {
      const trimmed = record.value.trim();
      return trimmed ? trimmed : undefined;
    }
  }
  return undefined;
};

const getNumberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.value !== undefined) {
      return getNumberValue(record.value);
    }
  }
  return undefined;
};

const toEpochMs = (value: number): number | undefined => {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if (value > 1e14) {
    return Math.round(value / 1000);
  }
  if (value > 1e11) {
    return Math.round(value);
  }
  if (value > 1e9) {
    return Math.round(value * 1000);
  }
  return undefined;
};

const toIsoFromEpoch = (value: number): string | undefined => {
  const ms = toEpochMs(value);
  if (ms === undefined) {
    return undefined;
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

const extractTriggerEventMeta = (input: {
  triggerNode?: BlueNode | null;
  triggerSimple?: unknown;
}): TriggerEventMeta | null => {
  const triggerNode = input.triggerNode ?? null;
  const triggerSimple = input.triggerSimple;

  let blueId: string | undefined;
  if (triggerNode) {
    blueId = triggerNode.getBlueId();
    if (!blueId) {
      try {
        blueId = summaryBlue.calculateBlueIdSync(triggerNode);
      } catch {
        blueId = undefined;
      }
    }
  }

  let createdAt: string | undefined;
  if (triggerNode) {
    let timestampValue: number | undefined;
    try {
      timestampValue =
        triggerNode.getAsInteger('/timestamp') ??
        getNumberValue(triggerNode.getAsNode('/timestamp')?.getValue());
    } catch {
      timestampValue = undefined;
    }
    if (timestampValue !== undefined) {
      createdAt = toIsoFromEpoch(timestampValue);
    }
  }

  const record =
    triggerSimple && typeof triggerSimple === 'object'
      ? (triggerSimple as Record<string, unknown>)
      : null;

  if (!createdAt && record) {
    createdAt = getStringValue(record.createdAt);
    if (!createdAt) {
      const timestampValue = getNumberValue(record.timestamp);
      if (timestampValue !== undefined) {
        createdAt = toIsoFromEpoch(timestampValue);
      }
    }
  }

  let actorAccountId: string | undefined;
  let actorEmail: string | undefined;
  if (record) {
    const actor = record.actor;
    const actorRecord =
      actor && typeof actor === 'object'
        ? (actor as Record<string, unknown>)
        : null;
    if (actorRecord) {
      actorAccountId = getStringValue(actorRecord.accountId);
      actorEmail = getStringValue(actorRecord.email);
    }
  }

  if (!blueId && !createdAt && !actorAccountId && !actorEmail) {
    return null;
  }

  return {
    ...(blueId ? { blueId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(actorAccountId ? { actorAccountId } : {}),
    ...(actorEmail ? { actorEmail } : {}),
  };
};

export const buildContractSummaryFacts = (
  input: BuildFactsInput
): ContractFactsV2Result => {
  const supportedContract = getSupportedContractByTypeBlueId(
    input.contract.typeBlueId
  );
  const viewerChannelKey = supportedContract
    ? resolveContractChannelKeys({
        supportedContract,
        customerChannelKey: input.contract.customerChannelKey,
        accountNumber: input.contract.accountNumber,
        document: input.contract.document,
      }).userChannelKey
    : undefined;

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
  const enforceBlueIdValidation =
    process.env.CONTRACT_SUMMARY_ENFORCE_BLUEID_VALIDATION === '1';

  if (documentStubs.length && enforceBlueIdValidation) {
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
    if (enforceBlueIdValidation) {
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
  }

  const triggerEventMeta = extractTriggerEventMeta({
    triggerNode,
    triggerSimple,
  });

  let viewerAccountId: string | undefined;
  if (viewerChannelKey) {
    const contractsRecord = (mergedDocument as Record<string, unknown>)
      .contracts;
    if (
      contractsRecord &&
      typeof contractsRecord === 'object' &&
      !Array.isArray(contractsRecord)
    ) {
      const bindings = buildChannelBindingsFromContracts(
        contractsRecord as Record<string, unknown>
      );
      viewerAccountId = bindings[viewerChannelKey]?.accountId;
    }
  }

  const actorIsViewer =
    viewerAccountId && triggerEventMeta?.actorAccountId
      ? viewerAccountId === triggerEventMeta.actorAccountId
      : viewerChannelKey
      ? false
      : undefined;

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

  const payNoteSummarySource =
    (document as { payNoteBootstrapRequest?: { document?: unknown } })
      .payNoteBootstrapRequest?.document ??
    (document as { payNote?: unknown }).payNote ??
    document;
  const payNoteSummary = getPayNoteSummaryFromDocument(payNoteSummarySource);
  const payNoteAmountDisplay = formatMinorAmountWithCurrency({
    amountMinor: payNoteSummary.amountMinor,
    currencyCode: payNoteSummary.currency,
    defaultCurrencyCode: 'USD',
    locale: 'en-US',
  });

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
      'This document appears to include PayNote details; the summary should explain the PayNote in plain language and describe current progress.'
    );
  }

  return {
    summaryInputBlueId,
    triggerEventMeta: triggerEventMeta ?? undefined,
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
              ...(triggerEventMeta ? { triggerMeta: triggerEventMeta } : {}),
              ...(actorIsViewer !== undefined ? { actorIsViewer } : {}),
            },
          }
        : {}),
      ...(viewerChannelKey
        ? {
            viewer: {
              channelKey: viewerChannelKey,
              ...(viewerAccountId ? { accountId: viewerAccountId } : {}),
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
