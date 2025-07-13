import { APIGatewayProxyResult } from 'aws-lambda';
import { expect } from 'vitest';

export const DEFAULT_TEST_ORIGIN = 'https://app.example.com';

/**
 * Asserts that basic security headers are present in the API response.
 * Uses lowercase header names as that's how helmet and HTTP standards work.
 */
export const assertSecurityHeaders = (result: APIGatewayProxyResult) => {
  expect(result.headers).toMatchObject({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'x-xss-protection': '0',
    'content-security-policy': expect.stringContaining("default-src 'self'"),
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  });
};

/**
 * Asserts that modern cross-origin protection headers are present.
 */
export const assertCrossOriginHeaders = (
  result: APIGatewayProxyResult,
  origin: string
) => {
  expect(result.headers).toMatchObject({
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
  });
};

/**
 * Asserts that all security headers are present and correctly configured.
 */
export const assertAllSecurityHeaders = (
  result: APIGatewayProxyResult,
  origin: string = DEFAULT_TEST_ORIGIN
) => {
  assertSecurityHeaders(result);
  assertCrossOriginHeaders(result, origin);
};
