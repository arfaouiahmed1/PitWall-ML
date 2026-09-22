"use client";

import { useMemo } from "react";
import { useLiveWeather, type LiveWeatherData } from "@/lib/liveWeather";

export type WeatherData = {
  airTempC: number;
  trackTempC: number;
  humidityPct: number;
  pressureMbar: number;
  windSpeedKmh: number;
  windDeg: number; // 0=N, 90=E
  rainfallProb: number; // 0-1
  // hourly precip 0-1 for radar
  precipHours?: number[];
  condition?: string;
};

const DEFAULT_DATA: WeatherData = {
  airTempC: 26.1,
  trackTempC: 38.4,
  humidityPct: 58,
  pressureMbar: 1012,
  windSpeedKmh: 12.4,
  windDeg: 215,
  rainfallProb: 0.18,
  precipHours: [0.05, 0.08, 0.12, 0.18, 0.22, 0.15, 0.08, 0.04],
  condition: "Partly cloudy",
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
  const { weather } = useLiveWeather(circuitId);
  const d = data ?? weather;
  const liveTrack = d.trackTempC;
  const liveAir = d.airTempC;

  const precip = d.precipHours ?? DEFAULT_DATA.precipHours!;
  const maxPrecip = Math.max(...precip, 0.25);

  const windLabel = useMemo(() => {
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

  return (
    <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-pitwall-cyan animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
          <h3 className="font-black tracking-tight text-sm">TRACK WEATHER</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-green font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-pitwall-green animate-pulse" />
            {weather.source}
          </span>
        </div>
        <span className="text-[11px] px-2 py-1 rounded-full bg-pitwall-border border border-pitwall-steel text-pitwall-fog font-mono">{d.condition}</span>
      </div>

      {/* main cards */}
      <div className={`grid ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"} gap-2 p-3 bg-pitwall-bg`}>
        {/* Track temp */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(400px 200px at 20% 0%, #f59e0b, transparent)" }} />
          <div className="relative">
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">TRACK TEMP</div>
            <div className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveTrack, true)}`}>
              {liveTrack.toFixed(1)}<span className="text-sm font-bold">°C</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-pitwall-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, Math.max(8, ((liveTrack - 20) / 30) * 100))}%`,
                  background: liveTrack > 42 ? "#ef4444" : liveTrack > 36 ? "#eab308" : "#22c55e",
                  boxShadow: liveTrack > 42 ? "0 0 8px rgba(239,68,68,0.6)" : undefined,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-pitwall-steel"><span>20°C</span><span>50°C</span></div>
          </div>
        </div>

        {/* Air temp */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(400px 200px at 80% 0%, #22c55e, transparent)" }} />
          <div className="relative">
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">AIR TEMP</div>
            <div className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveAir, false)}`}>
              {liveAir.toFixed(1)}<span className="text-sm font-bold">°C</span>
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
            <div className="mt-1 flex justify-between text-[9px] font-mono text-pitwall-steel"><span>12°C</span><span>36°C</span></div>
          </div>
        </div>

        {/* Humidity */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">HUMIDITY</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">{Math.round(d.humidityPct)}</span>
            <span className="text-sm font-bold text-pitwall-fog">%</span>
          </div>
          {/* circular ring */}
          <div className="mt-2 flex items-center gap-3">
            <div className="relative w-10 h-10">
              <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                <circle cx={18} cy={18} r={14} fill="none" stroke="#1e293b" strokeWidth={4} />
                <circle
                  cx={18}
                  cy={18}
                  r={14}
                  fill="none"
                  stroke={d.humidityPct > 75 ? "#38bdf8" : d.humidityPct > 55 ? "#22c55e" : "#eab308"}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeDasharray={`${(d.humidityPct / 100) * 87.9} 87.9`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black">RH</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${d.humidityPct > 75 ? "bg-pitwall-cyan/10 text-pitwall-cyan border-pitwall-cyan/30" : d.humidityPct > 55 ? "bg-pitwall-green/10 text-pitwall-mint border-pitwall-green/20" : "bg-pitwall-yellow/10 text-pitwall-amberlight border-pitwall-yellow/20"}`}>
              {d.humidityPct > 75 ? "Humid" : d.humidityPct > 55 ? "Moderate" : "Dry"}
            </span>
          </div>
        </div>

        {/* Pressure */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">PRESSURE</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-xl font-mono">{Math.round(d.pressureMbar)}</span>
            <span className="text-xs text-pitwall-fog">mbar</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${d.pressureMbar < 1005 ? "bg-pitwall-danger animate-pulse" : d.pressureMbar > 1018 ? "bg-pitwall-cyan" : "bg-pitwall-green"}`} />
            <span className="text-[10px] text-pitwall-fog">{d.pressureMbar < 1005 ? "Low : rain risk" : d.pressureMbar > 1018 ? "High : stable" : "Normal"}</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-pitwall-border overflow-hidden">
            <div className="h-full bg-pitwall-cyan" style={{ width: `${Math.min(100, Math.max(0, ((d.pressureMbar - 980) / 50) * 100))}%` }} />
          </div>
        </div>

        {/* Wind */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">WIND</div>
          <div className="mt-1 flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-full border border-pitwall-border bg-pitwall-bg flex items-center justify-center shrink-0">
              {/* compass marks */}
              <span className="absolute top-1 text-[7px] font-bold text-pitwall-steel">N</span>
              <span className="absolute bottom-1 text-[7px] font-bold text-pitwall-steel">S</span>
              <span className="absolute left-1.5 text-[7px] font-bold text-pitwall-steel">W</span>
              <span className="absolute right-1.5 text-[7px] font-bold text-pitwall-steel">E</span>
              {/* arrow : points where wind is going */}
              <div
                className="absolute w-0.5 h-8 bg-gradient-to-t from-pitwall-danger to-[#fca5a5] rounded-full origin-center transition-transform duration-700"
                style={{ transform: `rotate(${d.windDeg}deg)` }}
              >
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-pitwall-danger" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-pitwall-ink relative z-10" />
            </div>
            <div>
              <div className="font-mono font-black text-lg leading-none">{d.windSpeedKmh.toFixed(1)}<span className="text-xs font-bold text-pitwall-fog"> km/h</span></div>
              <div className="text-[11px] font-bold text-pitwall-cyan">{windLabel} • {Math.round(d.windDeg)}°</div>
              <div className="text-[10px] text-pitwall-muted">{d.windSpeedKmh > 25 ? "Strong : aero sensitive" : d.windSpeedKmh > 12 ? "Moderate" : "Light"}</div>
            </div>
          </div>
        </div>

        {/* Rain probability */}
        <div className="rounded-xl border border-pitwall-border bg-pitwall-card p-3">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">RAIN PROB</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">{Math.round(d.rainfallProb * 100)}</span>
            <span className="text-sm font-bold text-pitwall-fog">%</span>
            <span className={`ml-2 text-[10px] font-black px-2 py-0.5 rounded-full border ${d.rainfallProb > 0.5 ? "bg-pitwall-cyan/15 text-pitwall-cyan border-pitwall-cyan/30 animate-pulse" : d.rainfallProb > 0.25 ? "bg-pitwall-yellow/10 text-pitwall-amberlight border-pitwall-yellow/30" : "bg-pitwall-green/10 text-pitwall-mint border-pitwall-green/20"}`}>
              {d.rainfallProb > 0.5 ? "High" : d.rainfallProb > 0.25 ? "Medium" : "Low"}
            </span>
          </div>
          {/* mini radar */}
          <div className="mt-3 flex items-end gap-1 h-10">
            {precip.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${Math.max(4, (v / maxPrecip) * 32)}px`,
                    background: v > 0.18 ? "#38bdf8" : v > 0.1 ? "#7dd3fc" : "#1e293b",
                    opacity: v > 0.05 ? 1 : 0.5,
                    boxShadow: v > 0.18 ? "0 0 6px rgba(56,189,248,0.5)" : undefined,
                  }}
                />
                <span className="text-[7px] font-mono text-pitwall-steel">+{i}h</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[9px] text-pitwall-steel font-mono">next 8h • radar</div>
        </div>
      </div>

      {!compact && (
        <div className="px-4 py-2 border-t border-pitwall-border flex flex-wrap items-center justify-between gap-2 bg-pitwall-bg text-[10px]">
          <span className="text-pitwall-steel">Wind arrow shows origin • Track temp drives tyre warm-up model (Hard + cold = graining).</span>
          <span className="font-mono text-pitwall-muted">Δ track { (liveTrack - liveAir).toFixed(1)}°C • Humidity {Math.round(d.humidityPct)}%</span>
        </div>
      )}
    </div>
  );
}

export default WeatherWidget;
