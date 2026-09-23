"use client";
import { useMemo, useState } from "react";
import { CircuitMap, CIRCUITS, type DriverDot } from "@/components/CircuitMap";
import { WeekendSchedule } from "@/components/WeekendSchedule";
import { WeatherWidget } from "@/components/WeatherWidget";
import { useRaceSim } from "@/lib/raceSim";
import { DRIVER_FALLBACK } from "@/lib/drivers";
import { CALENDAR_2025 } from "@/lib/calendar";

export default function CircuitPage() {
  const [circuitId, setCircuitId] = useState("barcelona");
  const sim = useRaceSim("20x", true);
  const info = CIRCUITS.find((c) => c.id === circuitId);
  const calendarRound = useMemo(
    () => CALENDAR_2025.find((r) => r.circuitId === circuitId) ?? CALENDAR_2025[0],
    [circuitId]
  );

  const calendarSessions = useMemo(() => {
    return calendarRound.sessions.map((s) => ({
      kind: (s.type === "Qualifying" ? "Quali" : s.type) as any,
      label: s.label,
      day: new Date(s.startUtc).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
      utc: s.startUtc,
      durationMin: s.durationMin,
    }));
  }, [calendarRound]);
  const dots: DriverDot[] = useMemo(() => {
    return sim.entries.slice(0, 8).map((e, i) => {
      const fallback = DRIVER_FALLBACK[e.driver_number];
      return { driverNumber: e.driver_number, code: fallback?.code ?? String(e.driver_number), color: fallback?.color ?? "#243447", progress: 0.12 + (i * 0.09) % 0.78 };
    });
  }, [sim.entries]);

  return (
    <div className="space-y-6 min-w-0">
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight">CIRCUIT & SCHEDULE • TRACK INTELLIGENCE</h1>
            <p className="text-xs text-pitwall-muted mt-1">Source-derived track geometry • live driver dots • weekend timetable • track weather</p>
          </div>
          <div className="flex items-center gap-2 min-w-0 max-w-full">
            <span className="text-[11px] tracking-widest text-pitwall-muted font-bold shrink-0">SELECT CIRCUIT</span>
            <select value={circuitId} onChange={(e) => setCircuitId(e.target.value)} className="bg-pitwall-bg border border-pitwall-border rounded-lg px-3 py-2 text-sm font-mono min-w-0 max-w-full">
              {CIRCUITS.map((c) => <option key={c.id} value={c.id}>{c.name} • {c.location}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 text-center"><div className="text-[10px] tracking-widest text-pitwall-muted">LENGTH</div><div className="font-mono font-black mt-1">{info ? `${info.lengthKm.toFixed(3)} km` : "Unavailable"}</div></div>
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 text-center"><div className="text-[10px] tracking-widest text-pitwall-muted">TURNS</div><div className="font-mono font-black mt-1">Unavailable</div></div>
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 text-center"><div className="text-[10px] tracking-widest text-pitwall-muted">SECTORS</div><div className="font-mono font-bold mt-1 text-pitwall-cyan">Unavailable</div></div>
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 text-center"><div className="text-[10px] tracking-widest text-pitwall-muted">DRS</div><div className="font-mono font-bold mt-1">Unavailable</div></div>
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 text-center"><div className="text-[10px] tracking-widest text-pitwall-muted">SPEED TRAPS</div><div className="font-mono font-bold mt-1">Unavailable</div></div>
        </div>
        <div className="mt-2 text-[11px] text-pitwall-muted">Circuit line converted from the cited GeoJSON source; overlays are not included in that source.</div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 min-w-0">
          <CircuitMap circuitId={circuitId} drivers={dots} lap={sim.lap} flag="GREEN" />
          <div className="mt-4 rounded-xl bg-pitwall-card border border-pitwall-border p-4 text-xs text-pitwall-muted break-words">
            Geometry source: bacinger/f1-circuits at 394d8fbe70ef2c0b0c8d23ff7bee61fa09606055 (MIT; unofficial, not F1/FIA-endorsed).
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 space-y-4 min-w-0">
          <WeekendSchedule circuitName={calendarRound.officialName} roundNumber={calendarRound.round} sprintWeekend={calendarRound.isSprint} sessions={calendarSessions} />
          <WeatherWidget circuitId={circuitId} />
        </div>
      </div>
    </div>
  );
}
