import {
  getSupportedContractForDocument,
  resolveContractChannelKeys,
} from '@demo-bank-app/shared-bank-api-contract';
import type { PayNoteDeliveryRecord, PayNoteRecord } from '../../ports';

export const resolvePayNoteCustomerChannelKey = (input: {
  updatedRecord: Pick<
    PayNoteRecord,
    'document' | 'accountNumber' | 'payerAccountNumber' | 'payeeAccountNumber'
  >;
  deliveryRecord: PayNoteDeliveryRecord | null;
}): string | undefined => {
  const supportedContract = getSupportedContractForDocument(
    input.updatedRecord.document
  );

  if (supportedContract) {
    const resolved = resolveContractChannelKeys({
      supportedContract,
      accountNumber: input.updatedRecord.accountNumber,
      document: input.updatedRecord.document,
    });
    if (resolved.customerChannelKey) {
      return resolved.customerChannelKey;
    }
  }

  if (input.deliveryRecord) {
    return 'payerChannel';
  }

  return undefined;
};
