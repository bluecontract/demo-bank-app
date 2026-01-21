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
  TransactionDto,
  CardDetailsDto,
  IssueCardRequestDto,
  IssueCardResponseDto,
  CardListResponseDto,
  CardAuthorizationRequestDto,
  CardAuthorizationResponseDto,
  CardCaptureRequestDto,
  CardCaptureResponseDto,
  ActivityResponseDto,
  ActivityDetailDto,
  PayNoteDetailsDto,
  PayNoteDeliveryListResponseDto,
  PayNoteDeliveryDetailsDto,
  ContractListResponseDto,
  ContractDetailsDto,
  ContractOperationResponseDto,
  NotImplementedResponseDto,
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
  marketingEmailsOptIn: z.boolean(),
});

export const SignInRequestSchema = SignUpRequestSchema.pick({
  email: true,
});

export const AuthSuccessResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  marketingEmailsOptIn: z.boolean(),
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

      listCards: {
        method: 'GET',
        path: '/v1/cards',
        query: z.object({
          accountId: z.string().uuid().optional(),
        }),
        responses: {
          200: CardListResponseDto,
          403: ProblemDto,
          404: ProblemDto,
        },
        summary: 'List cards for a user or specific account',
      },

      issueCard: {
        method: 'POST',
        path: '/v1/cards',
        body: IssueCardRequestDto,
        responses: {
          201: IssueCardResponseDto,
          403: ProblemDto,
          404: ProblemDto,
        },
        summary: 'Issue a new card for an account',
      },

      getCard: {
        method: 'GET',
        path: '/v1/cards/:cardId',
        pathParams: z.object({ cardId: z.string().uuid() }),
        responses: { 200: CardDetailsDto, 404: ProblemDto, 403: ProblemDto },
        summary: 'Get a card by ID',
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

      listActivity: {
        method: 'GET',
        path: '/v1/activity/:accountNumber',
        pathParams: z.object({ accountNumber: z.string().length(10) }),
        query: z.object({
          limit: z.coerce.number().positive().optional(),
          cursor: z.string().optional(),
        }),
        responses: {
          200: ActivityResponseDto,
          400: ProblemDto,
          404: ProblemDto,
        },
        summary:
          'List account activity combining pending holds and posted transactions',
      },

      getActivityDetail: {
        method: 'GET',
        path: '/v1/activity/:accountNumber/records/:activityId',
        pathParams: z.object({
          accountNumber: z.string().length(10),
          activityId: z.string(),
        }),
        responses: {
          200: ActivityDetailDto,
          404: ProblemDto,
          501: NotImplementedResponseDto,
        },
        summary: 'Get detail for a specific activity item',
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

      getPayNoteDetails: {
        method: 'GET',
        path: '/v1/activity/:accountNumber/paynotes/:payNoteDocumentId',
        pathParams: z.object({
          accountNumber: z.string().length(10),
          payNoteDocumentId: z.string(),
        }),
        responses: {
          200: PayNoteDetailsDto,
          404: ProblemDto,
          501: NotImplementedResponseDto,
        },
        summary: 'Retrieve PayNote details for a given PayNote document id',
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

      listPayNoteDeliveries: {
        method: 'GET',
        path: '/v1/paynotes/deliveries',
        responses: {
          200: PayNoteDeliveryListResponseDto,
          401: ProblemDto,
        },
        summary: 'List PayNote deliveries identified for the current user.',
      },

      getPayNoteDelivery: {
        method: 'GET',
        path: '/v1/paynotes/deliveries/:deliveryId',
        pathParams: z.object({ deliveryId: z.string() }),
        responses: {
          200: PayNoteDeliveryDetailsDto,
          401: ProblemDto,
          404: ProblemDto,
        },
        summary: 'Get PayNote Delivery details for the current user.',
      },

      listContracts: {
        method: 'GET',
        path: '/v1/contracts',
        query: z
          .object({
            updatedSince: z.string().datetime({ offset: true }).optional(),
          })
          .optional(),
        responses: {
          200: ContractListResponseDto,
          401: ProblemDto,
        },
        summary: 'List contracts available for the current user.',
      },

      getContractDetails: {
        method: 'GET',
        path: '/v1/contracts/:sessionId',
        pathParams: z.object({
          sessionId: z.string(),
        }),
        responses: {
          200: ContractDetailsDto,
          401: ProblemDto,
          404: ProblemDto,
        },
        summary: 'Get contract details by session id.',
      },

      runContractOperation: {
        method: 'POST',
        path: '/v1/contracts/:sessionId/:operation',
        pathParams: z.object({
          sessionId: z.string(),
          operation: z.string(),
        }),
        body: z.unknown().optional(),
        responses: {
          200: ContractOperationResponseDto,
          401: ProblemDto,
          404: ProblemDto,
          409: ProblemDto,
        },
        summary: 'Run a MyOS document operation on a contract session.',
      },

      authorizeCard: {
        method: 'POST',
        path: '/v1/card-processor/authorizations',
        body: CardAuthorizationRequestDto,
        headers: IdempotencyKeyHeaderSchema,
        responses: {
          200: CardAuthorizationResponseDto,
          401: ProblemDto,
          409: ProblemDto,
        },
        summary: 'Authorize a card transaction (processor)',
      },

      captureCardAuthorization: {
        method: 'POST',
        path: '/v1/card-processor/authorizations/:authorizationId/capture',
        pathParams: z.object({ authorizationId: z.string() }),
        body: CardCaptureRequestDto,
        headers: IdempotencyKeyHeaderSchema,
        responses: {
          200: CardCaptureResponseDto,
          401: ProblemDto,
          404: ProblemDto,
          409: ProblemDto,
        },
        summary: 'Capture an authorized card transaction (processor)',
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
