import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimingUtils } from './TimingUtils';

describe('TimingUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startTiming', () => {
    it('should create timing object with operation name and start time', () => {
      const mockTime = 1640995200000; // 2022-01-01 00:00:00
      vi.setSystemTime(mockTime);

      const timing = TimingUtils.startTiming('user-signup');

      expect(timing).toEqual({
        operationName: 'user-signup',
        startTime: mockTime,
      });
    });
  });

  describe('endTiming', () => {
    it('should add end time and duration to timing object', () => {
      const startTime = 1640995200000; // 2022-01-01 00:00:00
      const endTime = 1640995205000; // 2022-01-01 00:00:05
      const expectedDuration = 5000; // 5 seconds

      const timing = {
        operationName: 'user-signup',
        startTime,
      };

      vi.setSystemTime(endTime);

      const result = TimingUtils.endTiming(timing);

      expect(result).toEqual({
        operationName: 'user-signup',
        startTime,
        endTime,
        duration: expectedDuration,
      });
    });

    it('should preserve original timing object properties', () => {
      const timing = {
        operationName: 'database-query',
        startTime: 1640995200000,
      };

      vi.setSystemTime(1640995201000);

      const result = TimingUtils.endTiming(timing);

      expect(result.operationName).toBe(timing.operationName);
      expect(result.startTime).toBe(timing.startTime);
    });
  });

  describe('createTimingMetadata', () => {
    it('should create metadata object from timing', () => {
      const timing = {
        operationName: 'user-signin',
        startTime: 1640995200000,
        endTime: 1640995203500,
        duration: 3500,
      };

      const metadata = TimingUtils.createTimingMetadata(timing);

      expect(metadata).toEqual({
        operation: 'user-signin',
        startTime: 1640995200000,
        endTime: 1640995203500,
        duration: 3500,
      });
    });

    it('should handle timing without end time and duration', () => {
      const timing = {
        operationName: 'ongoing-operation',
        startTime: 1640995200000,
      };

      const metadata = TimingUtils.createTimingMetadata(timing);

      expect(metadata).toEqual({
        operation: 'ongoing-operation',
        startTime: 1640995200000,
        endTime: undefined,
        duration: undefined,
      });
    });
  });
});
