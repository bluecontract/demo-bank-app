import { describe, it, expect, beforeEach } from 'vitest';
import { getDependencies, resetDependencies } from './dependencies';
import {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';

describe('Banking Dependencies', () => {
  beforeEach(() => {
    resetDependencies();
  });

  it('should return dependencies object with repository, holdRepository, and accountNumberGenerator', async () => {
    const deps = await getDependencies();
    expect(deps).toHaveProperty('repository');
    expect(deps).toHaveProperty('holdRepository');
    expect(deps).toHaveProperty('accountNumberGenerator');
    expect(deps.logger).toBeInstanceOf(PowertoolsLogger);
    expect(deps.metrics).toBeInstanceOf(PowertoolsMetrics);
  });

  it('should cache dependencies and return the same object', async () => {
    const deps1 = await getDependencies();
    const deps2 = await getDependencies();
    expect(deps1).toBe(deps2);
  });

  it('should reset dependencies', async () => {
    const deps1 = await getDependencies();
    resetDependencies();
    const deps2 = await getDependencies();
    expect(deps1).not.toBe(deps2);
  });
});
