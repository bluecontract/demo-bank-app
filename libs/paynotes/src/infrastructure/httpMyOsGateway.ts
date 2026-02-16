import type {
  MyOsClient,
  MyOsCredentials,
  MyOsFetchEventResult,
  MyOsFetchDocumentResult,
} from '../application/ports';

export type MyOsCredentialsResolver = () => Promise<MyOsCredentials>;

export const createHttpMyOsGateway = (
  resolveCredentials: MyOsCredentialsResolver
): MyOsClient => ({
  getCredentials: resolveCredentials,

  async bootstrapDocument({ credentials, payload, idempotencyKey }) {
    const response = await fetch(`${credentials.baseUrl}/documents/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: credentials.apiKey,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
      },
      body: JSON.stringify(payload),
    });

    const body = await response
      .clone()
      .json()
      .catch(() => undefined);

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  },

  async runDocumentOperation({ credentials, sessionId, operation, payload }) {
    const response = await fetch(
      `${credentials.baseUrl}/documents/${sessionId}/${operation}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: credentials.apiKey,
        },
        body: payload === undefined ? '{}' : JSON.stringify(payload),
      }
    );

    const body = await response
      .clone()
      .json()
      .catch(() => undefined);

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  },

  async fetchEvent(eventId: string): Promise<MyOsFetchEventResult> {
    try {
      const credentials = await resolveCredentials();
      const response = await fetch(
        `${credentials.baseUrl}/myos-events/${eventId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: credentials.apiKey,
          },
        }
      );

      if (response.status === 404) {
        return { kind: 'not-found', status: 404 };
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => undefined);
        return {
          kind: 'http-error',
          status: response.status,
          statusText: response.statusText,
          detail,
        };
      }

      try {
        const payload = await response.json();
        return { kind: 'success', payload };
      } catch (error) {
        return { kind: 'parse-error', status: response.status, error };
      }
    } catch (error) {
      return { kind: 'network-error', error };
    }
  },

  async fetchDocument(sessionId: string): Promise<MyOsFetchDocumentResult> {
    try {
      const credentials = await resolveCredentials();
      const response = await fetch(
        `${credentials.baseUrl}/documents/${sessionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: credentials.apiKey,
          },
        }
      );

      if (response.status === 404) {
        return { kind: 'not-found', status: 404 };
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => undefined);
        return {
          kind: 'http-error',
          status: response.status,
          statusText: response.statusText,
          detail,
        };
      }

      try {
        const payload = (await response.json()) as {
          documentId?: string;
          sessionId?: string;
          document?: Record<string, unknown>;
        };
        if (!payload.documentId || !payload.sessionId) {
          return {
            kind: 'parse-error',
            status: response.status,
            error: new Error('Document payload missing documentId/sessionId'),
          };
        }

        return {
          kind: 'success',
          document: {
            documentId: payload.documentId,
            sessionId: payload.sessionId,
            ...(payload.document ? { document: payload.document } : {}),
          },
        };
      } catch (error) {
        return { kind: 'parse-error', status: response.status, error };
      }
    } catch (error) {
      return { kind: 'network-error', error };
    }
  },
});
