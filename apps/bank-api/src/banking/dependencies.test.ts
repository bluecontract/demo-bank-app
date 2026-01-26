import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { getDependencies, resetDependencies } from './dependencies';

const hoisted = vi.hoisted(() => {
  const mockRepositoryInstance = {
    getAccountById: vi.fn(),
    saveAccount: vi.fn(),
  };
  const DynamoBankingRepository = vi.fn(() => mockRepositoryInstance);
  return {
    mockRepositoryInstance,
    DynamoBankingRepository,
  };
});

vi.mock('@demo-bank-app/banking', async () => {
  const actual = await vi.importActual<typeof import('@demo-bank-app/banking')>(
    '@demo-bank-app/banking'
  );
  return {
    ...actual,
    DynamoBankingRepository: hoisted.DynamoBankingRepository,
  };
});

describe('Banking Dependencies', () => {
  beforeEach(() => {
    hoisted.mockRepositoryInstance.getAccountById.mockResolvedValue(null);
    hoisted.mockRepositoryInstance.saveAccount.mockResolvedValue(undefined);
    hoisted.DynamoBankingRepository.mockClear();
    resetDependencies();
  });

  it('should return dependencies object with repository, holdRepository, and accountNumberGenerator', async () => {
    const deps = await getDependencies();
    expect(deps).toHaveProperty('repository');
    expect(deps).toHaveProperty('holdRepository');
    expect(deps).toHaveProperty('accountNumberGenerator');
    expect(deps).toHaveProperty('cardRepository');
    expect(deps).toHaveProperty('cardHasher');
    expect(deps.config).toHaveProperty('cardConfig');
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
