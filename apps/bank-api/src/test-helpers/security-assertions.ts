import { APIGatewayProxyResult } from 'aws-lambda';
import { expect } from 'vitest';

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
export const assertCrossOriginHeaders = (result: APIGatewayProxyResult) => {
  expect(result.headers).toMatchObject({
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
  });
};

/**
 * Asserts that all security headers are present and correctly configured.
 */
export const assertAllSecurityHeaders = (result: APIGatewayProxyResult) => {
  assertSecurityHeaders(result);
  assertCrossOriginHeaders(result);
};
