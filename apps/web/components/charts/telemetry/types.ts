export interface TelemetryPoint {
  distance?: number;
  distance_m?: number;
  speed?: number;
  speed_kmh?: number;
  throttle?: number;
  throttle_pct?: number;
  brake?: number;
  brake_pct?: number;
  gear?: number;
  drs?: boolean | number;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface DriverTelemetryMeta {
  name?: string;
  code: string;
  number?: number;
  team?: string;
  color?: string;
}

export interface TelemetryTraceChartProps {
  traceA?: TelemetryPoint[] | null;
  traceB?: TelemetryPoint[] | null;
  driverA?: DriverTelemetryMeta;
  driverB?: DriverTelemetryMeta;
  title?: string;
  subtitle?: string;
  className?: string;
  distanceUnit?: "m" | "%";
  showControls?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  axisMode?: "timestamp" | "distance_m" | "distance";
  reason?: string;
}

export interface NormalizedPoint {
  sampleIndex: number;
  axisValue: number;
  axisDisplay: string;
  distance: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  drs: boolean;
  rawTimestamp?: string | number;
  rawDistance?: number;
}

export interface DrsSegment {
  startX: number;
  width: number;
}

export const CHART_LAYOUT = {
  width: 1000,
  padLeft: 64,
  padRight: 24,
  plotWidth: 912,
  speedTop: 32,
  speedHeight: 130,
  throttleBrakeTop: 196,
  throttleBrakeHeight: 92,
  gearTop: 320,
  gearHeight: 68,
  totalHeight: 432,
} as const;
