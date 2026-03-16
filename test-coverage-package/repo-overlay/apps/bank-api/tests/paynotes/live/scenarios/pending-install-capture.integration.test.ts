import { afterAll, beforeAll, describe, it } from 'vitest';
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
import {
  buildSimpleCardTransactionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

/**
 * Intentional blueprint test.
 * Agent should align pending-action endpoints and response payloads to the real bank contract.
 */
describe('PayNote live scenario: pending install approval then capture', () => {
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

  it('should expose pending action, accept approval and then capture', async () => {
    const customer = await createFundedCustomerWithCard(bank, {
      prefix: 'pn-install-customer',
      fundingAmountMinor:
        FAST_AMOUNTS.pendingInstallMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
      merchantId: 'merchant-install-demo',
      merchantName: 'Install Demo Shop',
    });

    const sessionId = `pending-install-session-${randomUUID()}`;
    const documentId = `pending-install-doc-${randomUUID()}`;
    const eventId = `pending-install-event-${randomUUID()}`;

    const payNote = buildSimpleCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
    });

    myOs.seedDocument({
      documentId,
      sessionId,
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote,
      },
    });

    const webhookPayload = buildWebhookEnvelope({
      eventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote,
      },
      emitted: [
        {
          type: 'Conversation/Customer Action Requested',
          requestId: 'install-confirmation',
          title: 'Confirm installation',
          actions: [{ label: 'Installation confirmed', variant: 'primary' }],
        },
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.pendingInstallMinor,
          'install-capture'
        ),
      ],
    });

    myOs.seedEvent({
      eventId,
      payload: webhookPayload,
    });

    await bank.postPayNoteWebhookPayload(webhookPayload);

    // TODO(agent): align delivery -> contract -> pending action read path.
    // TODO(agent): call decideContractPendingAction with the real payload for approval.
    // TODO(agent): assert single capture for auth.processorChargeId.
    void auth;
  });
});
