import { handleSummaryJob } from '../../../../src/summary/worker';
import {
  buildSummaryInputKey,
  normalizeSourceUpdatedAt,
} from '../../../../src/summary/inputStore';
import type { PayNoteLiveTestContext } from './testContext';

type WebhookPayloadLike = {
  type?: string;
  object?: {
    created?: unknown;
    epoch?: unknown;
  };
};

const resolveSummaryJobSourceEpoch = (payload: WebhookPayloadLike) => {
  const epoch = payload.object?.epoch;
  if (typeof epoch === 'number' && Number.isFinite(epoch)) {
    return epoch;
  }

  if (payload.type === 'DOCUMENT_CREATED') {
    return -1;
  }

  return undefined;
};

export async function materializeContractSummaryForWebhook(input: {
  context: PayNoteLiveTestContext;
  sessionId: string;
  payload: WebhookPayloadLike;
  force?: boolean;
  reason?: string;
}) {
  const contract = await input.context.getRawContractBySessionId(
    input.sessionId
  );
  if (!contract?.contractId) {
    throw new Error(
      `Expected contract to exist for session "${input.sessionId}" before running summary worker`
    );
  }

  const sourceUpdatedAt = normalizeSourceUpdatedAt(
    input.payload.object?.created,
    contract.updatedAt ?? new Date().toISOString()
  );
  const sourceEpoch = resolveSummaryJobSourceEpoch(input.payload);
  const summaryInputKey = buildSummaryInputKey({
    sourceUpdatedAt,
    sourceEpoch,
  });

  await handleSummaryJob({
    type: 'contract-summary',
    messageVersion: 1,
    contractId: contract.contractId,
    documentId: contract.documentId ?? contract.contractId,
    summaryInputKey,
    sourceUpdatedAt,
    ...(sourceEpoch !== undefined ? { sourceEpoch } : {}),
    force: input.force ?? true,
    reason: input.reason ?? 'test-worker-materialization',
  });
}
