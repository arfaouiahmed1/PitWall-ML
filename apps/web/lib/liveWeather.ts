"use client";

// PitWall ML - Real Live Track Weather Engine
// Fetches persisted atmospheric telemetry from backend database storage (/weather/latest).
// When offline or unrecorded, surfaces explicit unavailable/stale status with source timestamps.

import { useEffect, useState } from "react";
import { API_URL, fetchJson, startPoller } from "@/lib/api";

export type LiveWeatherData = {
  readonly available: boolean;
  readonly reason: string | null;
  readonly airTempC: number | null;
  readonly trackTempC: number | null;
  readonly humidityPct: number | null;
  readonly pressureMbar: number | null;
  readonly windSpeedKmh: number | null;
  readonly windDeg: number | null;
  readonly rainfallMm: number | null;
  readonly rainfallProb: number | null;
  readonly condition: string;
  readonly source: string;
  readonly provenance: "OPENF1" | "DB" | "STALE" | "UNAVAILABLE";
  readonly sourceTimestamp: string | null;
  readonly dataAgeSeconds: number | null;
  readonly stale: boolean;
};

export const UNAVAILABLE_LIVE_WEATHER: LiveWeatherData = {
  available: false,
  reason: "Awaiting live weather stream",
  airTempC: null,
  trackTempC: null,
  humidityPct: null,
  pressureMbar: null,
  windSpeedKmh: null,
  windDeg: null,
  rainfallMm: null,
  rainfallProb: null,
  condition: "Unavailable",
  source: "Database Live Storage",
  provenance: "UNAVAILABLE",
  sourceTimestamp: null,
  dataAgeSeconds: null,
  stale: true,
};

type WeatherApiResponse = {
  status: "available" | "unavailable";
  reason?: string;
  session_id?: string;
  weather?: {
    session_id?: string;
    air_temp_c?: number | null;
    track_temp_c?: number | null;
    humidity_pct?: number | null;
    pressure_mbar?: number | null;
    wind_speed_kmh?: number | null;
    wind_dir_deg?: number | null;
    rainfall_mm?: number | null;
    rainfall_prob?: number | null;
    source_timestamp?: string | null;
  } | null;
  source_timestamp?: string | null;
  provenance?: "OPENF1" | "DB" | "STALE" | "UNAVAILABLE";
  data_age_seconds?: number | null;
  stale?: boolean;
};

/**
 * Fetch persisted meteorological telemetry for a session from the backend database.
 */
export async function fetchCircuitWeather(sessionId?: string): Promise<LiveWeatherData> {
  if (!API_URL) {
    return {
      ...UNAVAILABLE_LIVE_WEATHER,
      reason: "API not configured",
    };
  }

  const endpoint = sessionId
    ? `${API_URL}/weather/latest?session_id=${encodeURIComponent(sessionId)}`
    : `${API_URL}/weather/latest`;

  const res = await fetchJson<WeatherApiResponse>(endpoint, {}, { timeoutMs: 3000 });
  if (!res || res.status !== "available" || !res.weather) {
    return {
      ...UNAVAILABLE_LIVE_WEATHER,
      reason: res?.reason || "no_weather_records_for_session",
    };
  }

  const w = res.weather;
  const isRain =
    (w.rainfall_mm != null && w.rainfall_mm > 0) ||
    (w.rainfall_prob != null && w.rainfall_prob > 0.5);
  const condition = isRain ? "Rain on track" : "Track dry";

  return {
    available: true,
    reason: null,
    airTempC: w.air_temp_c != null ? Number(w.air_temp_c.toFixed(1)) : null,
    trackTempC: w.track_temp_c != null ? Number(w.track_temp_c.toFixed(1)) : null,
    humidityPct: w.humidity_pct != null ? Math.round(w.humidity_pct) : null,
    pressureMbar: w.pressure_mbar != null ? Math.round(w.pressure_mbar) : null,
    windSpeedKmh: w.wind_speed_kmh != null ? Number(w.wind_speed_kmh.toFixed(1)) : null,
    windDeg: w.wind_dir_deg != null ? Math.round(w.wind_dir_deg) : null,
    rainfallMm: w.rainfall_mm != null ? Number(w.rainfall_mm.toFixed(2)) : null,
    rainfallProb:
      w.rainfall_prob != null
        ? Number(w.rainfall_prob.toFixed(2))
        : isRain
          ? 1.0
          : 0.0,
    condition,
    source: "Persisted DB Stream",
    provenance: res.provenance || "OPENF1",
    sourceTimestamp: res.source_timestamp || w.source_timestamp || null,
    dataAgeSeconds: res.data_age_seconds ?? null,
    stale: res.stale ?? false,
  };
}

/**
 * React hook for live track weather queried from backend database storage.
 */
export function useLiveWeather(sessionId?: string) {
  const [weather, setWeather] = useState<LiveWeatherData>(UNAVAILABLE_LIVE_WEATHER);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const data = await fetchCircuitWeather(sessionId);
      if (!cancelled) {
        setWeather(data);
        setLoading(false);
      }
    };

    load();
    // Poll persisted live weather every 10 seconds.
    const stop = startPoller(load, 10000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId]);

  return { weather, loading };
}
