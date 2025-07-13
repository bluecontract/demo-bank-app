import { z } from 'zod';

export const ProblemDto = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});

export type ProblemDto = z.infer<typeof ProblemDto>;
