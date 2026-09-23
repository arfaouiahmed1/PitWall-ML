"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DRIVER_FALLBACK, useDrivers } from "@/lib/drivers";
import { TelemetryOverlay } from "@/components/TelemetryOverlay";
import { CarTopView } from "@/components/CarRenders";
import { DriverAvatar } from "@/components/DriverAvatar";
import { PerformanceRadarChart } from "@/components/charts/PerformanceRadarChart";

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

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-6">
        <h1 className="text-xl font-black tracking-tight">DRIVER TELEMETRY • HEAD-TO-HEAD</h1>
        <p className="text-xs text-pitwall-muted mt-1">Compare timestamped source telemetry. Driver identity and car imagery are roster references; team-car profiles are not driver measurements.</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 space-y-3">
          <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">SELECT DRIVERS</div>
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
                className={`w-full text-left rounded-xl border p-3 flex items-center gap-3 transition ${d.num === a || d.num === b ? "bg-pitwall-bg border-pitwall-accent/40 shadow-[0_0_10px_rgba(255,24,1,0.15)]" : "bg-pitwall-card border-pitwall-border hover:border-pitwall-edge"}`}
              >
                <DriverAvatar src={d.info.image} name={d.info.name} code={d.info.code} number={d.num} color={d.info.color} team={d.info.team} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black font-mono">{d.info.code} <span className="text-pitwall-muted font-normal">#{d.num}</span> {(d.num === a || d.num === b) && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-pitwall-accent text-white">{d.num === a ? "A" : "B"}</span>}</div>
                  <div className="text-[11px] text-pitwall-muted truncate">{d.info.name} • {d.info.team}</div>
                </div>
                <CarTopView team={d.info.team} size={36} />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select value={a} onChange={(e) => setA(Number(e.target.value))} className="flex-1 bg-pitwall-bg border border-pitwall-border rounded-lg px-2 py-2 text-xs font-mono">
              {all.map((d) => <option key={d.num} value={d.num}>{d.info.code} #{d.num}</option>)}
            </select>
            <span className="self-center text-pitwall-muted text-xs">vs</span>
            <select value={b} onChange={(e) => setB(Number(e.target.value))} className="flex-1 bg-pitwall-bg border border-pitwall-border rounded-lg px-2 py-2 text-xs font-mono">
              {all.map((d) => <option key={d.num} value={d.num}>{d.info.code} #{d.num}</option>)}
            </select>
          </div>
          <Link href={`/drivers/${a}`} className="block text-center text-xs font-bold py-2 rounded-lg bg-pitwall-border text-pitwall-muted border border-pitwall-edge hover:text-white">Open {infoA?.code ?? a} detail →</Link>
        </div>

        <div className="col-span-12 lg:col-span-9 space-y-4">
          <TelemetryOverlay driverA={a} driverB={b} />

          <div className="grid grid-cols-2 gap-4">
            {[
              { info: infoA, label: "A" },
              { info: infoB, label: "B" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
                <div className="flex items-center gap-3">
                  <DriverAvatar src={x.info?.image} name={x.info?.name ?? `Driver ${x.label}`} code={x.info?.code ?? x.label} number={x.label === "A" ? a : b} color={x.info?.color} team={x.info?.team} size={36} />
                  <div>
                    <div className="text-sm font-black">{x.info?.name ?? `Driver ${x.label}`} <span className="text-pitwall-muted font-normal text-xs">#{x.label === "A" ? a : b}</span></div>
                    <div className="text-[11px] text-pitwall-muted">{x.info?.team}</div>
                  </div>
                  <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-pitwall-bg border border-pitwall-border font-mono">{x.label}</span>
                </div>
                <div className="mt-3 bg-pitwall-bg rounded-lg border border-pitwall-border p-2">
                  <PerformanceRadarChart series={[]} title={`${x.info?.team ?? "Team"} team-level car profile`} />
                </div>
                <Link href={`/drivers/${x.label === "A" ? a : b}`} className="mt-3 block text-center text-xs py-2 rounded-lg bg-pitwall-border text-pitwall-muted border border-pitwall-edge hover:text-white">View detail →</Link>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
            <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">CORNER DELTA ANALYSIS</div>
            <p className="mt-3 text-xs text-pitwall-muted">Measured corner deltas are unavailable until the driver telemetry source is connected.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
