"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DRIVER_FALLBACK, lastName, useDrivers } from "@/lib/drivers";
import { TelemetryOverlay } from "@/components/TelemetryOverlay";
import { CarSideView } from "@/components/CarRenders";
import { DriverAvatar } from "@/components/DriverAvatar";
import { PerformanceRadarChart } from "@/components/charts/PerformanceRadarChart";

export function DriverDetailClient({ driverParam }: { driverParam: string }) {
  const num = Number(driverParam ?? "4");
  const drivers = useDrivers();
  const info = useMemo(() => drivers[num] ?? DRIVER_FALLBACK[num] ?? { name: `Driver ${num}`, code: String(num), team: "N/A", color: "#243447" }, [drivers, num]);
  const [laps, setLaps] = useState<readonly { lap_number: number; lap_duration: number; date_start: string | null }[]>([]);
  const [lapSourceTime, setLapSourceTime] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`https://api.openf1.org/v1/laps?session_key=latest&driver_number=${num}`)
      .then((response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((payload) => {
        if (!active || !Array.isArray(payload)) return;
        const records = payload.filter((row): row is { lap_number: number; lap_duration: number; date_start: string | null } =>
          typeof row === "object" && row !== null &&
          typeof row.lap_number === "number" && Number.isFinite(row.lap_number) &&
          typeof row.lap_duration === "number" && Number.isFinite(row.lap_duration) &&
          (typeof row.date_start === "string" || row.date_start === null)
        );
        setLaps(records);
        setLapSourceTime(records.at(-1)?.date_start ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof TypeError && active) setLaps([]);
      });
    return () => { active = false; };
  }, [num]);
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
                <span className="text-pitwall-muted">Roster reference; no current driver performance measurements available.</span>
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
            <span className="text-xs font-black tracking-wider uppercase">Team Car Profile</span>
            <span className="text-[10px] font-mono text-pitwall-muted">TEAM-LEVEL</span>
          </div>
          <PerformanceRadarChart series={[]} title={`${info.team} team-level car profile`} />
        </div>

        <div className="lg:col-span-2 rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-pitwall-border pb-3">
            <span className="text-xs font-black tracking-wider uppercase">Historical Lap Records</span>
            <span className="text-[10px] font-mono text-pitwall-muted">OpenF1 • latest session</span>
          </div>
          {laps.length ? <ol className="max-h-44 overflow-auto space-y-1" aria-label="Historical lap records">{laps.map((lap) => <li key={lap.lap_number} className="flex justify-between text-xs font-mono"><span>Lap {lap.lap_number}</span><span>{lap.lap_duration.toFixed(3)}s</span><time dateTime={lap.date_start ?? undefined}>{lap.date_start ?? "Timestamp unavailable"}</time></li>)}</ol> : <p className="text-xs text-pitwall-muted" role="status">Historical lap records unavailable: no valid OpenF1 lap data for this driver in the latest session.</p>}
          <p className="text-[10px] text-pitwall-muted">Source time: {lapSourceTime ?? "Unavailable"}</p>
        </div>
      </div>
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-pitwall-border pb-3">
          <span className="text-xs font-black tracking-wider uppercase">Timestamped Driver Telemetry</span>
          <span className="text-[10px] font-mono text-pitwall-muted">Live source samples only</span>
        </div>
        <TelemetryOverlay driver1Num={num} driver2Num={num} />
      </div>
    </div>
  );
}
