import { formatAccountNumber } from './formatAccountNumber';

describe('formatAccountNumber', () => {
  it('should format 10-digit account number with spaces', () => {
    expect(formatAccountNumber('1234567890')).toBe('123 456 7890');
  });

  it('should format 12-digit account number with spaces', () => {
    expect(formatAccountNumber('123456789012')).toBe('123 456 789 012');
  });

  it('should handle shorter account numbers', () => {
    expect(formatAccountNumber('12345')).toBe('12345');
  });

  it('should handle empty string', () => {
    expect(formatAccountNumber('')).toBe('');
  });

  it('should handle account numbers with existing spaces', () => {
    expect(formatAccountNumber('123 456 7890')).toBe('123 456 7890');
  });

  it('should handle account numbers with hyphens', () => {
    expect(formatAccountNumber('123-456-7890')).toBe('123 456 7890');
  });

  it('should handle mixed formatting', () => {
    expect(formatAccountNumber('123-456 789012')).toBe('123 456 789 012');
  });
});
