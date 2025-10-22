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
  TransferReqDto,
  PaginatedDto,
  TransactionDto,
} from './schemas';

const c = initContract();

export const PdfTextItemSchema = z.object({
  str: z.string(),
  transform: z.array(z.number()).length(6, 'transform must contain 6 numbers'),
  width: z.number(),
  height: z.number(),
  dir: z.string().optional(),
  fontName: z.string().optional(),
});

export type PdfTextItem = z.infer<typeof PdfTextItemSchema>;

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
  email: createSanitizedStringSchema(z.string().email()),
});

export const SignInRequestSchema = SignUpRequestSchema;

export const AuthSuccessResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
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
      summary: 'Sign up with a unique email',
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
      summary: 'Sign in with existing email',
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

      transferMoney: {
        method: 'POST',
        path: '/v1/transfers',
        body: TransferReqDto,
        headers: IdempotencyKeyHeaderSchema,
        responses: {
          201: TransferResponseDto,
          400: ProblemDto,
          403: ProblemDto,
          404: ProblemDto,
        },
        summary: 'Transfer money between bank accounts',
      },

      listTransactions: {
        method: 'GET',
        path: '/v1/accounts/:accountId/transactions',
        pathParams: z.object({ accountId: z.string().uuid() }),
        query: z.object({
          limit: z.coerce.number().positive().optional(),
          cursor: z.string().optional(),
        }),
        responses: { 200: PaginatedDto(TransactionDto), 404: ProblemDto },
        summary: 'List transactions for a bank account',
      },

      getTransaction: {
        method: 'GET',
        path: '/v1/accounts/:accountId/transactions/:txnId',
        pathParams: z.object({
          accountId: z.string().uuid(),
          txnId: z.string().uuid(),
        }),
        responses: { 200: TransactionDto, 404: ProblemDto },
        summary: 'Get a transaction by ID',
      },

      validatePayNote: {
        method: 'POST',
        path: '/v1/paynotes/validate',
        body: z.object({
          yamlContent: z.string(),
          formData: z.object({
            fromAccount: z.string().optional(),
            toAccount: z.string().optional(),
            recipientName: z.string().optional(),
            totalAmount: z.string().optional(),
            title: z.string().optional(),
            payNoteCode: z.string().optional(),
          }),
        }),
        responses: {
          200: z.object({
            validationScore: z.number().min(0).max(10),
            explanation: z.string(),
          }),
          400: ProblemDto,
        },
        summary: 'Validate a PayNote for transfer',
      },

      bootstrapPayNote: {
        method: 'POST',
        path: '/v1/paynotes/bootstrap',
        body: z.object({
          payNote: z.record(z.any()),
          formData: z.object({
            fromAccount: z.string().optional(),
            toAccount: z.string().optional(),
            recipientName: z.string().optional(),
            totalAmount: z.string().optional(),
            title: z.string().optional(),
            payNoteCode: z.string().optional(),
          }),
        }),
        responses: {
          200: z.object({
            message: z.literal('Bootstrap accepted'),
          }),
          400: ProblemDto,
        },
        summary: 'Bootstrap a PayNote in preparation for execution',
      },

      parsePayNotePdf: {
        method: 'POST',
        path: '/v1/paynotes/parse-pdf',
        body: z.object({
          items: z
            .array(PdfTextItemSchema)
            .min(1, 'At least one PDF text item is required.'),
        }),
        responses: {
          200: z.object({
            yaml: z.string(),
          }),
          400: ProblemDto,
        },
        summary:
          'Reconstruct PayNote YAML content from PDF text extraction items.',
      },

      payNoteWebhook: {
        method: 'POST',
        path: '/v1/paynotes/webhook',
        body: z.record(z.any()),
        responses: {
          200: z.object({ status: z.literal('ok') }),
        },
        summary: 'Webhook for PayNote events.',
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
