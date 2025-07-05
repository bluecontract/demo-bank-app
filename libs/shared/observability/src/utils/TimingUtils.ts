import type { RequestTiming } from '../types';

export class TimingUtils {
  static startTiming(operationName: string): RequestTiming {
    return {
      operationName,
      startTime: Date.now(),
    };
  }

  static endTiming(timing: RequestTiming): RequestTiming {
    const endTime = Date.now();
    return {
      ...timing,
      endTime,
      duration: endTime - timing.startTime,
    };
  }

  static createTimingMetadata(timing: RequestTiming): Record<string, unknown> {
    return {
      operation: timing.operationName,
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.duration,
    };
  }
}
