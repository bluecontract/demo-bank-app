import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import type { PayNoteLiveTestContext } from '../live/lib/testContext';
import { createPayNoteLiveTestContext } from '../live/lib/testContext';
import { requireAgentMyOsEnv, requireBankMyOsEnv } from '../lib/agentEnv';
import {
  MYOS_DOCUMENT_CREATED,
  MyOsLiveClient,
} from '../live/lib/MyOsLiveClient';
import { buildTestWebhookHeaders, EventPump } from '../live/lib/EventPump';
import { createFundedCustomerWithCard } from '../live/lib/scenarioSetup';
import { FAST_AMOUNTS } from '../live/lib/amounts';
import {
  createScenarioRunContext,
  logScenarioStep,
} from '../live/lib/reporting';
import {
  waitForNoDuplicatePayNoteCaptureSequenceAfterReplay,
  waitForPayNoteCaptureSequence,
  waitForSinglePostedCapture,
} from '../live/lib/assertions';
import { waitForExpectWithLogging } from '../live/lib/wait';
import { toMyOsWebhookPayload } from '../live/lib/myOsWebhookPayload';
import {
  buildCardDeliveryDocument,
  buildPendingInstallDeliveryDocument,
} from '../live/lib/simplePayNoteBuilders';
import {
  buildSubscriptionDeliveryDocumentFromFixture,
  buildVoucherMonitoringPayNote,
} from '../live/lib/documentFixtures';

const enabled = process.env.MYOS_E2E_ENABLED === '1';

type MyOsEnvSnapshot = {
  baseUrl?: string;
  apiKey?: string;
  accountId?: string;
};

type MyOsEventReadableClient = Pick<
  MyOsLiveClient,
  'listRelevantDocumentEvents' | 'fetchEvent'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const DOCUMENT_BOOTSTRAP_REQUESTED_BLUE_ID =
  conversationBlueIds['Conversation/Document Bootstrap Requested'];

const extractBlueString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.value === 'string') {
    return value.value.trim();
  }
  return undefined;
};

const extractBlueId = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.blueId === 'string' && value.blueId.trim().length > 0) {
    return value.blueId.trim();
  }

  if (isRecord(value.type)) {
    return extractBlueId(value.type);
  }

  return undefined;
};

const isDocumentBootstrapRequested = (value: unknown) => {
  const typeName = extractBlueString(value);
  if (typeName === 'Conversation/Document Bootstrap Requested') {
    return true;
  }

  return extractBlueId(value) === DOCUMENT_BOOTSTRAP_REQUESTED_BLUE_ID;
};

const extractBlueStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map(item => extractBlueString(item))
      .filter((item): item is string => Boolean(item));
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items
      .map(item => extractBlueString(item))
      .filter((item): item is string => Boolean(item));
  }
  return [];
};

const requireNonEmptyString = (
  value: string | undefined,
  label: string
): string => {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`${label} is required`);
};

const summarizeBootstrapDocument = (document: Record<string, unknown>) => ({
  bootstrapStatus: extractBlueString(document.bootstrapStatus),
  bootstrapError: extractBlueString(document.bootstrapError),
  initiatorSessionIds: extractBlueStringList(document.initiatorSessionIds),
  participantChannels: isRecord(document.participantsState)
    ? Object.keys(document.participantsState)
    : [],
  documentKeys: Object.keys(document),
});

const captureMyOsEnv = (): MyOsEnvSnapshot => ({
  baseUrl: process.env.MYOS_BASE_URL,
  apiKey: process.env.MYOS_API_KEY,
  accountId: process.env.MYOS_ACCOUNT_ID,
});

const restoreMyOsEnv = (snapshot: MyOsEnvSnapshot) => {
  if (snapshot.baseUrl === undefined) {
    delete process.env.MYOS_BASE_URL;
  } else {
    process.env.MYOS_BASE_URL = snapshot.baseUrl;
  }

  if (snapshot.apiKey === undefined) {
    delete process.env.MYOS_API_KEY;
  } else {
    process.env.MYOS_API_KEY = snapshot.apiKey;
  }

  if (snapshot.accountId === undefined) {
    delete process.env.MYOS_ACCOUNT_ID;
  } else {
    process.env.MYOS_ACCOUNT_ID = snapshot.accountId;
  }
};

const setBankMyOsEnvOverrides = () => {
  const bankEnv = requireBankMyOsEnv();
  process.env.MYOS_BASE_URL = bankEnv.baseUrl;
  process.env.MYOS_API_KEY = bankEnv.apiKey;
  process.env.MYOS_ACCOUNT_ID = bankEnv.accountId;
  return bankEnv;
};

const buildRealDeliveryBootstrapPayload = (input: {
  baseDocument: Record<string, unknown>;
  bankAccountId: string;
  customerAccountId: string;
}) => {
  const document = structuredClone(input.baseDocument);
  const contracts = isRecord(document.contracts) ? document.contracts : {};
  const senderTemplate = isRecord(contracts.payNoteSender)
    ? structuredClone(contracts.payNoteSender)
    : { type: 'MyOS/MyOS Timeline Channel' };

  if (isRecord(senderTemplate)) {
    delete senderTemplate.accountId;
  }

  contracts.payNoteDeliverer = structuredClone(senderTemplate);
  contracts.payNoteReceiver = structuredClone(senderTemplate);
  document.contracts = contracts;

  const payNoteBootstrapRequest = isRecord(document.payNoteBootstrapRequest)
    ? document.payNoteBootstrapRequest
    : undefined;
  const requestedDocumentContracts = isRecord(payNoteBootstrapRequest?.document)
    ? isRecord(payNoteBootstrapRequest.document.contracts)
      ? payNoteBootstrapRequest.document.contracts
      : undefined
    : undefined;
  const requestChannelBindings = isRecord(
    payNoteBootstrapRequest?.channelBindings
  )
    ? payNoteBootstrapRequest.channelBindings
    : undefined;
  if (requestChannelBindings) {
    if (
      !requestedDocumentContracts ||
      isRecord(requestedDocumentContracts.payeeChannel)
    ) {
      requestChannelBindings.payeeChannel = {
        accountId: input.bankAccountId,
      };
    }
    if (isRecord(requestedDocumentContracts?.cardProcessorChannel)) {
      requestChannelBindings.cardProcessorChannel = {
        accountId: input.bankAccountId,
      };
    } else {
      delete requestChannelBindings.cardProcessorChannel;
    }
    if (isRecord(requestedDocumentContracts?.guarantorChannel)) {
      requestChannelBindings.guarantorChannel = {
        accountId: input.bankAccountId,
      };
    } else {
      delete requestChannelBindings.guarantorChannel;
    }
  }

  return {
    document,
    channelBindings: {
      payNoteSender: { accountId: input.bankAccountId },
      payNoteDeliverer: { accountId: input.bankAccountId },
      payNoteReceiver: { accountId: input.customerAccountId },
      cardProcessorChannel: { accountId: input.bankAccountId },
    },
  };
};

const waitForBootstrapInitiatorSessionIds = async (
  myOsClient: MyOsLiveClient,
  bootstrapSessionId: string
) => {
  let targetSessionIds: string[] = [];
  let lastSnapshotSummary:
    | ReturnType<typeof summarizeBootstrapDocument>
    | undefined;

  await waitForExpectWithLogging(
    async () => {
      const snapshot = (await myOsClient.fetchDocument(bootstrapSessionId)) as {
        document?: Record<string, unknown>;
      };
      const document = isRecord(snapshot.document) ? snapshot.document : {};
      lastSnapshotSummary = summarizeBootstrapDocument(document);
      const bootstrapError = extractBlueString(document.bootstrapError);

      if (bootstrapError) {
        throw new Error(`MyOS bootstrap failed: ${bootstrapError}`);
      }

      targetSessionIds = extractBlueStringList(document.initiatorSessionIds);
      if (targetSessionIds.length === 0) {
        throw new Error(
          `MyOS bootstrap target sessions not materialized yet: ${JSON.stringify(
            lastSnapshotSummary
          )}`
        );
      }
    },
    60_000,
    2_000,
    'myos-bootstrap-target-sessions'
  );

  return [...new Set(targetSessionIds)];
};

const waitForBootstrapCreatedEventId = async (
  myOsClient: MyOsLiveClient,
  bootstrapSessionId: string
) => {
  let bootstrapCreatedEventId: string | undefined;

  await waitForExpectWithLogging(
    async () => {
      const events = await myOsClient.listRelevantDocumentEvents({
        sessionIds: [bootstrapSessionId],
        itemsPerPage: 100,
      });
      bootstrapCreatedEventId = events.find(
        event =>
          event.type === 'DOCUMENT_CREATED' &&
          event.sessionId === bootstrapSessionId
      )?.id;

      if (!bootstrapCreatedEventId) {
        throw new Error(
          `Bootstrap DOCUMENT_CREATED event not visible yet for ${bootstrapSessionId}`
        );
      }
    },
    60_000,
    2_000,
    'myos-bootstrap-created-event'
  );

  return bootstrapCreatedEventId!;
};

const extractCardTransactionFingerprint = (document: unknown) => {
  const record = isRecord(document) ? document : {};
  const cardTransactionDetails = isRecord(record.cardTransactionDetails)
    ? record.cardTransactionDetails
    : {};

  return {
    name: extractBlueString(record.name),
    retrievalReferenceNumber: extractBlueString(
      cardTransactionDetails.retrievalReferenceNumber
    ),
    systemTraceAuditNumber: extractBlueString(
      cardTransactionDetails.systemTraceAuditNumber
    ),
    transmissionDateTime: extractBlueString(
      cardTransactionDetails.transmissionDateTime
    ),
    authorizationCode: extractBlueString(
      cardTransactionDetails.authorizationCode
    ),
  };
};

const isMatchingCardTransactionFingerprint = (input: {
  left: unknown;
  right: unknown;
}) => {
  const left = extractCardTransactionFingerprint(input.left);
  const right = extractCardTransactionFingerprint(input.right);

  return (
    Boolean(left.name) &&
    left.name === right.name &&
    Boolean(left.retrievalReferenceNumber) &&
    left.retrievalReferenceNumber === right.retrievalReferenceNumber &&
    Boolean(left.systemTraceAuditNumber) &&
    left.systemTraceAuditNumber === right.systemTraceAuditNumber &&
    Boolean(left.transmissionDateTime) &&
    left.transmissionDateTime === right.transmissionDateTime &&
    Boolean(left.authorizationCode) &&
    left.authorizationCode === right.authorizationCode
  );
};

const waitForBankVisibleCreatedSessionId = async (input: {
  bankClient: MyOsLiveClient;
  from: string;
  matchingDocument: Record<string, unknown>;
  logLabel: string;
}) => {
  let matchedSessionId: string | undefined;

  await waitForExpectWithLogging(
    async () => {
      const events = await input.bankClient.listEvents({
        type: MYOS_DOCUMENT_CREATED,
        from: input.from,
        itemsPerPage: 100,
      });

      for (const event of events) {
        const payload = (await input.bankClient.fetchEvent(event.id)) as {
          object?: {
            sessionId?: unknown;
            document?: unknown;
          };
        };
        const sessionId =
          extractBlueString(payload.object?.sessionId) ?? event.ref;
        const document = isRecord(payload.object?.document)
          ? payload.object.document
          : null;

        if (!sessionId || !document) {
          continue;
        }

        if (
          isMatchingCardTransactionFingerprint({
            left: document,
            right: input.matchingDocument,
          })
        ) {
          matchedSessionId = sessionId;
          return;
        }
      }

      throw new Error(
        `No bank-visible DOCUMENT_CREATED event matched ${input.logLabel} since ${input.from}`
      );
    },
    60_000,
    2_000,
    input.logLabel
  );

  return matchedSessionId!;
};

const bootstrapRealDeliveryDocument = async (input: {
  bootstrapClient: MyOsLiveClient;
  bankClient: MyOsLiveClient;
  bankAccountId: string;
  customerAccountId: string;
  baseDocument: Record<string, unknown>;
}) => {
  const payload = buildRealDeliveryBootstrapPayload({
    baseDocument: input.baseDocument,
    bankAccountId: input.bankAccountId,
    customerAccountId: input.customerAccountId,
  });
  const startedAt = new Date(Date.now() - 5_000).toISOString();

  const response = (await input.bootstrapClient.bootstrapDocument(payload)) as {
    sessionId?: string;
  };
  const bootstrapSessionId = extractBlueString(response.sessionId);
  if (!bootstrapSessionId) {
    throw new Error('MyOS bootstrap did not return a bootstrap session id');
  }

  const deliveryCandidateSessionIds = await waitForBootstrapInitiatorSessionIds(
    input.bootstrapClient,
    bootstrapSessionId
  );
  const bootstrapCreatedEventId = await waitForBootstrapCreatedEventId(
    input.bootstrapClient,
    bootstrapSessionId
  );
  const deliverySessionId = await waitForBankVisibleCreatedSessionId({
    bankClient: input.bankClient,
    from: startedAt,
    matchingDocument: input.baseDocument,
    logLabel: 'myos-bank-delivery-created-event',
  });

  return {
    bootstrapSessionId,
    deliverySessionId,
    deliveryCandidateSessionIds,
    bootstrapCreatedEventId,
  };
};

const bootstrapRealRootDocument = async (input: {
  bootstrapClient: MyOsLiveClient;
  baseDocument: Record<string, unknown>;
  initiatorAccountId: string;
  channelBindings?: Record<string, { email?: string; accountId?: string }>;
}) => {
  const response = (await input.bootstrapClient.bootstrapDocument({
    document: input.baseDocument,
    channelBindings: input.channelBindings ?? {
      guarantorChannel: {
        accountId: input.initiatorAccountId,
      },
    },
  })) as {
    sessionId?: string;
  };
  const bootstrapSessionId = extractBlueString(response.sessionId);
  if (!bootstrapSessionId) {
    throw new Error('MyOS bootstrap did not return a bootstrap session id');
  }

  const rootSessionIds = await waitForBootstrapInitiatorSessionIds(
    input.bootstrapClient,
    bootstrapSessionId
  );

  return {
    bootstrapSessionId,
    rootSessionIds,
  };
};

const waitForPayNoteBootstrapSessionId = async (
  context: PayNoteLiveTestContext,
  deliverySessionId: string
) => {
  let payNoteSessionId: string | undefined;

  await waitForExpectWithLogging(
    async () => {
      const delivery = await context.getRawDeliveryBySessionId(
        deliverySessionId
      );
      payNoteSessionId = extractBlueString(delivery?.payNoteBootstrapSessionId);
      if (!payNoteSessionId) {
        throw new Error('Root PayNote bootstrap session not visible yet');
      }
    },
    60_000,
    2_000,
    'raw-delivery-paynote-bootstrap-session'
  );

  return payNoteSessionId!;
};

const waitForCanonicalRawContract = async (input: {
  context: PayNoteLiveTestContext;
  candidateSessionIds: string[];
}) => {
  let matchedContract:
    | Awaited<ReturnType<PayNoteLiveTestContext['getRawContractBySessionId']>>
    | undefined;

  await waitForExpectWithLogging(
    async () => {
      for (const sessionId of input.candidateSessionIds) {
        const contract = await input.context.getRawContractBySessionId(
          sessionId
        );
        if (contract?.sessionId) {
          matchedContract = contract as typeof matchedContract;
          return;
        }
      }

      throw new Error('Canonical raw PayNote contract not visible yet');
    },
    60_000,
    2_000,
    'canonical-raw-paynote-contract'
  );

  return matchedContract!;
};

const createMyOsMultiClientEventSource = (
  clients: MyOsEventReadableClient[]
): MyOsEventReadableClient => {
  const visibleEventClientById = new Map<string, MyOsEventReadableClient>();
  const uniqueClients = [...new Set(clients)];

  return {
    async listRelevantDocumentEvents(input) {
      const listed = await Promise.all(
        uniqueClients.map(client => client.listRelevantDocumentEvents(input))
      );
      const deduped = [
        ...new Map(listed.flat().map(item => [item.id, item])).values(),
      ];
      for (const item of deduped) {
        if (!visibleEventClientById.has(item.id)) {
          const owner =
            listed.find(events =>
              events.some(event => event.id === item.id)
            ) !== undefined
              ? uniqueClients[
                  listed.findIndex(events =>
                    events.some(event => event.id === item.id)
                  )
                ]
              : undefined;
          if (owner) {
            visibleEventClientById.set(item.id, owner);
          }
        }
      }
      return deduped;
    },
    async fetchEvent(eventId) {
      const preferredClient = visibleEventClientById.get(eventId);
      const candidates = preferredClient
        ? [
            preferredClient,
            ...uniqueClients.filter(client => client !== preferredClient),
          ]
        : uniqueClients;

      let lastError: unknown;
      for (const client of candidates) {
        try {
          const payload = await client.fetchEvent(eventId);
          visibleEventClientById.set(eventId, client);
          return payload;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`Unable to fetch MyOS event ${eventId}`);
    },
  };
};

const postRealMyOsEvents = async (input: {
  client: MyOsEventReadableClient;
  bank: PayNoteLiveTestContext['bank'];
  sessionIds: string[];
  eventType: 'DOCUMENT_CREATED' | 'DOCUMENT_EPOCH_ADVANCED';
  epoch?: number;
}) => {
  const events = await input.client.listRelevantDocumentEvents({
    sessionIds: input.sessionIds,
    itemsPerPage: 100,
  });
  const filtered = events
    .filter(event => event.type === input.eventType)
    .filter(event =>
      input.epoch === undefined ? true : event.epoch === input.epoch
    )
    .sort((left, right) => {
      if (left.type === 'DOCUMENT_EPOCH_ADVANCED' && right.type === left.type) {
        const leftEpoch = left.epoch ?? Number.POSITIVE_INFINITY;
        const rightEpoch = right.epoch ?? Number.POSITIVE_INFINITY;
        if (leftEpoch !== rightEpoch) {
          return leftEpoch - rightEpoch;
        }
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left.id.localeCompare(right.id);
    });

  for (const event of filtered) {
    const payload = toMyOsWebhookPayload(
      (await input.client.fetchEvent(event.id)) as Record<string, unknown>
    ) as Record<string, unknown>;
    await input.bank.postPayNoteWebhookPayload(
      payload,
      buildTestWebhookHeaders(payload)
    );
  }

  return filtered.map(event => event.id);
};

const postRealMyOsBootstrapRequestReplayEvents = async (input: {
  client: MyOsEventReadableClient;
  bank: PayNoteLiveTestContext['bank'];
  sessionIds: string[];
}) => {
  const listed = await input.client.listRelevantDocumentEvents({
    sessionIds: input.sessionIds,
    itemsPerPage: 100,
  });

  const replayedEventIds: string[] = [];

  for (const event of listed
    .filter(item => item.type === 'DOCUMENT_EPOCH_ADVANCED')
    .sort((left, right) => {
      const leftEpoch = left.epoch ?? Number.POSITIVE_INFINITY;
      const rightEpoch = right.epoch ?? Number.POSITIVE_INFINITY;
      if (leftEpoch !== rightEpoch) {
        return leftEpoch - rightEpoch;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left.id.localeCompare(right.id);
    })) {
    const payload = toMyOsWebhookPayload(
      (await input.client.fetchEvent(event.id)) as Record<string, unknown>
    ) as Record<string, unknown>;
    const object = isRecord(payload.object)
      ? structuredClone(payload.object)
      : {};
    const emitted = Array.isArray(object.emitted) ? object.emitted : [];
    const bootstrapOnly = emitted.filter(
      item => isRecord(item) && isDocumentBootstrapRequested(item.type)
    );

    if (bootstrapOnly.length === 0) {
      continue;
    }

    object.emitted = bootstrapOnly;
    const replayPayload = {
      ...payload,
      id: `${String(payload.id ?? event.id)}:bootstrap-replay`,
      object,
    };
    replayedEventIds.push(String(replayPayload.id));
    await input.bank.postPayNoteWebhookPayload(
      replayPayload,
      buildTestWebhookHeaders(replayPayload)
    );
  }

  return replayedEventIds;
};

describe.skipIf(!enabled)('PayNote real MyOS canaries', () => {
  let context: PayNoteLiveTestContext;
  let agentMyOsEnv: ReturnType<typeof requireAgentMyOsEnv>;
  let bootstrapClient: MyOsLiveClient;
  let bankMyOsClient: MyOsLiveClient;
  let myOsEventSource: MyOsEventReadableClient;
  let previousMyOsEnv: MyOsEnvSnapshot;
  let bankMyOsEnv: ReturnType<typeof requireBankMyOsEnv>;

  beforeAll(async () => {
    agentMyOsEnv = requireAgentMyOsEnv();
    previousMyOsEnv = captureMyOsEnv();
    bankMyOsEnv = setBankMyOsEnvOverrides();
    bootstrapClient = new MyOsLiveClient(agentMyOsEnv);
    bankMyOsClient = new MyOsLiveClient(bankMyOsEnv);
    myOsEventSource = createMyOsMultiClientEventSource([
      bootstrapClient,
      bankMyOsClient,
    ]);
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
    restoreMyOsEnv(previousMyOsEnv);
  });

  it('card delivery approval and capture happy path', async () => {
    const run = createScenarioRunContext('real-card-delivery-capture');
    const bankEventPump = new EventPump(myOsEventSource, context.bank);

    await context.bank.signUpUniqueTestUser('pn-e2e-card-merchant', true, {
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-e2e-card-customer',
      accountName: 'Real MyOS card account',
      fundingAmountMinor:
        FAST_AMOUNTS.pendingInstallMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const authorization = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });

    const deliveryDocument = buildPendingInstallDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: bankMyOsEnv.accountId,
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
      cardTransactionDetails: authorization.cardTransactionDetails,
    });

    logScenarioStep(run, 'bootstrapping-real-delivery', {
      merchantAccountId: bankMyOsEnv.accountId,
    });
    const { bootstrapSessionId, deliverySessionId } =
      await bootstrapRealDeliveryDocument({
        bootstrapClient,
        bankClient: bankMyOsClient,
        bankAccountId: bankMyOsEnv.accountId,
        customerAccountId: agentMyOsEnv.accountId,
        baseDocument: deliveryDocument,
      });

    logScenarioStep(run, 'pull-and-post-delivery-created', {
      bootstrapSessionId,
      deliverySessionId,
    });
    await bankEventPump.flushUntilSettled({
      sessionIds: [deliverySessionId],
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const rawDelivery = await context.getRawDeliveryBySessionId(
          deliverySessionId
        );
        if (!rawDelivery) {
          throw new Error('Delivery not persisted yet');
        }
        expect(rawDelivery.transactionIdentificationStatus).toBe('identified');
        expect(rawDelivery.userId).toBe(customer.user.userId);
      },
    });

    logScenarioStep(run, 'accepting-delivery', { deliverySessionId });
    await context.bank.acceptDelivery(
      customer.user.jwtCookie,
      deliverySessionId
    );

    await bankEventPump.flushUntilSettled({
      sessionIds: [deliverySessionId],
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const payNoteSessionId = await context
          .getRawDeliveryBySessionId(deliverySessionId)
          .then(delivery =>
            extractBlueString(delivery?.payNoteBootstrapSessionId)
          );
        if (!payNoteSessionId) {
          throw new Error('Root PayNote bootstrap session not visible yet');
        }
      },
    });

    const payNoteBootstrapSessionId = await waitForPayNoteBootstrapSessionId(
      context,
      deliverySessionId
    );
    const payNoteCandidateSessionIds =
      await waitForBootstrapInitiatorSessionIds(
        bankMyOsClient,
        payNoteBootstrapSessionId
      );

    logScenarioStep(run, 'pull-and-post-root-paynote', {
      payNoteBootstrapSessionId,
      payNoteCandidateSessionIds,
    });
    await bankEventPump.flushUntilSettled({
      sessionIds: [deliverySessionId, payNoteBootstrapSessionId],
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const rawDelivery = await context.getRawDeliveryBySessionId(
          deliverySessionId
        );
        const linkedBootstrapSessionId = extractBlueString(
          rawDelivery?.payNoteBootstrapSessionId
        );
        if (linkedBootstrapSessionId !== payNoteBootstrapSessionId) {
          throw new Error('Root PayNote bootstrap tracker not linked yet');
        }
      },
    });

    const createdEventIds = await postRealMyOsEvents({
      client: myOsEventSource,
      bank: context.bank,
      sessionIds: payNoteCandidateSessionIds,
      eventType: 'DOCUMENT_CREATED',
    });
    logScenarioStep(run, 'posted-root-created-events', {
      createdEventIds,
    });

    const deliveryAfterRootBootstrap = await context.getRawDeliveryBySessionId(
      deliverySessionId
    );
    const payNoteSessionIds = deliveryAfterRootBootstrap?.payNoteSessionIds
      ?.length
      ? deliveryAfterRootBootstrap.payNoteSessionIds
      : payNoteCandidateSessionIds;
    const canonicalContract = await waitForCanonicalRawContract({
      context,
      candidateSessionIds: payNoteSessionIds,
    });
    const payNoteSessionId = requireNonEmptyString(
      canonicalContract.sessionId,
      'PayNote session id'
    );
    const epochEventIds = await postRealMyOsEvents({
      client: myOsEventSource,
      bank: context.bank,
      sessionIds: [payNoteSessionId],
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 0,
    });
    logScenarioStep(run, 'posted-root-epoch-events', {
      payNoteSessionId,
      epochEventIds,
    });

    await context.bank.generateContractSummary(
      customer.user.jwtCookie,
      payNoteSessionId,
      { force: true }
    );
    const contract = await context.bank.waitForContract(
      customer.user.jwtCookie,
      payNoteSessionId
    );
    expect(contract.pendingActions).toHaveLength(1);

    logScenarioStep(run, 'approving-pending-action', {
      payNoteSessionId,
      actionId: contract.pendingActions[0]?.actionId,
    });
    await context.bank.decideContractPendingAction(
      customer.user.jwtCookie,
      payNoteSessionId,
      contract.pendingActions[0].actionId,
      {
        kind: 'selectOption',
        input: 'Installation confirmed',
      }
    );

    await bankEventPump.flushUntilSettled({
      sessionIds: [payNoteBootstrapSessionId, ...payNoteSessionIds],
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const rawPayNote = await context.getRawPayNoteBySessionId(
          payNoteSessionId
        );
        if (!rawPayNote?.holdId || !rawPayNote.transactionId) {
          throw new Error('PayNote capture not completed yet');
        }
      },
    });

    const capturedPayNote = await context.getRawPayNoteBySessionId(
      payNoteSessionId
    );
    expect(capturedPayNote?.holdId).toBeTruthy();
    expect(capturedPayNote?.transactionId).toBeTruthy();

    await waitForSinglePostedCapture({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      holdId: capturedPayNote!.holdId!,
      transactionId: capturedPayNote!.transactionId!,
    });
  });

  it('fetch-by-id compatibility smoke', async () => {
    await context.bank.signUpUniqueTestUser('pn-e2e-fetch-merchant', true, {
      merchantId: 'merchant-fetch-by-id-demo',
      merchantName: 'PayNote Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-e2e-fetch-customer',
      accountName: 'Real MyOS fetch-by-id account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const authorization = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-fetch-by-id-demo',
      merchantName: 'PayNote Demo Shop',
    });

    const deliveryDocument = buildCardDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: bankMyOsEnv.accountId,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: authorization.cardTransactionDetails,
    });

    const { deliverySessionId } = await bootstrapRealDeliveryDocument({
      bootstrapClient,
      bankClient: bankMyOsClient,
      bankAccountId: bankMyOsEnv.accountId,
      customerAccountId: agentMyOsEnv.accountId,
      baseDocument: deliveryDocument,
    });

    let createdEventId: string | undefined;
    await waitForExpectWithLogging(
      async () => {
        const events = await bankMyOsClient.listRelevantDocumentEvents({
          sessionIds: [deliverySessionId],
        });
        createdEventId = events.find(
          event => event.type === 'DOCUMENT_CREATED'
        )?.id;
        if (!createdEventId) {
          throw new Error('DOCUMENT_CREATED event not visible yet');
        }
      },
      60_000,
      2_000,
      'bank-visible-created-event-id'
    );

    await expect(
      bankMyOsClient.fetchEvent(createdEventId!)
    ).resolves.toMatchObject({
      id: createdEventId,
    });

    await context.bank.postPayNoteWebhookById(createdEventId!);

    const firstDelivery = await context.waitForRawDeliveryBySessionId(
      deliverySessionId,
      60_000
    );
    expect(firstDelivery.deliverySessionId).toBe(deliverySessionId);
    expect(firstDelivery.transactionIdentificationStatus).toBe('identified');

    await context.bank.postPayNoteWebhookById(createdEventId!);

    const secondDelivery = await context.waitForRawDeliveryBySessionId(
      deliverySessionId,
      60_000
    );
    expect(secondDelivery.deliveryId).toBe(firstDelivery.deliveryId);
  });

  it('subscription one follow-up cycle', async () => {
    const run = createScenarioRunContext('real-subscription-follow-up');
    const realContext = await createPayNoteLiveTestContext({
      myOsCredentials: bankMyOsEnv,
    });

    try {
      const bankEventPump = new EventPump(myOsEventSource, realContext.bank);

      await realContext.bank.signUpUniqueTestUser(
        'pn-e2e-subscription-merchant',
        true,
        {
          merchantId: 'merchant-subscription-demo',
          merchantName: 'Subscription Demo Shop',
        }
      );
      const customer = await createFundedCustomerWithCard(realContext.bank, {
        prefix: 'pn-e2e-subscription-customer',
        accountName: 'Real MyOS subscription account',
        fundingAmountMinor:
          FAST_AMOUNTS.subscriptionMonthlyMinor * 2 +
          FAST_AMOUNTS.fundingBufferMinor,
      });

      const authorization = await realContext.bank.authorizeCard({
        pan: customer.card.pan,
        expiryMonth: customer.card.expiryMonth,
        expiryYear: customer.card.expiryYear,
        cvc: customer.card.cvc,
        amountMinor: FAST_AMOUNTS.subscriptionMonthlyMinor,
        merchantId: 'merchant-subscription-demo',
        merchantName: 'Subscription Demo Shop',
      });

      const deliveryDocument = buildSubscriptionDeliveryDocumentFromFixture({
        merchantId: 'merchant-subscription-demo',
        merchantAccountId: bankMyOsEnv.accountId,
        cardTransactionDetails: authorization.cardTransactionDetails,
      });

      logScenarioStep(run, 'bootstrapping-real-subscription-delivery', {
        merchantAccountId: bankMyOsEnv.accountId,
      });
      const { bootstrapSessionId, deliverySessionId } =
        await bootstrapRealDeliveryDocument({
          bootstrapClient,
          bankClient: bankMyOsClient,
          bankAccountId: bankMyOsEnv.accountId,
          customerAccountId: agentMyOsEnv.accountId,
          baseDocument: deliveryDocument,
        });

      await bankEventPump.flushUntilSettled({
        sessionIds: [deliverySessionId],
        timeoutMs: 180_000,
        pollIntervalMs: 2_000,
        idleQuietPeriodMs: 3_000,
        assertSettled: async () => {
          const rawDelivery = await realContext.getRawDeliveryBySessionId(
            deliverySessionId
          );
          if (!rawDelivery) {
            throw new Error('Subscription delivery not persisted yet');
          }
          expect(rawDelivery.transactionIdentificationStatus).toBe(
            'identified'
          );
          expect(rawDelivery.userId).toBe(customer.user.userId);
        },
      });

      logScenarioStep(run, 'accepting-subscription-delivery', {
        bootstrapSessionId,
        deliverySessionId,
      });
      await realContext.bank.acceptDelivery(
        customer.user.jwtCookie,
        deliverySessionId
      );

      await bankEventPump.flushUntilSettled({
        sessionIds: [deliverySessionId],
        timeoutMs: 180_000,
        pollIntervalMs: 2_000,
        idleQuietPeriodMs: 3_000,
        assertSettled: async () => {
          const payNoteSessionId = await realContext
            .getRawDeliveryBySessionId(deliverySessionId)
            .then(delivery =>
              extractBlueString(delivery?.payNoteBootstrapSessionId)
            );
          if (!payNoteSessionId) {
            throw new Error(
              'Root subscription bootstrap session not visible yet'
            );
          }
        },
      });

      const payNoteBootstrapSessionId = await waitForPayNoteBootstrapSessionId(
        realContext,
        deliverySessionId
      );
      const rootCandidateSessionIds = await waitForBootstrapInitiatorSessionIds(
        bankMyOsClient,
        payNoteBootstrapSessionId
      );

      logScenarioStep(run, 'draining-root-subscription-events', {
        payNoteBootstrapSessionId,
        rootCandidateSessionIds,
      });
      await bankEventPump.flushUntilSettled({
        sessionIds: [
          deliverySessionId,
          payNoteBootstrapSessionId,
          ...rootCandidateSessionIds,
        ],
        timeoutMs: 240_000,
        pollIntervalMs: 2_000,
        idleQuietPeriodMs: 3_000,
        assertSettled: async () => {
          for (const sessionId of rootCandidateSessionIds) {
            const contract = await realContext.getRawContractBySessionId(
              sessionId
            );
            const payNote = await realContext.getRawPayNoteBySessionId(
              sessionId
            );
            if (contract?.documentId && payNote?.holdId) {
              return;
            }
          }

          throw new Error(
            'Canonical subscription contract with initial capture not materialized yet'
          );
        },
      });

      const canonicalContract = await waitForCanonicalRawContract({
        context: realContext,
        candidateSessionIds: rootCandidateSessionIds,
      });

      let payNoteDocumentId =
        extractBlueString(canonicalContract.documentId) ?? '';
      const payNoteSessionId = requireNonEmptyString(
        canonicalContract.sessionId,
        'Subscription PayNote session id'
      );
      let contract: any;
      let bootstrapPendingAction: any;
      const waitForBootstrapPendingAction = async (
        timeoutMs: number,
        logLabel: string
      ) =>
        waitForExpectWithLogging(
          async () => {
            await realContext.bank.generateContractSummary(
              customer.user.jwtCookie,
              payNoteSessionId,
              { force: true }
            );
            contract = await realContext.bank.waitForContract(
              customer.user.jwtCookie,
              payNoteSessionId,
              15_000
            );
            bootstrapPendingAction = (contract.pendingActions ?? []).find(
              (action: any) =>
                action.status === 'pending' &&
                action.type === 'paymentMandateBootstrapApproval'
            );
            if (!bootstrapPendingAction) {
              throw new Error(
                'Subscription payment mandate approval not visible yet'
              );
            }
          },
          timeoutMs,
          5_000,
          logLabel
        );

      try {
        await waitForBootstrapPendingAction(
          60_000,
          'subscription-bootstrap-pending-action-initial'
        );
      } catch (initialError) {
        logScenarioStep(run, 'replaying-bootstrap-request-only', {
          payNoteSessionId,
        });
        const replayedEventIds = await postRealMyOsBootstrapRequestReplayEvents(
          {
            client: myOsEventSource,
            bank: realContext.bank,
            sessionIds: [payNoteSessionId],
          }
        );
        logScenarioStep(run, 'replayed-bootstrap-request-only-events', {
          payNoteSessionId,
          replayedEventIds,
        });
        if (replayedEventIds.length === 0) {
          throw initialError;
        }

        await waitForBootstrapPendingAction(
          180_000,
          'subscription-bootstrap-pending-action-after-replay'
        );
      }

      payNoteDocumentId ||=
        extractBlueString(contract.documentId) ?? payNoteDocumentId;
      await waitForPayNoteCaptureSequence({
        bank: realContext.bank,
        jwtCookie: customer.user.jwtCookie,
        accountNumber: customer.account.accountNumber,
        payNoteDocumentId,
        expectedCaptureAmountsMinor: [FAST_AMOUNTS.subscriptionMonthlyMinor],
        timeoutMs: 120_000,
      });

      logScenarioStep(run, 'approving-subscription-payment-mandate', {
        payNoteSessionId,
        actionId: bootstrapPendingAction.actionId,
      });
      await realContext.bank.decideContractPendingAction(
        customer.user.jwtCookie,
        payNoteSessionId,
        bootstrapPendingAction.actionId,
        {
          kind: 'approveReject',
          input: 'accepted',
        }
      );

      let mandateBootstrapSessionId: string | undefined;
      await waitForExpectWithLogging(
        async () => {
          const rawContract = await realContext.getRawContractBySessionId(
            payNoteSessionId
          );
          const updatedAction = (rawContract?.pendingActions ?? []).find(
            (action: any) => action.actionId === bootstrapPendingAction.actionId
          );
          mandateBootstrapSessionId = extractBlueString(
            updatedAction?.payload?.paymentMandateBootstrapSessionId
          );
          if (!mandateBootstrapSessionId) {
            throw new Error(
              'Payment mandate bootstrap session id not persisted on pending action yet'
            );
          }
        },
        120_000,
        2_000,
        'subscription-mandate-bootstrap-session'
      );

      const resolvedMandateBootstrapSessionId = requireNonEmptyString(
        mandateBootstrapSessionId,
        'Payment mandate bootstrap session id'
      );

      const mandateSessionIds = await waitForBootstrapInitiatorSessionIds(
        bankMyOsClient,
        resolvedMandateBootstrapSessionId
      );

      await bankEventPump.flushUntilSettled({
        sessionIds: [
          deliverySessionId,
          payNoteBootstrapSessionId,
          ...rootCandidateSessionIds,
          resolvedMandateBootstrapSessionId,
        ],
        timeoutMs: 240_000,
        pollIntervalMs: 2_000,
        idleQuietPeriodMs: 3_000,
        assertSettled: async () => {
          const rawContract = await realContext.getRawContractBySessionId(
            payNoteSessionId
          );
          const rawDocument = isRecord(rawContract?.document)
            ? rawContract.document
            : {};
          const rawSubscription = isRecord(rawDocument.subscription)
            ? rawDocument.subscription
            : {};
          const mandateContractVisible = await Promise.all(
            mandateSessionIds.map(sessionId =>
              realContext.getRawContractBySessionId(sessionId)
            )
          ).then(contracts =>
            contracts.some(item => Boolean(item?.documentId))
          );
          const status = extractBlueString(
            rawSubscription.paymentMandateStatus
          );
          if (!mandateContractVisible || status !== 'active') {
            throw new Error('Payment mandate attachment not materialized yet');
          }
        },
      });

      await waitForExpectWithLogging(
        async () => {
          await realContext.bank.generateContractSummary(
            customer.user.jwtCookie,
            payNoteSessionId,
            { force: true }
          );
          contract = await realContext.bank.waitForContract(
            customer.user.jwtCookie,
            payNoteSessionId,
            15_000
          );
          const contractDocument = contract.document as any;
          const status =
            extractBlueString(
              contractDocument?.subscription?.paymentMandateStatus
            ) ?? contractDocument?.subscription?.paymentMandateStatus;
          if (status !== 'active') {
            throw new Error(
              `Expected active payment mandate, got ${String(status)}`
            );
          }
        },
        240_000,
        5_000,
        'subscription-contract-summary-active-mandate'
      );

      logScenarioStep(run, 'triggering-follow-up-subscription-cycle', {
        payNoteSessionId,
        mandateSessionIds,
      });
      await bankMyOsClient.runDocumentOperation(
        payNoteSessionId,
        'triggerScheduledPayment',
        {
          amountMinor: FAST_AMOUNTS.subscriptionMonthlyMinor,
          requestId: 'subscription-cycle-2',
        }
      );

      await bankEventPump.flushUntilSettled({
        sessionIds: [
          deliverySessionId,
          payNoteBootstrapSessionId,
          ...rootCandidateSessionIds,
          resolvedMandateBootstrapSessionId,
          ...mandateSessionIds,
        ],
        timeoutMs: 240_000,
        pollIntervalMs: 2_000,
        idleQuietPeriodMs: 3_000,
        assertSettled: async () => {
          const items = await realContext.bank.getActivity(
            customer.user.jwtCookie,
            customer.account.accountNumber
          );
          const postedTransactions = items.filter(
            (item: any) =>
              item.kind === 'POSTED_TRANSACTION' &&
              item.payNote?.payNoteDocumentId === payNoteDocumentId
          );
          if (postedTransactions.length < 2) {
            throw new Error('Follow-up subscription capture not completed yet');
          }
        },
      });

      await waitForPayNoteCaptureSequence({
        bank: realContext.bank,
        jwtCookie: customer.user.jwtCookie,
        accountNumber: customer.account.accountNumber,
        payNoteDocumentId,
        expectedCaptureAmountsMinor: [
          FAST_AMOUNTS.subscriptionMonthlyMinor,
          FAST_AMOUNTS.subscriptionMonthlyMinor,
        ],
        timeoutMs: 120_000,
      });
      await waitForNoDuplicatePayNoteCaptureSequenceAfterReplay({
        bank: realContext.bank,
        jwtCookie: customer.user.jwtCookie,
        accountNumber: customer.account.accountNumber,
        payNoteDocumentId,
        expectedCaptureAmountsMinor: [
          FAST_AMOUNTS.subscriptionMonthlyMinor,
          FAST_AMOUNTS.subscriptionMonthlyMinor,
        ],
        stablePeriodMs: 5_000,
      });
    } finally {
      await realContext.cleanup();
    }
  }, 300_000);

  it('voucher cashback smoke', async () => {
    const run = createScenarioRunContext('real-voucher-cashback');
    const bankEventPump = new EventPump(myOsEventSource, context.bank);

    const sponsor = await context.bank.signUpUniqueTestUser(
      'pn-e2e-voucher-sponsor',
      true,
      {
        merchantId: 'merchant-voucher-sponsor',
        merchantName: 'Voucher Sponsor Shop',
      }
    );
    await context.bank.signUpUniqueTestUser('pn-e2e-voucher-restaurant', true, {
      merchantId: 'merchant-voucher-restaurant',
      merchantName: 'Balanced Bowl Restaurant',
    });
    const sponsorAccount = await context.bank.createAccount(
      sponsor.jwtCookie,
      'Voucher reserve account'
    );
    await context.bank.fundAccount(
      sponsor.jwtCookie,
      sponsorAccount.accountId,
      FAST_AMOUNTS.voucherReserveMinor + FAST_AMOUNTS.fundingBufferMinor
    );
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-e2e-voucher-customer',
      accountName: 'Real MyOS voucher customer account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const rootDocument = buildVoucherMonitoringPayNote({
      sponsorMerchantId: 'merchant-voucher-sponsor',
      sponsorAccountNumber: sponsorAccount.accountNumber,
      customerAccountNumber: customer.account.accountNumber,
      targetMerchantId: 'merchant-voucher-restaurant',
      amountMinor: FAST_AMOUNTS.voucherReserveMinor,
    });

    logScenarioStep(run, 'bootstrapping-real-voucher-root', {
      sponsorAccountNumber: sponsorAccount.accountNumber,
    });
    const { bootstrapSessionId, rootSessionIds } =
      await bootstrapRealRootDocument({
        bootstrapClient: bankMyOsClient,
        baseDocument: rootDocument,
        initiatorAccountId: bankMyOsEnv.accountId,
      });

    await context.saveBootstrapContext({
      bootstrapSessionId,
      accountNumber: customer.account.accountNumber,
      userId: customer.user.userId,
      merchantId: 'merchant-voucher-sponsor',
    });
    await Promise.all(
      rootSessionIds.map(sessionId =>
        context.saveBootstrapContext({
          bootstrapSessionId: sessionId,
          accountNumber: customer.account.accountNumber,
          userId: customer.user.userId,
          merchantId: 'merchant-voucher-sponsor',
        })
      )
    );

    await bankEventPump.flushUntilSettled({
      sessionIds: rootSessionIds,
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        for (const sessionId of rootSessionIds) {
          const contract = await context.getRawContractBySessionId(sessionId);
          const payNote = await context.getRawPayNoteBySessionId(sessionId);
          if (contract?.documentId && payNote?.holdId) {
            return;
          }
        }

        throw new Error(
          'Canonical voucher contract with initial reserve not materialized yet'
        );
      },
    });

    const canonicalContract = await waitForCanonicalRawContract({
      context,
      candidateSessionIds: rootSessionIds,
    });
    const voucherSessionId = requireNonEmptyString(
      canonicalContract.sessionId,
      'Voucher session id'
    );
    const voucherDocumentId = requireNonEmptyString(
      extractBlueString(canonicalContract.documentId),
      'Voucher document id'
    );

    await context.bank.generateContractSummary(
      customer.user.jwtCookie,
      voucherSessionId,
      { force: true }
    );
    const contract = await context.bank.waitForContract(
      customer.user.jwtCookie,
      voucherSessionId,
      60_000
    );
    const monitoringPendingAction = (contract.pendingActions ?? []).find(
      (action: any) =>
        action.status === 'pending' &&
        action.type === 'monitoringConsentApproval'
    );

    expect(monitoringPendingAction).toBeTruthy();

    logScenarioStep(run, 'approving-voucher-monitoring', {
      sessionId: voucherSessionId,
      actionId: monitoringPendingAction?.actionId,
    });
    await context.bank.decideContractPendingAction(
      customer.user.jwtCookie,
      voucherSessionId,
      monitoringPendingAction.actionId,
      {
        kind: 'approveReject',
        input: 'accepted',
      }
    );

    await bankEventPump.flushUntilSettled({
      sessionIds: rootSessionIds,
      timeoutMs: 90_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const snapshot = (await bankMyOsClient.fetchDocument(
          voucherSessionId
        )) as {
          document?: unknown;
        };
        const state =
          isRecord(snapshot.document) && isRecord(snapshot.document.state)
            ? snapshot.document.state
            : {};
        if (extractBlueString(state.monitoringStatus) !== 'started') {
          throw new Error('Monitoring status not started yet');
        }
      },
    });

    const authorization = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-voucher-restaurant',
      merchantName: 'Balanced Bowl Restaurant',
    });

    logScenarioStep(run, 'capturing-monitored-restaurant-transaction', {
      authorizationId: authorization.authorizationId,
    });
    await context.bank.captureCardAuthorization(
      authorization.authorizationId,
      FAST_AMOUNTS.cardPurchaseMinor
    );

    await bankEventPump.flushUntilSettled({
      sessionIds: rootSessionIds,
      timeoutMs: 30_000,
      pollIntervalMs: 2_000,
      idleQuietPeriodMs: 3_000,
      assertSettled: async () => {
        const items = await context.bank.getActivity(
          sponsor.jwtCookie,
          sponsorAccount.accountNumber
        );
        const holdCaptures = items.filter(
          (item: any) =>
            item.kind === 'HOLD_CAPTURED' &&
            item.payNote?.payNoteDocumentId === voucherDocumentId
        );
        const postedTransactions = items.filter(
          (item: any) =>
            item.kind === 'POSTED_TRANSACTION' &&
            item.payNote?.payNoteDocumentId === voucherDocumentId
        );

        if (
          holdCaptures.length !== 1 ||
          postedTransactions.length !== 1 ||
          holdCaptures[0]?.amountMinor !== FAST_AMOUNTS.voucherReserveMinor ||
          postedTransactions[0]?.amountMinor !==
            FAST_AMOUNTS.voucherReserveMinor
        ) {
          throw new Error('Voucher cashback capture not materialized yet');
        }
      },
      afterEachDelivery: async event => {
        logScenarioStep(run, 'delivered-voucher-follow-up-event', {
          eventId: event.id,
          eventType: event.type,
          epoch: event.epoch ?? null,
        });
      },
    });

    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: sponsor.jwtCookie,
      accountNumber: sponsorAccount.accountNumber,
      payNoteDocumentId: voucherDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.voucherReserveMinor],
      timeoutMs: 20_000,
    });

    logScenarioStep(run, 'voucher-cashback-captured', {
      sessionId: voucherSessionId,
      payNoteDocumentId: voucherDocumentId,
    });
  });
});
