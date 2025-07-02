export interface Metrics {
  addMetric(name: string, unit: MetricUnit, value: number): void;
  addMetadata(key: string, value: string): void;
  publishStoredMetrics(): Promise<void>;
  setDefaultDimensions(dimensions: Record<string, string>): void;
}

export type MetricUnit =
  | 'Seconds'
  | 'Microseconds'
  | 'Milliseconds'
  | 'Count'
  | 'Bytes'
  | 'Kilobytes'
  | 'Megabytes'
  | 'Gigabytes'
  | 'Percent';

export interface MetricsConfig {
  namespace: string;
  serviceName: string;
  environment?: string;
}
