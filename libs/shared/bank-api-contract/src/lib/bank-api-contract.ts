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

// Auth schemas
export const SignUpRequestSchema = z.object({
  name: z.string().min(1).max(50),
});

export const AuthSuccessResponseSchema = z.object({
  userId: z.string(),
  name: z.string(),
});

export const AuthErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// ============= API Contract =============

export const bankApiContract = c.router(
  {
    // Health check
    health: {
      method: 'GET',
      path: '/health',
      responses: {
        200: HealthCheckSchema,
      },
      summary: 'Health check endpoint',
    },

    // Auth endpoints
    signUp: {
      method: 'POST',
      path: '/auth/signup',
      body: SignUpRequestSchema,
      responses: {
        201: AuthSuccessResponseSchema,
        409: AuthErrorResponseSchema,
        // 400: AuthErrorResponseSchema,
      },
      summary: 'Sign up with a unique name',
    },
  },
  {
    commonResponses: {
      400: AuthErrorResponseSchema,
      500: AuthErrorResponseSchema,
    },
  }
);

// Export types for use in handlers
export type BankApiContract = typeof bankApiContract;
