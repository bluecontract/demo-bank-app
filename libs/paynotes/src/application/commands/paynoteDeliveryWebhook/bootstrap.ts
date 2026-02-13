import type { BlueNode } from '@blue-labs/language';
import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import {
  CardTransactionPayNoteSchema,
  MerchantToCustomerPayNoteSchema,
  PayNoteDeliverySchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { blueIds as payNoteBlueIds } from '@blue-repository/types/packages/paynote/blue-ids';
import type { Hold } from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { LogEntry, MyOsClient, PayNoteDeliveryRecord } from '../../ports';
import { runGuarantorUpdate } from '../documentOperations';
import {
  buildChannelBindingsFromContracts,
  ensureTimelineChannel,
  getCardTransactionDetailsFromDocument,
  getPayNoteSummaryFromDocument,
  getSynchronySessionIdFromDocument,
} from '../../payNoteDelivery/blueUtils';
import { blue } from '../../../blue';
import { log, trace } from '../paynoteWebhook/logging';
import { getString, toSimpleRecord } from '../paynoteWebhook/utils';
import { toBlueNode } from '../webhookUtils';
import { mergeSessionIds } from '../payNoteSessionUtils';
import type {
  HandlePayNoteDeliveryWebhookDependencies,
  WebhookEventObject,
} from './types';

export type BootstrapRequest = {
  rawEvent: unknown;
  request: Record<string, unknown>;
  documentNode: BlueNode | null;
  documentPayload: Record<string, unknown> | null;
};

type ChannelBindings = Record<string, { email?: string; accountId?: string }>;

type NormalizedBootstrapRequest = {
  bootstrapAssignee?: string;
  requestId?: string;
  document?: Record<string, unknown> | null;
  channelBindings: ChannelBindings;
};

type PayNoteBootstrapContext = {
  payNoteDocument?: Record<string, unknown> | null;
  payNoteDocumentNode: BlueNode | null;
  requestingSessionId?: string;
  requestingDeliveryCardDetails: ReturnType<
    typeof getCardTransactionDetailsFromDocument
  > | null;
  deliveryId?: string;
  senderIdentity?: string;
  payeeIdentity?: string;
  payerIdentity?: string;
};

export const getDocumentBootstrapRequestFromEvent = (
  event: unknown
): BootstrapRequest | null => {
  const rawRecord =
    event && typeof event === 'object' && !Array.isArray(event)
      ? (event as Record<string, unknown>)
      : null;
  const rawDocument =
    rawRecord &&
    rawRecord.document &&
    typeof rawRecord.document === 'object' &&
    !Array.isArray(rawRecord.document)
      ? (rawRecord.document as Record<string, unknown>)
      : null;
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, DocumentBootstrapRequestedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  const payload = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const documentNode = node.getProperties()?.document ?? null;
  const documentPayload =
    rawDocument ??
    (payload.document &&
    typeof payload.document === 'object' &&
    !Array.isArray(payload.document)
      ? (payload.document as Record<string, unknown>)
      : null);

  return {
    rawEvent: event,
    request: payload,
    documentNode,
    documentPayload,
  };
};

const normalizeChannelBindings = (
  bindings: unknown
): Record<string, { email?: string; accountId?: string }> => {
  if (!bindings || typeof bindings !== 'object') {
    return {};
  }

  const record = bindings as Record<string, unknown>;
  const output: Record<string, { email?: string; accountId?: string }> = {};

  Object.entries(record).forEach(([key, value]) => {
    if (!key) {
      return;
    }

    const binding = toSimpleRecord(value);
    if (!binding) {
      return;
    }

    const accountId = getString(binding.accountId);
    const email = getString(binding.email);

    if (accountId) {
      output[key] = { accountId };
    } else if (email) {
      output[key] = { email };
    }
  });

  return output;
};

const getBindingIdentity = (binding?: {
  email?: string;
  accountId?: string;
}): string | undefined => binding?.accountId ?? binding?.email;

const validateBankControlledChannelBinding = (input: {
  request: NormalizedBootstrapRequest;
  requestedDocumentPayload: Record<string, unknown>;
  channelKey: string;
  accountId: string;
}): { ok: true } | { ok: false; reason: string } => {
  const { request, requestedDocumentPayload, channelKey, accountId } = input;
  const requestBindingIdentity = getBindingIdentity(
    request.channelBindings[channelKey]
  );
  if (requestBindingIdentity && requestBindingIdentity !== accountId) {
    return {
      ok: false,
      reason: `${channelKey} binding is already set to ${requestBindingIdentity}`,
    };
  }

  const contracts = toSimpleRecord(requestedDocumentPayload.contracts);
  if (!contracts) {
    return { ok: true };
  }

  const contractsForValidation = { ...contracts };
  const validation = ensureTimelineChannel(
    contractsForValidation,
    channelKey,
    accountId
  );
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.error ?? `${channelKey} is already bound`,
    };
  }

  return { ok: true };
};

const isBootstrapAssigneeMatch = (
  requestingDocument: Record<string, unknown> | undefined,
  bootstrapAssignee: string | undefined,
  myOsAccountId: string
): boolean => {
  if (!requestingDocument || !bootstrapAssignee) {
    return false;
  }
  const contracts = toSimpleRecord(requestingDocument.contracts);
  if (!contracts) {
    return false;
  }

  const bindings = buildChannelBindingsFromContracts(contracts);
  return bindings[bootstrapAssignee]?.accountId === myOsAccountId;
};

const extractBootstrapSessionId = (response: {
  body?: unknown;
}): string | undefined => {
  const body = response.body as { sessionId?: unknown } | undefined;
  return typeof body?.sessionId === 'string' ? body.sessionId : undefined;
};

const withInResponseTo = (
  event: Record<string, unknown>,
  requestId: string | undefined
): Record<string, unknown> => {
  if (!requestId) {
    return event;
  }
  return {
    ...event,
    inResponseTo: {
      requestId,
    },
  };
};

const resolveBootstrapFailureReason = (input: {
  status: number;
  body?: unknown;
}): string => {
  const { status, body } = input;
  const bodyRecord = toSimpleRecord(body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `Document bootstrap failed: ${detail}`
    : `Document bootstrap failed with status ${status}.`;
};

type BootstrapResponseContext = {
  eventId: string;
  bootstrapAssignee?: string;
  requestingSessionId?: string;
  requestId?: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
};

const emitBootstrapGuarantorEvent = async (input: {
  context: BootstrapResponseContext;
  responseEvent: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingSessionMessage: string;
}): Promise<boolean> => {
  const {
    context,
    responseEvent,
    successMessage,
    failureMessage,
    missingSessionMessage,
  } = input;
  const {
    eventId,
    bootstrapAssignee,
    requestingSessionId,
    requestId,
    credentials,
    deps,
    logs,
  } = context;
  if (!requestingSessionId) {
    log(logs, 'error', missingSessionMessage, {
      eventId,
      bootstrapAssignee,
      requestId: requestId ?? null,
    });
    return false;
  }

  return runGuarantorUpdate({
    myOsClient: deps.myOsClient,
    credentials,
    sessionId: requestingSessionId,
    request: [withInResponseTo(responseEvent, requestId)],
    logs,
    logContext: {
      eventId,
      bootstrapAssignee,
      requestId: requestId ?? null,
    },
    successMessage,
    failureMessage,
    missingCredentialsMessage:
      'Skipped document bootstrap response (missing MyOS credentials)',
  });
};

const respondBootstrapDecision = async (
  context: BootstrapResponseContext,
  input: {
    status: 'accepted' | 'rejected';
    reason?: string;
  }
): Promise<boolean> => {
  const event: Record<string, unknown> = {
    type: 'Conversation/Document Bootstrap Responded',
    status: input.status,
  };
  if (input.reason && input.reason.trim().length > 0) {
    event.reason = input.reason;
  }

  return emitBootstrapGuarantorEvent({
    context,
    responseEvent: event,
    successMessage: `Reported document bootstrap ${input.status} via guarantorUpdate`,
    failureMessage: `Failed to report document bootstrap ${input.status} via guarantorUpdate`,
    missingSessionMessage:
      'Failed to report document bootstrap decision (missing requesting session id)',
  });
};

const respondBootstrapFailed = async (
  context: BootstrapResponseContext,
  reason: string
): Promise<boolean> =>
  emitBootstrapGuarantorEvent({
    context,
    responseEvent: {
      type: 'Conversation/Document Bootstrap Failed',
      reason,
    },
    successMessage: 'Reported document bootstrap failure via guarantorUpdate',
    failureMessage:
      'Failed to report document bootstrap failure via guarantorUpdate',
    missingSessionMessage:
      'Failed to report document bootstrap failure (missing requesting session id)',
  });

const rejectPayNoteBootstrapRequest = async (input: {
  context: BootstrapResponseContext;
  eventId: string;
  deliveryId?: string;
  reason: string;
  logMessage: string;
  logContext?: Record<string, unknown>;
}): Promise<boolean> => {
  const { context, logMessage, logContext, eventId, deliveryId, reason } =
    input;
  log(context.logs, 'error', logMessage, {
    eventId,
    deliveryId,
    ...logContext,
  });
  await respondBootstrapDecision(context, { status: 'rejected', reason });
  return true;
};

const normalizeBootstrapRequest = (
  request: Record<string, unknown>
): NormalizedBootstrapRequest => ({
  bootstrapAssignee: getString(request.bootstrapAssignee),
  requestId: getString(request.requestId),
  document: toSimpleRecord(request.document),
  channelBindings: normalizeChannelBindings(request.channelBindings),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeBootstrapDocument = (
  document: Record<string, unknown>
): Record<string, unknown> => {
  const node = toBlueNode(document);
  if (!node) {
    return document;
  }
  const restored = blue.restoreInlineTypes(node);
  const normalized = blue.nodeToJson(restored, 'original');
  return isRecord(normalized) ? normalized : document;
};

const buildPayNoteBootstrapContext = (input: {
  request: NormalizedBootstrapRequest;
  documentNode: BlueNode | null;
  requestedDocumentPayload?: Record<string, unknown> | null;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
}): PayNoteBootstrapContext => {
  const {
    request,
    documentNode,
    requestedDocumentPayload,
    eventObject,
    documentPayload,
  } = input;
  const payNoteDocument = requestedDocumentPayload ?? null;
  const requestingSessionId = getString(eventObject?.sessionId);
  const requestingDeliveryCardDetails = documentPayload
    ? getCardTransactionDetailsFromDocument(documentPayload) ?? null
    : null;
  const deliveryId = requestingDeliveryCardDetails
    ? buildCardTransactionDetailsKey(requestingDeliveryCardDetails)
    : undefined;
  const deliveryContracts = documentPayload
    ? toSimpleRecord(documentPayload.contracts)
    : null;
  const deliveryBindings = deliveryContracts
    ? buildChannelBindingsFromContracts(deliveryContracts)
    : {};
  const senderIdentity = getBindingIdentity(deliveryBindings.payNoteSender);
  const payeeIdentity = getBindingIdentity(
    request.channelBindings.payeeChannel
  );
  const payerIdentity = getBindingIdentity(
    request.channelBindings.payerChannel
  );

  return {
    payNoteDocument,
    payNoteDocumentNode: documentNode,
    requestingSessionId,
    requestingDeliveryCardDetails,
    deliveryId,
    senderIdentity,
    payeeIdentity,
    payerIdentity,
  };
};

const ensureValidPayNoteBootstrapRequest = async (input: {
  context: PayNoteBootstrapContext;
  responseContext: BootstrapResponseContext;
  eventId: string;
}): Promise<Record<string, unknown> | null> => {
  const { context, responseContext, eventId } = input;
  const {
    deliveryId,
    payerIdentity,
    payeeIdentity,
    senderIdentity,
    payNoteDocumentNode,
    payNoteDocument,
  } = context;

  if (payerIdentity) {
    await rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason: 'Payer binding must not be provided by merchant.',
      logMessage:
        'PayNote bootstrap request rejected (payer binding supplied by merchant)',
    });
    return null;
  }

  if (!senderIdentity || !payeeIdentity || payeeIdentity !== senderIdentity) {
    await rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason: 'Payee binding must match the delivery sender.',
      logMessage:
        'PayNote bootstrap request rejected (payee does not match delivery sender)',
    });
    return null;
  }

  if (!payNoteDocument || !payNoteDocumentNode) {
    await rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason:
        'Unsupported PayNote type. Expected PayNote/Card Transaction PayNote.',
      logMessage:
        'PayNote bootstrap request rejected (unsupported PayNote type)',
    });
    return null;
  }

  if (
    !blue.isTypeOf(payNoteDocumentNode, CardTransactionPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    await rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason:
        'Unsupported PayNote type. Expected PayNote/Card Transaction PayNote.',
      logMessage:
        'PayNote bootstrap request rejected (unsupported PayNote type)',
    });
    return null;
  }

  return payNoteDocument;
};

const resolveExistingDelivery = async (input: {
  deliveryId?: string;
  requestingSessionId?: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<PayNoteDeliveryRecord | null> => {
  const { deliveryId, requestingSessionId, deps } = input;
  if (deliveryId) {
    return deps.payNoteDeliveryRepository.getDelivery(deliveryId);
  }
  if (requestingSessionId) {
    return deps.payNoteDeliveryRepository.getDeliveryBySessionId(
      requestingSessionId
    );
  }
  return null;
};

const resolveHoldForBootstrap = async (input: {
  existingDelivery: PayNoteDeliveryRecord | null;
  requestingDeliveryCardDetails: ReturnType<
    typeof getCardTransactionDetailsFromDocument
  > | null;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<Hold | null> => {
  const { existingDelivery, requestingDeliveryCardDetails, deps } = input;
  if (existingDelivery?.holdId) {
    return deps.holdRepository.getHold(existingDelivery.holdId);
  }
  if (requestingDeliveryCardDetails) {
    return deps.holdRepository.getHoldByCardTransactionDetails(
      requestingDeliveryCardDetails
    );
  }
  return null;
};

const isDeliveryDocumentNode = (node: BlueNode | null): boolean =>
  Boolean(
    node &&
      blue.isTypeOf(node, PayNoteDeliverySchema, {
        checkSchemaExtensions: true,
      })
  );

const isPayNoteDocumentNode = (node: BlueNode | null): boolean =>
  Boolean(
    node &&
      blue.isTypeOf(node, PayNoteSchema, {
        checkSchemaExtensions: true,
      })
  );

const resolveExistingDocAllowedBootstrapType = (input: {
  node: BlueNode | null;
  requestedDocumentPayload: Record<string, unknown>;
}): string | null => {
  const { node, requestedDocumentPayload } = input;
  if (
    node &&
    blue.isTypeOf(node, MerchantToCustomerPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return 'PayNote/Merchant To Customer PayNote';
  }

  if (node && blue.isTypeOfBlueId(node, payNoteBlueIds['PayNote/PayNote'])) {
    return 'PayNote/PayNote';
  }

  const requestedTypeName = getString(requestedDocumentPayload.type);
  if (
    requestedTypeName === 'PayNote/Merchant To Customer PayNote' ||
    requestedTypeName === 'PayNote/PayNote'
  ) {
    return requestedTypeName;
  }

  return null;
};

const resolveRequestedMerchantId = (
  requestedDocumentPayload: Record<string, unknown>
): string | undefined => {
  const voucher = toSimpleRecord(requestedDocumentPayload.voucher);
  return (
    getString(requestedDocumentPayload.payerMerchantId) ??
    getString(requestedDocumentPayload.merchantId) ??
    getString(voucher?.payerMerchantId) ??
    getString(voucher?.merchantId)
  );
};

const hasExplicitBootstrapAccountNumbers = (
  requestedDocumentPayload: Record<string, unknown>
): boolean => {
  const simple =
    toSimpleRecord(requestedDocumentPayload) ?? requestedDocumentPayload;
  return Boolean(
    getString(simple.payerAccountNumber) || getString(simple.payeeAccountNumber)
  );
};

const isAccountActive = (account: {
  status?: string;
  isActive?: () => boolean;
}): boolean => {
  if (typeof account.isActive === 'function') {
    try {
      return account.isActive();
    } catch {
      return false;
    }
  }
  return account.status === 'ACTIVE';
};

const resolveMerchantCreditLineAccountNumber = async (input: {
  merchantId: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<string | undefined> => {
  const accounts = await input.deps.bankingRepository.getAccountsByUserId(
    input.merchantId
  );
  const activeCreditLine = accounts.find(
    account => account.accountType === 'CREDIT_LINE' && isAccountActive(account)
  );
  return activeCreditLine?.accountNumber;
};

const validateActiveBootstrapBindings = (input: {
  request: NormalizedBootstrapRequest;
  requestingPayerAccountId?: string;
  requestingPayeeAccountId?: string;
}):
  | { ok: true; boundClientAccountId: string }
  | {
      ok: false;
      reason:
        | 'missing_payer_or_payee_binding'
        | 'missing_requesting_participant_bindings'
        | 'no_matching_requesting_participant';
    } => {
  const { request, requestingPayerAccountId, requestingPayeeAccountId } = input;
  const payerAccountId = getString(
    request.channelBindings.payerChannel?.accountId
  );
  const payeeAccountId = getString(
    request.channelBindings.payeeChannel?.accountId
  );

  if (!payerAccountId || !payeeAccountId) {
    return { ok: false, reason: 'missing_payer_or_payee_binding' };
  }

  const requestingParticipantAccountIds = [
    requestingPayerAccountId,
    requestingPayeeAccountId,
  ].filter((value): value is string => Boolean(value));

  if (!requestingParticipantAccountIds.length) {
    return { ok: false, reason: 'missing_requesting_participant_bindings' };
  }

  const boundAccountIds = [payerAccountId, payeeAccountId];
  const boundClientAccountId = requestingParticipantAccountIds.find(accountId =>
    boundAccountIds.includes(accountId)
  );

  if (!boundClientAccountId) {
    return { ok: false, reason: 'no_matching_requesting_participant' };
  }

  return { ok: true, boundClientAccountId };
};

const resolveBootstrapCustomerChannelKey = (input: {
  request: NormalizedBootstrapRequest;
  accountId: string;
}): 'payerChannel' | 'payeeChannel' | undefined => {
  const { request, accountId } = input;
  const payerAccountId = getString(
    request.channelBindings.payerChannel?.accountId
  );
  if (payerAccountId && payerAccountId === accountId) {
    return 'payerChannel';
  }

  const payeeAccountId = getString(
    request.channelBindings.payeeChannel?.accountId
  );
  if (payeeAccountId && payeeAccountId === accountId) {
    return 'payeeChannel';
  }

  return undefined;
};

const handleExistingDocBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  requestedTypeName: string;
  requestedDocumentPayload: Record<string, unknown>;
  existingDelivery: PayNoteDeliveryRecord;
  requestingPayerAccountId?: string;
  requestingPayeeAccountId?: string;
  responseContext: BootstrapResponseContext;
  eventId: string;
  bootstrapAssignee: string;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    request,
    requestedTypeName,
    requestedDocumentPayload,
    existingDelivery,
    requestingPayerAccountId,
    requestingPayeeAccountId,
    responseContext,
    eventId,
    bootstrapAssignee,
    now,
    credentials,
    deps,
    logs,
  } = input;

  const bindingsValidation = validateActiveBootstrapBindings({
    request,
    requestingPayerAccountId,
    requestingPayeeAccountId,
  });
  if (!bindingsValidation.ok) {
    log(
      logs,
      'warn',
      'Bootstrap request ignored (invalid payer/payee bindings for active PayNote bootstrap)',
      {
        eventId,
        bootstrapAssignee,
        requestedTypeName,
        reason: bindingsValidation.reason,
        requestingPayerAccountId,
        requestingPayeeAccountId,
      }
    );
    await respondBootstrapDecision(responseContext, {
      status: 'rejected',
      reason:
        'Active PayNote bootstrap requires valid payer/payee bindings that match requesting participants.',
    });
    return true;
  }

  const guarantorBindingValidation = validateBankControlledChannelBinding({
    request,
    requestedDocumentPayload,
    channelKey: 'guarantorChannel',
    accountId: credentials.accountId,
  });
  if (!guarantorBindingValidation.ok) {
    log(
      logs,
      'warn',
      'Bootstrap request rejected (guarantor channel conflict)',
      {
        eventId,
        bootstrapAssignee,
        requestedTypeName,
        reason: guarantorBindingValidation.reason,
      }
    );
    await respondBootstrapDecision(responseContext, {
      status: 'rejected',
      reason:
        'guarantorChannel must be bound to the bank guarantor account for bootstrap.',
    });
    return true;
  }

  if (hasExplicitBootstrapAccountNumbers(requestedDocumentPayload)) {
    log(
      logs,
      'warn',
      'Bootstrap request rejected (explicit account numbers are not allowed for active PayNote bootstrap)',
      {
        eventId,
        bootstrapAssignee,
        requestedTypeName,
      }
    );
    await respondBootstrapDecision(responseContext, {
      status: 'rejected',
      reason:
        'payerAccountNumber/payeeAccountNumber are not supported for bootstrap from active PayNotes.',
    });
    return true;
  }

  const merchantId =
    existingDelivery.merchantId ??
    resolveRequestedMerchantId(requestedDocumentPayload);
  let payerAccountNumber: string | undefined;
  let payeeAccountNumber: string | undefined;

  if (requestedTypeName === 'PayNote/Merchant To Customer PayNote') {
    const rootCustomerAccountNumber = existingDelivery.accountNumber;
    if (!rootCustomerAccountNumber) {
      log(
        logs,
        'warn',
        'Bootstrap request rejected (missing root customer account for merchant-to-customer paynote)',
        {
          eventId,
          bootstrapAssignee,
          requestedTypeName,
          deliveryId: existingDelivery.deliveryId,
        }
      );
      await respondBootstrapDecision(responseContext, {
        status: 'rejected',
        reason:
          'Unable to resolve root customer account for Merchant To Customer PayNote bootstrap.',
      });
      return true;
    }

    if (!merchantId) {
      log(
        logs,
        'warn',
        'Bootstrap request rejected (missing merchant id for merchant-to-customer paynote)',
        {
          eventId,
          bootstrapAssignee,
          requestedTypeName,
          deliveryId: existingDelivery.deliveryId,
        }
      );
      await respondBootstrapDecision(responseContext, {
        status: 'rejected',
        reason:
          'Unable to resolve merchant for Merchant To Customer PayNote bootstrap.',
      });
      return true;
    }

    const merchantPayerAccountNumber =
      await resolveMerchantCreditLineAccountNumber({
        merchantId,
        deps,
      });
    if (!merchantPayerAccountNumber) {
      log(
        logs,
        'warn',
        'Bootstrap request rejected (merchant credit line account not found)',
        {
          eventId,
          bootstrapAssignee,
          requestedTypeName,
          merchantId,
        }
      );
      await respondBootstrapDecision(responseContext, {
        status: 'rejected',
        reason:
          'Unable to resolve merchant credit line account for Merchant To Customer PayNote bootstrap.',
      });
      return true;
    }

    payerAccountNumber = merchantPayerAccountNumber;
    payeeAccountNumber = rootCustomerAccountNumber;
  }

  const bootstrapDocument = normalizeBootstrapDocument(
    requestedDocumentPayload
  );

  const channelBindings: ChannelBindings = {
    ...request.channelBindings,
    guarantorChannel: { accountId: credentials.accountId },
  };

  trace(logs, 'Bootstrapping allow-listed child PayNote document', {
    eventId,
    bootstrapAssignee,
    requestedTypeName,
    boundClientAccountId: bindingsValidation.boundClientAccountId,
    deliveryId: existingDelivery.deliveryId,
  });

  await respondBootstrapDecision(responseContext, {
    status: 'accepted',
  });

  const response = await deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings,
      document: bootstrapDocument,
    },
  });

  if (!response.ok) {
    log(logs, 'error', 'Allow-listed child PayNote bootstrap failed', {
      eventId,
      bootstrapAssignee,
      requestedTypeName,
      boundClientAccountId: bindingsValidation.boundClientAccountId,
      status: response.status,
      body: response.body,
    });
    await respondBootstrapFailed(
      responseContext,
      resolveBootstrapFailureReason({
        status: response.status,
        body: response.body,
      })
    );
    return true;
  }

  const bootstrapSessionId = extractBootstrapSessionId(response);

  if (bootstrapSessionId) {
    const customerChannelKey = resolveBootstrapCustomerChannelKey({
      request,
      accountId: bindingsValidation.boundClientAccountId,
    });
    await deps.bootstrapContextRepository.saveContext({
      bootstrapSessionId,
      ...(merchantId ? { merchantId } : {}),
      ...(existingDelivery.accountNumber
        ? { accountNumber: existingDelivery.accountNumber }
        : {}),
      ...(existingDelivery.userId ? { userId: existingDelivery.userId } : {}),
      ...(existingDelivery.holdId ? { holdId: existingDelivery.holdId } : {}),
      ...(existingDelivery.transactionId
        ? { transactionId: existingDelivery.transactionId }
        : {}),
      ...(payerAccountNumber ? { payerAccountNumber } : {}),
      ...(payeeAccountNumber ? { payeeAccountNumber } : {}),
      ...(customerChannelKey ? { customerChannelKey } : {}),
      ...(responseContext.requestingSessionId
        ? { requestingSessionId: responseContext.requestingSessionId }
        : {}),
      ...(responseContext.requestId
        ? { requestId: responseContext.requestId }
        : {}),
      createdAt: now,
    });
  }

  if (bootstrapSessionId && deps.consumePendingBootstrapEvents) {
    try {
      await deps.consumePendingBootstrapEvents(bootstrapSessionId);
    } catch (error) {
      log(logs, 'error', 'Failed consuming pending bootstrap events', {
        eventId,
        bootstrapSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log(logs, 'info', 'Allow-listed child PayNote bootstrap requested', {
    eventId,
    bootstrapAssignee,
    requestedTypeName,
    boundClientAccountId: bindingsValidation.boundClientAccountId,
    deliveryId: existingDelivery.deliveryId,
    bootstrapSessionId,
  });

  return true;
};

const resolveKnownDeliveryBySessionId = async (input: {
  sessionId?: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<PayNoteDeliveryRecord | null> => {
  const { sessionId, deps } = input;
  if (!sessionId) {
    return null;
  }
  const byDeliverySession =
    await deps.payNoteDeliveryRepository.getDeliveryBySessionId(sessionId);
  if (byDeliverySession) {
    return byDeliverySession;
  }
  const byBootstrapSession =
    await deps.payNoteDeliveryRepository.getDeliveryByBootstrapSessionId(
      sessionId
    );
  if (byBootstrapSession) {
    return byBootstrapSession;
  }

  const contractLookup = deps.contractRepository as {
    getContractBySessionId?: (
      sessionId: string
    ) => Promise<{ documentId?: string } | null>;
  };
  if (typeof contractLookup.getContractBySessionId !== 'function') {
    return null;
  }

  const contract = await contractLookup.getContractBySessionId(sessionId);
  const contractDocumentId = getString(contract?.documentId);
  if (!contractDocumentId) {
    return null;
  }

  return deps.payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId(
    contractDocumentId
  );
};

const handleDeliveryBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  deliveryDocument: Record<string, unknown>;
  responseContext: BootstrapResponseContext;
  eventId: string;
  bootstrapAssignee: string;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    request,
    deliveryDocument,
    responseContext,
    eventId,
    bootstrapAssignee,
    now,
    credentials,
    deps,
    logs,
  } = input;
  const synchronySessionId =
    getSynchronySessionIdFromDocument(deliveryDocument);
  const deliveryError =
    getString(deliveryDocument.deliveryError) ??
    getString(toSimpleRecord(deliveryDocument)?.deliveryError);
  if (!synchronySessionId) {
    trace(logs, 'Delivery bootstrap request missing synchrony merchant link', {
      eventId,
      bootstrapAssignee,
    });
  }

  const cardDetails = getCardTransactionDetailsFromDocument(deliveryDocument);
  if (!cardDetails) {
    log(logs, 'warn', 'Delivery missing card transaction details', {
      eventId,
    });
    return true;
  }

  const deliveryId = buildCardTransactionDetailsKey(cardDetails);
  trace(logs, 'Processing delivery bootstrap request', {
    eventId,
    deliveryId,
  });

  const existing = await deps.payNoteDeliveryRepository.getDelivery(deliveryId);
  const deliveryRecord: PayNoteDeliveryRecord = {
    ...(existing ?? {
      deliveryId,
      createdAt: now,
      updatedAt: now,
    }),
    deliveryId,
    cardTransactionDetails: cardDetails,
    cardTransactionDetailsKey: deliveryId,
    deliveryDocument,
    synchronySessionId: existing?.synchronySessionId ?? synchronySessionId,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);

  const payNoteDelivererBindingValidation =
    validateBankControlledChannelBinding({
      request,
      requestedDocumentPayload: deliveryDocument,
      channelKey: 'payNoteDeliverer',
      accountId: credentials.accountId,
    });
  if (!payNoteDelivererBindingValidation.ok) {
    log(
      logs,
      'warn',
      'Bootstrap request rejected (delivery channel conflict)',
      {
        eventId,
        bootstrapAssignee,
        reason: payNoteDelivererBindingValidation.reason,
      }
    );
    await respondBootstrapDecision(responseContext, {
      status: 'rejected',
      reason:
        'payNoteDeliverer must be bound to the bank delivery account for bootstrap.',
    });
    return true;
  }

  const channelBindings: ChannelBindings = {
    ...request.channelBindings,
    payNoteDeliverer: { accountId: credentials.accountId },
  };

  trace(logs, 'Bootstrapping PayNote Delivery document', {
    eventId,
    deliveryId,
    channelBindingCount: Object.keys(channelBindings).length,
    hasDeliveryDocument: Boolean(deliveryDocument),
  });

  await respondBootstrapDecision(responseContext, {
    status: 'accepted',
  });

  const bootstrapDocument = normalizeBootstrapDocument(deliveryDocument);
  const response = await deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings,
      document: bootstrapDocument,
    },
  });

  if (!response.ok) {
    log(logs, 'error', 'PayNote Delivery bootstrap failed', {
      eventId,
      status: response.status,
      body: response.body,
    });
    await respondBootstrapFailed(
      responseContext,
      resolveBootstrapFailureReason({
        status: response.status,
        body: response.body,
      })
    );
  } else {
    log(logs, 'info', 'PayNote Delivery bootstrap requested', {
      eventId,
      deliveryId,
    });
  }

  const bootstrapSessionId = response.ok
    ? extractBootstrapSessionId(response)
    : undefined;

  if (response.ok && bootstrapSessionId) {
    const deliverySessionIds = mergeSessionIds(
      deliveryRecord.deliverySessionIds ??
        (deliveryRecord.deliverySessionId
          ? [deliveryRecord.deliverySessionId]
          : undefined),
      bootstrapSessionId
    );

    await deps.payNoteDeliveryRepository.saveDelivery({
      ...deliveryRecord,
      deliverySessionId: deliveryRecord.deliverySessionId ?? bootstrapSessionId,
      deliverySessionIds,
      updatedAt: now,
    });

    const canonicalDeliverySessionId =
      deliveryRecord.deliverySessionId ?? bootstrapSessionId;
    if (
      deps.enqueuePayNoteDeliverySummary &&
      canonicalDeliverySessionId === bootstrapSessionId
    ) {
      void deps.enqueuePayNoteDeliverySummary({
        sessionId: canonicalDeliverySessionId,
        reason: 'delivery-bootstrap',
      });
    }

    await deps.bootstrapContextRepository.saveContext({
      bootstrapSessionId,
      ...(deliveryRecord.merchantId
        ? { merchantId: deliveryRecord.merchantId }
        : {}),
      ...(deliveryRecord.accountNumber
        ? { accountNumber: deliveryRecord.accountNumber }
        : {}),
      ...(deliveryRecord.userId ? { userId: deliveryRecord.userId } : {}),
      ...(deliveryRecord.holdId ? { holdId: deliveryRecord.holdId } : {}),
      ...(deliveryRecord.transactionId
        ? { transactionId: deliveryRecord.transactionId }
        : {}),
      ...(responseContext.requestingSessionId
        ? { requestingSessionId: responseContext.requestingSessionId }
        : {}),
      ...(responseContext.requestId
        ? { requestId: responseContext.requestId }
        : {}),
      createdAt: now,
    });
  }

  if (response.ok && deliveryError) {
    if (!bootstrapSessionId) {
      log(
        logs,
        'error',
        'Failed to report PayNote Delivery bootstrap error (missing session id)',
        { eventId, deliveryId }
      );
      return true;
    }

    const reportResponse = await deps.myOsClient.runDocumentOperation({
      credentials,
      sessionId: bootstrapSessionId,
      operation: 'reportDeliveryError',
      payload: deliveryError,
    });

    if (!reportResponse.ok) {
      log(logs, 'error', 'Failed to report PayNote Delivery error', {
        eventId,
        deliveryId,
        status: reportResponse.status,
        body: reportResponse.body,
      });
    } else {
      log(logs, 'info', 'Reported PayNote Delivery error', {
        eventId,
        deliveryId,
      });
    }
  }

  return true;
};

const handlePayNoteBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  requestedDocumentNode: BlueNode | null;
  requestedDocumentPayload?: Record<string, unknown> | null;
  responseContext: BootstrapResponseContext;
  eventId: string;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    request,
    requestedDocumentNode,
    requestedDocumentPayload,
    responseContext,
    eventId,
    eventObject,
    documentPayload,
    now,
    credentials,
    deps,
    logs,
  } = input;

  const context = buildPayNoteBootstrapContext({
    request,
    documentNode: requestedDocumentNode,
    requestedDocumentPayload,
    eventObject,
    documentPayload,
  });
  const payNoteDocument = await ensureValidPayNoteBootstrapRequest({
    context,
    responseContext,
    eventId,
  });

  if (!payNoteDocument) {
    return true;
  }

  const { deliveryId, requestingSessionId, requestingDeliveryCardDetails } =
    context;
  const existingDelivery = await resolveExistingDelivery({
    deliveryId,
    requestingSessionId,
    deps,
  });
  const payNoteSummary = getPayNoteSummaryFromDocument(payNoteDocument);
  const payNoteAmountMinor = payNoteSummary.amountMinor;
  const holdForBootstrap =
    existingDelivery?.merchantId || payNoteAmountMinor !== undefined
      ? await resolveHoldForBootstrap({
          existingDelivery,
          requestingDeliveryCardDetails,
          deps,
        })
      : null;
  const merchantId =
    existingDelivery?.merchantId ?? holdForBootstrap?.merchantId;

  if (payNoteAmountMinor !== undefined) {
    if (
      holdForBootstrap &&
      holdForBootstrap.amountMinor !== payNoteAmountMinor
    ) {
      const deliveryError = `PayNote amount (${payNoteAmountMinor}) does not match transaction amount (${holdForBootstrap.amountMinor})`;
      return rejectPayNoteBootstrapRequest({
        context: responseContext,
        eventId,
        deliveryId,
        reason: deliveryError,
        logMessage: 'PayNote bootstrap request rejected (amount mismatch)',
        logContext: {
          holdId: holdForBootstrap.holdId,
          payNoteAmountMinor,
          holdAmountMinor: holdForBootstrap.amountMinor,
        },
      });
    }
  }

  const guarantorBindingValidation = validateBankControlledChannelBinding({
    request,
    requestedDocumentPayload: payNoteDocument,
    channelKey: 'guarantorChannel',
    accountId: credentials.accountId,
  });
  if (!guarantorBindingValidation.ok) {
    return rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason:
        'guarantorChannel must be bound to the bank guarantor account for bootstrap.',
      logMessage:
        'PayNote bootstrap request rejected (guarantor channel conflict)',
      logContext: {
        reason: guarantorBindingValidation.reason,
      },
    });
  }

  const payerBindingValidation = validateBankControlledChannelBinding({
    request,
    requestedDocumentPayload: payNoteDocument,
    channelKey: 'payerChannel',
    accountId: credentials.accountId,
  });
  if (!payerBindingValidation.ok) {
    return rejectPayNoteBootstrapRequest({
      context: responseContext,
      eventId,
      deliveryId,
      reason:
        'payerChannel must be bound to the bank payer account for bootstrap.',
      logMessage: 'PayNote bootstrap request rejected (payer channel conflict)',
      logContext: {
        reason: payerBindingValidation.reason,
      },
    });
  }

  const channelBindings: ChannelBindings = {
    ...request.channelBindings,
    payerChannel: { accountId: credentials.accountId },
    guarantorChannel: { accountId: credentials.accountId },
  };

  trace(logs, 'Bootstrapping PayNote document', {
    eventId,
    deliveryId,
    channelBindingCount: Object.keys(channelBindings).length,
    hasPayNoteDocument: Boolean(payNoteDocument),
  });

  await respondBootstrapDecision(responseContext, {
    status: 'accepted',
  });

  const bootstrapDocument = normalizeBootstrapDocument(payNoteDocument);
  const response = await deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings,
      document: bootstrapDocument,
    },
  });

  if (!response.ok) {
    log(logs, 'error', 'PayNote bootstrap failed', {
      eventId,
      status: response.status,
      body: response.body,
    });
    await respondBootstrapFailed(
      responseContext,
      resolveBootstrapFailureReason({
        status: response.status,
        body: response.body,
      })
    );
    return true;
  }

  const bootstrapSessionId = extractBootstrapSessionId(response);

  if (existingDelivery) {
    await deps.payNoteDeliveryRepository.saveDelivery({
      ...existingDelivery,
      payNoteBootstrapRequestedAt: now,
      payNoteBootstrapSessionId:
        existingDelivery.payNoteBootstrapSessionId ?? bootstrapSessionId,
      updatedAt: now,
    });
  }

  if (bootstrapSessionId) {
    await deps.bootstrapContextRepository.saveContext({
      bootstrapSessionId,
      ...(merchantId ? { merchantId } : {}),
      ...(existingDelivery?.accountNumber
        ? { accountNumber: existingDelivery.accountNumber }
        : {}),
      ...(existingDelivery?.userId ? { userId: existingDelivery.userId } : {}),
      ...(existingDelivery?.holdId ? { holdId: existingDelivery.holdId } : {}),
      ...(existingDelivery?.transactionId
        ? { transactionId: existingDelivery.transactionId }
        : {}),
      ...(responseContext.requestingSessionId
        ? { requestingSessionId: responseContext.requestingSessionId }
        : {}),
      ...(responseContext.requestId
        ? { requestId: responseContext.requestId }
        : {}),
      createdAt: now,
    });
  }

  if (bootstrapSessionId && deps.consumePendingBootstrapEvents) {
    try {
      await deps.consumePendingBootstrapEvents(bootstrapSessionId);
    } catch (error) {
      log(logs, 'error', 'Failed consuming pending bootstrap events', {
        eventId,
        bootstrapSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log(logs, 'info', 'PayNote bootstrap requested', {
    eventId,
    bootstrapSessionId,
    deliveryId: existingDelivery?.deliveryId ?? deliveryId,
  });

  return true;
};

export const handleBootstrapRequests = async (input: {
  requests: BootstrapRequest[];
  eventId: string;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { requests, eventId, eventObject, documentPayload, now, deps, logs } =
    input;
  const credentials = await deps.myOsClient.getCredentials();
  const requestingSessionId = getString(eventObject?.sessionId);
  const requestingDocumentNode = eventObject?.document
    ? toBlueNode(eventObject.document)
    : null;
  const isRequestingDeliveryDoc = isDeliveryDocumentNode(
    requestingDocumentNode
  );
  const requestingContracts = documentPayload
    ? toSimpleRecord(documentPayload.contracts)
    : null;
  const requestingBindings = requestingContracts
    ? buildChannelBindingsFromContracts(requestingContracts)
    : {};
  const requestingPayerAccountId = getString(
    requestingBindings.payerChannel?.accountId
  );
  const requestingPayeeAccountId = getString(
    requestingBindings.payeeChannel?.accountId
  );
  const canHandleAllowListedFromDelivery = Boolean(
    isRequestingDeliveryDoc &&
      requestingPayerAccountId &&
      requestingPayeeAccountId
  );
  const isSynchronyMerchantDoc = Boolean(
    requestingContracts?.synchronyChannel && requestingContracts?.sendPayNote
  );
  let knownDelivery: PayNoteDeliveryRecord | null | undefined;
  const getKnownDelivery = async () => {
    if (knownDelivery !== undefined) {
      return knownDelivery;
    }
    knownDelivery = await resolveKnownDeliveryBySessionId({
      sessionId: requestingSessionId,
      deps,
    });
    return knownDelivery;
  };
  const shouldRequireKnownRequestingSession =
    !isRequestingDeliveryDoc && !isSynchronyMerchantDoc;
  const canResolveCanonicalRequestingSession =
    typeof deps.contractRepository.getContractBySessionId === 'function';
  const canonicalRequestingContract =
    shouldRequireKnownRequestingSession &&
    canResolveCanonicalRequestingSession &&
    requestingSessionId
      ? await deps.contractRepository.getContractBySessionId?.(
          requestingSessionId
        )
      : null;
  if (
    shouldRequireKnownRequestingSession &&
    canResolveCanonicalRequestingSession &&
    !canonicalRequestingContract
  ) {
    log(
      logs,
      'info',
      'Bootstrap requests ignored (unknown or non-canonical requesting session)',
      {
        eventId,
        requestingSessionId: requestingSessionId ?? null,
      }
    );
    return;
  }
  const canonicalRequestingDocumentId = getString(
    canonicalRequestingContract?.documentId
  );
  const knownRequestingDelivery = shouldRequireKnownRequestingSession
    ? canonicalRequestingDocumentId
      ? await deps.payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId(
          canonicalRequestingDocumentId
        )
      : await getKnownDelivery()
    : null;
  if (shouldRequireKnownRequestingSession && !knownRequestingDelivery) {
    log(
      logs,
      'info',
      'Bootstrap requests ignored (unknown or non-canonical requesting session)',
      {
        eventId,
        requestingSessionId: requestingSessionId ?? null,
      }
    );
    return;
  }

  for (const request of requests) {
    const normalized = normalizeBootstrapRequest(request.request);
    const bootstrapAssignee = normalized.bootstrapAssignee;
    const responseContext: BootstrapResponseContext = {
      eventId,
      bootstrapAssignee,
      requestingSessionId,
      requestId: normalized.requestId,
      credentials,
      deps,
      logs,
    };

    if (!bootstrapAssignee) {
      log(logs, 'warn', 'Bootstrap request missing bootstrapAssignee', {
        eventId,
      });
      continue;
    }

    if (
      !isBootstrapAssigneeMatch(
        documentPayload,
        bootstrapAssignee,
        credentials.accountId
      )
    ) {
      trace(logs, 'Bootstrap request ignored (not assigned)', {
        eventId,
        bootstrapAssignee,
      });
      continue;
    }

    const requestedDocumentPayload =
      request.documentPayload ?? normalized.document ?? null;
    if (!requestedDocumentPayload) {
      log(logs, 'warn', 'Bootstrap request missing document', { eventId });
      await respondBootstrapDecision(responseContext, {
        status: 'rejected',
        reason: 'Bootstrap request missing document payload.',
      });
      continue;
    }

    const requestedDocumentNode = request.documentNode;

    if (isDeliveryDocumentNode(requestedDocumentNode)) {
      if (!isSynchronyMerchantDoc) {
        log(
          logs,
          'warn',
          'Bootstrap request ignored (delivery bootstrap outside synchrony merchant)',
          {
            eventId,
            bootstrapAssignee,
          }
        );
        await respondBootstrapDecision(responseContext, {
          status: 'rejected',
          reason:
            'Delivery bootstrap is allowed only for synchrony merchant documents.',
        });
        continue;
      }

      await handleDeliveryBootstrapRequest({
        request: normalized,
        deliveryDocument: requestedDocumentPayload,
        responseContext,
        eventId,
        bootstrapAssignee,
        now,
        credentials,
        deps,
        logs,
      });
      continue;
    }

    const allowedExistingDocType = resolveExistingDocAllowedBootstrapType({
      node: requestedDocumentNode,
      requestedDocumentPayload,
    });
    if (
      allowedExistingDocType &&
      (!isRequestingDeliveryDoc || canHandleAllowListedFromDelivery)
    ) {
      const existingDelivery = isRequestingDeliveryDoc
        ? await getKnownDelivery()
        : knownRequestingDelivery;
      if (!existingDelivery) {
        if (isRequestingDeliveryDoc) {
          log(
            logs,
            'warn',
            'Bootstrap request rejected (unable to resolve delivery context for delivery-origin allow-listed bootstrap)',
            {
              eventId,
              bootstrapAssignee,
              requestedTypeName: allowedExistingDocType,
              requestingSessionId: requestingSessionId ?? null,
            }
          );
          await respondBootstrapDecision(responseContext, {
            status: 'rejected',
            reason:
              'Unable to resolve requesting session for active PayNote bootstrap.',
          });
        } else {
          log(
            logs,
            'info',
            'Bootstrap request ignored (unknown or non-canonical requesting session)',
            {
              eventId,
              bootstrapAssignee,
              requestedTypeName: allowedExistingDocType,
            }
          );
        }
        continue;
      }

      await handleExistingDocBootstrapRequest({
        request: normalized,
        requestedTypeName: allowedExistingDocType,
        requestedDocumentPayload,
        existingDelivery,
        requestingPayerAccountId,
        requestingPayeeAccountId,
        responseContext,
        eventId,
        bootstrapAssignee,
        now,
        credentials,
        deps,
        logs,
      });
      continue;
    }

    if (isPayNoteDocumentNode(requestedDocumentNode)) {
      if (!isRequestingDeliveryDoc) {
        log(
          logs,
          'warn',
          'Bootstrap request ignored (paynote bootstrap outside delivery document)',
          {
            eventId,
            bootstrapAssignee,
          }
        );
        await respondBootstrapDecision(responseContext, {
          status: 'rejected',
          reason:
            'PayNote bootstrap is allowed only when requested from a delivery document.',
        });
        continue;
      }

      await handlePayNoteBootstrapRequest({
        request: normalized,
        requestedDocumentNode,
        requestedDocumentPayload,
        responseContext,
        eventId,
        eventObject,
        documentPayload,
        now,
        credentials,
        deps,
        logs,
      });
      continue;
    }

    log(logs, 'warn', 'Bootstrap request rejected (unsupported document)', {
      eventId,
      bootstrapAssignee,
    });
    await respondBootstrapDecision(responseContext, {
      status: 'rejected',
      reason: 'Unsupported document type for bootstrap.',
    });
  }
};
