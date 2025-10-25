import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApiClient } from './api-client';

const originalFetch = global.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

const createFetchResponse = ({
  status,
  body,
}: {
  status: number;
  body: unknown;
}) => ({
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: vi.fn().mockResolvedValue(body),
  text: vi.fn(),
  blob: vi.fn(),
});

describe('API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });

  it('should create an API client with the provided configuration', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      headers: { 'X-API-Key': 'test-key' },
    };

    const client = createApiClient(config);

    expect(client).toBeDefined();
    expect(client.health).toBeDefined();
  });

  it('redirects to root when request returns 401', async () => {
    const assign = vi.fn();
    (globalThis as any).window = {
      location: {
        assign,
        pathname: '/dashboard',
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createFetchResponse({ status: 401, body: {} }));
    global.fetch = fetchMock as typeof fetch;

    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const response = await client.health();

    expect(assign).toHaveBeenCalledWith('/');
    expect(response.status).toBe(401);
  });

  it('redirects to root when request returns 403', async () => {
    const assign = vi.fn();
    (globalThis as any).window = {
      location: {
        assign,
        pathname: '/settings',
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createFetchResponse({ status: 403, body: {} }));
    global.fetch = fetchMock as typeof fetch;

    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const response = await client.health();

    expect(assign).toHaveBeenCalledWith('/');
    expect(response.status).toBe(403);
  });

  it('does not redirect when response is not 401 or 403', async () => {
    const assign = vi.fn();
    (globalThis as any).window = {
      location: {
        assign,
        pathname: '/dashboard',
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse({
        status: 200,
        body: {
          status: 'healthy',
          timestamp: '',
          version: '',
          environment: '',
        },
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    const response = await client.health();

    expect(assign).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
