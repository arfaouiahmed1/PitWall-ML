// Unified TypeScript interfaces — shared design tokens and data contracts
// Background: #080c14, Card: #0f172a, Border: #1e293b
// Neon: #ff1801 Racing Red, #00d2be Mercedes Cyan, #3671c6 Red Bull Blue, #ff8000 Papaya, #e8002d Ferrari, #22c55e Green, #eab308 Yellow

export type Compound = "S" | "M" | "H" | "I" | "W" | "SOFT" | "MEDIUM" | "HARD" | "INTER" | "WET";
export type TyreCompound = Compound;

export type TelemetryPoint = {
  lap: number;
  distance_m: number;
  speed_kmh: number;
  throttle_pct: number; // 0-100
  brake_pct: number; // 0-100
  gear: number; // 1-8, 0 = N
  drs: boolean;
  x_mode?: boolean;
  z_mode?: boolean;
};
export type TelemetryTrace = TelemetryPoint[];
export type TracePoint = { distance: number; speed: number; throttle: number; brake: number; gear: number; drs: boolean };

export type DriverState = {
  driver_number: number;
  position: number;
  gap_to_leader_s: number;
  gap_to_ahead_s?: number;
  interval_gap?: string;
  tyre_compound: Compound;
  tyre_age_laps: number;
  stint_lap: number;
  last_lap_s?: number;
  last_lap_str?: string;
  forecast_q10?: number;
  forecast_q50?: number;
  forecast_q90?: number;
  interval_width?: number;
  confidence?: number;
  pit_prob_1?: number;
  pit_prob_3?: number;
  pit_prob_5?: number;
  drs_available?: boolean;
  // compat with raceSim DriverTick
  gap?: string;
  tyre?: string;
  tyreAge?: number;
  lastLap?: string;
  forecast?: string;
  interval?: string;
  pitProb?: number;
};

export type PacePrediction = {
  driver_number: number;
  lap: number;
  q10: number;
  q50: number;
  q90: number;
  interval_width: number;
  confidence: number;
  pit_prob_next1?: number;
  pit_prob_next3?: number;
  pit_prob_next5?: number;
  finish_probs?: FinishDistribution;
};
export type Prediction = PacePrediction;
export type TyrePrediction = { driver_number: number; delta_s: number; confidence: number };
export type PitHazard = { driver_number: number; p1: number; p3: number; p5: number };
export type FinishDistribution = { p1: number; podium: number; points: number };

export type SimulationResult = {
  driver_number: number;
  target_pit_lap: number;
  target_compound: Compound;
  baseline_win_prob: number;
  whatif_win_prob: number;
  delta_s: number;
  reentry_position: number;
  reentry_position_dist: number[];
  gap_trajectory: { lap: number; baseline_gap: number; whatif_gap: number }[];
  cliff_risk: number;
  finishing_dist_baseline: number[];
  finishing_dist_whatif: number[];
};

export type WhatIfRequest = {
  driver_number: number;
  target_pit_lap: number;
  target_compound: Compound;
  push_pace_delta_s: number; // -0.5 .. +0.5
  remaining_laps: number;
  current_lap: number;
  simulations?: number;
};
export type WhatIfScenario = WhatIfRequest;
export type WhatIfResponse = {
  projected_reentry_position: number;
  reentry_distribution: number[];
  net_time_delta_s: number;
  win_prob_baseline: number;
  win_prob_whatif: number;
  cliff_risk: number;
  gap_trajectory: { lap: number; baseline: number; whatif: number }[];
  finishing_probs?: { baseline: number[]; whatif: number[] };
};

export type ShapAttribution = { feature: string; shap_value: number; feature_value?: number };
export type SHAPAttribution = ShapAttribution;
export type LocalExplanation = { driver_number: number; lap: number; base_value: number; attributions: ShapAttribution[] };
export type GlobalFeatureImportance = { feature: string; importance: number };
export type ShapSummary = Record<string, number>;

export type ModelCard = {
  alias: "champion" | "challenger";
  name: string;
  version: string;
  mlflow_run_id?: string;
  dataset_rows?: number;
  dataset_races?: number;
  metrics: {
    mae: number;
    rmse: number;
    coverage_80: number;
    mean_width?: number;
    p95_ms?: number;
    per_compound?: Record<string, number>;
    per_stint?: Record<string, number>;
    per_circuit_type?: Record<string, number>;
  };
  gate_passed?: boolean;
};

export type DriftSeverity = "none" | "moderate" | "severe";
export type DriftFeatureRow = {
  feature: string;
  wasserstein: number;
  ks_stat: number;
  ks_p: number;
  psi: number;
  js_divergence: number;
  severity: DriftSeverity;
};
export type FeatureDrift = DriftFeatureRow;
export type DriftReport = {
  era_from: string;
  era_to: string;
  overall_wasserstein: number;
  overall_ks: number;
  overall_psi: number;
  overall_js: number;
  features: DriftFeatureRow[];
  drift_ratio: number;
};

export type WeatherMetrics = {
  air_temp_c: number;
  track_temp_c: number;
  humidity_pct: number;
  pressure_mbar: number;
  wind_speed_kmh: number;
  wind_dir_deg: number;
  rainfall_mm?: number;
  rainfall_prob?: number;
  session_id?: string;
};
export type WeatherData = WeatherMetrics;

export type FlagStatus = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED" | "UNKNOWN";
export type TrackFlag = FlagStatus;
export type ConnectionStatus = "live" | "replay" | "sim" | "offline";

export type SessionInfo = {
  circuit_key: string;
  circuit_name: string;
  session_type: "FP1" | "FP2" | "FP3" | "Q" | "Sprint" | "Race";
  lap: number;
  total_laps: number;
  flag: FlagStatus;
  replay?: boolean;
  latency_ms?: number;
};
export type CircuitInfo = { id: string; name: string; country: string; length_km: number; laps: number; sectors?: number };
export type SessionSlot = { name: string; start: string; end?: string; type: string };
export type WeekendSchedule = { circuit: CircuitInfo; sessions: SessionSlot[] };

export type PerformanceVector = {
  highSpeed: number;
  lowSpeed: number;
  traction: number;
  tyreConservation: number;
  energyEfficiency: number;
  reliability: number;
};

export type HealthMetrics = {
  p95_latency_ms: number;
  ws_clients: number;
  feature_freshness_s: number;
  error_rate: number;
  drift_ratio: number;
  events_per_sec?: number;
  processing_lag_s?: number;
};
export type LatencySample = { ts: number; p50: number; p95: number; p99: number };

export type CalibrationPoint = { nominal: number; empirical: number; compound?: string };
export type SubgroupMetric = { group: string; category: string; mae: number; rmse: number; n: number };
export type SubgroupRow = SubgroupMetric;

export type RaceState = {
  lap: number;
  total_laps: number;
  flag: TrackFlag;
  entries: DriverState[];
};
