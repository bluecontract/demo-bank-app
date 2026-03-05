import {
  CustomerActionRequestedSchema,
  DocumentBootstrapRequestedSchema,
} from '@blue-repository/types/packages/conversation/schemas';
import {
  CardTransactionCaptureLockRequestedSchema,
  CardTransactionCaptureUnlockRequestedSchema,
  CaptureFundsRequestedSchema,
  LinkedCardChargeAndCaptureImmediatelyRequestedSchema,
  LinkedCardChargeRequestedSchema,
  PaymentMandateSpendAuthorizationRespondedSchema,
  PaymentMandateSpendSettlementRespondedSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
  ReverseCardChargeAndCaptureImmediatelyRequestedSchema,
  ReverseCardChargeRequestedSchema,
  StartCardTransactionMonitoringRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type { BlueNode } from '@blue-labs/language';
import { blue } from '../../../blue';
import type { WebhookEmittedEvent } from './types';
import { getString } from './utils';

export const RESERVE_FUNDS_EVENT_NAME = 'PayNote/Reserve Funds Requested';
export const CAPTURE_FUNDS_EVENT_NAME = 'PayNote/Capture Funds Requested';
export const RESERVATION_RELEASE_EVENT_NAME =
  'PayNote/Reservation Release Requested';
export const CAPTURE_IMMEDIATELY_EVENT_NAME =
  'PayNote/Reserve Funds and Capture Immediately Requested';
export const CAPTURE_LOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Lock Requested';
export const CAPTURE_UNLOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Unlock Requested';
export const DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME =
  'Conversation/Document Bootstrap Requested';
export const CUSTOMER_ACTION_REQUESTED_EVENT_NAME =
  'Conversation/Customer Action Requested';
export const START_CARD_TRANSACTION_MONITORING_REQUESTED_EVENT_NAME =
  'PayNote/Start Card Transaction Monitoring Requested';
export const LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME =
  'PayNote/Linked Card Charge Requested';
export const LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME =
  'PayNote/Linked Card Charge and Capture Immediately Requested';
export const REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME =
  'PayNote/Reverse Card Charge Requested';
export const REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME =
  'PayNote/Reverse Card Charge and Capture Immediately Requested';
export const MANDATE_SPEND_AUTHORIZATION_RESPONDED_EVENT_NAME =
  'PayNote/Payment Mandate Spend Authorization Responded';
export const MANDATE_SPEND_SETTLEMENT_RESPONDED_EVENT_NAME =
  'PayNote/Payment Mandate Spend Settlement Responded';

export const CHARGE_ATTEMPT_ID_PREFIX = 'paynote-card-charge-attempt:';
export const TRANSFER_MANDATE_CHARGE_ATTEMPT_ID_PREFIX =
  'paynote-transfer-mandate-attempt:';

type EventTypeLabelResolution =
  | {
      kind: 'prefixed';
      value: string;
    }
  | {
      kind: 'short';
      value: string;
    }
  | {
      kind: 'none';
    };

const parseTypeLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveEventTypeLabel = (event: unknown): EventTypeLabelResolution => {
  if (!event || typeof event !== 'object') {
    return { kind: 'none' };
  }

  const type = (event as { type?: unknown }).type;
  const directLabel = parseTypeLabel(type);
  if (directLabel) {
    return directLabel.includes('/')
      ? { kind: 'prefixed', value: directLabel }
      : { kind: 'short', value: directLabel };
  }

  if (!type || typeof type !== 'object') {
    return { kind: 'none' };
  }

  const typeRecord = type as { name?: unknown; value?: unknown };
  const fromName = parseTypeLabel(typeRecord.name);
  if (fromName) {
    return fromName.includes('/')
      ? { kind: 'prefixed', value: fromName }
      : { kind: 'short', value: fromName };
  }
  const fromValue = parseTypeLabel(typeRecord.value);
  if (fromValue) {
    return fromValue.includes('/')
      ? { kind: 'prefixed', value: fromValue }
      : { kind: 'short', value: fromValue };
  }
  return { kind: 'none' };
};

const resolveEventType = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    if (
      blue.isTypeOf(node, CardTransactionCaptureLockRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return CAPTURE_LOCK_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, CardTransactionCaptureUnlockRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return CAPTURE_UNLOCK_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(
        node,
        LinkedCardChargeAndCaptureImmediatelyRequestedSchema,
        {
          checkSchemaExtensions: true,
        }
      )
    ) {
      return LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, LinkedCardChargeRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(
        node,
        ReverseCardChargeAndCaptureImmediatelyRequestedSchema,
        {
          checkSchemaExtensions: true,
        }
      )
    ) {
      return REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, ReverseCardChargeRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, PaymentMandateSpendAuthorizationRespondedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return MANDATE_SPEND_AUTHORIZATION_RESPONDED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, PaymentMandateSpendSettlementRespondedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return MANDATE_SPEND_SETTLEMENT_RESPONDED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, DocumentBootstrapRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, CustomerActionRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return CUSTOMER_ACTION_REQUESTED_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return CAPTURE_IMMEDIATELY_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, CaptureFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return CAPTURE_FUNDS_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, ReserveFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return RESERVE_FUNDS_EVENT_NAME;
    }
    if (
      blue.isTypeOf(node, StartCardTransactionMonitoringRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return START_CARD_TRANSACTION_MONITORING_REQUESTED_EVENT_NAME;
    }
  } catch {
    // ignore parse failures; the label fallback is handled separately
  }

  return undefined;
};

const getNodeTextProperty = (
  node: BlueNode,
  propertyName: string
): string | undefined => {
  const property = node.getProperties()?.[propertyName];
  if (!property) {
    return undefined;
  }
  const value = property.getValue();
  const direct = getString(value);
  if (direct) {
    return direct;
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'value' in value
  ) {
    return getString((value as { value?: unknown }).value);
  }
  return undefined;
};

export const resolveEmittedEventType = (
  event: WebhookEmittedEvent
): string | undefined => {
  const label = resolveEventTypeLabel(event);
  if (label.kind === 'prefixed') {
    return label.value;
  }
  if (label.kind === 'short') {
    // Event type names must include package prefix (e.g. "Conversation/...").
    return undefined;
  }
  return resolveEventType(event);
};

export const resolveTransferRequestId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    const direct = getNodeTextProperty(node, 'requestId');
    if (direct) {
      return direct;
    }

    if (
      blue.isTypeOf(node, ReserveFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(node, ReserveFundsRequestedSchema);
      return getString(output.requestId);
    }

    if (
      blue.isTypeOf(node, CaptureFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(node, CaptureFundsRequestedSchema);
      return getString(output.requestId);
    }

    if (
      blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(
        node,
        ReserveFundsAndCaptureImmediatelyRequestedSchema
      );
      return getString(output.requestId);
    }
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};

export const resolveTransferPaymentMandateDocumentId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    const direct = getNodeTextProperty(node, 'paymentMandateDocumentId');
    if (direct) {
      return direct;
    }

    if (
      blue.isTypeOf(node, ReserveFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(
        node,
        ReserveFundsRequestedSchema
      ) as { paymentMandateDocumentId?: unknown } | undefined;
      return getString(output?.paymentMandateDocumentId);
    }

    if (
      blue.isTypeOf(node, CaptureFundsRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(
        node,
        CaptureFundsRequestedSchema
      ) as { paymentMandateDocumentId?: unknown } | undefined;
      return getString(output?.paymentMandateDocumentId);
    }

    if (
      blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      const output = blue.nodeToSchemaOutput(
        node,
        ReserveFundsAndCaptureImmediatelyRequestedSchema
      ) as { paymentMandateDocumentId?: unknown } | undefined;
      return getString(output?.paymentMandateDocumentId);
    }
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};

export const resolveTransferHoldId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    return getNodeTextProperty(node, 'holdId');
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};

export const resolveCaptureRequestId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    const isCaptureRequest =
      blue.isTypeOf(node, CardTransactionCaptureLockRequestedSchema, {
        checkSchemaExtensions: true,
      }) ||
      blue.isTypeOf(node, CardTransactionCaptureUnlockRequestedSchema, {
        checkSchemaExtensions: true,
      });
    if (!isCaptureRequest) {
      return undefined;
    }
    return getNodeTextProperty(node, 'requestId');
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};

export const resolveMonitoringRequestId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    if (
      !blue.isTypeOf(node, StartCardTransactionMonitoringRequestedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return undefined;
    }
    const output = blue.nodeToSchemaOutput(
      node,
      StartCardTransactionMonitoringRequestedSchema
    );
    return getString(output.requestId);
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};

export const resolveChargeRequestId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.resolve(blue.jsonValueToNode(event));
    return getNodeTextProperty(node, 'requestId');
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};
