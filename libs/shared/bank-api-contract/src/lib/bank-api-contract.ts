import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { createSanitizedStringSchema } from './sanitization';
import { AccountDto, CreateAccountRequestDto } from './schemas';

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
  name: createSanitizedStringSchema(z.string().min(1).max(50)),
});

export const SignInRequestSchema = SignUpRequestSchema;

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
      query: z
        .object({
          dev: z.string().optional(),
        })
        .optional(),
      responses: {
        201: AuthSuccessResponseSchema,
        409: AuthErrorResponseSchema,
        // 400: AuthErrorResponseSchema,
      },
      summary: 'Sign up with a unique name',
    },

    signIn: {
      method: 'POST',
      path: '/auth/signin',
      body: SignInRequestSchema,
      responses: {
        200: AuthSuccessResponseSchema,
        404: AuthErrorResponseSchema,
        // 400: AuthErrorResponseSchema,
      },
      summary: 'Sign in with existing name',
    },

    banking: {
      createAccount: {
        method: 'POST',
        path: '/v1/accounts',
        body: CreateAccountRequestDto,
        responses: { 201: AccountDto },
        summary: 'Create a bank account',
      },
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
