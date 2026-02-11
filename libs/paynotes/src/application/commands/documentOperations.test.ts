import { describe, expect, it, vi } from 'vitest';
import {
  runDocumentOperationWithLogs,
  runGuarantorUpdate,
} from './documentOperations';
import type { LogEntry, MyOsClient, MyOsCredentials } from '../ports';

const credentials: MyOsCredentials = {
  apiKey: 'key',
  accountId: 'account-1',
  baseUrl: 'http://localhost:3000',
};

const createMyOsClient = (ok = true) =>
  ({
    getCredentials: vi.fn(),
    bootstrapDocument: vi.fn(),
    runDocumentOperation: vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      body: ok ? undefined : { message: 'failed' },
    }),
    fetchEvent: vi.fn(),
    fetchDocument: vi.fn(),
  } as unknown as MyOsClient);

describe('documentOperations', () => {
  it('returns false and logs error when credentials are missing', async () => {
    const myOsClient = createMyOsClient(true);
    const logs: LogEntry[] = [];

    const result = await runDocumentOperationWithLogs({
      myOsClient,
      credentials: null,
      sessionId: 'session-1',
      operation: 'test-operation',
      payload: { value: true },
      logs,
      logContext: { eventId: 'event-1' },
      successMessage: 'ok',
      failureMessage: 'failed',
      missingCredentialsMessage: 'missing credentials',
    });

    expect(result).toBe(false);
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        level: 'error',
        message: 'missing credentials',
        context: { eventId: 'event-1' },
      },
    ]);
  });

  it('returns false and logs response details when operation fails', async () => {
    const myOsClient = createMyOsClient(false);
    const logs: LogEntry[] = [];

    const result = await runDocumentOperationWithLogs({
      myOsClient,
      credentials,
      sessionId: 'session-1',
      operation: 'test-operation',
      payload: { value: true },
      logs,
      logContext: { eventId: 'event-1' },
      successMessage: 'ok',
      failureMessage: 'failed',
      missingCredentialsMessage: 'missing credentials',
    });

    expect(result).toBe(false);
    expect(logs).toEqual([
      {
        level: 'error',
        message: 'failed',
        context: {
          eventId: 'event-1',
          status: 500,
          body: { message: 'failed' },
        },
      },
    ]);
  });

  it('returns true and logs success when operation succeeds', async () => {
    const myOsClient = createMyOsClient(true);
    const logs: LogEntry[] = [];

    const result = await runDocumentOperationWithLogs({
      myOsClient,
      credentials,
      sessionId: 'session-1',
      operation: 'test-operation',
      payload: { value: true },
      logs,
      logContext: { eventId: 'event-1' },
      successMessage: 'ok',
      failureMessage: 'failed',
      missingCredentialsMessage: 'missing credentials',
    });

    expect(result).toBe(true);
    expect(logs).toEqual([
      {
        level: 'info',
        message: 'ok',
        context: { eventId: 'event-1' },
      },
    ]);
  });

  it('runs guarantor update as a standard document operation', async () => {
    const myOsClient = createMyOsClient(true);
    const logs: LogEntry[] = [];
    const events = [
      {
        type: 'PayNote/Card Transaction Capture Locked',
        lockedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    const result = await runGuarantorUpdate({
      myOsClient,
      credentials,
      sessionId: 'session-1',
      request: events,
      logs,
      logContext: { eventId: 'event-1', holdId: 'hold-1' },
      successMessage: 'ok',
      failureMessage: 'failed',
      missingCredentialsMessage: 'missing credentials',
    });

    expect(result).toBe(true);
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials,
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload as Array<Record<string, unknown>>;

    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        type: 'PayNote/Card Transaction Capture Locked',
      })
    );
    expect(payload[0]).toHaveProperty('lockedAt');
  });

  it('fails and logs when guarantorUpdate payload serialization fails', async () => {
    const myOsClient = createMyOsClient(true);
    const logs: LogEntry[] = [];

    const result = await runGuarantorUpdate({
      myOsClient,
      credentials,
      sessionId: 'session-1',
      request: [{ type: 'Definitely Unknown Event Type' }],
      logs,
      successMessage: 'ok',
      failureMessage: 'fail',
      missingCredentialsMessage: 'missing',
    });

    expect(result).toBe(false);
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'Failed to serialize guarantorUpdate payload',
      })
    );
  });
});
