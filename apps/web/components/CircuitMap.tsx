"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CIRCUITS, getCircuitGeometry } from "@/lib/circuits/registry";
import type { CircuitGeometry, CircuitId } from "@/lib/circuits/types";
import { TrackGeometry, type TrackDriver } from "@/components/circuit/TrackGeometry";
import { useLiveWeather } from "@/lib/liveWeather";
import { useRaceSocket } from "@/lib/useRaceSocket";

export type DriverDot = {
  driverNumber: number;
  code: string;
  color: string;
  progress: number;
  sourceTimestamp?: string;
  position?: number;
  gap?: string | number;
  tyreCompound?: string;
};

export type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";
export type { CircuitGeometry as CircuitMeta } from "@/lib/circuits/types";
export { CIRCUITS } from "@/lib/circuits/registry";

export type CircuitMapProps = {
  circuitId?: CircuitId | string;
  drivers?: DriverDot[];
  lap?: number;
  flag?: Flag;
  showCircuitSelector?: boolean;
  onCircuitChange?: (circuitId: string) => void;
  className?: string;
};

export const MAX_DRIVER_AGE_MS = 60_000;

export function getTimestampedDrivers(
  drivers: readonly DriverDot[] = [],
  nowMs: number = Date.now()
): DriverDot[] {
  return drivers.filter((driver) => {
    if (typeof driver.sourceTimestamp !== "string") return false;
    const sourceMs = Date.parse(driver.sourceTimestamp);
    if (!Number.isFinite(sourceMs)) return false;
    return nowMs - sourceMs <= MAX_DRIVER_AGE_MS;
  });
}

export function getLatestSourceTimestamp(drivers: readonly DriverDot[] = []): string | undefined {
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const driver of drivers ?? []) {
    if (typeof driver.sourceTimestamp !== "string") continue;
    const sourceMs = Date.parse(driver.sourceTimestamp);
    if (Number.isFinite(sourceMs) && sourceMs > latestMs) {
      latestMs = sourceMs;
      latest = driver.sourceTimestamp;
    }
  }
  return latest;
}

const FLAG_CONFIG: Record<
  Flag | "UNKNOWN",
  { bg: string; border: string; text: string; glow: string; label: string; dot: string; desc: string }
> = {
  GREEN: { bg: "bg-pitwall-green/10", border: "border-pitwall-green/30", text: "text-pitwall-green", glow: "shadow-[0_0_15px_rgba(34,197,94,0.35)]", label: "GREEN : RACING", dot: "bg-pitwall-green", desc: "push allowed" },
  YELLOW: { bg: "bg-pitwall-yellow/15", border: "border-pitwall-yellow/40", text: "text-pitwall-yellow", glow: "shadow-[0_0_15px_rgba(234,179,8,0.4)]", label: "YELLOW : CAUTION", dot: "bg-pitwall-yellow", desc: "caution, no overtaking" },
  SC: { bg: "bg-pitwall-papaya/20", border: "border-pitwall-papaya/40", text: "text-pitwall-papaya", glow: "shadow-[0_0_15px_rgba(255,128,0,0.45)]", label: "SAFETY CAR", dot: "bg-pitwall-papaya", desc: "safety car deployed" },
  VSC: { bg: "bg-pitwall-mint/15", border: "border-pitwall-mint/40", text: "text-pitwall-mint", glow: "shadow-[0_0_15px_rgba(132,204,22,0.35)]", label: "VIRTUAL SAFETY CAR", dot: "bg-pitwall-mint", desc: "delta adherence required" },
  RED: { bg: "bg-pitwall-danger/20", border: "border-pitwall-danger/50", text: "text-pitwall-danger", glow: "shadow-[0_0_15px_rgba(239,68,68,0.5)]", label: "RED FLAG", dot: "bg-pitwall-danger", desc: "session suspended" },
  UNKNOWN: { bg: "bg-pitwall-card", border: "border-pitwall-border", text: "text-pitwall-muted", glow: "", label: "STATUS UNAVAILABLE", dot: "bg-pitwall-muted", desc: "status unavailable" },
};

export function CircuitMap({
  circuitId,
  drivers,
  lap,
  flag,
  showCircuitSelector,
  onCircuitChange,
  className = "",
}: CircuitMapProps) {
  const [selectedId, setSelectedId] = useState<string>(circuitId ?? "barcelona");
  const activeId = circuitId ?? selectedId;

  useEffect(() => {
    if (circuitId) setSelectedId(circuitId);
  }, [circuitId]);

  const circuit = useMemo(() => getCircuitGeometry(activeId), [activeId]);
  const { weather, loading: weatherLoading } = useLiveWeather(circuit?.id ?? "");
  const conditionsLive =
    weather.available === true &&
    weather.trackTempC !== null &&
    weather.airTempC !== null &&
    typeof weather.sourceTimestamp === "string" &&
    Number.isFinite(Date.parse(weather.sourceTimestamp));

  const socket = useRaceSocket();

  const effectiveLap = lap ?? (socket.connected && socket.lap > 0 ? socket.lap : undefined);
  const effectiveFlag = flag ?? (socket.connected ? socket.flag : "UNKNOWN");
  const flagCfg = FLAG_CONFIG[effectiveFlag];

  const effectiveDrivers = useMemo<DriverDot[]>(() => {
    return getTimestampedDrivers(drivers);
  }, [drivers]);
  const latestDriverSource = useMemo(() => getLatestSourceTimestamp(drivers), [drivers]);
  const driverStatusReason =
    (drivers ?? []).length === 0
      ? "no timestamped position source supplied"
      : `stale: latest source ${latestDriverSource ?? "unknown"} exceeds ${MAX_DRIVER_AGE_MS / 1000}s freshness`;

  const trackDrivers = useMemo<TrackDriver[]>(() => {
    return effectiveDrivers.map((d) => ({
      driverNumber: d.driverNumber,
      code: d.code,
      color: d.color,
      progress: d.progress,
      position: d.position,
      gap: d.gap,
      tyreCompound: d.tyreCompound,
    }));
  }, [effectiveDrivers]);

  const isSelectorVisible = showCircuitSelector ?? !circuitId;

  if (!circuit) {
    return (
      <div className={`rounded-xl border-[1.5px] border-pitwall-border bg-pitwall-card p-6 ${className}`} role="status">
        <h3 className="text-sm font-black">CIRCUIT GEOMETRY UNAVAILABLE</h3>
        <p className="mt-2 text-xs text-pitwall-muted">No source-backed circuit is registered for {activeId}.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border-[1.5px] border-pitwall-border bg-pitwall-card ${className}`}>
      {/* Cockpit Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b-[1.5px] border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-pitwall-cyan animate-pulse" />
          <h3 className="font-black tracking-tight text-sm">CIRCUIT MAP</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-muted">SOURCE-DERIVED TRACK LINE • LIVE TELEMETRY</span>
          {typeof effectiveLap === "number" && (
            <span className="ml-2 text-[11px] font-mono px-2 py-0.5 rounded bg-pitwall-card border-[1.5px] border-pitwall-steel text-pitwall-fog">
              LAP {effectiveLap}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isSelectorVisible && (
            <select
              value={circuit.id}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedId(nextId);
                onCircuitChange?.(nextId);
              }}
              className="bg-pitwall-card border-[1.5px] border-pitwall-border rounded px-2.5 py-1 text-xs font-mono text-pitwall-fog focus:outline-none focus:border-pitwall-cyan/40 min-w-0 max-w-full"
              aria-label="Select circuit"
            >
              {CIRCUITS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} • {c.location}
                </option>
              ))}
            </select>
          )}

          <span
            className={`hidden md:inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full border-[1.5px] ${flagCfg.border} ${flagCfg.bg} ${flagCfg.text} ${flagCfg.glow} ${effectiveFlag === "YELLOW" || effectiveFlag === "RED" ? "animate-pulse" : ""}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${flagCfg.dot} ${effectiveFlag !== "GREEN" ? "animate-ping" : "animate-pulse"}`} />
            {flagCfg.label}
          </span>
        </div>
      </div>

      {/* Telemetry DNA & Conditions Strip */}
      <div className="grid grid-cols-3 divide-x divide-pitwall-border border-b-[1.5px] border-pitwall-border bg-pitwall-card">
        <div className="px-4 py-2 min-w-0">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">CIRCUIT</div>
          <div className="text-sm font-black truncate">{circuit.name}</div>
          <div className="text-[11px] text-pitwall-fog break-words">{circuit.location} • {circuit.lengthKm.toFixed(3)} km</div>
        </div>

        <div className="px-4 py-2 text-center min-w-0">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">OVERLAYS</div>
          <div className="font-mono font-bold text-sm mt-0.5">Unavailable</div>
          <div className="text-[10px] text-pitwall-muted mt-0.5">Source overlay data unavailable</div>
        </div>

        <div className="px-4 py-2 text-right min-w-0">
          <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">CONDITIONS</div>
          {conditionsLive ? (
            <>
              <div className="text-xs font-mono text-pitwall-fog break-words">Track {weather.trackTempC.toFixed(1)}°C • Air {weather.airTempC.toFixed(1)}°C</div>
              <div className="text-[10px] text-pitwall-cyan font-mono flex items-center justify-end gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-pitwall-cyan animate-pulse" />
                {weather.condition}
              </div>
              <div className="text-[10px] text-pitwall-muted font-mono mt-0.5">Source {weather.source} • {weather.sourceTimestamp}</div>
            </>
          ) : (
            <>
              <div className="font-mono font-bold text-sm mt-0.5" role="status">Conditions unavailable</div>
              <div className="text-[10px] text-pitwall-muted mt-0.5">
                {weatherLoading ? "loading weather feed" : "no live weather source"}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Track Geometry Visualizer */}
      <div className="relative bg-pitwall-bg p-2 sm:p-4">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <TrackGeometry
          circuit={circuit}
          drivers={trackDrivers}
          className="w-full h-auto border-[1.5px] border-pitwall-border/40"
        />
        {trackDrivers.length === 0 && (
          <div role="status" className="mt-3 rounded border-[1.5px] border-pitwall-border bg-pitwall-card px-3 py-2 text-[11px] font-mono text-pitwall-muted">
            Driver positions unavailable: {driverStatusReason}.
          </div>
        )}

        {/* Legend Bar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-pitwall-fog">
            <span className="font-mono">Map source: bacinger/f1-circuits</span>
            <span className="font-mono">Turns / sectors / DRS / speed traps: unavailable</span>
          </div>

          <span className="font-mono text-[10px] text-pitwall-steel hidden lg:inline">
            Unofficial source-derived geometry
          </span>
        </div>
      </div>

      {/* Bottom Track Status Banner */}
      <div className={`px-4 py-2 flex items-center justify-between border-t-[1.5px] border-pitwall-border text-[11px] ${flagCfg.bg}`}>
        <span
          className={`inline-flex items-center gap-2 font-black tracking-widest ${flagCfg.text} ${effectiveFlag === "YELLOW" || effectiveFlag === "SC" || effectiveFlag === "RED" ? "animate-pulse" : ""}`}
        >
          <span className={`w-2 h-2 rounded-full ${flagCfg.dot}`} />
          TRACK: {flagCfg.label}
          <span className="hidden sm:inline font-normal opacity-70">
            : {circuit.name} ({flagCfg.desc})
          </span>
        </span>
        <span className="font-mono text-pitwall-muted hidden sm:inline">
          {circuit.lengthKm.toFixed(3)} km • overlay data unavailable
        </span>
      </div>
    </div>
  );
}

export default CircuitMap;
