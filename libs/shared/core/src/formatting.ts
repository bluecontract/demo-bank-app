const normalizeCurrencyCode = (value?: string): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveCurrencyFractionDigits = (currencyCode?: string): number => {
  if (!currencyCode) {
    return 2;
  }
  try {
    const maximumFractionDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits;
    if (
      typeof maximumFractionDigits === 'number' &&
      Number.isFinite(maximumFractionDigits)
    ) {
      return maximumFractionDigits;
    }
    return 2;
  } catch {
    return 2;
  }
};

export const parseMinorAmount = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) {
      return parseMinorAmount(record.value);
    }
  }
  return undefined;
};

export const formatMinorAmount = (input: {
  amountMinor?: unknown;
  currencyCode?: string;
  locale?: string;
  fractionDigits?: number;
  trimTrailingZeros?: boolean;
}): string | undefined => {
  const amountMinor = parseMinorAmount(input.amountMinor);
  if (amountMinor === undefined) {
    return undefined;
  }

  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  const fractionDigits =
    typeof input.fractionDigits === 'number' &&
    Number.isFinite(input.fractionDigits)
      ? Math.max(0, Math.trunc(input.fractionDigits))
      : resolveCurrencyFractionDigits(currencyCode);
  const majorAmount = amountMinor / 10 ** fractionDigits;
  const minimumFractionDigits = input.trimTrailingZeros ? 0 : fractionDigits;

  return new Intl.NumberFormat(input.locale ?? 'en-US', {
    minimumFractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(majorAmount);
};

export const formatMinorAmountWithCurrency = (input: {
  amountMinor?: unknown;
  currencyCode?: string;
  defaultCurrencyCode?: string;
  locale?: string;
  fractionDigits?: number;
  trimTrailingZeros?: boolean;
  usdSymbol?: string;
}): string | undefined => {
  const normalizedCurrency =
    normalizeCurrencyCode(input.currencyCode) ??
    normalizeCurrencyCode(input.defaultCurrencyCode);
  const amount = formatMinorAmount({
    amountMinor: input.amountMinor,
    currencyCode: normalizedCurrency,
    locale: input.locale,
    fractionDigits: input.fractionDigits,
    trimTrailingZeros: input.trimTrailingZeros,
  });
  if (!amount) {
    return undefined;
  }

  if (!normalizedCurrency || normalizedCurrency === 'USD') {
    return `${input.usdSymbol ?? '$'}${amount}`;
  }
  return `${normalizedCurrency} ${amount}`;
};

export const formatIsoDateHumanReadable = (input: {
  isoDate?: string;
  locale?: string;
  timeZone?: string;
  fallbackToInput?: boolean;
  options?: Intl.DateTimeFormatOptions;
}): string | undefined => {
  const isoDate = input.isoDate;
  if (!isoDate) {
    return undefined;
  }
  const timestampMs = Date.parse(isoDate);
  if (!Number.isFinite(timestampMs)) {
    return input.fallbackToInput ? isoDate : undefined;
  }

  return new Intl.DateTimeFormat(input.locale ?? 'en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    ...(input.options ?? {}),
  }).format(new Date(timestampMs));
};
