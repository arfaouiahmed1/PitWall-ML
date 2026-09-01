"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DRIVER_FALLBACK, lastName, readableTextColor, useDrivers } from "@/lib/drivers";
import { TelemetryOverlay } from "@/components/TelemetryOverlay";
import { CarSideView, CarTopView } from "@/components/CarRenders";
import type { PerformanceVector } from "@/lib/types";

const RADAR: Record<number, PerformanceVector> = {
  1: { highSpeed: 96, lowSpeed: 88, traction: 91, tyreConservation: 84, energyEfficiency: 78, reliability: 93 },
  4: { highSpeed: 92, lowSpeed: 94, traction: 88, tyreConservation: 90, energyEfficiency: 86, reliability: 89 },
  16: { highSpeed: 89, lowSpeed: 91, traction: 85, tyreConservation: 82, energyEfficiency: 80, reliability: 84 },
  63: { highSpeed: 90, lowSpeed: 87, traction: 86, tyreConservation: 88, energyEfficiency: 88, reliability: 90 },
  44: { highSpeed: 88, lowSpeed: 92, traction: 90, tyreConservation: 93, energyEfficiency: 82, reliability: 91 },
};

function RadarChart({ radar, color }: { radar: PerformanceVector; color: string }) {
  const keys: (keyof PerformanceVector)[] = ["highSpeed", "lowSpeed", "traction", "tyreConservation", "energyEfficiency", "reliability"];
  const labels: Record<string, string> = { highSpeed: "High Spd", lowSpeed: "Low Spd", traction: "Traction", tyreConservation: "Tyre", energyEfficiency: "Energy", reliability: "Reliability" };
  const cx = 90, cy = 90, r = 68;
  const ang = (i: number) => (Math.PI * 2 * i) / keys.length - Math.PI / 2;
  const pt = (v: number, i: number) => {
    const a = ang(i);
    const rad = (v / 100) * r;
    return `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
  };
  const poly = keys.map((k, i) => pt(radar[k], i)).join(" ");
  return (
    <svg viewBox="0 0 180 180" className="w-full h-[180px]">
      {[20, 40, 60, 80, 100].map((lvl) => (
        <polygon key={lvl} points={keys.map((_, i) => pt(lvl, i)).join(" ")} fill="none" stroke="#1e293b" strokeWidth={0.7} />
      ))}
      {keys.map((_, i) => <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(ang(i)) * r} y2={cy + Math.sin(ang(i)) * r} stroke="#1e293b" strokeWidth={0.7} />)}
      <polygon points={poly} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2.2} />
      {keys.map((k, i) => {
        const a = ang(i);
        const x = cx + Math.cos(a) * (r + 16);
        const y = cy + Math.sin(a) * (r + 16);
        return <text key={k} x={x} y={y} fontSize={7} textAnchor="middle" dominantBaseline="middle" fill="#8b9bb4">{labels[k]}</text>;
      })}
    </svg>
  );
}

export function DriverDetailClient({ driverParam }: { driverParam: string }) {
  const num = Number(driverParam ?? "4");
  const drivers = useDrivers();
  const info = useMemo(() => drivers[num] ?? DRIVER_FALLBACK[num] ?? { name: `Driver ${num}`, code: String(num), team: "—", color: "#243447" }, [drivers, num]);
  const radar = RADAR[num] ?? { highSpeed: 82, lowSpeed: 82, traction: 82, tyreConservation: 82, energyEfficiency: 82, reliability: 82 };
  const rival = num === 4 ? 1 : 4;
  const rivalInfo = drivers[rival] ?? DRIVER_FALLBACK[rival];

  // mock stint sparkline
  const laps = Array.from({ length: 12 }, (_, i) => 79.2 + Math.sin(i * 0.8) * 0.4 + i * 0.045 + (Math.random() - 0.5) * 0.2);
  const min = Math.min(...laps), max = Math.max(...laps);
  const path = laps.map((v, i) => `${(i / (laps.length - 1)) * 260},${36 - ((v - min) / (max - min || 1)) * 28}`).join(" L ");

  return (
    <div className="space-y-6">
      <Link href="/drivers" className="inline-flex items-center gap-1.5 text-xs text-[#8b9bb4] hover:text-white">← Back to head-to-head</Link>

      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] overflow-hidden">
        <div className="h-1 w-full" style={{ background: info.color }} />
        <div className="p-6 flex flex-wrap gap-6 items-center justify-between">
          <div className="flex items-center gap-4">
            {info.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.image} alt={info.name} width={64} height={64} referrerPolicy="no-referrer" className="w-16 h-16 rounded-2xl object-cover border border-[#1e293b] bg-[#080c14]" />
            ) : (
              <span className="w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-black border border-[#1e293b]" style={{ background: info.color, color: readableTextColor(info.color) }}>{info.code}</span>
            )}
            <div>
              <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">{info.team.toUpperCase()} • #{num}</div>
              <h1 className="text-2xl font-black tracking-tight">{lastName(info.name).toUpperCase()} <span className="text-[#8b9bb4] font-bold text-lg">• {info.code}</span></h1>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-[#080c14] border border-[#1e293b] font-mono text-[#22c55e]">P1 Contender</span>
                <span className="text-[#8b9bb4] font-mono">Pace: 1:19.28 ± 0.29s</span>
              </div>
            </div>
          </div>
          <div className="w-48 h-16">
            <CarSideView team={info.team} size="md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
            <span className="text-xs font-black tracking-wider uppercase">Performance Latent Dimensions</span>
            <span className="text-[10px] font-mono text-[#8b9bb4]">INDEX 0-100</span>
          </div>
          <RadarChart radar={radar} color={info.color} />
          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs font-mono">
            <div className="p-2 rounded bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4]">High Spd</div>
              <div className="font-bold text-[#22c55e]">{radar.highSpeed}</div>
            </div>
            <div className="p-2 rounded bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4]">Tyre Mgmt</div>
              <div className="font-bold text-[#eab308]">{radar.tyreConservation}</div>
            </div>
            <div className="p-2 rounded bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4]">Energy</div>
              <div className="font-bold text-[#00d2be]">{radar.energyEfficiency}</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl bg-[#0f172a] border border-[#1e293b] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
            <span className="text-xs font-black tracking-wider uppercase">Recent Stint Lap Evolution (S2 / Medium)</span>
            <span className="text-[10px] font-mono text-[#22c55e]">Avg Deg: +0.045s/lap</span>
          </div>
          <div className="h-32 bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex flex-col justify-between">
            <div className="flex justify-between text-[10px] font-mono text-[#8b9bb4]">
              <span>Lap 18 (Fresh)</span>
              <span>Lap 30 (Current)</span>
            </div>
            <svg viewBox="0 0 260 40" className="w-full h-16">
              <path d={`M ${path}`} fill="none" stroke={info.color} strokeWidth={2} />
            </svg>
            <div className="flex justify-between text-[10px] font-mono text-[#8b9bb4]">
              <span>Best: {min.toFixed(2)}s</span>
              <span>Delta: +{(max - min).toFixed(2)}s</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4] uppercase">Speed Trap Max</div>
              <div className="text-lg font-black font-mono mt-1">344.2 <span className="text-xs text-[#8b9bb4] font-normal">km/h</span></div>
            </div>
            <div className="p-3 rounded-lg bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4] uppercase">Brake Intensity</div>
              <div className="text-lg font-black font-mono mt-1 text-[#ef4444]">94.8 <span className="text-xs text-[#8b9bb4] font-normal">bar</span></div>
            </div>
            <div className="p-3 rounded-lg bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4] uppercase">Lift & Coast</div>
              <div className="text-lg font-black font-mono mt-1 text-[#22c55e]">4.2<span className="text-xs text-[#8b9bb4] font-normal">%</span></div>
            </div>
            <div className="p-3 rounded-lg bg-[#080c14] border border-[#1e293b]">
              <div className="text-[10px] text-[#8b9bb4] uppercase">X-Mode Straight</div>
              <div className="text-lg font-black font-mono mt-1 text-[#00d2be]">78.4<span className="text-xs text-[#8b9bb4] font-normal">%</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
          <span className="text-xs font-black tracking-wider uppercase">Head-to-Head Comparison vs Rival ({rivalInfo.code})</span>
          <span className="text-[10px] font-mono text-[#8b9bb4]">Synchronized 100 Hz Telemetry</span>
        </div>
        <TelemetryOverlay driver1Num={num} driver2Num={rival} />
      </div>
    </div>
  );
}
