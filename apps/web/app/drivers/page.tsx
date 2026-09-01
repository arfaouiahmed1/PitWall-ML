"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DRIVER_FALLBACK, useDrivers } from "@/lib/drivers";
import { TelemetryOverlay } from "@/components/TelemetryOverlay";
import { CarTopView } from "@/components/CarRenders";

type Radar = { highSpeed: number; lowSpeed: number; traction: number; tyreConservation: number; energyEfficiency: number; reliability: number };
const RADAR_MOCK: Record<number, Radar> = {
  1: { highSpeed: 96, lowSpeed: 88, traction: 91, tyreConservation: 84, energyEfficiency: 78, reliability: 93 },
  4: { highSpeed: 92, lowSpeed: 94, traction: 88, tyreConservation: 90, energyEfficiency: 86, reliability: 89 },
  16: { highSpeed: 89, lowSpeed: 91, traction: 85, tyreConservation: 82, energyEfficiency: 80, reliability: 84 },
  63: { highSpeed: 90, lowSpeed: 87, traction: 86, tyreConservation: 88, energyEfficiency: 88, reliability: 90 },
  44: { highSpeed: 88, lowSpeed: 92, traction: 90, tyreConservation: 93, energyEfficiency: 82, reliability: 91 },
  81: { highSpeed: 91, lowSpeed: 90, traction: 87, tyreConservation: 86, energyEfficiency: 84, reliability: 88 },
  55: { highSpeed: 87, lowSpeed: 85, traction: 84, tyreConservation: 80, energyEfficiency: 79, reliability: 82 },
  12: { highSpeed: 85, lowSpeed: 83, traction: 82, tyreConservation: 78, energyEfficiency: 81, reliability: 80 },
};

function RadarChart({ radar, color }: { radar: Radar; color: string }) {
  const keys: (keyof Radar)[] = ["highSpeed", "lowSpeed", "traction", "tyreConservation", "energyEfficiency", "reliability"];
  const labels: Record<string, string> = { highSpeed: "High Spd", lowSpeed: "Low Spd", traction: "Traction", tyreConservation: "Tyre", energyEfficiency: "Energy", reliability: "Reliability" };
  const cx = 80, cy = 80, r = 62;
  const angle = (i: number) => (Math.PI * 2 * i) / keys.length - Math.PI / 2;
  const point = (value: number, i: number) => {
    const a = angle(i);
    const rad = (value / 100) * r;
    return `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
  };
  const polygon = keys.map((k, i) => point(radar[k], i)).join(" ");
  const gridLevels = [20, 40, 60, 80, 100];
  return (
    <svg viewBox="0 0 160 160" className="w-full h-[160px]">
      {gridLevels.map((lvl) => (
        <polygon key={lvl} points={keys.map((_, i) => point(lvl, i)).join(" ")} fill="none" stroke="#1e293b" strokeWidth={0.8} opacity={0.7} />
      ))}
      {keys.map((_, i) => {
        const a = angle(i);
        return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="#1e293b" strokeWidth={0.8} />;
      })}
      <polygon points={polygon} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2} />
      {keys.map((k, i) => {
        const a = angle(i);
        const x = cx + Math.cos(a) * (r + 14);
        const y = cy + Math.sin(a) * (r + 14);
        return <text key={k} x={x} y={y} fontSize={6.5} textAnchor="middle" dominantBaseline="middle" fill="#8b9bb4">{labels[k]}</text>;
      })}
    </svg>
  );
}

export default function DriversPage() {
  const liveDrivers = useDrivers();
  const all = useMemo(() => {
    const merged: Record<number, { name: string; code: string; team: string; color: string; image?: string }> = { ...(DRIVER_FALLBACK as unknown as Record<number, { name: string; code: string; team: string; color: string; image?: string }>) };
    for (const [k, v] of Object.entries(liveDrivers)) merged[Number(k)] = v;
    return Object.entries(merged)
      .map(([num, info]) => ({ num: Number(num), info }))
      .sort((a, b) => a.num - b.num);
  }, [liveDrivers]);

  const [a, setA] = useState(4);
  const [b, setB] = useState(1);

  const infoA = all.find((x) => x.num === a)?.info ?? DRIVER_FALLBACK[a];
  const infoB = all.find((x) => x.num === b)?.info ?? DRIVER_FALLBACK[b];
  const radarA = RADAR_MOCK[a] ?? { highSpeed: 82, lowSpeed: 82, traction: 82, tyreConservation: 82, energyEfficiency: 82, reliability: 82 };
  const radarB = RADAR_MOCK[b] ?? { highSpeed: 78, lowSpeed: 78, traction: 78, tyreConservation: 78, energyEfficiency: 78, reliability: 78 };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <h1 className="text-xl font-black tracking-tight">DRIVER TELEMETRY • HEAD-TO-HEAD</h1>
        <p className="text-xs text-[#8b9bb4] mt-1">Dual-driver speed • throttle • brake • gear • DRS / X-Mode overlay + PerformanceVector radar. Click a driver card to open detail.</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 space-y-3">
          <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">SELECT DRIVERS</div>
          <div className="space-y-2 max-h-[560px] overflow-auto pr-1">
            {all.map((d) => (
              <button
                key={d.num}
                onClick={() => {
                  if (a === d.num || b === d.num) return;
                  // alternate assignment: keep a fixed, move b, then toggle
                  if (Math.abs(d.num - a) < Math.abs(d.num - b)) setB(d.num);
                  else setA(d.num);
                }}
                className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition ${d.num === a || d.num === b ? "bg-[#080c14] border-[#ff1801]/40 shadow-[0_0_10px_rgba(255,24,1,0.15)]" : "bg-[#0f172a] border-[#1e293b] hover:border-[#243447]"}`}
              >
                <span className="w-1 h-10 rounded-full" style={{ background: d.info.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black font-mono">{d.info.code} <span className="text-[#8b9bb4] font-normal">#{d.num}</span> {(d.num === a || d.num === b) && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-[#ff1801] text-white">{d.num === a ? "A" : "B"}</span>}</div>
                  <div className="text-[11px] text-[#8b9bb4] truncate">{d.info.name} • {d.info.team}</div>
                </div>
                <CarTopView team={d.info.team} size={36} />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select value={a} onChange={(e) => setA(Number(e.target.value))} className="flex-1 bg-[#080c14] border border-[#1e293b] rounded-lg px-2 py-2 text-xs font-mono">
              {all.map((d) => <option key={d.num} value={d.num}>{d.info.code} #{d.num}</option>)}
            </select>
            <span className="self-center text-[#5a6b84] text-xs">vs</span>
            <select value={b} onChange={(e) => setB(Number(e.target.value))} className="flex-1 bg-[#080c14] border border-[#1e293b] rounded-lg px-2 py-2 text-xs font-mono">
              {all.map((d) => <option key={d.num} value={d.num}>{d.info.code} #{d.num}</option>)}
            </select>
          </div>
          <Link href={`/drivers/${a}`} className="block text-center text-xs font-bold py-2 rounded-lg bg-[#1e293b] text-[#8b9bb4] border border-[#243447] hover:text-white">Open {infoA?.code ?? a} detail →</Link>
        </div>

        <div className="col-span-12 lg:col-span-9 space-y-4">
          <TelemetryOverlay driverA={a} driverB={b} />

          <div className="grid grid-cols-2 gap-4">
            {[
              { info: infoA, radar: radarA, label: "A" },
              { info: infoB, radar: radarB, label: "B" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ background: x.info?.color ?? "#243447" }}>{x.info?.code ?? x.label}</span>
                  <div>
                    <div className="text-sm font-black">{x.info?.name ?? `Driver ${x.label}`} <span className="text-[#8b9bb4] font-normal text-xs">#{x.label === "A" ? a : b}</span></div>
                    <div className="text-[11px] text-[#8b9bb4]">{x.info?.team}</div>
                  </div>
                  <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-[#080c14] border border-[#1e293b] font-mono">{x.label}</span>
                </div>
                <div className="mt-3 bg-[#080c14] rounded-lg border border-[#1e293b] p-2">
                  <RadarChart radar={x.radar} color={x.info?.color ?? "#ff8000"} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                  <div className="bg-[#080c14] border border-[#1e293b] rounded px-2 py-1 text-center"><div className="text-[#8b9bb4]">High Spd</div><div className="font-bold">{x.radar.highSpeed}</div></div>
                  <div className="bg-[#080c14] border border-[#1e293b] rounded px-2 py-1 text-center"><div className="text-[#8b9bb4]">Tyre</div><div className="font-bold">{x.radar.tyreConservation}</div></div>
                  <div className="bg-[#080c14] border border-[#1e293b] rounded px-2 py-1 text-center"><div className="text-[#8b9bb4]">Energy</div><div className="font-bold">{x.radar.energyEfficiency}</div></div>
                </div>
                <Link href={`/drivers/${x.label === "A" ? a : b}`} className="mt-3 block text-center text-xs py-2 rounded-lg bg-[#1e293b] text-[#8b9bb4] border border-[#243447] hover:text-white">View detail →</Link>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
            <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">CORNER DELTA ANALYSIS</div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">SPEED AT APEX</div><div className="font-mono font-bold mt-1">{infoA?.code} 142 km/h vs {infoB?.code} 138 km/h • Δ +4</div><div className="text-[10px] text-[#22c55e]">A carries more apex speed</div></div>
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">BRAKING POINT</div><div className="font-mono font-bold mt-1">{infoB?.code} 6m later</div><div className="text-[10px] text-[#ef4444]">later braking, higher entry risk</div></div>
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">EXIT ACCELERATION</div><div className="font-mono font-bold mt-1">{infoA?.code} +0.12s advantage</div><div className="text-[10px] text-[#8b9bb4]">traction + X-Mode deployment</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
