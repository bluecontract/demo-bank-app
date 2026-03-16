import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayEventRequestContextV2,
  Context,
  Callback,
} from 'aws-lambda';
import { handler } from '../../../../src/main';
import {
  assertAllSecurityHeaders,
  DEFAULT_TEST_ORIGIN,
} from '../../../../src/test-helpers/security-assertions';
import { resetDependencies as resetAuthDependencies } from '../../../../src/auth/dependencies';
import { resetDependencies as resetBankingDependencies } from '../../../../src/banking/dependencies';
import { resetDependencies as resetPaynoteDependencies } from '../../../../src/paynote/dependencies';

export { DEFAULT_TEST_ORIGIN };

export type InvokeBankApiInput = {
  method: string;
  path: string;
  body?: object;
  jwtCookie?: string;
  headers?: Record<string, string>;
};

export const resetBankRuntimeDependencies = () => {
  resetAuthDependencies();
  resetBankingDependencies();
  resetPaynoteDependencies();
};

function createTestEvent(
  method: string,
  path: string,
  body?: object
): APIGatewayProxyEventV2 {
  const requestBody =
    method === 'GET' || method === 'DELETE' ? null : body || {};
  const urlParams = new URLSearchParams(path.split('?')[1]);
  const queryStringParameters = path.includes('?')
    ? {
        queryStringParameters: Object.fromEntries(
          new URLSearchParams(path.split('?')[1])
        ),
        rawQueryString: urlParams.toString(),
      }
    : { rawQueryString: '' };

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    requestContext: {
      requestId: `test-request-${randomUUID()}`,
      stage: 'test',
      httpMethod: method,
      path,
      accountId: '123456789012',
      resourceId: 'test-resource',
      apiId: 'test-api',
      http: {
        method,
        path,
        protocol: 'http',
        sourceIp: '127.0.0.1',
        userAgent: 'paynote-test-user-agent',
      },
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      identity: {
        accessKey: 'test',
        accountId: '123456789012',
        apiKey: 'test',
      },
      domainName: 'localhost',
      domainPrefix: 'test',
      routeKey: '$default',
    } as APIGatewayEventRequestContextV2,
    headers: { 'Content-Type': 'application/json' },
    ...queryStringParameters,
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    isBase64Encoded: false,
  };
}

export async function invokeBankApi(input: InvokeBankApiInput) {
  resetBankRuntimeDependencies();

  const event = createTestEvent(input.method, input.path, input.body);
  if (input.jwtCookie) {
    event.headers.cookie = input.jwtCookie;
  }
  Object.assign(
    event.headers,
    input.headers ?? { origin: DEFAULT_TEST_ORIGIN }
  );

  const result = (await handler(event, {} as Context, {} as Callback)) as {
    statusCode: number;
    headers: Record<string, string>;
    cookies?: string[];
    body: string;
  };

  assertAllSecurityHeaders(
    {
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body,
    },
    event.headers.origin ?? DEFAULT_TEST_ORIGIN
  );

  return {
    statusCode: result.statusCode,
    headers: result.headers,
    cookies: result.cookies,
    body: result.body ? JSON.parse(result.body) : undefined,
  };
}
