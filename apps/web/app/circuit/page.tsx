"use client";
import { useMemo, useState } from "react";
import { CircuitMap, CIRCUITS, type DriverDot } from "@/components/CircuitMap";
import { WeekendSchedule } from "@/components/WeekendSchedule";
import { WeatherWidget } from "@/components/WeatherWidget";
import { useRaceSim } from "@/lib/raceSim";
import { DRIVER_FALLBACK } from "@/lib/drivers";

const META: Record<string, { len: string; turns: number; drs: string; sectors: string; record: string; energy: string }> = {
  barcelona: { len: "4.675 km", turns: 16, drs: "2 zones • X-Mode", sectors: "S1 T1-4, S2 T5-9, S3 T10-16", record: "1:16.330 VER 2023", energy: "Medium • lift & coast 8%" },
  bahrain: { len: "5.412 km", turns: 15, drs: "3 zones", sectors: "S1 T1-4, S2 T5-10, S3 T11-15", record: "1:31.447 PEDRO 2005", energy: "High • traction limited" },
  monaco: { len: "3.337 km", turns: 19, drs: "1 zone", sectors: "S1 T1-6, S2 T7-12, S3 T13-19", record: "1:12.909 HAM 2021", energy: "Low • mechanical grip" },
  spa: { len: "7.004 km", turns: 19, drs: "2 zones", sectors: "S1 La Source–Kemmel, S2 Les Combes–Pouhon, S3 Blanchimont", record: "1:46.286 BOT 2018", energy: "Very High" },
  monza: { len: "5.793 km", turns: 11, drs: "2 zones", sectors: "S1 T1-2, S2 T3-6, S3 T7-11", record: "1:21.046 RUB 2004", energy: "Very High • low downforce" },
  silverstone: { len: "5.891 km", turns: 18, drs: "2 zones", sectors: "S1 T1-6, S2 T7-14, S3 T15-18", record: "1:27.097 VER 2020", energy: "High • high-speed" },
  default: { len: "—", turns: 16, drs: "2 zones • X-Mode", sectors: "S1/S2/S3", record: "—", energy: "Medium" },
};

export default function CircuitPage() {
  const [circuitId, setCircuitId] = useState("barcelona");
  const sim = useRaceSim("20x", true);
  const info = CIRCUITS.find((c) => c.id === circuitId) ?? CIRCUITS.find((c) => c.id === "barcelona")!;
  const meta = META[circuitId] ?? META.default;

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
              {CIRCUITS.length < 10 && (
                <>
                  <option value="bahrain">Bahrain GP • BH</option>
                  <option value="monaco">Monaco GP • MC</option>
                  <option value="spa">Belgian GP • BE</option>
                  <option value="monza">Italian GP • IT</option>
                  <option value="suzuka">Japanese GP • JP</option>
                  <option value="cota">US GP • US</option>
                </>
              )}
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
          <WeekendSchedule circuitName={info.name} />
          <WeatherWidget />
        </div>
      </div>
    </div>
  );
}
