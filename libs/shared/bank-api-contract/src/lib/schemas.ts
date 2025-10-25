import { z } from 'zod';
import {
  createSanitizedOptionalStringSchema,
  createSanitizedStringSchema,
} from './sanitization';

export const ProblemDto = z.object({
  error: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});

export type ProblemDto = z.infer<typeof ProblemDto>;

const MoneyMinor = z.number().int();

export const AccountDto = z.object({
  accountId: z.string().uuid(),
  accountNumber: z.string().length(10),
  name: z.string(),
  currency: z.literal('USD'),
  createdAt: z.string().datetime({ offset: true }),
  ledgerBalanceMinor: MoneyMinor,
  availableBalanceMinor: MoneyMinor,
  status: z.string(),
});

export const CreateAccountRequestDto = z.object({
  name: createSanitizedStringSchema(
    z
      .string()
      .min(1, 'Account name is required')
      .max(100, 'Account name must be 100 characters or less')
  ),
});

export const FundingReqDto = z.object({
  amountMinor: MoneyMinor.positive(),
});

export const TransferReqDto = z.object({
  sourceAccountId: z.string().uuid(),
  destinationAccountNumber: z.string().length(10),
  amountMinor: MoneyMinor.positive(),
  description: createSanitizedOptionalStringSchema(
    z.string().max(140).optional()
  ),
});

export const TransferResponseDto = z.object({
  txnId: z.string().uuid(),
});

export const IdempotencyKeyHeaderSchema = z.object({
  'idempotency-key': z.string(),
});

export const TransactionDto = z.object({
  txnId: z.string().uuid(),
  accountId: z.string().uuid(),
  side: z.enum(['DEBIT', 'CREDIT']),
  amountMinor: MoneyMinor,
  type: z.string(),
  status: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  description: z.string().optional(),
  counterpartyAccountNumber: z.string(),
});

export const PaginatedDto = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next: z.string().optional(),
  });

export const ActivityPostedTransactionDto = z.object({
  kind: z.literal('POSTED_TRANSACTION'),
  transactionId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  postedAt: z.string().datetime({ offset: true }),
  originHoldId: z.string().optional(),
});

export const ActivityHoldCreatedDto = z.object({
  kind: z.literal('HOLD_CREATED'),
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  createdAt: z.string().datetime({ offset: true }),
  counterpartyAccountNumber: z.string().optional(),
  createdByUserId: z.string().optional(),
  idempotencyKeyHash: z.string().optional(),
});

export const ActivityHoldReleasedDto = z.object({
  kind: z.literal('HOLD_RELEASED'),
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  releasedAt: z.string().datetime({ offset: true }),
  releaseReason: z.string().optional(),
});

export const ActivityHoldCapturedDto = z.object({
  kind: z.literal('HOLD_CAPTURED'),
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  capturedAt: z.string().datetime({ offset: true }),
  transactionId: z.string(),
  counterpartyAccountNumber: z.string(),
});

export const ActivityHoldFailedDto = z.object({
  kind: z.literal('HOLD_FAILED'),
  holdId: z.string(),
  amountMinor: MoneyMinor,
  description: createSanitizedOptionalStringSchema(z.string().optional()),
  failedAt: z.string().datetime({ offset: true }),
  failureCode: z.enum([
    'INSUFFICIENT_FUNDS',
    'STATE_MISMATCH',
    'VALIDATION',
    'INTERNAL',
  ]),
  failureMessage: z.string().optional(),
});

export const ActivityItemDto = z.discriminatedUnion('kind', [
  ActivityHoldCreatedDto,
  ActivityHoldReleasedDto,
  ActivityHoldCapturedDto,
  ActivityHoldFailedDto,
  ActivityPostedTransactionDto,
]);

export const ActivityResponseDto = z.object({
  items: z.array(ActivityItemDto),
  nextCursor: z.string().optional(),
});
