import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';

export const listTransactionContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listTransactionContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { txnId } = request.params;

  logger.info('Listing contracts for transaction', {
    userId,
    transactionId: txnId,
  });

  const items = await contractRepository.listContractsByTransactionId(txnId, {
    userId,
  });

  return {
    status: 200 as const,
    body: {
      items,
    },
  };
};
