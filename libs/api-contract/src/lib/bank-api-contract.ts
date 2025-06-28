import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

// ============= Schemas =============

// Health check schema
export const HealthCheckSchema = z.object({
  status: z.literal('healthy'),
  timestamp: z.string().datetime(),
  version: z.string(),
  environment: z.string(),
});

// ============= API Contract =============

export const bankApiContract = c.router({
  // Health check
  health: {
    method: 'GET',
    path: '/health',
    responses: {
      200: HealthCheckSchema,
    },
    summary: 'Health check endpoint',
  },
});

// Export types for use in handlers
export type BankApiContract = typeof bankApiContract;
