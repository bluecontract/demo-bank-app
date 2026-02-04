import { vi } from 'vitest';
import { formatRelativeListDate } from './formatDate';

describe('formatRelativeListDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 4, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats same-day updates as time', () => {
    const value = new Date(2026, 1, 4, 9, 15, 0);
    const expected = value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatRelativeListDate(value.toISOString())).toBe(expected);
  });

  it('formats yesterday as 1 day', () => {
    const value = new Date(2026, 1, 3, 9, 15, 0);
    expect(formatRelativeListDate(value.toISOString())).toBe('1 day');
  });

  it('formats recent updates as day counts', () => {
    const value = new Date(2026, 1, 1, 9, 15, 0);
    expect(formatRelativeListDate(value.toISOString())).toBe('3 days');
  });

  it('falls back to date for older updates', () => {
    const value = new Date(2026, 0, 20, 9, 15, 0);
    const expected = value.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    });
    expect(formatRelativeListDate(value.toISOString())).toBe(expected);
  });
});
