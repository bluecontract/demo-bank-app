import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BankTestDriver } from '../lib/BankTestDriver';
import { MyOsHarness } from '../lib/MyOsHarness';
import {
  applyPayNoteIntegrationTestEnv,
  upsertMyOsCredentialsSecret,
  upsertOpenAiPlaceholderSecret,
} from '../lib/localstackSecrets';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { createScenarioRunContext, logScenarioStep } from '../lib/reporting';
import {
  waitForSinglePostedCapture,
  waitForNoDuplicateActivityAfterReplay,
} from '../lib/assertions';
import {
  buildSimpleCardTransactionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: card delivery accepted then capture', () => {
  let bank: BankTestDriver;
  let myOs: MyOsHarness;

  beforeAll(async () => {
    applyPayNoteIntegrationTestEnv();
    bank = new BankTestDriver();
    myOs = new MyOsHarness();
    await myOs.start();

    await upsertMyOsCredentialsSecret({
      secretArn:
        process.env.MYOS_SECRET_ARN ??
        '/demo-bank-app/integration-test/myos-credentials',
      baseUrl: myOs.baseUrl,
      apiKey: myOs.apiKey,
      accountId: 'integration-myos-account-id',
    });

    await upsertOpenAiPlaceholderSecret(
      process.env.OPENAI_API_KEY_SECRET_ARN ??
        '/demo-bank-app/integration-test/openai-api-key'
    );
  });

  afterAll(async () => {
    await myOs.stop();
  });

  it('posts full webhook payload, persists delivery, accepts it and captures funds exactly once', async () => {
    const ctx = createScenarioRunContext('card-delivery-capture');
    const customer = await createFundedCustomerWithCard(bank, {
      prefix: 'pn-card-customer',
      accountName: 'PayNote card account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });

    const sessionId = `paynote-card-session-${randomUUID()}`;
    const documentId = `paynote-card-doc-${randomUUID()}`;
    const eventId = `myos-event-${randomUUID()}`;

    const document = buildSimpleCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
    });

    const webhookPayload = buildWebhookEnvelope({
      eventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote: document,
      },
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.cardPurchaseMinor,
          'card-delivery-capture'
        ),
      ],
    });

    myOs.seedEvent({
      eventId,
      payload: webhookPayload,
    });

    myOs.seedDocument({
      documentId,
      sessionId,
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote: document,
      },
    });

    logScenarioStep(ctx, 'posting-webhook', { eventId, sessionId, documentId });
    await bank.postPayNoteWebhookPayload(webhookPayload);

    const delivery = await bank.waitForDeliveryBySessionId(
      customer.user.jwtCookie,
      sessionId
    );
    const deliveryId = delivery.deliveryId ?? delivery.id;
    expect(deliveryId).toBeTruthy();

    logScenarioStep(ctx, 'accepting-delivery', { deliveryId });
    await bank.acceptDelivery(customer.user.jwtCookie, deliveryId);

    await waitForSinglePostedCapture({
      bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      processorChargeId: auth.processorChargeId,
    });

    await bank.postPayNoteWebhookPayload(webhookPayload);
    await waitForNoDuplicateActivityAfterReplay({
      bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      processorChargeId: auth.processorChargeId,
    });

    await myOs.waitForOperationCall(
      call =>
        call.operation === 'guarantorUpdate' ||
        call.operation === 'acceptDelivery'
    );
  });
});
