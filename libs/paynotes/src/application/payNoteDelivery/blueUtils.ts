import type { CardTransactionDetails } from '@demo-bank-app/banking';
import type { BlueNode } from '@blue-labs/language';
import { MyOSTimelineChannelSchema } from '@blue-repository/types/packages/myos/schemas';
import {
  PayNoteDeliverySchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../blue';

const toBlueNode = (value: unknown): BlueNode | null => {
  if (!value) {
    return null;
  }
  try {
    return blue.jsonValueToNode(value);
  } catch {
    return null;
  }
};

const toSimpleRecord = (value: unknown): Record<string, unknown> | null => {
  const node = toBlueNode(value);
  if (node) {
    const simple = blue.nodeToJson(node, 'simple');
    if (simple && typeof simple === 'object') {
      return simple as Record<string, unknown>;
    }
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
};

const getString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  return record ? getString(record[key]) : undefined;
};

const parsePayNoteDelivery = (document: unknown) => {
  const node = toBlueNode(document);
  if (
    !node ||
    !blue.isTypeOf(node, PayNoteDeliverySchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }
  const simple = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  return {
    node,
    output: blue.nodeToSchemaOutput(node, PayNoteDeliverySchema),
    simple,
  };
};

const parsePayNote = (document: unknown) => {
  const node = toBlueNode(document);
  if (
    !node ||
    !blue.isTypeOf(node, PayNoteSchema, { checkSchemaExtensions: true })
  ) {
    return null;
  }
  return {
    node,
    output: blue.nodeToSchemaOutput(node, PayNoteSchema),
  };
};

const parseTimelineChannel = (value: unknown) => {
  const node = toBlueNode(value);
  if (
    !node ||
    !blue.isTypeOf(node, MyOSTimelineChannelSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }
  return {
    node,
    output: blue.nodeToSchemaOutput(node, MyOSTimelineChannelSchema),
  };
};

const getChannelIdentity = (channel: unknown): string | undefined => {
  const parsed = parseTimelineChannel(channel);
  if (parsed) {
    return (
      getString(parsed.output.accountId) ??
      getString(parsed.output.email) ??
      getString(parsed.output.timelineId)
    );
  }

  const simple = toSimpleRecord(channel);
  if (!simple) {
    return undefined;
  }

  return (
    getRecordString(simple, 'accountId') ??
    getRecordString(simple, 'email') ??
    getRecordString(simple, 'timelineId')
  );
};

export const ensureTimelineChannel = (
  contracts: Record<string, unknown>,
  channelKey: string,
  accountId: string
): { ok: boolean; error?: string } => {
  const existing = contracts[channelKey];
  const channel =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const existingIdentity = getChannelIdentity(channel);

  if (existingIdentity && existingIdentity !== accountId) {
    return {
      ok: false,
      error: `${channelKey} already bound to ${existingIdentity}`,
    };
  }

  channel.type = 'MyOS/MyOS Timeline Channel';

  if (!existingIdentity) {
    channel.accountId = accountId;
  }

  contracts[channelKey] = channel;
  return { ok: true };
};

export const buildChannelBindingsFromContracts = (
  contracts: Record<string, unknown>
): Record<string, { email?: string; accountId?: string }> => {
  const bindings: Record<string, { email?: string; accountId?: string }> = {};

  Object.entries(contracts).forEach(([key, value]) => {
    const parsed = parseTimelineChannel(value);
    if (parsed) {
      const accountId = getString(parsed.output.accountId);
      const email = getString(parsed.output.email);
      if (accountId) {
        bindings[key] = { accountId };
        return;
      }
      if (email) {
        bindings[key] = { email };
        return;
      }
    }

    const channel = toSimpleRecord(value);
    if (!channel) {
      return;
    }
    const accountId = getRecordString(channel, 'accountId');
    const email = getRecordString(channel, 'email');

    if (accountId) {
      bindings[key] = { accountId };
      return;
    }
    if (email) {
      bindings[key] = { email };
    }
  });

  return bindings;
};

export const getCardTransactionDetailsFromDocument = (
  document: unknown
): CardTransactionDetails | null => {
  const parsed = parsePayNoteDelivery(document);
  if (!parsed) {
    return null;
  }

  const cardDetails = parsed.output.cardTransactionDetails;
  const retrievalReferenceNumber = getString(
    cardDetails?.retrievalReferenceNumber
  );
  const systemTraceAuditNumber = getString(cardDetails?.systemTraceAuditNumber);
  const transmissionDateTime = getString(cardDetails?.transmissionDateTime);
  const authorizationCode = getString(cardDetails?.authorizationCode);

  if (
    !retrievalReferenceNumber ||
    !systemTraceAuditNumber ||
    !transmissionDateTime ||
    !authorizationCode
  ) {
    return null;
  }

  return {
    retrievalReferenceNumber,
    systemTraceAuditNumber,
    transmissionDateTime,
    authorizationCode,
  };
};

export const getDeliveryStatusFromDocument = (
  document: unknown
): {
  deliveryStatus?: string;
  transactionIdentificationStatus?: string;
  clientDecisionStatus?: string;
} => {
  const parsed = parsePayNoteDelivery(document);
  if (!parsed) {
    return {};
  }

  const { output, node } = parsed;
  let deliveryStatus = getString(output.deliveryStatus?.name);
  if (!deliveryStatus) {
    const simple = blue.nodeToJson(node, 'simple') as
      | Record<string, unknown>
      | undefined;
    const statusRecord = simple?.deliveryStatus as
      | Record<string, unknown>
      | undefined;
    const typeRecord = statusRecord?.type as
      | Record<string, unknown>
      | undefined;
    deliveryStatus =
      getRecordString(typeRecord, 'name') ??
      getRecordString(typeRecord, 'value');
  }

  return {
    deliveryStatus,
    transactionIdentificationStatus: getString(
      output.transactionIdentificationStatus
    ),
    clientDecisionStatus: getString(output.clientDecisionStatus),
  };
};

export const getPayNoteSummaryFromDocument = (
  payNote?: unknown
): { name?: string; amountMinor?: number; currency?: string } => {
  const parsed = parsePayNote(payNote);
  const source = parsed?.output ?? toSimpleRecord(payNote);
  if (!source) {
    return {};
  }

  const name = getString((source as { name?: unknown }).name);
  const amountValue = (source as { amount?: { total?: unknown } }).amount
    ?.total;
  const amountMinor = typeof amountValue === 'number' ? amountValue : undefined;
  const currencyValue = getString((source as { currency?: unknown }).currency);

  return {
    name,
    amountMinor,
    currency: currencyValue,
  };
};

export const getDeliveryNameFromDocument = (
  document: unknown
): string | undefined => {
  const parsed = parsePayNoteDelivery(document);
  if (!parsed) {
    const simple = toSimpleRecord(document);
    if (!simple) {
      return undefined;
    }
    const name = getString((simple as { name?: unknown }).name);
    if (name) {
      return name;
    }
    const payNote = (
      simple as { payNoteBootstrapRequest?: { document?: unknown } }
    ).payNoteBootstrapRequest?.document;
    return getPayNoteSummaryFromDocument(payNote).name;
  }

  const name = getString(parsed.output.name);
  if (name) {
    return name;
  }
  const payNote = (
    parsed.simple as { payNoteBootstrapRequest?: { document?: unknown } }
  )?.payNoteBootstrapRequest?.document;
  return getPayNoteSummaryFromDocument(payNote).name;
};

export const getSynchronySessionIdFromDocument = (
  document: unknown
): string | undefined => {
  const parsed = parsePayNoteDelivery(document);
  if (!parsed) {
    return undefined;
  }
  const simple = blue.nodeToJson(parsed.node, 'simple') as
    | Record<string, unknown>
    | undefined;
  const contracts = simple?.contracts as Record<string, unknown> | undefined;
  const links = contracts?.links as Record<string, unknown> | undefined;
  const link = links?.synchronyMerchantLink as
    | Record<string, unknown>
    | undefined;
  return getRecordString(link, 'sessionId');
};
