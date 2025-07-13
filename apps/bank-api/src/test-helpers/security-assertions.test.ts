import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  assertSecurityHeaders,
  assertCrossOriginHeaders,
  assertAllSecurityHeaders,
} from './security-assertions';

describe('Security Assertion Helpers', () => {
  const createMockResponse = (
    headers: Record<string, string> = {}
  ): APIGatewayProxyResult => ({
    statusCode: 200,
    body: JSON.stringify({ message: 'test' }),
    headers,
  });

  describe('assertSecurityHeaders', () => {
    it('should pass when all security headers are present', () => {
      const response = createMockResponse({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'x-xss-protection': '0',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
      });

      expect(() => assertSecurityHeaders(response)).not.toThrow();
    });

    it('should fail when security headers are missing', () => {
      const response = createMockResponse({});

      expect(() => assertSecurityHeaders(response)).toThrow();
    });
  });

  describe('assertCrossOriginHeaders', () => {
    it('should pass when cross-origin headers are present', () => {
      const response = createMockResponse({
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'origin-agent-cluster': '?1',
      });

      expect(() => assertCrossOriginHeaders(response)).not.toThrow();
    });
  });

  describe('assertAllSecurityHeaders', () => {
    it('should pass when all security headers are present', () => {
      const response = createMockResponse({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'x-xss-protection': '0',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'origin-agent-cluster': '?1',
        'access-control-allow-origin': 'https://example.com',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers': 'Content-Type, Authorization',
      });

      expect(() => assertAllSecurityHeaders(response)).not.toThrow();
    });
  });
});
