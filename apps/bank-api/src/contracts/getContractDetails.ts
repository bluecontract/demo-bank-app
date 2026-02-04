import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { normalizeContractSummary } from './summaryNormalization';

export const getContractDetailsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getContractDetails']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  logger.info('Fetching contract details', { userId, sessionId });

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const normalizedSummary = normalizeContractSummary(
    contract.summary,
    contract.documentName ?? contract.displayName
  );

  return {
    status: 200 as const,
    body: {
      contractId: contract.contractId,
      typeBlueId: contract.typeBlueId,
      displayName: contract.displayName,
      sessionId: contract.sessionId,
      documentId: contract.documentId,
      status: contract.status,
      archivedAt: contract.archivedAt,
      statusUpdatedAt: contract.statusUpdatedAt,
      statusTimestamps: contract.statusTimestamps,
      triggerEvent: contract.triggerEvent,
      emittedEvents: contract.emittedEvents,
      relatedTransactionIds: contract.relatedTransactionIds,
      relatedHoldIds: contract.relatedHoldIds,
      accountNumber: contract.accountNumber,
      document: contract.document,
      summary: normalizedSummary ?? undefined,
      summaryUpdatedAt: contract.summaryUpdatedAt,
      summarySourceUpdatedAt: contract.summarySourceUpdatedAt,
      summaryInputBlueId: contract.summaryInputBlueId,
      summaryModel: contract.summaryModel,
      summaryError: contract.summaryError,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    },
  };
};
