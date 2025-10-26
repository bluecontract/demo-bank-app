import { describe, it, expect } from 'vitest';
import { getMetrics } from './metrics';
import { PowertoolsMetrics } from '@demo-bank-app/shared-observability';

describe('Metrics', () => {
  it('should return PowertoolsMetrics', () => {
    const metrics = getMetrics();
    expect(metrics).toBeInstanceOf(PowertoolsMetrics);
  });
});
