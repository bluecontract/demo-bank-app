import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Callback,
  Context,
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

export const handler = async (
  event: unknown,
  context: Context,
  callback: Callback
) => {
  if (isApiGatewayEvent(event)) {
    return apiHandler(event as APIGatewayProxyEventV2, context, callback);
  }
  return handleSummaryJob(event);
};
