import { describe, it, expect } from 'vitest';
import { bankApiContract } from './api/contract.js';

describe('Bank Lambda Business Logic', () => {
  describe('Bank Lambda Setup', () => {
    it('should have a valid API contract', () => {
      expect(bankApiContract).toBeDefined();
      expect(bankApiContract.health).toBeDefined();
    });

    it('should have health endpoint defined', () => {
      expect(bankApiContract.health.method).toBe('GET');
      expect(bankApiContract.health.path).toBe('/health');
    });
  });
});
