import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpMyOsGateway } from './httpMyOsGateway';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

describe('createHttpMyOsGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serializes document operation payloads correctly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    const credentials = await gateway.getCredentials();

    await gateway.runDocumentOperation({
      credentials,
      sessionId: 'sess-1',
      operation: 'incrementCounter',
      payload: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://myos.local/documents/sess-1/incrementCounter',
      expect.objectContaining({
        method: 'POST',
        body: '0',
      })
    );

    await gateway.runDocumentOperation({
      credentials,
      sessionId: 'sess-2',
      operation: 'confirm',
      payload: undefined,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://myos.local/documents/sess-2/confirm',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
      })
    );
  });

  it('passes Idempotency-Key when bootstrapping a document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sessionId: 'bootstrap-1' }, { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    const credentials = await gateway.getCredentials();
    await gateway.bootstrapDocument({
      credentials,
      idempotencyKey: 'idem-bootstrap-1',
      payload: {
        channelBindings: {},
        document: { type: 'PayNote/PayNote' },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://myos.local/documents/bootstrap',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'api-key',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-bootstrap-1',
        }),
      })
    );
  });

  it('returns not-found for missing events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    await expect(gateway.fetchEvent('event-1')).resolves.toEqual({
      kind: 'not-found',
      status: 404,
    });
  });

  it('returns parse-error when event payload is not JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    const result = await gateway.fetchEvent('event-1');
    expect(result).toMatchObject({ kind: 'parse-error', status: 200 });
  });

  it('returns network-error when fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    const result = await gateway.fetchEvent('event-1');
    expect(result.kind).toBe('network-error');
  });

  it('returns parse-error when document response is missing identifiers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sessionId: 'sess-1' }, { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    const result = await gateway.fetchDocument('sess-1');
    expect(result).toMatchObject({ kind: 'parse-error', status: 200 });
  });

  it('returns success with document payload when identifiers are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          documentId: 'doc-1',
          sessionId: 'sess-1',
          document: { foo: 'bar' },
        },
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createHttpMyOsGateway(async () => ({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'http://myos.local',
    }));

    await expect(gateway.fetchDocument('sess-1')).resolves.toEqual({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'sess-1',
        document: { foo: 'bar' },
      },
    });
  });
});
