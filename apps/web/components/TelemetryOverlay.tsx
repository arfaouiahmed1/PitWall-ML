"use client";

import React, { useEffect, useState } from "react";
import {
  TelemetryTraceChart,
  type TelemetryPoint,
  validateTelemetryTrace,
} from "@/components/charts/TelemetryTraceChart";
import { API_URL, fetchJson } from "@/lib/api";
import { DRIVER_FALLBACK } from "@/lib/drivers";

export type TracePoint = TelemetryPoint;

type DriverOpt = { number: number; code: string; color: string; team?: string };
type TelemetryResponse = {
  points?: TelemetryPoint[];
  provenance?: string;
  reason?: string | null;
  observed_at?: string | null;
  source_timestamp?: string | null;
  stale?: boolean;
};

const DRIVER_OPTS: DriverOpt[] = Object.entries(DRIVER_FALLBACK)
  .map(([number, driver]) => ({ number: Number(number), ...driver }))
  .slice(0, 8);

function driverMeta(number: number) {
  const driver = DRIVER_FALLBACK[number];
  return driver
    ? { code: driver.code, color: driver.color, team: driver.team, number }
    : { code: `#${number}`, number };
}

function verifiedTrace(response: TelemetryResponse | null): TelemetryPoint[] | null {
  if (!response || response.provenance === "UNAVAILABLE" || response.stale || !Array.isArray(response.points)) {
    return null;
  }
  return validateTelemetryTrace(response.points).valid ? response.points : null;
}

export function TelemetryOverlay({
  driverA: driverAProp,
  driverB: driverBProp,
  driver1Num,
  driver2Num,
  dataA,
  dataB,
}: {
  driverA?: number;
  driverB?: number;
  driver1Num?: number;
  driver2Num?: number;
  dataA?: TracePoint[];
  dataB?: TracePoint[];
}) {
  const [aNum, setANum] = useState(
    typeof driverAProp === "number" ? driverAProp : typeof driver1Num === "number" ? driver1Num : 4
  );
  const [bNum, setBNum] = useState(
    typeof driverBProp === "number" ? driverBProp : typeof driver2Num === "number" ? driver2Num : 1
  );
  const [responseA, setResponseA] = useState<TelemetryResponse | null>(null);
  const [responseB, setResponseB] = useState<TelemetryResponse | null>(null);

  useEffect(() => {
    if (typeof driverAProp === "number") setANum(driverAProp);
    else if (typeof driver1Num === "number") setANum(driver1Num);
  }, [driverAProp, driver1Num]);

  useEffect(() => {
    if (typeof driverBProp === "number") setBNum(driverBProp);
    else if (typeof driver2Num === "number") setBNum(driver2Num);
  }, [driverBProp, driver2Num]);

  useEffect(() => {
    let active = true;
    if (!API_URL) {
      setResponseA(null);
      setResponseB(null);
      return () => {
        active = false;
      };
    }

    void fetchJson<TelemetryResponse>(`${API_URL}/drivers/${aNum}/telemetry?source=live`).then((response) => {
      if (active) setResponseA(response ?? null);
    });
    void fetchJson<TelemetryResponse>(`${API_URL}/drivers/${bNum}/telemetry?source=live`).then((response) => {
      if (active) setResponseB(response ?? null);
    });

    return () => {
      active = false;
    };
  }, [aNum, bNum]);

  const traceA = dataA ?? verifiedTrace(responseA);
  const traceB = dataB ?? verifiedTrace(responseB);
  const sourceTime = responseA?.source_timestamp ?? responseA?.observed_at;

  return (
    <section className="space-y-3" aria-label="Telemetry overlay">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="sr-only" htmlFor="telemetry-driver-a">Driver A</label>
        <select
          id="telemetry-driver-a"
          value={aNum}
          onChange={(event) => setANum(Number(event.target.value))}
          className="rounded border border-pitwall-border bg-pitwall-card px-2 py-1.5 font-mono text-xs text-pitwall-ink"
        >
          {DRIVER_OPTS.map((driver) => <option key={driver.number} value={driver.number}>{driver.code} #{driver.number}</option>)}
        </select>
        <span className="text-[11px] font-black text-pitwall-steel">VS</span>
        <label className="sr-only" htmlFor="telemetry-driver-b">Driver B</label>
        <select
          id="telemetry-driver-b"
          value={bNum}
          onChange={(event) => setBNum(Number(event.target.value))}
          className="rounded border border-pitwall-border bg-pitwall-card px-2 py-1.5 font-mono text-xs text-pitwall-ink"
        >
          {DRIVER_OPTS.map((driver) => <option key={driver.number} value={driver.number}>{driver.code} #{driver.number}</option>)}
        </select>
      </div>
      <TelemetryTraceChart
        traceA={traceA}
        traceB={traceB}
        driverA={driverMeta(aNum)}
        driverB={driverMeta(bNum)}
        title="TELEMETRY OVERLAY"
        subtitle={sourceTime ? `Source observed ${sourceTime}` : "Raw source samples only; scrub to inspect the exact sample timestamp."}
      />
    </section>
  );
}

export default TelemetryOverlay;
