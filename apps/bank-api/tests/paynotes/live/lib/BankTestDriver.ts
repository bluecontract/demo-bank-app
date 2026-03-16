import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { invokeBankApi, DEFAULT_TEST_ORIGIN } from './invokeBankApi';
import { FAST_AMOUNTS, assertSafeTestAmount } from './amounts';
import { waitForExpectWithLogging } from './wait';

export const bankRoutes = {
  signUp: (isTest = true) =>
    isTest ? '/auth/signup?dev=true' : '/auth/signup',
  accounts: '/v1/accounts',
  account: (accountId: string) => `/v1/accounts/${accountId}`,
  fundAccount: (accountId: string) => `/v1/accounts/${accountId}/funding`,
  cards: '/v1/cards',
  cardsByAccount: (accountId: string) => `/v1/cards?accountId=${accountId}`,
  activity: (accountNumber: string) => `/v1/activity/${accountNumber}`,
  transfers: '/v1/transfers',
  authorizeCard: '/v1/card-processor/authorizations',
  captureAuthorization: (authorizationId: string) =>
    `/v1/card-processor/authorizations/${authorizationId}/capture`,
  bootstrapPayNote: '/v1/paynotes/bootstrap',
  payNoteWebhook: '/v1/paynotes/webhook',
  listPayNoteDeliveries: '/v1/paynotes/deliveries',
  getPayNoteDeliveryBySessionId: (sessionId: string) =>
    `/v1/paynotes/deliveries/by-session/${sessionId}`,
  acceptPayNoteDelivery: (sessionId: string) =>
    `/v1/paynotes/deliveries/${sessionId}/accept`,
  rejectPayNoteDelivery: (sessionId: string) =>
    `/v1/paynotes/deliveries/${sessionId}/reject`,
  getContract: (sessionId: string) => `/v1/contracts/${sessionId}`,
  runContractOperation: (sessionId: string, operation: string) =>
    `/v1/contracts/${sessionId}/operations/${operation}`,
  decideContractPendingAction: (sessionId: string, pendingActionId: string) =>
    `/v1/contracts/${sessionId}/pending-actions/${pendingActionId}/decision`,
  listTransactionContracts: (txnId: string) =>
    `/v1/transactions/${txnId}/contracts`,
  listHoldContracts: (holdId: string) => `/v1/holds/${holdId}/contracts`,
};

export type SignedUpUser = {
  userId: string;
  jwtCookie: string;
  userEmail: string;
  merchantName: string;
};

export type FundedAccountContext = {
  user: SignedUpUser;
  account: any;
  fundingAmountMinor: number;
};

export type FundedCardContext = FundedAccountContext & {
  card: any;
};

export class BankTestDriver {
  async signUpUniqueTestUser(
    prefix = 'paynote-user',
    isTest = true
  ): Promise<SignedUpUser> {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const userEmail = `${prefix}-${suffix}@example.test`;
    const merchantName = `Merchant ${prefix} ${suffix}`;

    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.signUp(isTest),
      body: {
        email: userEmail,
        merchantName,
        marketingEmailsOptIn: true,
      },
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });

    expect(response.statusCode).toBe(201);

    const jwtCookie = response.headers['set-cookie'];
    if (!jwtCookie) {
      throw new Error('Missing set-cookie header in sign-up response');
    }

    return {
      userId: response.body.userId,
      jwtCookie,
      userEmail,
      merchantName,
    };
  }

  async createAccount(jwtCookie: string, name: string) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.accounts,
      jwtCookie,
      body: { name },
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async getAccount(jwtCookie: string, accountId: string) {
    const response = await invokeBankApi({
      method: 'GET',
      path: bankRoutes.account(accountId),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  async fundAccount(jwtCookie: string, accountId: string, amountMinor: number) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.fundAccount(accountId),
      jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        'idempotency-key': randomUUID(),
      },
      body: { amountMinor },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async issueCard(jwtCookie: string, accountId: string) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.cards,
      jwtCookie,
      body: { accountId },
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async createFundedAccount(
    input: {
      prefix?: string;
      accountName?: string;
      fundingAmountMinor?: number;
    } = {}
  ): Promise<FundedAccountContext> {
    const fundingAmountMinor =
      input.fundingAmountMinor ?? FAST_AMOUNTS.fundingBufferMinor;
    assertSafeTestAmount(fundingAmountMinor, 'fundingAmountMinor');

    const user = await this.signUpUniqueTestUser(
      input.prefix ?? 'paynote-funded-user'
    );
    const account = await this.createAccount(
      user.jwtCookie,
      input.accountName ?? 'PayNote funded account'
    );
    await this.fundAccount(
      user.jwtCookie,
      account.accountId,
      fundingAmountMinor
    );

    return { user, account, fundingAmountMinor };
  }

  async createFundedAccountWithCard(
    input: {
      prefix?: string;
      accountName?: string;
      fundingAmountMinor?: number;
    } = {}
  ): Promise<FundedCardContext> {
    const base = await this.createFundedAccount(input);
    const card = await this.issueCard(
      base.user.jwtCookie,
      base.account.accountId
    );
    return { ...base, card };
  }

  async authorizeCard(input: {
    pan: string;
    expiryMonth: number;
    expiryYear: number;
    cvc: string;
    amountMinor: number;
    merchantId?: string;
    merchantName: string;
    statementDescriptor?: string;
    processorChargeId?: string;
  }) {
    assertSafeTestAmount(input.amountMinor, 'authorizeCard.amountMinor');
    const processorChargeId =
      input.processorChargeId ?? `paynote-charge-${randomUUID()}`;

    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.authorizeCard,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        Authorization: `Bearer ${
          process.env.CARD_PROCESSOR_TOKEN ?? 'demo-bank-processor-token'
        }`,
        'idempotency-key': randomUUID(),
      },
      body: {
        pan: input.pan,
        expiryMonth: input.expiryMonth,
        expiryYear: input.expiryYear,
        cvc: input.cvc,
        amountMinor: input.amountMinor,
        currency: 'USD',
        merchant: {
          name: input.merchantName,
          statementDescriptor:
            input.statementDescriptor ??
            input.merchantName.toUpperCase().slice(0, 22),
          ...(input.merchantId ? { merchantId: input.merchantId } : {}),
        },
        processorChargeId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('APPROVED');
    return { ...response.body, processorChargeId };
  }

  async captureCardAuthorization(authorizationId: string, amountMinor: number) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.captureAuthorization(authorizationId),
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        Authorization: `Bearer ${
          process.env.CARD_PROCESSOR_TOKEN ?? 'demo-bank-processor-token'
        }`,
        'idempotency-key': randomUUID(),
      },
      body: { amountMinor },
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  async transfer(input: {
    jwtCookie: string;
    sourceAccountId: string;
    destinationAccountNumber: string;
    amountMinor: number;
  }) {
    assertSafeTestAmount(input.amountMinor, 'transfer.amountMinor');

    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.transfers,
      jwtCookie: input.jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        'idempotency-key': randomUUID(),
      },
      body: {
        sourceAccountId: input.sourceAccountId,
        destinationAccountNumber: input.destinationAccountNumber,
        amountMinor: input.amountMinor,
      },
    });

    expect(response.statusCode).toBe(201);
    return response.body;
  }

  async bootstrapPayNote(jwtCookie: string, body: Record<string, unknown>) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.bootstrapPayNote,
      jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        'idempotency-key': randomUUID(),
      },
      body,
    });
    expect([200, 201, 202]).toContain(response.statusCode);
    return response.body;
  }

  async postPayNoteWebhook(
    payloadOrEventId: string | Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ) {
    const body =
      typeof payloadOrEventId === 'string'
        ? { id: payloadOrEventId }
        : payloadOrEventId;

    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.payNoteWebhook,
      body,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
        ...(extraHeaders ?? {}),
      },
    });

    expect(response.statusCode).toBe(200);
    return response.body;
  }

  async postPayNoteWebhookPayload(
    payload: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ) {
    return this.postPayNoteWebhook(payload, extraHeaders);
  }

  async postPayNoteWebhookById(
    eventId: string,
    extraHeaders?: Record<string, string>
  ) {
    return this.postPayNoteWebhook(eventId, extraHeaders);
  }

  async getPayNoteDeliveryBySessionId(jwtCookie: string, sessionId: string) {
    return invokeBankApi({
      method: 'GET',
      path: bankRoutes.getPayNoteDeliveryBySessionId(sessionId),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
  }

  async listPayNoteDeliveries(
    jwtCookie: string,
    clientDecisionStatus?: 'pending' | 'accepted' | 'rejected'
  ) {
    const path = clientDecisionStatus
      ? `${bankRoutes.listPayNoteDeliveries}?clientDecisionStatus=${clientDecisionStatus}`
      : bankRoutes.listPayNoteDeliveries;

    const response = await invokeBankApi({
      method: 'GET',
      path,
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    return Array.isArray(response.body?.items) ? response.body.items : [];
  }

  async waitForDeliveryBySessionId(
    jwtCookie: string,
    sessionId: string,
    timeoutMs = 10_000
  ) {
    let matched: any;
    await waitForExpectWithLogging(
      async () => {
        const deliveries = await this.listPayNoteDeliveries(jwtCookie);
        matched = deliveries.find(
          (delivery: any) =>
            delivery.deliverySessionId === sessionId ||
            delivery.deliveryId === sessionId ||
            (Array.isArray(delivery.deliverySessionIds) &&
              delivery.deliverySessionIds.includes(sessionId))
        );
        if (!matched) {
          throw new Error('Delivery not visible yet');
        }
      },
      timeoutMs,
      250,
      'delivery-by-session'
    );
    return matched;
  }

  async acceptDelivery(jwtCookie: string, sessionId: string) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.acceptPayNoteDelivery(sessionId),
      jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
      },
      body: {},
    });
    expect([200, 202]).toContain(response.statusCode);
    return response.body;
  }

  async getContract(jwtCookie: string, sessionId: string) {
    return invokeBankApi({
      method: 'GET',
      path: bankRoutes.getContract(sessionId),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
  }

  async waitForContract(
    jwtCookie: string,
    sessionId: string,
    timeoutMs = 15000
  ) {
    let matched: any;
    await waitForExpectWithLogging(
      async () => {
        const response = await this.getContract(jwtCookie, sessionId);
        expect([200, 404]).toContain(response.statusCode);
        if (response.statusCode !== 200) {
          throw new Error('Contract not visible yet');
        }
        matched = response.body;
      },
      timeoutMs,
      500,
      'contract-by-session'
    );
    return matched;
  }

  async runContractOperation(
    jwtCookie: string,
    sessionId: string,
    operation: string,
    body: Record<string, unknown>
  ) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.runContractOperation(sessionId, operation),
      jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
      },
      body,
    });
    expect([200, 202]).toContain(response.statusCode);
    return response.body;
  }

  async decideContractPendingAction(
    jwtCookie: string,
    sessionId: string,
    pendingActionId: string,
    body: Record<string, unknown>
  ) {
    const response = await invokeBankApi({
      method: 'POST',
      path: bankRoutes.decideContractPendingAction(sessionId, pendingActionId),
      jwtCookie,
      headers: {
        origin: DEFAULT_TEST_ORIGIN,
      },
      body,
    });
    expect([200, 202]).toContain(response.statusCode);
    return response.body;
  }

  async listHoldContracts(jwtCookie: string, holdId: string) {
    return invokeBankApi({
      method: 'GET',
      path: bankRoutes.listHoldContracts(holdId),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
  }

  async listTransactionContracts(jwtCookie: string, txnId: string) {
    return invokeBankApi({
      method: 'GET',
      path: bankRoutes.listTransactionContracts(txnId),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
  }

  async getActivity(jwtCookie: string, accountNumber: string) {
    const response = await invokeBankApi({
      method: 'GET',
      path: bankRoutes.activity(accountNumber),
      jwtCookie,
      headers: { origin: DEFAULT_TEST_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    return Array.isArray(response.body?.items) ? response.body.items : [];
  }

  async waitForActivity(input: {
    jwtCookie: string;
    accountNumber: string;
    predicate: (items: any[]) => boolean;
    timeoutMs?: number;
  }) {
    let items: any[] = [];
    await waitForExpectWithLogging(
      async () => {
        items = await this.getActivity(input.jwtCookie, input.accountNumber);
        if (!input.predicate(items)) {
          throw new Error('Activity predicate not satisfied yet');
        }
      },
      input.timeoutMs ?? 15_000,
      500,
      'account-activity'
    );
    return items;
  }
}
