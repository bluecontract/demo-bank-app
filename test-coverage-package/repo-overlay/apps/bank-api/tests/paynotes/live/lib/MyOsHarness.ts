import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { waitForExpectWithLogging } from './wait';

export type MyOsDocumentRecord = {
  documentId: string;
  sessionId: string;
  document?: Record<string, unknown>;
};

export type MyOsBootstrapCall = {
  at: string;
  headers: Record<string, string | string[] | undefined>;
  idempotencyKey?: string;
  body: unknown;
};

export type MyOsOperationCall = {
  at: string;
  headers: Record<string, string | string[] | undefined>;
  sessionId: string;
  operation: string;
  body: unknown;
};

export type MyOsFetchEventCall = {
  at: string;
  eventId: string;
};

export type MyOsFetchDocumentCall = {
  at: string;
  sessionId: string;
};

export type HarnessHttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
};

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>
) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  Object.entries(headers ?? {}).forEach(([key, value]) =>
    res.setHeader(key, value)
  );
  res.end(JSON.stringify(body ?? {}));
};

const notFound = (res: ServerResponse) =>
  json(res, 404, { message: 'not found' });
const unauthorized = (res: ServerResponse) =>
  json(res, 401, { message: 'unauthorized' });

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  return raw ? JSON.parse(raw) : {};
};

const extractEventMetadata = (payload: unknown) => {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const id = typeof record.id === 'string' ? record.id : undefined;
  const type = typeof record.type === 'string' ? record.type : undefined;
  const created =
    typeof record.created === 'string' ? record.created : undefined;
  const ref = typeof record.ref === 'string' ? record.ref : undefined;

  if (!id || !type || !created || !ref) {
    return null;
  }

  return { id, type, created, ref };
};

const isAuthorized = (req: IncomingMessage, apiKey: string) => {
  const authHeader = req.headers.authorization;
  return (
    authHeader === apiKey ||
    authHeader === `Bearer ${apiKey}` ||
    req.headers['x-api-key'] === apiKey
  );
};

export class MyOsHarness {
  readonly apiKey = `myos-harness-${randomUUID()}`;

  private server?: http.Server;
  private port?: number;
  private readonly events = new Map<string, unknown>();
  private readonly documents = new Map<string, MyOsDocumentRecord>();
  private readonly documentsBySessionId = new Map<string, MyOsDocumentRecord>();
  private readonly bootstrapCalls: MyOsBootstrapCall[] = [];
  private readonly operationCalls: MyOsOperationCall[] = [];
  private readonly fetchEventCalls: MyOsFetchEventCall[] = [];
  private readonly fetchDocumentCalls: MyOsFetchDocumentCall[] = [];
  private readonly eventResponses = new Map<string, HarnessHttpResponse[]>();
  private readonly documentResponses = new Map<string, HarnessHttpResponse[]>();
  private readonly bootstrapResponses: HarnessHttpResponse[] = [];
  private readonly operationResponses = new Map<
    string,
    HarnessHttpResponse[]
  >();

  get baseUrl() {
    if (!this.port) {
      throw new Error('Harness server is not started');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch(error => {
        console.error('[MyOsHarness] request failed', error);
        json(res, 500, { message: 'internal harness error' });
      });
    });

    await new Promise<void>(resolve =>
      this.server!.listen(0, '127.0.0.1', () => resolve())
    );
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop() {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close(error => (error ? reject(error) : resolve()))
    );
    this.server = undefined;
    this.port = undefined;
  }

  seedEvent(input: { eventId: string; payload: unknown }) {
    this.events.set(input.eventId, input.payload);
  }

  seedDocument(input: MyOsDocumentRecord) {
    this.documents.set(input.documentId, input);
    this.documentsBySessionId.set(input.sessionId, input);
  }

  queueEventResponse(eventId: string, response?: HarnessHttpResponse) {
    const queue = this.eventResponses.get(eventId) ?? [];
    queue.push(response ?? {});
    this.eventResponses.set(eventId, queue);
  }

  queueDocumentResponse(sessionId: string, response?: HarnessHttpResponse) {
    const queue = this.documentResponses.get(sessionId) ?? [];
    queue.push(response ?? {});
    this.documentResponses.set(sessionId, queue);
  }

  queueBootstrapResponse(response?: HarnessHttpResponse) {
    this.bootstrapResponses.push(response ?? {});
  }

  queueOperationResponse(
    sessionId: string,
    operation: string,
    response?: HarnessHttpResponse
  ) {
    const key = `${sessionId}:${operation}`;
    const queue = this.operationResponses.get(key) ?? [];
    queue.push(response ?? {});
    this.operationResponses.set(key, queue);
  }

  listBootstrapCalls() {
    return [...this.bootstrapCalls];
  }

  listOperationCalls() {
    return [...this.operationCalls];
  }

  listFetchEventCalls() {
    return [...this.fetchEventCalls];
  }

  listFetchDocumentCalls() {
    return [...this.fetchDocumentCalls];
  }

  async waitForBootstrapCall(
    predicate: (call: MyOsBootstrapCall) => boolean,
    timeoutMs = 10_000,
    intervalMs = 200
  ): Promise<MyOsBootstrapCall> {
    let matched: MyOsBootstrapCall | undefined;
    await waitForExpectWithLogging(
      () => {
        matched = this.bootstrapCalls.find(predicate);
        if (!matched) {
          throw new Error('Expected bootstrap call not observed yet');
        }
      },
      timeoutMs,
      intervalMs,
      'myos-bootstrap'
    );
    return matched!;
  }

  async waitForOperationCall(
    predicate: (call: MyOsOperationCall) => boolean,
    timeoutMs = 10_000,
    intervalMs = 200
  ): Promise<MyOsOperationCall> {
    let matched: MyOsOperationCall | undefined;
    await waitForExpectWithLogging(
      () => {
        matched = this.operationCalls.find(predicate);
        if (!matched) {
          throw new Error('Expected operation call not observed yet');
        }
      },
      timeoutMs,
      intervalMs,
      'myos-operation'
    );
    return matched!;
  }

  async waitForFetchEvent(
    predicate: (call: MyOsFetchEventCall) => boolean,
    timeoutMs = 10_000,
    intervalMs = 200
  ): Promise<MyOsFetchEventCall> {
    let matched: MyOsFetchEventCall | undefined;
    await waitForExpectWithLogging(
      () => {
        matched = this.fetchEventCalls.find(predicate);
        if (!matched) {
          throw new Error('Expected fetchEvent call not observed yet');
        }
      },
      timeoutMs,
      intervalMs,
      'myos-fetch-event'
    );
    return matched!;
  }

  async waitForFetchDocument(
    predicate: (call: MyOsFetchDocumentCall) => boolean,
    timeoutMs = 10_000,
    intervalMs = 200
  ): Promise<MyOsFetchDocumentCall> {
    let matched: MyOsFetchDocumentCall | undefined;
    await waitForExpectWithLogging(
      () => {
        matched = this.fetchDocumentCalls.find(predicate);
        if (!matched) {
          throw new Error('Expected fetchDocument call not observed yet');
        }
      },
      timeoutMs,
      intervalMs,
      'myos-fetch-document'
    );
    return matched!;
  }

  private dequeueResponse(
    map: Map<string, HarnessHttpResponse[]>,
    key: string
  ) {
    const queue = map.get(key);
    if (!queue || queue.length === 0) return undefined;
    const head = queue.shift();
    if (queue.length === 0) {
      map.delete(key);
    }
    return head;
  }

  private async respondWith(
    res: ServerResponse,
    response: HarnessHttpResponse | undefined,
    fallbackBody: unknown,
    fallbackStatus = 200
  ) {
    if (response?.delayMs) {
      await new Promise(resolve => setTimeout(resolve, response.delayMs));
    }
    json(
      res,
      response?.status ?? fallbackStatus,
      response?.body ?? fallbackBody,
      response?.headers
    );
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (!isAuthorized(req, this.apiKey)) {
      return unauthorized(res);
    }

    if (method === 'GET' && pathname === '/myos-events') {
      const refFilter = url.searchParams.get('ref') ?? undefined;
      const typeFilter = url.searchParams.get('type') ?? undefined;
      const fromFilter = url.searchParams.get('from') ?? undefined;
      const nextPageToken = url.searchParams.get('nextPageToken') ?? undefined;
      const itemsPerPage = Math.max(
        1,
        Number(url.searchParams.get('itemsPerPage') ?? '100') || 100
      );

      const items = [...this.events.values()]
        .map(extractEventMetadata)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter(item => (refFilter ? item.ref.includes(refFilter) : true))
        .filter(item => (typeFilter ? item.type === typeFilter : true))
        .filter(item => (fromFilter ? item.created >= fromFilter : true))
        .filter(item => (nextPageToken ? item.created < nextPageToken : true))
        .sort((left, right) => {
          if (left.created !== right.created) {
            return right.created.localeCompare(left.created);
          }
          if (left.ref !== right.ref) {
            return right.ref.localeCompare(left.ref);
          }
          return right.id.localeCompare(left.id);
        });

      const paged = items.slice(0, itemsPerPage);
      const next =
        paged.length === itemsPerPage
          ? paged[paged.length - 1]?.created
          : undefined;
      return json(res, 200, {
        items: paged.map(item => ({
          id: item.id,
          type: item.type,
          created: item.created,
          uid: 'myos-harness-uid',
          ref: item.ref,
        })),
        ...(next ? { nextPageToken: next } : {}),
      });
    }

    const eventMatch = pathname.match(/^\/myos-events\/([^/]+)$/);
    if (method === 'GET' && eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]);
      this.fetchEventCalls.push({ at: new Date().toISOString(), eventId });
      const forced = this.dequeueResponse(this.eventResponses, eventId);
      if (forced) {
        return this.respondWith(res, forced, { ok: true });
      }

      const payload = this.events.get(eventId);
      if (!payload) {
        return notFound(res);
      }
      return json(res, 200, payload);
    }

    const documentMatch = pathname.match(/^\/documents\/([^/]+)$/);
    if (method === 'GET' && documentMatch) {
      const sessionId = decodeURIComponent(documentMatch[1]);
      this.fetchDocumentCalls.push({ at: new Date().toISOString(), sessionId });
      const forced = this.dequeueResponse(this.documentResponses, sessionId);
      if (forced) {
        return this.respondWith(res, forced, { ok: true });
      }

      const payload = this.documentsBySessionId.get(sessionId);
      if (!payload) {
        return notFound(res);
      }
      return json(res, 200, payload.document ?? payload);
    }

    if (method === 'POST' && pathname === '/documents/bootstrap') {
      const body = await readBody(req);
      this.bootstrapCalls.push({
        at: new Date().toISOString(),
        headers: req.headers,
        idempotencyKey:
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined,
        body,
      });
      const response = this.bootstrapResponses.shift();
      return this.respondWith(
        res,
        response,
        { documentId: `bootstrap-${randomUUID()}` },
        201
      );
    }

    const operationMatch = pathname.match(/^\/documents\/([^/]+)\/([^/]+)$/);
    if (method === 'POST' && operationMatch) {
      const sessionId = decodeURIComponent(operationMatch[1]);
      const operation = decodeURIComponent(operationMatch[2]);
      const body = await readBody(req);
      this.operationCalls.push({
        at: new Date().toISOString(),
        headers: req.headers,
        sessionId,
        operation,
        body,
      });
      const response = this.dequeueResponse(
        this.operationResponses,
        `${sessionId}:${operation}`
      );
      return this.respondWith(res, response, { ok: true }, 200);
    }

    return notFound(res);
  }
}
