import { readFileSync } from 'node:fs';

import { DocumentProcessor } from '@blue-labs/document-processor';
import { describe, expect, it } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';

import { blue } from '../../../blue';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const loadFixture = (fileName: string): JsonValue => {
  const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);
  const raw = readFileSync(fixtureUrl, 'utf8');

  return JSON.parse(raw) as JsonValue;
};

const AUTHORIZE_SPEND_CODE = `
const request =
  event && event.message && event.message.request
    ? event.message.request
    : {};

const unwrapNodeValue = function (value) {
  if (
    value &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  ) {
    return value.value;
  }
  return value;
};

const toText = function (value) {
  const unwrapped = unwrapNodeValue(value);
  return typeof unwrapped === 'string' ? unwrapped : '';
};

const toTimestampText = function (value) {
  const unwrapped = unwrapNodeValue(value);
  if (typeof unwrapped === 'string') {
    return unwrapped;
  }
  if (typeof unwrapped === 'number') {
    return String(unwrapped);
  }
  return '';
};

const nowIso =
  toText(request.requestedAt) ||
  toTimestampText(event && event.timestamp ? event.timestamp : '');

const normalizeTimestamp = function (value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  let digits = '';
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      digits += value.charAt(index);
    }
    index += 1;
  }
  if (digits.length < 14) {
    return '';
  }
  return digits.slice(0, 14);
};

const toInteger = function (value, fallback) {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? Math.trunc(fallback)
      : 0;
  const unwrapped = unwrapNodeValue(value);
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    return Math.trunc(unwrapped);
  }
  if (typeof unwrapped !== 'string' || !unwrapped) {
    return safeFallback;
  }
  const parsed = Number(unwrapped);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : safeFallback;
};

const cloneObject = function (value) {
  const source = value && typeof value === 'object' ? value : {};
  const clone = {};
  Object.keys(source).forEach(function (key) {
    clone[key] = source[key];
  });
  return clone;
};

const chargeAttemptId =
  toText(request.chargeAttemptId);
const amountMinor = toInteger(request.amountMinor, 0);
const counterpartyType = toText(request.counterpartyType);
const counterpartyId = toText(request.counterpartyId);
const requestedCurrency = toText(request.currency);

const chargeAttempts = document.canonical('/chargeAttempts') || {};
const nextChargeAttempts = cloneObject(chargeAttempts);

const existingAttempt =
  chargeAttemptId &&
  chargeAttempts[chargeAttemptId] &&
  typeof chargeAttempts[chargeAttemptId] === 'object'
    ? chargeAttempts[chargeAttemptId]
    : null;
const existingDecision =
  existingAttempt ? toText(existingAttempt.authorizationStatus) : '';
const existingReason =
  existingAttempt ? toText(existingAttempt.authorizationReason) : '';

const amountLimit = toInteger(document('/amountLimit'), 0);
const amountReserved = toInteger(document('/amountReserved'), 0);
const amountCaptured = toInteger(document('/amountCaptured'), 0);
const mandateCurrency = toText(document('/currency'));
const expiresAt = toText(document('/expiresAt'));
const revokedAt = toText(document('/revokedAt'));
const nowComparable = normalizeTimestamp(nowIso);

const allowedCounterparties = document.canonical('/allowedPaymentCounterparties');
const isCounterpartyAllowed =
  !Array.isArray(allowedCounterparties) ||
  allowedCounterparties.length === 0 ||
  allowedCounterparties.some(function (item) {
    return (
      item &&
      item.counterpartyType === counterpartyType &&
      item.counterpartyId === counterpartyId
    );
  });

let status = 'rejected';
let reason = '';
let nextAmountReserved = amountReserved;

if (existingDecision === 'approved' || existingDecision === 'rejected') {
  status = existingDecision;
  reason = existingDecision === 'rejected' ? existingReason : '';
} else if (!chargeAttemptId) {
  reason = 'Missing chargeAttemptId.';
} else if (amountMinor <= 0) {
  reason = 'Amount must be greater than zero.';
} else if (!requestedCurrency || requestedCurrency !== mandateCurrency) {
  reason = 'Currency does not match mandate currency.';
} else if (revokedAt) {
  reason = 'Mandate is revoked.';
} else if (
  expiresAt &&
  normalizeTimestamp(expiresAt) &&
  nowComparable &&
  normalizeTimestamp(expiresAt) < nowComparable
) {
  reason = 'Mandate is expired.';
} else if (!isCounterpartyAllowed) {
  reason = 'Counterparty is not allowed by mandate.';
} else if (amountReserved + amountCaptured + amountMinor > amountLimit) {
  reason = 'Mandate amount limit exceeded.';
} else {
  status = 'approved';
  nextAmountReserved = amountReserved + amountMinor;
}

if (chargeAttemptId && !existingDecision) {
  nextChargeAttempts[chargeAttemptId] = {
    amountMinor,
    currency: requestedCurrency,
    counterpartyType,
    counterpartyId,
    chargeMode:
      toText(request.chargeMode),
    authorizationStatus: status,
    authorizationReason: reason,
    authorizationRespondedAt: nowIso,
    authorizedAmountMinor: status === 'approved' ? amountMinor : 0,
    settled: false,
    lastSettlementRequestStatus: '',
    lastSettlementProcessingStatus: '',
    settlementReason: '',
    settlementRespondedAt: '',
    reservedDeltaMinor: 0,
    capturedDeltaMinor: 0,
    holdId: '',
    transactionId: ''
  };
}

const remainingAmountMinor = Math.max(
  0,
  amountLimit - (nextAmountReserved + amountCaptured)
);

const responseEvent = {
  type: 'PayNote/Payment Mandate Spend Authorization Responded',
  chargeAttemptId,
  status,
  remainingAmountMinor,
  respondedAt: nowIso
};

if (reason) {
  responseEvent.reason = reason;
}

return {
  nextChargeAttempts: nextChargeAttempts,
  nextAmountReserved: nextAmountReserved,
  events: [responseEvent]
};
`;

const buildInlinePaymentMandateDocument = (): JsonValue => {
  const base = loadFixture(
    'paymentMandate-authorizeSpend-epoch0-document.json'
  );
  const document = structuredClone(base) as {
    contracts?: {
      authorizeSpendImpl?: {
        steps?: {
          items?: Array<{
            code?: { value?: string } | string;
          }>;
        };
      };
    };
  };

  const steps = document.contracts?.authorizeSpendImpl?.steps?.items;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Missing authorizeSpendImpl steps in mandate fixture.');
  }

  const firstStepCode = steps[0]?.code;
  if (typeof firstStepCode === 'string') {
    steps[0].code = AUTHORIZE_SPEND_CODE;
    return document as JsonValue;
  }

  if (
    !firstStepCode ||
    typeof firstStepCode !== 'object' ||
    typeof firstStepCode.value !== 'string'
  ) {
    throw new Error('Missing authorizeSpendImpl JS code in mandate fixture.');
  }

  firstStepCode.value = AUTHORIZE_SPEND_CODE;
  return document as JsonValue;
};

describe('payment mandate runtime repro', () => {
  it('emits authorization response for inline payment mandate workflow', async () => {
    const mandateDocument = buildInlinePaymentMandateDocument();
    const triggerEntry = loadFixture(
      'paymentMandate-authorizeSpend-epoch1-triggeredBy.json'
    );
    const patchedCode =
      ((
        mandateDocument as {
          contracts?: {
            authorizeSpendImpl?: {
              steps?: {
                items?: Array<{
                  code?: { value?: string } | string;
                }>;
              };
            };
          };
        }
      ).contracts?.authorizeSpendImpl?.steps?.items?.[0]?.code as
        | { value?: string }
        | string
        | undefined) || '';
    const patchedCodeText =
      typeof patchedCode === 'string' ? patchedCode : patchedCode.value || '';
    expect(patchedCodeText).toContain('charCodeAt');
    expect(patchedCodeText).not.toContain('/[^0-9]/g');

    const processor = new DocumentProcessor({ blue });

    const result = await processor.processDocument(
      blue.jsonValueToNode(mandateDocument),
      blue.jsonValueToNode(triggerEntry)
    );

    const emitted = result.triggeredEvents.map(node =>
      blue.nodeToJson(node, 'simple')
    );

    expect(result.capabilityFailure).toBe(false);
    expect(result.failureReason).toBeNull();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: {
        blueId:
          paynoteBlueIds[
            'PayNote/Payment Mandate Spend Authorization Responded'
          ],
      },
    });
  });
});
