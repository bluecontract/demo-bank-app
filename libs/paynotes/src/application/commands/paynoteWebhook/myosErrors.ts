import type {
  MyOsFetchDocumentResult,
  MyOsFetchEventResult,
} from '../../ports';
import type { LogEntry } from '../../ports';

export type FetchErrorMessages = {
  notFound: string;
  httpError: string;
  parseError: string;
  networkError: string;
};

export const logMyOsFetchError = (
  result: MyOsFetchEventResult | MyOsFetchDocumentResult,
  logs: LogEntry[],
  context: Record<string, unknown>,
  messages: FetchErrorMessages
): string | undefined => {
  switch (result.kind) {
    case 'not-found': {
      logs.push({
        level: 'error',
        message: messages.notFound,
        context: { ...context, status: result.status },
      });
      return messages.notFound;
    }
    case 'http-error': {
      logs.push({
        level: 'error',
        message: messages.httpError,
        context: {
          ...context,
          status: result.status,
          statusText: result.statusText,
        },
      });
      return messages.httpError;
    }
    case 'parse-error': {
      logs.push({
        level: 'error',
        message: messages.parseError,
        context: {
          ...context,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        },
      });
      return messages.parseError;
    }
    case 'network-error': {
      logs.push({
        level: 'error',
        message: messages.networkError,
        context: {
          ...context,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        },
      });
      return messages.networkError;
    }
    default:
      return undefined;
  }
};
