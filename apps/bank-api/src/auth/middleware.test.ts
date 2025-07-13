import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from './middleware';
import { getDependencies } from './dependencies';
import { toUnauthorizedResponse } from '../shared/errors';

vi.mock('./dependencies', () => ({
  getDependencies: vi.fn(),
}));
const mockGetDependencies = vi.mocked(getDependencies);

const makeRequest = (
  overrides: Partial<
    { headers: Headers | Record<string, string> } & Record<string, any>
  > = {}
) => {
  const { headers, ...rest } = overrides;
  return {
    url: 'http://localhost/protected',
    method: 'GET',
    headers: headers instanceof Headers ? headers : new Headers(headers),
    ...rest,
  };
};

const minimalDeps = {
  userRepository: {} as any,
  logger: {} as any,
  metrics: {} as any,
  config: {} as any,
};

describe('createAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('should allow authenticated request on a protected path', async () => {
    mockGetDependencies.mockResolvedValue({
      ...minimalDeps,
      jwtService: {
        verifyToken: vi.fn().mockResolvedValue({ sub: 'user-1' }),
      } as any,
    });
    const middleware = createAuthMiddleware();
    const request: any = makeRequest({
      url: 'http://localhost/protected',
      headers: new Headers({ cookie: 'demoAuth=goodtoken' }),
    });
    const result = await middleware(request, {} as any);
    expect(result).toBeUndefined();
  });

  it('should allow excluded route (by path)', async () => {
    const middleware = createAuthMiddleware({
      exclusions: [{ path: '/public' }],
    });
    const request = makeRequest({ url: 'http://localhost/public' });
    const result = await middleware(request as any, {} as any);
    expect(result).toBeUndefined();
  });

  it('should return 401 if no cookie', async () => {
    const middleware = createAuthMiddleware();
    const request = makeRequest();
    const result = await middleware(request as any, {} as any);
    const expected = toUnauthorizedResponse('Unauthorized');
    expect(result.status).toBe(expected.status);
    expect(JSON.stringify(result.body)).toBe(JSON.stringify(expected.body));
  });

  it('should return 401 if no demoAuth cookie', async () => {
    const middleware = createAuthMiddleware();
    const request = makeRequest({ headers: { cookie: 'other=foo' } });
    const result = await middleware(request as any, {} as any);
    const expected = toUnauthorizedResponse('Unauthorized');
    expect(result.status).toBe(expected.status);
    expect(JSON.stringify(result.body)).toBe(JSON.stringify(expected.body));
  });

  it('should return 401 if jwtService.verify throws', async () => {
    mockGetDependencies.mockResolvedValue({
      ...minimalDeps,
      jwtService: {
        verifyToken: vi.fn().mockRejectedValue(new Error('bad token')),
      } as any,
    });
    const middleware = createAuthMiddleware();
    const request = makeRequest({ headers: { cookie: 'demoAuth=badtoken' } });
    const result = await middleware(request as any, {} as any);
    const expected = toUnauthorizedResponse('Unauthorized');
    expect(result.status).toBe(expected.status);
    expect(JSON.stringify(result.body)).toBe(JSON.stringify(expected.body));
  });
});
