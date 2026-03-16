import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BankTestDriver } from '../lib/BankTestDriver';
import { MyOsHarness } from '../lib/MyOsHarness';
import {
  applyPayNoteIntegrationTestEnv,
  upsertMyOsCredentialsSecret,
  upsertOpenAiPlaceholderSecret,
} from '../lib/localstackSecrets';
import { createFundedTransferPair } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import {
  buildSimpleTransferPayNote,
  buildWebhookEnvelope,
  emittedReserveFundsRequested,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: transfer reserve then capture', () => {
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

  it('reserves and then captures funds on transfer flow', async () => {
    const { payer, payee } = await createFundedTransferPair(
      bank,
      FAST_AMOUNTS.transferMinor
    );
    const sessionId = `paynote-transfer-session-${randomUUID()}`;
    const documentId = `paynote-transfer-doc-${randomUUID()}`;
    const reserveEventId = `myos-reserve-${randomUUID()}`;
    const captureEventId = `myos-capture-${randomUUID()}`;

    const document = buildSimpleTransferPayNote({
      payerAccountNumber: payer.account.accountNumber,
      payeeAccountNumber: payee.account.accountNumber,
      amountMinor: FAST_AMOUNTS.transferMinor,
    });

    myOs.seedDocument({ documentId, sessionId, document });
    const reserveWebhookPayload = buildWebhookEnvelope({
      eventId: reserveEventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document,
      emitted: [
        emittedReserveFundsRequested(
          FAST_AMOUNTS.transferMinor,
          'transfer-reserve-1'
        ),
      ],
    });

    const captureWebhookPayload = buildWebhookEnvelope({
      eventId: captureEventId,
      sessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document,
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.transferMinor,
          'transfer-capture-1'
        ),
      ],
    });

    myOs.seedEvent({
      eventId: reserveEventId,
      payload: reserveWebhookPayload,
    });

    myOs.seedEvent({
      eventId: captureEventId,
      payload: captureWebhookPayload,
    });

    await bank.postPayNoteWebhookPayload(reserveWebhookPayload);
    await bank.postPayNoteWebhookPayload(captureWebhookPayload);

    const items = await bank.waitForActivity({
      jwtCookie: payer.user.jwtCookie,
      accountNumber: payer.account.accountNumber,
      predicate: activityItems =>
        activityItems.some(
          item =>
            item.amountMinor === FAST_AMOUNTS.transferMinor &&
            item.kind !== 'HOLD'
        ),
    });

    expect(
      items.some(item => item.amountMinor === FAST_AMOUNTS.transferMinor)
    ).toBe(true);
  });
});
