import { describe, it, expect } from 'vitest';
import { generatePan, generateCvc, isLuhnValid } from './cardUtils';

describe('cardUtils', () => {
  it('generates a PAN with the expected prefix and length', () => {
    const pan = generatePan('123456', () => 1);
    expect(pan).toMatch(/^123456\d{10}$/);
    expect(pan.length).toBe(16);
  });

  it('generates a PAN that passes Luhn validation', () => {
    const pan = generatePan('123456', () => 4);
    expect(isLuhnValid(pan)).toBe(true);
  });

  it('validates a known test PAN', () => {
    expect(isLuhnValid('4242424242424242')).toBe(true);
  });

  it('generates a 3-digit CVC', () => {
    const cvc = generateCvc(() => 7);
    expect(cvc).toBe('777');
    expect(cvc).toMatch(/^\d{3}$/);
  });
});
