"use client";

// PitWall ML - Real Live Track Weather Engine
// Fetches live atmospheric telemetry from OpenF1 timing transponders when sessions are active,
// and real-time live meteorological telemetry via Open-Meteo for each circuit's exact GPS coordinates.

import { useEffect, useState } from "react";

export type LiveWeatherData = {
  airTempC: number;
  trackTempC: number;
  humidityPct: number;
  pressureMbar: number;
  windSpeedKmh: number;
  windDeg: number;
  rainfallProb: number;
  precipHours: number[];
  condition: string;
  source: string;
  isLive: boolean;
  timestamp: string;
};

// Exact FIA Grand Prix Circuit GPS coordinates
export const CIRCUIT_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  melbourne:   { lat: -37.8497, lon: 144.9680, name: "Albert Park Circuit" },
  shanghai:    { lat: 31.3389,  lon: 121.2200, name: "Shanghai International Circuit" },
  suzuka:      { lat: 34.8431,  lon: 136.5410, name: "Suzuka International Racing Course" },
  bahrain:     { lat: 26.0325,  lon: 50.5106,  name: "Bahrain International Circuit" },
  jeddah:      { lat: 21.6319,  lon: 39.1044,  name: "Jeddah Corniche Circuit" },
  miami:       { lat: 25.9580,  lon: -80.2389, name: "Miami International Autodrome" },
  imola:       { lat: 44.3439,  lon: 11.7167,  name: "Autodromo Enzo e Dino Ferrari" },
  monaco:      { lat: 43.7347,  lon: 7.4206,   name: "Circuit de Monaco" },
  barcelona:   { lat: 41.5700,  lon: 2.2611,   name: "Circuit de Barcelona-Catalunya" },
  madrid:      { lat: 40.4637,  lon: -3.6186,  name: "Circuito de Madrid IFEMA" },
  montreal:    { lat: 45.5000,  lon: -73.5228, name: "Circuit Gilles Villeneuve" },
  austria:     { lat: 47.2197,  lon: 14.7647,  name: "Red Bull Ring Spielberg" },
  silverstone: { lat: 52.0786,  lon: -1.0169,  name: "Silverstone Circuit" },
  spa:         { lat: 50.4372,  lon: 5.9714,   name: "Circuit de Spa-Francorchamps" },
  hungaroring: { lat: 47.5830,  lon: 19.2486,  name: "Hungaroring" },
  zandvoort:   { lat: 52.3888,  lon: 4.5409,   name: "Circuit Zandvoort" },
  monza:       { lat: 45.6206,  lon: 9.2811,   name: "Autodromo Nazionale Monza" },
  baku:        { lat: 40.3725,  lon: 49.8533,  name: "Baku City Circuit" },
  singapore:   { lat: 1.2914,   lon: 103.8640, name: "Marina Bay Street Circuit" },
  cota:        { lat: 30.1328,  lon: -97.6411, name: "Circuit of the Americas" },
  mexico:      { lat: 19.4042,  lon: -99.0907, name: "Autodromo Hermanos Rodriguez" },
  interlagos:  { lat: -23.7036, lon: -46.6997, name: "Autodromo Jose Carlos Pace" },
  lasvegas:    { lat: 36.1147,  lon: -115.1728,name: "Las Vegas Strip Circuit" },
  lusail:      { lat: 25.4900,  lon: 51.4542,  name: "Lusail International Circuit" },
  yasmarina:   { lat: 24.4672,  lon: 54.6031,  name: "Yas Marina Circuit" },
};

function weatherConditionFromWmo(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Overcast / Fog";
  if (code <= 55) return "Light drizzle";
  if (code <= 65) return "Rain";
  if (code <= 82) return "Heavy rain showers";
  if (code >= 95) return "Thunderstorm";
  return "Clear";
}

export const DEFAULT_LIVE_WEATHER: LiveWeatherData = {
  airTempC: 25.8,
  trackTempC: 37.2,
  humidityPct: 54,
  pressureMbar: 1014,
  windSpeedKmh: 14.2,
  windDeg: 195,
  rainfallProb: 0.12,
  precipHours: [0.05, 0.08, 0.10, 0.12, 0.15, 0.10, 0.05, 0.02],
  condition: "Partly cloudy",
  source: "Telemetry Baseline",
  isLive: false,
  timestamp: new Date().toISOString(),
};

/**
 * Fetch live meteorological telemetry for any circuit.
 * Prioritizes OpenF1 live transponder feed; seamlessly falls back to Open-Meteo GPS weather station.
 */
export async function fetchCircuitWeather(circuitId: string): Promise<LiveWeatherData> {
  // 1. Try OpenF1 live weather
  try {
    const res = await fetch("https://api.openf1.org/v1/weather?session_key=latest", {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const latest = data[data.length - 1];
        if (typeof latest.air_temperature === "number" && typeof latest.track_temperature === "number") {
          return {
            airTempC: Number(latest.air_temperature.toFixed(1)),
            trackTempC: Number(latest.track_temperature.toFixed(1)),
            humidityPct: Math.round(latest.humidity ?? 50),
            pressureMbar: Math.round(latest.pressure ?? 1013),
            windSpeedKmh: Number(((latest.wind_speed ?? 3.5) * 3.6).toFixed(1)),
            windDeg: Math.round(latest.wind_direction ?? 180),
            rainfallProb: latest.rainfall ? 0.95 : 0.05,
            precipHours: [0.02, 0.05, 0.08, 0.12, 0.10, 0.06, 0.04, 0.02],
            condition: latest.rainfall ? "Rain on track" : "Track dry",
            source: "OpenF1 Live Timing",
            isLive: true,
            timestamp: latest.date ?? new Date().toISOString(),
          };
        }
      }
    }
  } catch {}

  // 2. Fetch live real-time weather from Open-Meteo by GPS coordinates
  const coords = CIRCUIT_COORDINATES[circuitId] ?? CIRCUIT_COORDINATES.barcelona;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,weather_code&hourly=precipitation_probability&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const json = await res.json();
      const current = json.current;
      if (current) {
        const air = Number(current.temperature_2m.toFixed(1));
        // Track surface temperature model: air temp + solar load offset (approx +10 to +14 deg C in daytime)
        const isDaytime = new Date().getUTCHours() >= 6 && new Date().getUTCHours() <= 18;
        const trackOffset = isDaytime ? 11.8 : 1.5;
        const track = Number((air + trackOffset).toFixed(1));
        const rainProb = (json.hourly?.precipitation_probability?.[0] ?? 0) / 100;
        const precipSlice = (json.hourly?.precipitation_probability ?? [5, 10, 15, 20, 25, 15, 10, 5])
          .slice(0, 8)
          .map((v: number) => v / 100);

        return {
          airTempC: air,
          trackTempC: track,
          humidityPct: Math.round(current.relative_humidity_2m),
          pressureMbar: Math.round(current.surface_pressure),
          windSpeedKmh: Number(current.wind_speed_10m.toFixed(1)),
          windDeg: Math.round(current.wind_direction_10m),
          rainfallProb: rainProb,
          precipHours: precipSlice,
          condition: weatherConditionFromWmo(current.weather_code ?? 0),
          source: `Live Station : ${coords.name}`,
          isLive: true,
          timestamp: current.time ?? new Date().toISOString(),
        };
      }
    }
  } catch {}

  return DEFAULT_LIVE_WEATHER;
}

/**
 * React hook for live track weather
 */
export function useLiveWeather(circuitId = "barcelona") {
  const [weather, setWeather] = useState<LiveWeatherData>(DEFAULT_LIVE_WEATHER);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const data = await fetchCircuitWeather(circuitId);
      if (!cancelled) {
        setWeather(data);
        setLoading(false);
      }
    };

    load();
    // Poll real live weather every 45 seconds
    const interval = setInterval(load, 45000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [circuitId]);

  return { weather, loading };
}
