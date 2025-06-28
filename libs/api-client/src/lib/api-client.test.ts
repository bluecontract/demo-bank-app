import { describe, it, expect } from 'vitest';
import { createApiClient } from './api-client';

describe('API Client', () => {
  it('should create an API client with the provided configuration', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      headers: { 'X-API-Key': 'test-key' },
    };

    const client = createApiClient(config);

    expect(client).toBeDefined();
    expect(client.health).toBeDefined();
  });
});
