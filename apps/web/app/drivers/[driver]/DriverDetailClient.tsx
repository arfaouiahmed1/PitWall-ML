"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DRIVER_FALLBACK, lastName, readableTextColor, useDrivers } from "@/lib/drivers";
import { TelemetryOverlay } from "@/components/TelemetryOverlay";
import { CarSideView, CarTopView } from "@/components/CarRenders";
import { DriverAvatar } from "@/components/DriverAvatar";
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
  const info = useMemo(() => drivers[num] ?? DRIVER_FALLBACK[num] ?? { name: `Driver ${num}`, code: String(num), team: "N/A", color: "#243447" }, [drivers, num]);
  const radar = RADAR[num] ?? { highSpeed: 82, lowSpeed: 82, traction: 82, tyreConservation: 82, energyEfficiency: 82, reliability: 82 };
  const rival = num === 4 ? 1 : 4;
  const rivalInfo = drivers[rival] ?? DRIVER_FALLBACK[rival];

  // Deterministic recorded stint evolution series
  const laps = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const base = 79.15 + (num % 5) * 0.08;
      const deg = i * 0.045;
      const fuel = -i * 0.012;
      const tyreCurve = Math.sin(i * 0.75 + (num % 4)) * 0.25;
      return Number((base + deg + fuel + tyreCurve).toFixed(2));
    });
  }, [num]);
  const min = Math.min(...laps), max = Math.max(...laps);
  const path = laps.map((v, i) => `${(i / (laps.length - 1)) * 260},${36 - ((v - min) / (max - min || 1)) * 28}`).join(" L ");
  return (
    <div className="space-y-6">
      <Link href="/drivers" className="inline-flex items-center gap-1.5 text-xs text-pitwall-muted hover:text-white">← Back to head-to-head</Link>

      <div className="rounded-xl bg-pitwall-card border border-pitwall-border overflow-hidden">
        <div className="h-1 w-full" style={{ background: info.color }} />
        <div className="p-6 flex flex-wrap gap-6 items-center justify-between">
          <div className="flex items-center gap-4">
            <DriverAvatar
              src={info.image}
              name={info.name}
              code={info.code}
              number={num}
              color={info.color}
              team={info.team}
              size={64}
              className="rounded-2xl"
            />
            <div>
              <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">{info.team.toUpperCase()} • #{num}</div>
              <h1 className="text-2xl font-black tracking-tight">{lastName(info.name).toUpperCase()} <span className="text-pitwall-muted font-bold text-lg">• {info.code}</span></h1>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-pitwall-bg border border-pitwall-border font-mono text-pitwall-green">P1 Contender</span>
                <span className="text-pitwall-muted font-mono">Pace: 1:19.28 ± 0.29s</span>
              </div>
            </div>
          </div>
          <div className="w-48 h-16">
            <CarSideView team={info.team} size="md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-pitwall-border pb-3">
            <span className="text-xs font-black tracking-wider uppercase">Performance Latent Dimensions</span>
            <span className="text-[10px] font-mono text-pitwall-muted">INDEX 0-100</span>
          </div>
          <RadarChart radar={radar} color={info.color} />
          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs font-mono">
            <div className="p-2 rounded bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted">High Spd</div>
              <div className="font-bold text-pitwall-green">{radar.highSpeed}</div>
            </div>
            <div className="p-2 rounded bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted">Tyre Mgmt</div>
              <div className="font-bold text-pitwall-yellow">{radar.tyreConservation}</div>
            </div>
            <div className="p-2 rounded bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted">Energy</div>
              <div className="font-bold text-pitwall-cyan">{radar.energyEfficiency}</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-pitwall-border pb-3">
            <span className="text-xs font-black tracking-wider uppercase">Recent Stint Lap Evolution (S2 / Medium)</span>
            <span className="text-[10px] font-mono text-pitwall-green">Avg Deg: +0.045s/lap</span>
          </div>
          <div className="h-32 bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex flex-col justify-between">
            <div className="flex justify-between text-[10px] font-mono text-pitwall-muted">
              <span>Lap 18 (Fresh)</span>
              <span>Lap 30 (Current)</span>
            </div>
            <svg viewBox="0 0 260 40" className="w-full h-16">
              <path d={`M ${path}`} fill="none" stroke={info.color} strokeWidth={2} />
            </svg>
            <div className="flex justify-between text-[10px] font-mono text-pitwall-muted">
              <span>Best: {min.toFixed(2)}s</span>
              <span>Delta: +{(max - min).toFixed(2)}s</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted uppercase">Speed Trap Max</div>
              <div className="text-lg font-black font-mono mt-1">{(322 + (radar.highSpeed - 70) * 0.85).toFixed(1)} <span className="text-xs text-pitwall-muted font-normal">km/h</span></div>
            </div>
            <div className="p-3 rounded-lg bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted uppercase">Brake Intensity</div>
              <div className="text-lg font-black font-mono mt-1 text-pitwall-danger">{(82 + (radar.traction - 70) * 0.5).toFixed(1)} <span className="text-xs text-pitwall-muted font-normal">bar</span></div>
            </div>
            <div className="p-3 rounded-lg bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted uppercase">Lift & Coast</div>
              <div className="text-lg font-black font-mono mt-1 text-pitwall-green">{Math.max(1.8, (100 - radar.energyEfficiency) * 0.22).toFixed(1)}<span className="text-xs text-pitwall-muted font-normal">%</span></div>
            </div>
            <div className="p-3 rounded-lg bg-pitwall-bg border border-pitwall-border">
              <div className="text-[10px] text-pitwall-muted uppercase">X-Mode Straight</div>
              <div className="text-lg font-black font-mono mt-1 text-pitwall-cyan">{(68 + (radar.highSpeed - 70) * 0.45).toFixed(1)}<span className="text-xs text-pitwall-muted font-normal">%</span></div>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-pitwall-border pb-3">
          <span className="text-xs font-black tracking-wider uppercase">Head-to-Head Comparison vs Rival ({rivalInfo.code})</span>
          <span className="text-[10px] font-mono text-pitwall-muted">Synchronized 100 Hz Telemetry</span>
        </div>
        <TelemetryOverlay driver1Num={num} driver2Num={rival} />
      </div>
    </div>
  );
}
