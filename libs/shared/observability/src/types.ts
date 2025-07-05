export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LoggerConfig {
  level: LogLevel;
  serviceName: string;
  environment?: string;
}

export interface MetricsConfig {
  namespace: string;
  serviceName: string;
  environment?: string;
}

export interface RequestTiming {
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}
