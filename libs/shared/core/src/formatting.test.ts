import { describe, expect, it } from 'vitest';
import {
  formatIsoDateHumanReadable,
  formatMinorAmount,
  formatMinorAmountWithCurrency,
  parseMinorAmount,
} from './formatting';

describe('formatting', () => {
  describe('parseMinorAmount', () => {
    it('parses number, string and typed scalar values', () => {
      expect(parseMinorAmount(12000)).toBe(12000);
      expect(parseMinorAmount('12000')).toBe(12000);
      expect(parseMinorAmount({ value: '12000' })).toBe(12000);
    });

    it('returns undefined for invalid values', () => {
      expect(parseMinorAmount(undefined)).toBeUndefined();
      expect(parseMinorAmount('abc')).toBeUndefined();
      expect(parseMinorAmount('120abc')).toBeUndefined();
      expect(parseMinorAmount({ value: 'abc' })).toBeUndefined();
    });
  });

  describe('formatMinorAmount', () => {
    it('formats USD minor value with trimmed zeros', () => {
      expect(
        formatMinorAmount({
          amountMinor: 14400,
          currencyCode: 'USD',
          locale: 'en-US',
          trimTrailingZeros: true,
        })
      ).toBe('144');
    });

    it('supports currencies with custom fraction digits', () => {
      expect(
        formatMinorAmount({
          amountMinor: 12345,
          currencyCode: 'USD',
          fractionDigits: 2,
          locale: 'en-US',
        })
      ).toBe('123.45');
    });

    it('uses dynamic fraction digits for zero-decimal currencies when not overridden', () => {
      expect(
        formatMinorAmount({
          amountMinor: 1234,
          currencyCode: 'JPY',
          locale: 'en-US',
        })
      ).toBe('1,234');
    });
  });

  describe('formatMinorAmountWithCurrency', () => {
    it('formats USD with dollar prefix', () => {
      expect(
        formatMinorAmountWithCurrency({
          amountMinor: 12000,
          currencyCode: 'USD',
          fractionDigits: 2,
          locale: 'en-US',
        })
      ).toBe('$120.00');
    });

    it('formats non-USD with currency code prefix', () => {
      expect(
        formatMinorAmountWithCurrency({
          amountMinor: 12000,
          currencyCode: 'EUR',
          fractionDigits: 2,
          locale: 'en-US',
        })
      ).toBe('EUR 120.00');
    });
  });

  describe('formatIsoDateHumanReadable', () => {
    it('formats ISO timestamp into human-readable date', () => {
      expect(
        formatIsoDateHumanReadable({
          isoDate: '2027-12-31T23:59:59.000Z',
          locale: 'en-US',
          timeZone: 'UTC',
        })
      ).toBe('December 31, 2027');
    });

    it('returns source date on parse failure when fallback is enabled', () => {
      expect(
        formatIsoDateHumanReadable({
          isoDate: 'not-an-iso-date',
          fallbackToInput: true,
        })
      ).toBe('not-an-iso-date');
    });
  });
});
