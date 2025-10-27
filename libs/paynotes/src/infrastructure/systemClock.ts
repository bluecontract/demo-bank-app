import type { ClockPort } from '../application/ports';

export const createSystemClock = (): ClockPort => ({
  now: () => new Date(),
});
