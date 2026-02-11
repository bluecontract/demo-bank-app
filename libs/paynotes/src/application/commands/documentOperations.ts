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

const toOfficialBluePayload = (payload: unknown): unknown => {
  try {
    return blue.nodeToJson(blue.jsonValueToNode(payload), {
      format: 'official',
    });
  } catch {
    return payload;
  }
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
): Promise<boolean> =>
  runDocumentOperationWithLogs({
    myOsClient: input.myOsClient,
    credentials: input.credentials,
    sessionId: input.sessionId,
    operation: 'guarantorUpdate',
    payload: toOfficialBluePayload(input.request),
    logs: input.logs,
    logContext: input.logContext,
    successMessage: input.successMessage,
    failureMessage: input.failureMessage,
    missingCredentialsMessage: input.missingCredentialsMessage,
  });
