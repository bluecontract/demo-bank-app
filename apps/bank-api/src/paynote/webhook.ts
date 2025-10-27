import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { handleWebhookEvent as handleWebhookEventUseCase } from '@demo-bank-app/paynotes';
import { getDependencies } from './dependencies';
import { createMyOsClient, createBankingFacade } from './useCaseAdapters';

const returnResponse = (note?: string) => ({
  status: 200 as const,
  body: note
    ? ({ status: 'ok' as const, note } as const)
    : ({ status: 'ok' as const } as const),
});

export const payNoteWebhookHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['payNoteWebhook']
  >
) => {
  const { logger, getMyOsCredentials, bankingRepository, holdRepository } =
    await getDependencies();

  const { id: eventId } = request.body ?? {};

  if (!eventId || typeof eventId !== 'string') {
    logger.error('PayNote webhook received payload without valid id', {
      payload: request.body,
    });
    return returnResponse('PayNote webhook received payload without valid id');
  }

  const myOsClient = createMyOsClient(getMyOsCredentials);
  const bankingFacade = createBankingFacade({
    bankingRepository,
    holdRepository,
    logger,
  });

  const result = await handleWebhookEventUseCase(
    {
      eventId,
    },
    {
      myOsClient,
      bankingFacade,
    }
  );

  result.logs.forEach(entry => {
    if (entry.level === 'error') {
      logger.error(entry.message, entry.context);
    } else if (entry.level === 'warn') {
      logger.warn(entry.message, entry.context);
    } else {
      logger.info(entry.message, entry.context);
    }
  });

  return returnResponse(result.note);
};
