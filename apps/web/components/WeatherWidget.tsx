"use client";

import { useMemo } from "react";
import { useLiveWeather } from "@/lib/liveWeather";

export type WeatherData = {
  available?: boolean;
  reason?: string | null;
  airTempC: number | null;
  trackTempC: number | null;
  humidityPct: number | null;
  pressureMbar: number | null;
  windSpeedKmh: number | null;
  windDeg: number | null; // 0=N, 90=E
  rainfallProb: number | null; // 0-1
  rainfallMm?: number | null;
  precipHours?: number[];
  condition?: string;
  source?: string;
  provenance?: string;
  sourceTimestamp?: string | null;
  stale?: boolean;
};

function tempColor(c: number, isTrack: boolean): string {
  if (isTrack) {
    if (c < 28) return "text-pitwall-cyan";
    if (c < 36) return "text-pitwall-green";
    if (c < 45) return "text-pitwall-amberlight";
    return "text-pitwall-danger";
  }
  if (c < 18) return "text-pitwall-cyan";
  if (c < 27) return "text-pitwall-green";
  if (c < 32) return "text-pitwall-amberlight";
  return "text-pitwall-danger";
}

export function WeatherWidget({
  circuitId = "barcelona",
  data,
  compact = false,
}: {
  circuitId?: string;
  data?: WeatherData;
  compact?: boolean;
}) {
  const { weather, loading } = useLiveWeather(circuitId);
  const d: WeatherData = data ?? weather;

  const isAvailable = Boolean(
    d.available !== false &&
    d.trackTempC !== null &&
    d.airTempC !== null &&
    !Number.isNaN(d.trackTempC) &&
    !Number.isNaN(d.airTempC)
  );

  const liveTrack = d.trackTempC ?? 0;
  const liveAir = d.airTempC ?? 0;
  const liveHumidity = d.humidityPct != null ? Math.round(d.humidityPct) : null;
  const livePressure = d.pressureMbar != null ? Math.round(d.pressureMbar) : null;
  const liveWindSpeed = d.windSpeedKmh != null ? Number(d.windSpeedKmh.toFixed(1)) : null;
  const liveWindDeg = d.windDeg != null ? Math.round(d.windDeg) : 0;
  const liveRainProb = d.rainfallProb != null ? Math.round(d.rainfallProb * 100) : null;

  const windLabel = useMemo(() => {
    if (d.windDeg == null) return "N/A";
    const deg = ((d.windDeg % 360) + 360) % 360;
    if (deg < 22.5 || deg >= 337.5) return "N";
    if (deg < 67.5) return "NE";
    if (deg < 112.5) return "E";
    if (deg < 157.5) return "SE";
    if (deg < 202.5) return "S";
    if (deg < 247.5) return "SW";
    if (deg < 292.5) return "W";
    return "NW";
  }, [d.windDeg]);

  if (!isAvailable) {
    return (
      <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-pitwall-steel" />
            <h3 className="font-black tracking-tight text-sm">TRACK WEATHER</h3>
            <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-steel font-mono">
              {d.source || "Database Storage"}
            </span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-pitwall-border border border-pitwall-steel text-pitwall-fog font-mono">
            {loading ? "FETCHING" : "UNAVAILABLE"}
          </span>
        </div>
        <div className="p-6 text-center text-pitwall-muted">
          <div className="text-xs font-mono font-bold uppercase tracking-wider text-pitwall-steel">
            NO PERSISTED WEATHER RECORDED
          </div>
          <p className="text-[11px] mt-1 text-pitwall-fog">
            {d.reason || "Awaiting live atmospheric stream or active session telemetry"}
          </p>
          {d.sourceTimestamp && (
            <div className="mt-2 text-[10px] font-mono text-pitwall-steel">
              Last observed: {d.sourceTimestamp}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${d.stale ? "bg-pitwall-yellow" : "bg-pitwall-cyan animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.6)]"}`}
          />
          <h3 className="font-black tracking-tight text-sm">TRACK WEATHER</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-green font-mono flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${d.stale ? "bg-pitwall-yellow" : "bg-pitwall-green animate-pulse"}`}
            />
            {d.source || "Persisted DB Stream"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {d.stale && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-pitwall-yellow/20 text-pitwall-amberlight border border-pitwall-yellow/30 font-mono">
              STALE
            </span>
          )}
          <span className="text-[11px] px-2 py-1 rounded-full bg-pitwall-border border border-pitwall-steel text-pitwall-fog font-mono">
            {d.condition || "Recorded"}
          </span>
        </div>
      </div>

      <div
        className={`grid ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"} gap-2 p-3 bg-pitwall-bg`}
      >
        {/* Track temp */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3 relative overflow-hidden">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">TRACK TEMP</div>
          <div
            className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveTrack, true)}`}
          >
            {liveTrack.toFixed(1)}
            <span className="text-sm font-bold">°C</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-pitwall-border overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.max(8, ((liveTrack - 20) / 30) * 100))}%`,
                background: liveTrack > 42 ? "#ef4444" : liveTrack > 36 ? "#eab308" : "#22c55e",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-mono text-pitwall-steel">
            <span>20°C</span>
            <span>50°C</span>
          </div>
        </div>

        {/* Air temp */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3 relative overflow-hidden">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">AIR TEMP</div>
          <div
            className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveAir, false)}`}
          >
            {liveAir.toFixed(1)}
            <span className="text-sm font-bold">°C</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-pitwall-border overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.max(8, ((liveAir - 12) / 24) * 100))}%`,
                background: liveAir > 30 ? "#eab308" : liveAir > 26 ? "#22c55e" : "#38bdf8",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-mono text-pitwall-steel">
            <span>12°C</span>
            <span>36°C</span>
          </div>
        </div>

        {/* Humidity */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">HUMIDITY</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">
              {liveHumidity != null ? liveHumidity : "N/A"}
            </span>
            <span className="text-sm font-bold text-pitwall-fog">%</span>
          </div>
        </div>

        {/* Pressure */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">PRESSURE</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-xl font-mono">
              {livePressure != null ? livePressure : "N/A"}
            </span>
            <span className="text-xs text-pitwall-fog">mbar</span>
          </div>
        </div>

        {/* Wind */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">WIND</div>
          <div className="mt-1 flex items-center gap-3">
            <div>
              <div className="font-mono font-black text-lg leading-none">
                {liveWindSpeed != null ? liveWindSpeed : "N/A"}
                <span className="text-xs font-bold text-pitwall-fog"> km/h</span>
              </div>
              <div className="text-[11px] font-bold text-pitwall-cyan mt-1">
                {windLabel} • {liveWindDeg}°
              </div>
            </div>
          </div>
        </div>

        {/* Rain probability */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">RAIN PROB</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">
              {liveRainProb != null ? liveRainProb : "N/A"}
            </span>
            <span className="text-sm font-bold text-pitwall-fog">%</span>
          </div>
          {d.rainfallMm != null && (
            <div className="mt-1 text-[10px] font-mono text-pitwall-steel">
              Rainfall: {d.rainfallMm.toFixed(2)} mm
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="px-4 py-2 border-t border-pitwall-border flex flex-wrap items-center justify-between gap-2 bg-pitwall-bg text-[10px]">
          <span className="text-pitwall-steel">
            Track temp drives tyre warm-up model (Hard + cold = graining).
          </span>
          <span className="font-mono text-pitwall-muted">
            Δ track {(liveTrack - liveAir).toFixed(1)}°C • Source: {d.source || "Persisted DB"}
          </span>
        </div>
      )}
    </div>
  );
}

export default WeatherWidget;
