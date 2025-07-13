import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from './security';

describe('Security Headers', () => {
  it('should return all required security headers from helmet', () => {
    const headers = getSecurityHeaders();

    // Test that key security headers exist (using lowercase as helmet returns them)
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN'); // Helmet default
    expect(headers['x-xss-protection']).toBe('0'); // Modern best practice
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['origin-agent-cluster']).toBe('?1');
  });

  it('should include modern XSS protection header (disabled)', () => {
    const headers = getSecurityHeaders();
    // Modern best practice: disable browser XSS filter, rely on CSP
    expect(headers['x-xss-protection']).toBe('0');
  });

  it('should include Content Security Policy with helmet defaults', () => {
    const headers = getSecurityHeaders();
    const csp = headers['content-security-policy'];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('should include HSTS header', () => {
    const headers = getSecurityHeaders();
    expect(headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains'
    );
  });

  it('should include modern cross-origin protection headers', () => {
    const headers = getSecurityHeaders();
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});
