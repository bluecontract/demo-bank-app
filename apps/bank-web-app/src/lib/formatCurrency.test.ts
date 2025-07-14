import { formatCurrency } from './formatCurrency';

describe('formatCurrency', () => {
  it('should format currency in minor units to dollars', () => {
    expect(formatCurrency(1030000)).toBe('$10,300');
  });

  it('should format currency with cents when needed', () => {
    expect(formatCurrency(1030050)).toBe('$10,300.50');
  });

  it('should handle zero amount', () => {
    expect(formatCurrency(0)).toBe('$0');
  });

  it('should handle small amounts', () => {
    expect(formatCurrency(1)).toBe('$0.01');
    expect(formatCurrency(99)).toBe('$0.99');
  });

  it('should handle negative amounts', () => {
    expect(formatCurrency(-1030000)).toBe('-$10,300');
  });

  it('should handle large amounts with proper comma separators', () => {
    expect(formatCurrency(123456789)).toBe('$1,234,567.89');
  });

  it('should handle amounts that end in zero cents', () => {
    expect(formatCurrency(1000000)).toBe('$10,000');
  });

  it('should handle amounts with single digit cents', () => {
    expect(formatCurrency(100005)).toBe('$1,000.05');
  });
});
