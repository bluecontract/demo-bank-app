import type {
  MyOsClient,
  MyOsCredentials,
  MyOsFetchEventResult,
} from '../application/ports';

export type MyOsCredentialsResolver = () => Promise<MyOsCredentials>;

export const createHttpMyOsGateway = (
  resolveCredentials: MyOsCredentialsResolver
): MyOsClient => ({
  getCredentials: resolveCredentials,

  async bootstrapDocument({ credentials, payload }) {
    const response = await fetch(`${credentials.baseUrl}/documents/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: credentials.apiKey,
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
});
