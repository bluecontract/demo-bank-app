import { createApiClient } from '@demo-blue/shared-bank-api-client';

const baseUrl = __BANK_API_URL__ || 'http://localhost:3000';

export const apiClient = createApiClient({ baseUrl });
