import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { createFundedTransferPair } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { waitForExpectWithLogging } from '../lib/wait';
import {
  buildTransferPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
  emittedReserveFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: transfer reserve then capture', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('reserves and then captures funds for a transfer flow', async () => {
    const { payer, payee } = await createFundedTransferPair(
      context.bank,
      FAST_AMOUNTS.transferMinor
    );

    const sessionId = `paynote-transfer-session-${randomUUID()}`;
    const documentId = `paynote-transfer-doc-${randomUUID()}`;
    const reserveEventId = `myos-reserve-${randomUUID()}`;
    const captureEventId = `myos-capture-${randomUUID()}`;
    const requestId = `transfer-flow-${randomUUID()}`;

    const document = buildTransferPayNote({
      payerAccountNumber: payer.account.accountNumber,
      payeeAccountNumber: payee.account.accountNumber,
      amountMinor: FAST_AMOUNTS.transferMinor,
    });

    context.myOs.seedDocument({ documentId, sessionId, document });
    await context.saveBootstrapContext({
      bootstrapSessionId: sessionId,
      accountNumber: payer.account.accountNumber,
      userId: payer.user.userId,
    });

    const reserveWebhookPayload = buildWebhookEnvelope({
      eventId: reserveEventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document,
      emitted: [
        emittedReserveFundsRequested(FAST_AMOUNTS.transferMinor, requestId),
      ],
    });

    const captureWebhookPayload = buildWebhookEnvelope({
      eventId: captureEventId,
      sessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document,
      emitted: [
        emittedCaptureFundsRequested(FAST_AMOUNTS.transferMinor, requestId),
      ],
    });

    await context.bank.postPayNoteWebhookPayload(reserveWebhookPayload);
    await context.bank.postPayNoteWebhookPayload(captureWebhookPayload);

    await waitForExpectWithLogging(
      async () => {
        const payerAccount = await context.bank.getAccount(
          payer.user.jwtCookie,
          payer.account.accountId
        );
        const payeeAccount = await context.bank.getAccount(
          payee.user.jwtCookie,
          payee.account.accountId
        );

        expect(payerAccount.ledgerBalanceMinor).toBe(
          payer.fundingAmountMinor - FAST_AMOUNTS.transferMinor
        );
        expect(payerAccount.availableBalanceMinor).toBe(
          payer.fundingAmountMinor - FAST_AMOUNTS.transferMinor
        );
        expect(payeeAccount.ledgerBalanceMinor).toBe(
          payee.fundingAmountMinor + FAST_AMOUNTS.transferMinor
        );
        expect(payeeAccount.availableBalanceMinor).toBe(
          payee.fundingAmountMinor + FAST_AMOUNTS.transferMinor
        );
      },
      20_000,
      500,
      'transfer-reserve-capture-balances'
    );
  });
});
