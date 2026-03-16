import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Callback,
  Context,
  SQSBatchResponse,
  SQSEvent,
} from 'aws-lambda';
import { handler as apiHandler } from './main';
import { handleSummaryJob } from './summary/worker';

const isApiGatewayEvent = (
  event: unknown
): event is APIGatewayProxyEvent | APIGatewayProxyEventV2 => {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const record = event as {
    requestContext?: unknown;
    version?: unknown;
    httpMethod?: unknown;
  };
  return (
    Boolean(record.requestContext) &&
    (record.version === '2.0' || 'httpMethod' in record)
  );
};

const isSqsEvent = (event: unknown): event is SQSEvent => {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const records = (event as { Records?: unknown }).Records;
  if (!Array.isArray(records) || records.length === 0) {
    return false;
  }
  return records.every(
    record =>
      record &&
      typeof record === 'object' &&
      (record as { eventSource?: unknown }).eventSource === 'aws:sqs'
  );
};

export const handler = async (
  event: unknown,
  context: Context,
  callback: Callback
) => {
  if (isApiGatewayEvent(event)) {
    return apiHandler(event as APIGatewayProxyEventV2, context, callback);
  }

  if (isSqsEvent(event)) {
    const failures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      let payload: unknown;
      try {
        payload = JSON.parse(record.body);
      } catch {
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      try {
        await handleSummaryJob(payload, { sqsRecord: record });
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }

    return {
      batchItemFailures: failures,
    };
  }

  return handleSummaryJob(event);
};
