import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { waitForSinglePostedCapture } from '../live/lib/assertions';
import { waitForExpectWithLogging } from '../live/lib/wait';
import { toMyOsWebhookPayload } from '../live/lib/myOsWebhookPayload';
import {
  buildCardDeliveryDocument,
  buildPendingInstallDeliveryDocument,
} from '../live/lib/simplePayNoteBuilders';

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

const extractBlueString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.value === 'string') {
    return value.value.trim();
  }
  return undefined;
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
  const requestChannelBindings = isRecord(
    payNoteBootstrapRequest?.channelBindings
  )
    ? payNoteBootstrapRequest.channelBindings
    : undefined;
  if (requestChannelBindings) {
    requestChannelBindings.payeeChannel = {
      accountId: input.bankAccountId,
    };
    requestChannelBindings.cardProcessorChannel = {
      accountId: input.bankAccountId,
    };
    requestChannelBindings.guarantorChannel = {
      accountId: input.bankAccountId,
    };
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
    | {
        sessionId: string;
      }
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
    );
    await input.bank.postPayNoteWebhookPayload(
      payload,
      buildTestWebhookHeaders(payload)
    );
  }

  return filtered.map(event => event.id);
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
    const payNoteSessionId = canonicalContract.sessionId;
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

  it.skip('fetch-by-id compatibility smoke', async () => {
    // Verified on 2026-03-16 against real MyOS after fixing test-side env and
    // multi-account event visibility:
    // - the test can discover a real delivery DOCUMENT_CREATED event id
    // - `POST /paynote/webhook { id }` still makes bank runtime log
    //   `Failed to download PayNote event from MyOS` with status 404
    // - raw delivery never materializes afterwards
    //
    // Root cause is not the smoke harness anymore: bank MyOS credentials cannot
    // fetch that sandbox event by id. Keep this skipped until MyOS exposes a
    // bank-visible event/session for the fallback path.
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
        const events = await myOsEventSource.listRelevantDocumentEvents({
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
      'myos-created-event-id'
    );

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

  it.skip('subscription one follow-up cycle', async () => {
    // Shared blocker as of 2026-03-16:
    // the real-MyOS subscription flow starts with the same delivery bootstrap
    // and acceptance path as the card canary above. That shared bootstrap step
    // currently never yields any delivery session readable by bank credentials,
    // so the scenario cannot reach mandate bootstrap or follow-up cycle logic.
    //
    // Once MyOS exposes a bank-visible delivery session for this flow, re-check
    // the deeper subscription continuation path; earlier local-only findings are
    // no longer treated as the current root cause.
  });

  it.skip('voucher cashback smoke', async () => {
    // Shared blocker as of 2026-03-16:
    // voucher canary uses the same real-MyOS delivery bootstrap / acceptance
    // stage as the card canary, and that stage currently fails before the
    // monitored-transaction part can start because no bank-visible delivery
    // session materializes for sandbox bank credentials.
    //
    // When that shared MyOS visibility blocker is removed, the monitored
    // transaction trigger should be modeled via a normal bank card auth at the
    // monitored merchant, not via any synthetic MyOS REST trigger.
  });
});
