import { z } from 'zod';
import { createSanitizedStringSchema } from './sanitization';

export const ProblemDto = z.object({
  code: z.string(),
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
