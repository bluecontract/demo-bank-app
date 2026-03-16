import type { LogEntry } from '../../ports';

const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

export const log = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  logs.push({ level, message, context });
};

export const logAndReturn = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  log(logs, level, message, context);
  return message;
};

export const trace = (
  logs: LogEntry[],
  message: string,
  context?: Record<string, unknown>
) => {
  if (!isTraceEnabled) {
    return;
  }
  log(logs, 'info', message, context);
};
