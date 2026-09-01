"use client";

import { useEffect, useMemo, useState } from "react";

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
    if (c < 28) return "text-[#38bdf8]";
    if (c < 36) return "text-[#22c55e]";
    if (c < 45) return "text-[#facc15]";
    return "text-[#ef4444]";
  }
  if (c < 18) return "text-[#38bdf8]";
  if (c < 27) return "text-[#22c55e]";
  if (c < 32) return "text-[#facc15]";
  return "text-[#ef4444]";
}

export function WeatherWidget({
  data,
  compact = false,
}: {
  data?: WeatherData;
  compact?: boolean;
}) {
  const d = data ?? DEFAULT_DATA;
  const [liveTrack, setLiveTrack] = useState(d.trackTempC);
  const [liveAir, setLiveAir] = useState(d.airTempC);
  useEffect(() => {
    const iv = setInterval(() => {
      setLiveTrack((v) => Math.max(28, Math.min(48, v + (Math.random() - 0.5) * 0.6)));
      setLiveAir((v) => Math.max(20, Math.min(33, v + (Math.random() - 0.5) * 0.3)));
    }, 3000);
    return () => clearInterval(iv);
  }, []);

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
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
          <h3 className="font-black tracking-tight text-sm">TRACK WEATHER</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">LIVE ENVIRONMENT</span>
        </div>
        <span className="text-[11px] px-2 py-1 rounded-full bg-[#1e293b] border border-[#334155] text-[#94a3b8] font-mono">{d.condition}</span>
      </div>

      {/* main cards */}
      <div className={`grid ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"} gap-2 p-3 bg-[#080c14]`}>
        {/* Track temp */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(400px 200px at 20% 0%, #f59e0b, transparent)" }} />
          <div className="relative">
            <div className="text-[10px] tracking-widest text-[#64748b] font-bold">TRACK TEMP</div>
            <div className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveTrack, true)}`}>
              {liveTrack.toFixed(1)}<span className="text-sm font-bold">°C</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, Math.max(8, ((liveTrack - 20) / 30) * 100))}%`,
                  background: liveTrack > 42 ? "#ef4444" : liveTrack > 36 ? "#eab308" : "#22c55e",
                  boxShadow: liveTrack > 42 ? "0 0 8px rgba(239,68,68,0.6)" : undefined,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-[#475569]"><span>20°C</span><span>50°C</span></div>
          </div>
        </div>

        {/* Air temp */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(400px 200px at 80% 0%, #22c55e, transparent)" }} />
          <div className="relative">
            <div className="text-[10px] tracking-widest text-[#64748b] font-bold">AIR TEMP</div>
            <div className={`mt-1 font-black text-2xl leading-none font-mono ${tempColor(liveAir, false)}`}>
              {liveAir.toFixed(1)}<span className="text-sm font-bold">°C</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, Math.max(8, ((liveAir - 12) / 24) * 100))}%`,
                  background: liveAir > 30 ? "#eab308" : liveAir > 26 ? "#22c55e" : "#38bdf8",
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-[#475569]"><span>12°C</span><span>36°C</span></div>
          </div>
        </div>

        {/* Humidity */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
          <div className="text-[10px] tracking-widest text-[#64748b] font-bold">HUMIDITY</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">{Math.round(d.humidityPct)}</span>
            <span className="text-sm font-bold text-[#94a3b8]">%</span>
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
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${d.humidityPct > 75 ? "bg-[#38bdf8]/10 text-[#7dd3fc] border-[#38bdf8]/30" : d.humidityPct > 55 ? "bg-[#22c55e]/10 text-[#86efac] border-[#22c55e]/20" : "bg-[#eab308]/10 text-[#fde68a] border-[#eab308]/20"}`}>
              {d.humidityPct > 75 ? "Humid" : d.humidityPct > 55 ? "Moderate" : "Dry"}
            </span>
          </div>
        </div>

        {/* Pressure */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
          <div className="text-[10px] tracking-widest text-[#64748b] font-bold">PRESSURE</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-xl font-mono">{Math.round(d.pressureMbar)}</span>
            <span className="text-xs text-[#94a3b8]">mbar</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${d.pressureMbar < 1005 ? "bg-[#ef4444] animate-pulse" : d.pressureMbar > 1018 ? "bg-[#38bdf8]" : "bg-[#22c55e]"}`} />
            <span className="text-[10px] text-[#94a3b8]">{d.pressureMbar < 1005 ? "Low — rain risk" : d.pressureMbar > 1018 ? "High — stable" : "Normal"}</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-[#1e293b] overflow-hidden">
            <div className="h-full bg-[#38bdf8]" style={{ width: `${Math.min(100, Math.max(0, ((d.pressureMbar - 980) / 50) * 100))}%` }} />
          </div>
        </div>

        {/* Wind */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
          <div className="text-[10px] tracking-widest text-[#64748b] font-bold">WIND</div>
          <div className="mt-1 flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-full border border-[#1e293b] bg-[#080c14] flex items-center justify-center shrink-0">
              {/* compass marks */}
              <span className="absolute top-1 text-[7px] font-bold text-[#475569]">N</span>
              <span className="absolute bottom-1 text-[7px] font-bold text-[#475569]">S</span>
              <span className="absolute left-1.5 text-[7px] font-bold text-[#475569]">W</span>
              <span className="absolute right-1.5 text-[7px] font-bold text-[#475569]">E</span>
              {/* arrow — points where wind is going? convention: from. Rotate to windDeg */}
              <div
                className="absolute w-0.5 h-8 bg-gradient-to-t from-[#ef4444] to-[#fca5a5] rounded-full origin-center transition-transform duration-700"
                style={{ transform: `rotate(${d.windDeg}deg)` }}
              >
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#ef4444]" style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-[#e2e8f0] relative z-10" />
            </div>
            <div>
              <div className="font-mono font-black text-lg leading-none">{d.windSpeedKmh.toFixed(1)}<span className="text-xs font-bold text-[#94a3b8]"> km/h</span></div>
              <div className="text-[11px] font-bold text-[#7dd3fc]">{windLabel} • {Math.round(d.windDeg)}°</div>
              <div className="text-[10px] text-[#64748b]">{d.windSpeedKmh > 25 ? "Strong — aero sensitive" : d.windSpeedKmh > 12 ? "Moderate" : "Light"}</div>
            </div>
          </div>
        </div>

        {/* Rain probability */}
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
          <div className="text-[10px] tracking-widest text-[#64748b] font-bold">RAIN PROB</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-black text-2xl font-mono">{Math.round(d.rainfallProb * 100)}</span>
            <span className="text-sm font-bold text-[#94a3b8]">%</span>
            <span className={`ml-2 text-[10px] font-black px-2 py-0.5 rounded-full border ${d.rainfallProb > 0.5 ? "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/30 animate-pulse" : d.rainfallProb > 0.25 ? "bg-[#eab308]/10 text-[#facc15] border-[#eab308]/30" : "bg-[#22c55e]/10 text-[#86efac] border-[#22c55e]/20"}`}>
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
                <span className="text-[7px] font-mono text-[#475569]">+{i}h</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[9px] text-[#475569] font-mono">next 8h • radar</div>
        </div>
      </div>

      {!compact && (
        <div className="px-4 py-2 border-t border-[#1e293b] flex flex-wrap items-center justify-between gap-2 bg-[#080c14] text-[10px]">
          <span className="text-[#475569]">Wind arrow shows origin • Track temp drives tyre warm-up model (Hard + cold = graining).</span>
          <span className="font-mono text-[#64748b]">Δ track { (liveTrack - liveAir).toFixed(1)}°C • Humidity {Math.round(d.humidityPct)}%</span>
        </div>
      )}
    </div>
  );
}

export default WeatherWidget;
