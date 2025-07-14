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
