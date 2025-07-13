import { z } from 'zod';
import xss from 'xss';

export const sanitizeText = (text: string): string => {
  return xss(text, {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
  });
};

export const createSanitizedStringSchema = (baseSchema: z.ZodString) => {
  return baseSchema.transform(sanitizeText);
};

export const createSanitizedOptionalStringSchema = (
  baseSchema: z.ZodOptional<z.ZodString>
) => {
  return baseSchema.transform(value => (value ? sanitizeText(value) : value));
};
