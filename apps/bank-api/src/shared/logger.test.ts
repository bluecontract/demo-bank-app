import { describe, it, expect } from 'vitest';
import { getLogger } from './logger';
import { PowertoolsLogger } from '@demo-blue/shared-observability';

describe('Logger', () => {
  it('should return PowertoolsLogger', () => {
    const logger = getLogger();
    expect(logger).toBeInstanceOf(PowertoolsLogger);
  });
});
