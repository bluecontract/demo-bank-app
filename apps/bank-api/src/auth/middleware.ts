import { tsr } from '@ts-rest/serverless/aws';
import type { TsRestRequest } from '@ts-rest/serverless';
import { getDependencies } from './dependencies';
import { UnauthorizedRequestError } from './errors';

export type MaybeAuthenticatedRequestContext = {
  userId?: string;
  userEmail?: string;
  isTest?: boolean;
};

export type MaybeAuthenticatedTsRestRequestContext = TsRestRequest &
  MaybeAuthenticatedRequestContext;

export type ExclusionRule = {
  path: string | RegExp;
  method?: string;
};

export type AuthMiddlewareOptions = {
  exclusions?: ExclusionRule[];
};

function matchExclusion(
  request: TsRestRequest,
  exclusions: ExclusionRule[] = []
) {
  const pathname = new URL(request.url).pathname;

  return exclusions.some(rule => {
    const pathMatch =
      typeof rule.path === 'string'
        ? pathname === rule.path || pathname === rule.path + '/'
        : rule.path.test(pathname);
    const methodMatch = rule.method ? request.method === rule.method : true;
    return pathMatch && methodMatch;
  });
}

type AuthTokenPayload = {
  sub?: string;
  email?: string;
  userEmail?: string;
  isTest?: boolean;
};

export async function extractAuthInfo(request: {
  headers: Headers;
}): Promise<{ userId: string; userEmail?: string; isTest: boolean }> {
  try {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) {
      throw new Error('Missing cookie header');
    }
    const match = cookieHeader.match(/demoAuth=([^;]+)/);
    if (!match) {
      throw new Error('Missing demoAuth cookie');
    }
    const token = match[1];
    // JWT: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token');
    }
    const rawPayload = Buffer.from(parts[1], 'base64').toString('utf-8');
    const payload = JSON.parse(rawPayload) as AuthTokenPayload;
    if (!payload.sub) {
      throw new Error('Invalid token');
    }
    return {
      userId: payload.sub,
      userEmail:
        typeof payload.email === 'string'
          ? payload.email
          : typeof payload.userEmail === 'string'
          ? payload.userEmail
          : undefined,
      isTest: !!payload.isTest,
    };
  } catch (error: unknown) {
    throw new UnauthorizedRequestError(
      'Failed to extract auth info from the request',
      error instanceof Error ? error : undefined
    );
  }
}

export function createAuthMiddleware(
  options: AuthMiddlewareOptions = {}
): ReturnType<typeof tsr.middleware<MaybeAuthenticatedRequestContext>> {
  const exclusions = options.exclusions || [];
  return tsr.middleware<MaybeAuthenticatedRequestContext>(async request => {
    if (matchExclusion(request, exclusions)) {
      return; // Allow unauthenticated
    }
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) {
      throw new UnauthorizedRequestError('Missing cookie header');
    }
    const match = cookieHeader.match(/demoAuth=([^;]+)/);
    if (!match) {
      throw new UnauthorizedRequestError('Missing cookie header');
    }
    const token = match[1];
    const deps = await getDependencies();
    try {
      await deps.jwtService.verifyToken(token);
    } catch {
      throw new UnauthorizedRequestError('Invalid token');
    }
  });
}
