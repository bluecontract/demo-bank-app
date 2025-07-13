import helmet from 'helmet';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Get security headers using helmet with appropriate configurations for our banking API
 */
export function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  // Create mock request/response objects for helmet
  const mockReq = {
    headers: {},
    url: '/',
    method: 'GET',
  } as IncomingMessage;

  const mockRes = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    removeHeader: (name: string) => {
      delete headers[name.toLowerCase()];
    },
    headersSent: false,
    locals: {},
  } as unknown as ServerResponse;

  // Apply helmet middleware
  helmet()(mockReq, mockRes, () => {
    // No-op callback
  });

  return headers;
}

export const addSecurityHeaders = <
  T extends Record<string, unknown> & { headers?: Record<string, unknown> }
>(
  response: T
): T => {
  if (response && typeof response === 'object' && 'headers' in response) {
    const securityHeaders = getSecurityHeaders();
    return {
      ...response,
      headers: {
        ...response.headers,
        ...securityHeaders,
      },
    };
  }
  return response;
};
