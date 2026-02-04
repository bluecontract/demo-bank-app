import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const unarchiveContractHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['unarchiveContract']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  logger.info('Unarchiving contract', { userId, sessionId });

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const updatedAt = new Date().toISOString();
  await contractRepository.updateContractArchive({
    contractId: contract.contractId,
    archivedAt: null,
    updatedAt,
    userId: contract.userId,
    relatedTransactionIds: contract.relatedTransactionIds ?? null,
    relatedHoldIds: contract.relatedHoldIds ?? null,
  });

  return {
    status: 200 as const,
    body: {
      status: 'ok' as const,
      myosStatus: 200,
    },
  };
};
