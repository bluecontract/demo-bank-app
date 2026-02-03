import { getDependencies } from '../paynote/dependencies';
import { generateContractSummaryForSessionId } from '../contracts/generateContractSummary';
import { generatePayNoteDeliverySummaryForSessionId } from '../paynote/generatePayNoteDeliverySummary';
import { isSummaryJob } from './types';

export const handleSummaryJob = async (event: unknown) => {
  const {
    logger,
    contractRepository,
    payNoteDeliveryRepository,
    getOpenAiApiKey,
  } = await getDependencies();

  if (!isSummaryJob(event)) {
    logger.warn('Summary job ignored (invalid payload)', {
      payloadType: typeof event,
    });
    return { status: 'ignored' as const };
  }

  const { type, sessionId, force, reason } = event;
  logger.info('Starting summarization', {
    type,
    sessionId,
    force: Boolean(force),
    reason,
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

  try {
    if (type === 'contract-summary') {
      await generateContractSummaryForSessionId({
        sessionId,
        force: Boolean(force),
        contractRepository,
        getOpenAiApiKey,
        logger,
      });
      return { status: 'ok' as const };
    }

    await generatePayNoteDeliverySummaryForSessionId({
      sessionId,
      force: Boolean(force),
      payNoteDeliveryRepository,
      getOpenAiApiKey,
      logger,
    });
    return { status: 'ok' as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Summary job failed', {
      type,
      sessionId,
      error: message,
    });
    return { status: 'error' as const, message };
  }
};
