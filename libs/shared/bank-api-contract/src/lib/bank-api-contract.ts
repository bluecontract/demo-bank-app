import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { createSanitizedStringSchema } from './sanitization';
import {
  AccountDto,
  CreateAccountRequestDto,
  FundingReqDto,
  ProblemDto,
  TransferResponseDto,
  IdempotencyKeyHeaderSchema,
} from './schemas';

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
        401: ProblemDto,
        409: ProblemDto,
      },
      summary: 'Sign up with a unique name',
    },

    signIn: {
      method: 'POST',
      path: '/auth/signin',
      body: SignInRequestSchema,
      responses: {
        200: AuthSuccessResponseSchema,
        401: ProblemDto,
        404: ProblemDto,
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

      listAccounts: {
        method: 'GET',
        path: '/v1/accounts',
        responses: {
          200: z.object({ accounts: z.array(AccountDto) }),
        },
        query: z.object({
          limit: z.coerce.number().int().positive().optional(),
          cursor: z.string().optional(),
        }),
        summary: 'List user bank accounts',
      },

      getAccount: {
        method: 'GET',
        path: '/v1/accounts/:accountId',
        pathParams: z.object({ accountId: z.string().uuid() }),
        responses: { 200: AccountDto, 404: ProblemDto },
        summary: 'Get a bank account by ID',
      },

      fundAccount: {
        method: 'POST',
        path: '/v1/accounts/:accountId/funding',
        pathParams: z.object({ accountId: z.string().uuid() }),
        body: FundingReqDto,
        headers: IdempotencyKeyHeaderSchema,
        responses: {
          201: TransferResponseDto,
          400: ProblemDto,
          404: ProblemDto,
        },
        summary: 'Fund a bank account',
      },
    },
  },
  {
    commonResponses: {
      401: ProblemDto,
      403: ProblemDto,
      400: ProblemDto,
      500: ProblemDto,
    },
  }
);

// Export types for use in handlers
export type BankApiContract = typeof bankApiContract;
