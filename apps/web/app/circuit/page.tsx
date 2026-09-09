"use client";
import { useMemo, useState } from "react";
import { CircuitMap, CIRCUITS, type DriverDot } from "@/components/CircuitMap";
import { WeekendSchedule } from "@/components/WeekendSchedule";
import { WeatherWidget } from "@/components/WeatherWidget";
import { useRaceSim } from "@/lib/raceSim";
import { DRIVER_FALLBACK } from "@/lib/drivers";
import { CALENDAR_2025 } from "@/lib/calendar";
const META: Record<string, { len: string; turns: number; drs: string; sectors: string; record: string; energy: string }> = {
  bahrain:    { len: "5.412 km", turns: 15, drs: "3 zones",                 sectors: "S1 T1-4, S2 T5-10, S3 T11-15",              record: "1:31.447 PEDRO 2005", energy: "High • traction limited" },
  monaco:     { len: "3.337 km", turns: 19, drs: "1 zone",                  sectors: "S1 T1-6, S2 T7-12, S3 T13-19",              record: "1:12.909 HAM 2021",   energy: "Low • mechanical grip" },
  spa:        { len: "7.004 km", turns: 19, drs: "2 zones",                 sectors: "S1 La Source–Kemmel, S2 Pouhon, S3 Blanchimont", record: "1:46.286 BOT 2018", energy: "Very High" },
  monza:      { len: "5.793 km", turns: 11, drs: "2 zones • X-Mode",        sectors: "S1 T1-2, S2 T3-6, S3 T7-11",                record: "1:21.046 RUB 2004",   energy: "Very High • low downforce" },
  silverstone:{ len: "5.891 km", turns: 18, drs: "2 zones",                 sectors: "S1 T1-6, S2 T7-14, S3 T15-18",              record: "1:27.097 VER 2020",   energy: "High • high-speed" },
  baku:       { len: "6.003 km", turns: 20, drs: "2 zones • X-Mode 2.2 km", sectors: "S1 T1-7, S2 T8-18, S3 T19-20",              record: "1:43.009 LEC 2019",   energy: "Very High • long straight" },
  miami:      { len: "5.412 km", turns: 19, drs: "3 zones",                 sectors: "S1 T1-8, S2 T9-14, S3 T15-19",              record: "1:29.820 VER 2023",   energy: "High" },
  singapore:  { len: "4.940 km", turns: 19, drs: "3 zones",                 sectors: "S1 T1-8, S2 T9-14, S3 T15-19",              record: "1:35.867 SAI 2023",   energy: "High • night street" },
  austria:    { len: "4.318 km", turns: 10, drs: "3 zones • X-Mode",        sectors: "S1 T1-4, S2 T5-8, S3 T9-10",                record: "1:05.619 VER 2023",   energy: "Medium-High" },
  barcelona:  { len: "4.657 km", turns: 14, drs: "2 zones",                 sectors: "S1 T1-4, S2 T5-9, S3 T10-14",               record: "1:16.330 VER 2023",   energy: "Medium • lift & coast 8%" },
  suzuka:     { len: "5.807 km", turns: 18, drs: "1 zone",                  sectors: "S1 T1-9, S2 T10-14, S3 T15-18",             record: "1:30.983 VER 2023",   energy: "High • figure-of-eight" },
  zandvoort:  { len: "4.259 km", turns: 14, drs: "2 zones • X-Mode",        sectors: "S1 T1-6, S2 T7-10, S3 T11-14",              record: "1:11.097 VER 2021",   energy: "Medium • banked corners" },
  interlagos: { len: "4.309 km", turns: 15, drs: "2 zones",                 sectors: "S1 T1-4, S2 T5-10, S3 T11-15",              record: "1:10.540 VER 2023",   energy: "Medium-High • altitude" },
  cota:       { len: "5.513 km", turns: 20, drs: "2 zones • X-Mode",        sectors: "S1 T1-9, S2 T10-15, S3 T16-20",             record: "1:36.169 VER 2023",   energy: "High" },
  lasvegas:   { len: "6.201 km", turns: 17, drs: "2 zones • X-Mode 1.9 km", sectors: "S1 T1-6, S2 T7-12, S3 T13-17",             record: "1:35.490 LEC 2023",   energy: "Very High • casino strip" },
  yasmarina:  { len: "5.281 km", turns: 16, drs: "2 zones",                 sectors: "S1 T1-6, S2 T7-12, S3 T13-16",              record: "1:26.103 VER 2021",   energy: "Medium" },
  melbourne:  { len: "5.278 km", turns: 14, drs: "4 zones",                 sectors: "S1 T1-5, S2 T6-10, S3 T11-14",              record: "1:19.813 LEC 2024",   energy: "Medium • street/park" },
  shanghai:   { len: "5.451 km", turns: 16, drs: "2 zones • 1.2 km",        sectors: "S1 T1-4, S2 T5-10, S3 T11-16",              record: "1:31.095 MSC 2004",   energy: "High • front tyre deg" },
  jeddah:     { len: "6.174 km", turns: 27, drs: "3 zones",                 sectors: "S1 T1-12, S2 T13-22, S3 T23-27",            record: "1:30.734 HAM 2021",   energy: "Very High • ultra-fast street" },
  imola:      { len: "4.909 km", turns: 19, drs: "1 zone",                  sectors: "S1 T1-6, S2 T7-14, S3 T15-19",              record: "1:15.484 HAM 2020",   energy: "Medium-High • kerb ride" },
  montreal:   { len: "4.361 km", turns: 14, drs: "2 zones",                 sectors: "S1 T1-5, S2 T6-9, S3 T10-14",               record: "1:13.078 BOT 2019",   energy: "High • stop and go" },
  hungaroring:{ len: "4.381 km", turns: 14, drs: "2 zones",                 sectors: "S1 T1-3, S2 T4-11, S3 T12-14",              record: "1:16.627 HAM 2020",   energy: "Medium • high downforce" },
  mexico:     { len: "4.304 km", turns: 17, drs: "3 zones",                 sectors: "S1 T1-3, S2 T4-11, S3 T12-17",              record: "1:17.774 BOT 2021",   energy: "Medium • thin air cooling" },
  lusail:     { len: "5.419 km", turns: 16, drs: "1 zone",                  sectors: "S1 T1-5, S2 T6-11, S3 T12-16",              record: "1:24.319 VER 2023",   energy: "Very High • high lateral g" },
  madrid:     { len: "5.474 km", turns: 20, drs: "3 zones",                 sectors: "S1 T1-6, S2 T7-14, S3 T15-20",              record: "1:29.850 PREV 2026", energy: "High • semi-street" },
  default:    { len: "N/A",      turns: 16, drs: "2 zones",                 sectors: "S1/S2/S3",                                   record: "N/A",                 energy: "Medium" },
};

export default function CircuitPage() {
  const [circuitId, setCircuitId] = useState("barcelona");
  const sim = useRaceSim("20x", true);
  const info = CIRCUITS.find((c) => c.id === circuitId) ?? CIRCUITS.find((c) => c.id === "barcelona")!;
  const meta = META[circuitId] ?? META.default;
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
    <div className="space-y-6">
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">CIRCUIT & SCHEDULE • TRACK INTELLIGENCE</h1>
            <p className="text-xs text-[#8b9bb4] mt-1">Vector layouts • sectors • speed traps • DRS / Active Aero X-Mode straights • live driver dots • weekend timetable • track weather</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">SELECT CIRCUIT</span>
            <select value={circuitId} onChange={(e) => setCircuitId(e.target.value)} className="bg-[#080c14] border border-[#1e293b] rounded-lg px-3 py-2 text-sm font-mono">
              {CIRCUITS.map((c) => <option key={c.id} value={c.id}>{c.name} • {c.country}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center"><div className="text-[10px] tracking-widest text-[#8b9bb4]">LENGTH</div><div className="font-mono font-black mt-1">{meta.len}</div></div>
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center"><div className="text-[10px] tracking-widest text-[#8b9bb4]">TURNS</div><div className="font-mono font-black mt-1">{meta.turns}</div></div>
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center"><div className="text-[10px] tracking-widest text-[#8b9bb4]">DRS / X-MODE</div><div className="font-mono font-bold mt-1 text-[#00d2be]">{meta.drs}</div></div>
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center"><div className="text-[10px] tracking-widest text-[#8b9bb4]">LAP RECORD</div><div className="font-mono font-bold mt-1">{meta.record}</div></div>
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center"><div className="text-[10px] tracking-widest text-[#8b9bb4]">ENERGY</div><div className="font-mono font-bold mt-1">{meta.energy}</div></div>
        </div>
        <div className="mt-2 text-[11px] text-[#5a6b84]">Sectors: {meta.sectors} • Speed traps • DRS detection • Active Aero high-speed straights</div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <CircuitMap circuitId={circuitId} drivers={dots} lap={sim.lap} flag="GREEN" />
          <div className="mt-4 rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
            <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">CIRCUIT DNA • TELEMETRY FEATURES</div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">SPEED TRAP MAX</div><div className="font-mono font-black mt-1">332 km/h • S1 straight</div><div className="text-[10px] text-[#00d2be]">X-Mode gain +8 km/h</div></div>
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">BRAKE INTENSITY</div><div className="font-mono font-black mt-1">Mean 68% • T1, T10</div><div className="text-[10px] text-[#ef4444]">Heavy zones &gt;150 km/h Δ</div></div>
              <div className="bg-[#080c14] border border-[#1e293b] rounded-lg p-3"><div className="text-[#8b9bb4] text-[10px]">ENERGY DIFFICULTY</div><div className="font-mono font-black mt-1">Index 6.2 / 10</div><div className="text-[10px] text-[#eab308]">lift & coast 12% lap</div></div>
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <WeekendSchedule circuitName={calendarRound.officialName} roundNumber={calendarRound.round} sprintWeekend={calendarRound.isSprint} sessions={calendarSessions} />
          <WeatherWidget circuitId={circuitId} />
        </div>
      </div>
    </div>
  );
}
