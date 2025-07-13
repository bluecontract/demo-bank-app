import { tsr } from '@ts-rest/serverless/aws';
import type { TsRestRequest } from '@ts-rest/serverless';
import { getDependencies } from './dependencies';
import { toUnauthorizedResponse } from '../shared/errors';

export type MaybeAuthenticatedRequestContext = {
  userId?: string;
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

export async function extractAuthInfo(
  headers: Headers
): Promise<{ userId?: string; isTest?: boolean }> {
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) {
    return {};
  }
  const match = cookieHeader.match(/demoAuth=([^;]+)/);
  if (!match) {
    return {};
  }
  const token = match[1];
  // JWT: header.payload.signature
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {};
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8')
    );
    return {
      userId: payload.sub,
      isTest: payload.isTest,
    };
  } catch {
    return {};
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
      return toUnauthorizedResponse('Unauthorized');
    }
    const match = cookieHeader.match(/demoAuth=([^;]+)/);
    if (!match) {
      return toUnauthorizedResponse('Unauthorized');
    }
    const token = match[1];
    const deps = await getDependencies();
    try {
      await deps.jwtService.verifyToken(token);
    } catch {
      return toUnauthorizedResponse('Unauthorized');
    }
  });
}
