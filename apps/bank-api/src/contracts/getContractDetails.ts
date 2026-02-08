import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { normalizeContractSummary } from './summaryNormalization';
import {
  buildMerchantDirectoryMap,
  resolveMerchantFrom,
} from '../shared/merchantDirectory';

export const getContractDetailsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getContractDetails']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger, merchantDirectoryRepository } =
    await getDependencies();
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
  if (!normalizedSummary) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract summary not available',
    });
  }

  const hasSummarySnapshot = Boolean(contract.summarySourceUpdatedAt);
  const shouldUseSummarySnapshot =
    hasSummarySnapshot &&
    contract.summarySourceUpdatedAt !== contract.updatedAt;
  const summarySnapshot = shouldUseSummarySnapshot
    ? await contractRepository.getContractSummarySnapshot(contract.contractId)
    : null;
  const shouldUseSnapshotPayload =
    shouldUseSummarySnapshot &&
    summarySnapshot?.summarySourceUpdatedAt === contract.summarySourceUpdatedAt;
  const effectiveUpdatedAt =
    shouldUseSummarySnapshot && contract.summarySourceUpdatedAt
      ? contract.summarySourceUpdatedAt
      : contract.updatedAt;
  const directory = await buildMerchantDirectoryMap(
    [contract.merchantId],
    merchantDirectoryRepository
  );
  const from = resolveMerchantFrom(contract.merchantId, directory);

  return {
    status: 200 as const,
    body: {
      contractId: contract.contractId,
      typeBlueId: contract.typeBlueId,
      displayName: contract.displayName,
      customerChannelKey: contract.customerChannelKey,
      sessionId: contract.sessionId,
      documentId: contract.documentId,
      status: shouldUseSnapshotPayload
        ? summarySnapshot?.summaryStatus ??
          contract.summaryStatus ??
          contract.status
        : contract.status,
      archivedAt: contract.archivedAt,
      from,
      statusUpdatedAt: shouldUseSnapshotPayload
        ? summarySnapshot?.summaryStatusUpdatedAt ??
          contract.summaryStatusUpdatedAt ??
          contract.statusUpdatedAt
        : contract.statusUpdatedAt,
      statusTimestamps: shouldUseSnapshotPayload
        ? summarySnapshot?.summaryStatusTimestamps ??
          contract.summaryStatusTimestamps ??
          contract.statusTimestamps
        : contract.statusTimestamps,
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
      updatedAt: effectiveUpdatedAt,
    },
  };
};
