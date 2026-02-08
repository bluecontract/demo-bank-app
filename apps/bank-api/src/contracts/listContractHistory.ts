import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const listContractHistoryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listContractHistory']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  logger.info('Listing contract history', { userId, sessionId });

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const items = await contractRepository.listContractHistory(
    contract.contractId
  );

  return {
    status: 200 as const,
    body: {
      items: items.map(item => ({
        id: item.id,
        kind: item.kind,
        short: item.short,
        more: item.more,
        createdAt: item.createdAt,
      })),
    },
  };
};
