import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';
import type { ContractRecord } from '@demo-bank-app/contracts';
import { getDependencies } from '../paynote/dependencies';
import { generateContractSummaryForContract } from '../contracts/generateContractSummary';
import { generatePayNoteDeliverySummaryForSessionId } from '../paynote/generatePayNoteDeliverySummary';
import { isSummaryJob } from './types';

const NOT_READY_BACKOFF_SECONDS = [5, 15, 45, 120];

class SummaryNotReadyError extends Error {
  override name = 'SummaryNotReadyError';
}

const buildContractForSummary = (input: {
  latest: ContractRecord;
  snapshot?: ContractRecord;
  sourceEpoch?: number;
}): ContractRecord => {
  const { latest, snapshot, sourceEpoch } = input;
  if (!snapshot) {
    return {
      ...latest,
      ...(sourceEpoch !== undefined ? { summarySourceEpoch: sourceEpoch } : {}),
    };
  }

  return {
    ...latest,
    ...snapshot,
    // Projection metadata must come from latest persisted core state.
    userId: latest.userId,
    relatedTransactionIds: latest.relatedTransactionIds,
    relatedHoldIds: latest.relatedHoldIds,
    accountNumber: latest.accountNumber,
    merchantId: latest.merchantId,
    ...(sourceEpoch !== undefined ? { summarySourceEpoch: sourceEpoch } : {}),
    summary: latest.summary ?? snapshot.summary,
    summaryPreview: latest.summaryPreview ?? snapshot.summaryPreview,
    summaryUpdatedAt: latest.summaryUpdatedAt ?? snapshot.summaryUpdatedAt,
    summarySourceUpdatedAt:
      latest.summarySourceUpdatedAt ?? snapshot.summarySourceUpdatedAt,
    summaryInputBlueId:
      latest.summaryInputBlueId ?? snapshot.summaryInputBlueId,
    summaryModel: latest.summaryModel ?? snapshot.summaryModel,
    summaryError: latest.summaryError ?? snapshot.summaryError,
    summaryDocumentName:
      latest.summaryDocumentName ?? snapshot.summaryDocumentName,
  };
};

type SummaryJobExecutionContext = {
  sqsRecord?: Pick<SQSRecord, 'receiptHandle' | 'messageId' | 'attributes'>;
};

let cachedSqsClient: SQSClient | null = null;

const getSqsClient = () => {
  if (cachedSqsClient) {
    return cachedSqsClient;
  }

  const region = process.env.AWS_REGION || 'eu-west-1';
  const endpoint = process.env.AWS_ENDPOINT_URL;
  cachedSqsClient = new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
  return cachedSqsClient;
};

const getApproximateReceiveCount = (
  record?: SummaryJobExecutionContext['sqsRecord']
) => {
  const count = record?.attributes?.ApproximateReceiveCount;
  const parsed = count ? Number.parseInt(count, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const isLatestSummarySourceAhead = (input: {
  latestEpoch?: number;
  latestUpdatedAt?: string;
  snapshotEpoch?: number;
  snapshotUpdatedAt: string;
}) => {
  const latestEpoch = input.latestEpoch;
  const snapshotEpoch = input.snapshotEpoch;

  if (
    typeof latestEpoch === 'number' &&
    Number.isFinite(latestEpoch) &&
    typeof snapshotEpoch === 'number' &&
    Number.isFinite(snapshotEpoch)
  ) {
    if (latestEpoch > snapshotEpoch) {
      return true;
    }
    if (latestEpoch < snapshotEpoch) {
      return false;
    }
  }

  return Boolean(
    input.latestUpdatedAt && input.latestUpdatedAt > input.snapshotUpdatedAt
  );
};

const applyNotReadyBackoff = async (input: {
  logger: Awaited<ReturnType<typeof getDependencies>>['logger'];
  sqsRecord?: SummaryJobExecutionContext['sqsRecord'];
  jobType: string;
  context: Record<string, unknown>;
}) => {
  const { logger, sqsRecord, jobType, context } = input;
  if (!sqsRecord?.receiptHandle) {
    return;
  }

  const queueUrl = process.env.SUMMARY_QUEUE_URL?.trim();
  if (!queueUrl) {
    logger.warn('Summary backoff skipped (missing SUMMARY_QUEUE_URL)', {
      jobType,
      messageId: sqsRecord.messageId,
      ...context,
    });
    return;
  }

  const receiveCount = getApproximateReceiveCount(sqsRecord);
  const backoff =
    NOT_READY_BACKOFF_SECONDS[
      Math.min(receiveCount - 1, NOT_READY_BACKOFF_SECONDS.length - 1)
    ];

  try {
    await getSqsClient().send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: sqsRecord.receiptHandle,
        VisibilityTimeout: backoff,
      })
    );
    logger.warn('Summary job not ready, applying backoff', {
      jobType,
      messageId: sqsRecord.messageId,
      receiveCount,
      visibilityTimeoutSeconds: backoff,
      ...context,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to apply summary backoff', {
      jobType,
      messageId: sqsRecord.messageId,
      receiveCount,
      visibilityTimeoutSeconds: backoff,
      error: message,
      ...context,
    });
  }
};

export const handleSummaryJob = async (
  event: unknown,
  executionContext?: SummaryJobExecutionContext
) => {
  const {
    logger,
    contractRepository,
    summaryInputStore,
    payNoteDeliveryRepository,
    merchantDirectoryRepository,
    getOpenAiApiKey,
  } = await getDependencies();

  if (!isSummaryJob(event)) {
    logger.warn('Summary job ignored (invalid payload)', {
      payloadType: typeof event,
    });
    return { status: 'ignored' as const };
  }

  const { type, force, reason } = event;
  const summaryContext =
    type === 'contract-summary'
      ? {
          contractId: event.contractId,
          documentId: event.documentId,
          summaryInputKey: event.summaryInputKey,
          sourceUpdatedAt: event.sourceUpdatedAt,
          sourceEpoch: event.sourceEpoch,
        }
      : {
          sessionId: event.sessionId,
        };
  logger.info('Starting summarization', {
    type,
    force: Boolean(force),
    reason,
    ...summaryContext,
  });
  logger.info('Summary AWS environment', {
    region: process.env.AWS_REGION ?? null,
    endpoint: process.env.AWS_ENDPOINT_URL ?? null,
    accessKeyIdSuffix: process.env.AWS_ACCESS_KEY_ID
      ? process.env.AWS_ACCESS_KEY_ID.slice(-4)
      : null,
    hasSessionToken: Boolean(process.env.AWS_SESSION_TOKEN),
    localstackHostname: process.env.LOCALSTACK_HOSTNAME ?? null,
  });

  let contractSummarySnapshot: Awaited<
    ReturnType<typeof summaryInputStore.get>
  > | null = null;

  try {
    if (type === 'contract-summary') {
      contractSummarySnapshot = await summaryInputStore.get({
        contractId: event.contractId,
        summaryInputKey: event.summaryInputKey,
      });
      if (!contractSummarySnapshot) {
        throw new SummaryNotReadyError('Summary input snapshot not found');
      }

      const latestContract = await contractRepository.getContract(
        event.contractId
      );
      if (!latestContract) {
        throw new SummaryNotReadyError('Contract not found for summary job');
      }
      const contractForSummary = buildContractForSummary({
        latest: latestContract,
        snapshot: contractSummarySnapshot.contractSnapshot,
        sourceEpoch: contractSummarySnapshot.sourceEpoch ?? event.sourceEpoch,
      });

      if (!contractForSummary.document) {
        throw new SummaryNotReadyError(
          'Contract document not available for summary job'
        );
      }
      if (!contractForSummary.userId) {
        throw new SummaryNotReadyError(
          'Contract userId not available for summary job'
        );
      }

      await generateContractSummaryForContract({
        contract: contractForSummary,
        force: Boolean(force),
        historyEventId: contractSummarySnapshot.eventId,
        merchantDirectoryRepository,
        contractRepository,
        getOpenAiApiKey,
        logger,
      });
      return { status: 'ok' as const };
    }

    await generatePayNoteDeliverySummaryForSessionId({
      sessionId: event.sessionId,
      force: Boolean(force),
      merchantDirectoryRepository,
      payNoteDeliveryRepository,
      getOpenAiApiKey,
      logger,
    });
    return { status: 'ok' as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isConditionalCheckFailed =
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: string }).name === 'ConditionalCheckFailedException';

    if (type === 'contract-summary' && isConditionalCheckFailed) {
      const latestContract = await contractRepository.getContract(
        event.contractId
      );
      const snapshotSourceUpdatedAt =
        contractSummarySnapshot?.contractSnapshot?.updatedAt ??
        contractSummarySnapshot?.sourceUpdatedAt ??
        event.sourceUpdatedAt;
      const snapshotSourceEpoch =
        contractSummarySnapshot?.sourceEpoch ?? event.sourceEpoch;
      if (
        latestContract &&
        isLatestSummarySourceAhead({
          latestEpoch: latestContract.summarySourceEpoch,
          latestUpdatedAt: latestContract.summarySourceUpdatedAt,
          snapshotEpoch: snapshotSourceEpoch,
          snapshotUpdatedAt: snapshotSourceUpdatedAt,
        })
      ) {
        logger.info('Skipping stale contract summary job', {
          contractId: event.contractId,
          summaryInputKey: event.summaryInputKey,
          sourceUpdatedAt: snapshotSourceUpdatedAt,
          sourceEpoch: snapshotSourceEpoch,
          latestSummarySourceEpoch: latestContract.summarySourceEpoch,
          latestSummarySourceUpdatedAt: latestContract.summarySourceUpdatedAt,
        });
        return { status: 'stale' as const };
      }
    }

    if (error instanceof SummaryNotReadyError || isConditionalCheckFailed) {
      await applyNotReadyBackoff({
        logger,
        sqsRecord: executionContext?.sqsRecord,
        jobType: type,
        context: summaryContext,
      });
    }
    logger.error('Summary job failed', {
      type,
      error: message,
      ...summaryContext,
    });
    throw error;
  }
};
