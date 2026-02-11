import type {
  LogEntry,
  MyOsClient,
  MyOsCredentials,
  MyOsOperationResponse,
} from '../ports';
import { blue } from '../../blue';

type RunDocumentOperationWithLogsInput<TPayload> = {
  myOsClient: MyOsClient;
  credentials: MyOsCredentials | null;
  sessionId: string;
  operation: string;
  payload?: TPayload;
  logs: LogEntry[];
  logContext?: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
};

const buildFailureContext = (
  context: Record<string, unknown> | undefined,
  response: MyOsOperationResponse
) => ({
  ...context,
  status: response.status,
  body: response.body,
});

export const runDocumentOperationWithLogs = async <TPayload>(
  input: RunDocumentOperationWithLogsInput<TPayload>
): Promise<boolean> => {
  const {
    myOsClient,
    credentials,
    sessionId,
    operation,
    payload,
    logs,
    logContext,
    successMessage,
    failureMessage,
    missingCredentialsMessage,
  } = input;

  if (!credentials) {
    logs.push({
      level: 'error',
      message: missingCredentialsMessage,
      context: logContext,
    });
    return false;
  }

  const response = await myOsClient.runDocumentOperation({
    credentials,
    sessionId,
    operation,
    payload,
  });

  if (!response.ok) {
    logs.push({
      level: 'error',
      message: failureMessage,
      context: buildFailureContext(logContext, response),
    });
    return false;
  }

  logs.push({
    level: 'info',
    message: successMessage,
    context: logContext,
  });

  return true;
};

const toMinimalOperationEventPayload = (
  event: unknown,
  index?: number
): unknown => {
  const rawType =
    event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    typeof (event as { type?: unknown }).type === 'string'
      ? ((event as { type: string }).type as string)
      : undefined;

  try {
    const node = blue.resolve(blue.jsonValueToNode(event)).getMinimalNode();
    const minimal = blue.nodeToJson(node);

    if (
      rawType &&
      minimal &&
      typeof minimal === 'object' &&
      !Array.isArray(minimal)
    ) {
      return {
        ...(minimal as Record<string, unknown>),
        type: rawType,
      };
    }

    return minimal;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown serialization error';
    const atIndex = typeof index === 'number' ? ` at index ${index}` : '';
    throw new Error(
      `Cannot serialize guarantorUpdate request payload${atIndex}: ${message}`
    );
  }
};

const toOperationRequestPayload = (payload: unknown): unknown => {
  if (Array.isArray(payload)) {
    return payload.map((event, index) =>
      toMinimalOperationEventPayload(event, index)
    );
  }
  return toMinimalOperationEventPayload(payload);
};

type RunGuarantorUpdateInput = {
  myOsClient: MyOsClient;
  credentials: MyOsCredentials | null;
  sessionId: string;
  request: unknown;
  logs: LogEntry[];
  logContext?: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
};

export const runGuarantorUpdate = async (
  input: RunGuarantorUpdateInput
): Promise<boolean> => {
  let payload: unknown;
  try {
    payload = toOperationRequestPayload(input.request);
  } catch (error) {
    input.logs.push({
      level: 'error',
      message: 'Failed to serialize guarantorUpdate payload',
      context: {
        ...input.logContext,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return false;
  }

  return runDocumentOperationWithLogs({
    myOsClient: input.myOsClient,
    credentials: input.credentials,
    sessionId: input.sessionId,
    operation: 'guarantorUpdate',
    payload,
    logs: input.logs,
    logContext: input.logContext,
    successMessage: input.successMessage,
    failureMessage: input.failureMessage,
    missingCredentialsMessage: input.missingCredentialsMessage,
  });
};
