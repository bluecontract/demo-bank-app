import { describe, expect, it } from 'vitest';
import {
  getSupportedContractForDocument,
  resolveContractChannelKeys,
} from '@demo-bank-app/shared-bank-api-contract';
import { resolvePayNoteCustomerChannelKey } from './customerChannel';

const expectSharedAndWebhookToMatch = (input: {
  document: Record<string, unknown>;
  accountNumber?: string;
}) => {
  const supported = getSupportedContractForDocument(input.document);
  expect(supported).toBeTruthy();

  const shared = resolveContractChannelKeys({
    supportedContract: supported!,
    accountNumber: input.accountNumber,
    document: input.document,
  }).customerChannelKey;

  const webhook = resolvePayNoteCustomerChannelKey({
    updatedRecord: {
      document: input.document,
      accountNumber: input.accountNumber,
    } as any,
    deliveryRecord: null,
  });

  expect(webhook).toBe(shared);
};

describe('resolvePayNoteCustomerChannelKey', () => {
  it('matches shared resolver for payer channel inference', () => {
    expectSharedAndWebhookToMatch({
      accountNumber: '1111111111',
      document: {
        type: 'PayNote/PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });
  });

  it('matches shared resolver for payee channel inference', () => {
    expectSharedAndWebhookToMatch({
      accountNumber: '2222222222',
      document: {
        type: 'PayNote/PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });
  });

  it('matches shared resolver for Merchant To Customer PayNote', () => {
    expectSharedAndWebhookToMatch({
      accountNumber: '1111111111',
      document: {
        type: 'PayNote/Merchant To Customer PayNote',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      },
    });
  });

  it('falls back to payerChannel for delivery-linked records when shared inference is unavailable', () => {
    const resolved = resolvePayNoteCustomerChannelKey({
      updatedRecord: {
        document: {
          type: 'PayNote/PayNote',
        },
        accountNumber: '1111111111',
      } as any,
      deliveryRecord: {
        deliveryId: 'delivery-1',
      } as any,
    });

    expect(resolved).toBe('payerChannel');
  });
});
