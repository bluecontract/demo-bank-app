import { z } from 'zod';

export const coerceBooleanQueryParam = (
  value: boolean | string | undefined,
  fallback?: boolean
): boolean | undefined => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return fallback;
  }

  return value;
};

export const BooleanQueryParamSchema = z.preprocess(
  value =>
    coerceBooleanQueryParam(
      typeof value === 'boolean' || typeof value === 'string'
        ? value
        : undefined
    ),
  z.boolean().optional()
);
