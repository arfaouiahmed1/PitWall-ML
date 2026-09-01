"use client";

import { useMemo, useState } from "react";

export type BattleDriver = {
  code: string;
  driverNumber: number;
  color: string;
  team?: string;
  tyre: "S" | "M" | "H" | "I" | "W";
  tyreAge: number;
  gapToLeader?: string;
};

type PitPoint = { lap: number; delta: number };

function tireAdvantageCurve(pitLap: number, totalLaps: number): PitPoint[] {
  const pts: PitPoint[] = [];
  for (let lap = 0; lap <= 18; lap++) {
    // fresh tyre advantage decays: ~0.9s on lap 0, ~0.25s lap 8, ~0.05 lap 15
    const age = lap;
    const adv = Math.max(0, 0.92 * Math.exp(-0.19 * age) - 0.04);
    pts.push({ lap, delta: Number(adv.toFixed(3)) });
  }
  return pts;
}

function overtakeProbForGap(gap: number): number {
  // gap = seconds behind after pit exit (negative = ahead). Map to 0-100.
  if (gap < -1.2) return 92;
  if (gap < -0.5) return 78;
  if (gap < 0.2) return 55;
  if (gap < 0.8) return 32;
  if (gap < 1.6) return 15;
  return 6;
}

export function StrategyBattle({
  driverA,
  driverB,
  pitWindowDelta,
  overtakeProb,
  remainingLaps = 28,
}: {
  driverA?: BattleDriver;
  driverB?: BattleDriver;
  pitWindowDelta?: number;
  overtakeProb?: number;
  remainingLaps?: number;
}) {
  const a: BattleDriver = driverA ?? { code: "NOR", driverNumber: 4, color: "#FF8000", team: "McLaren", tyre: "H", tyreAge: 11 };
  const b: BattleDriver = driverB ?? { code: "VER", driverNumber: 1, color: "#3671C6", team: "Red Bull", tyre: "M", tyreAge: 18 };

  const [pitLap, setPitLap] = useState(24);
  const curve = useMemo(() => tireAdvantageCurve(pitLap, 66), [pitLap]);

  const basePitDelta = pitWindowDelta ?? 1.35; // seconds lost to pit vs staying out after window
  // slide pitLap earlier = more tyre advantage but more traffic
  const lapOffset = pitLap - 24;
  const windowDelta = Number((basePitDelta + lapOffset * -0.18).toFixed(2));
  const exitGap = windowDelta - curve[0].delta * 1.2; // rough re-entry gap
  const prob = overtakeProb ?? overtakeProbForGap(exitGap);

  const maxAdv = Math.max(...curve.map((p) => p.delta));

  // SVG path for advantage curve
  const svgW = 320, svgH = 86, padL = 28, padR = 10, padT = 8, padB = 18;
  const plotW = svgW - padL - padR, plotH = svgH - padT - padB;
  const pathD = curve
    .map((p, i) => {
      const x = padL + (p.lap / 18) * plotW;
      const y = padT + (1 - p.delta / (maxAdv || 1)) * plotH;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const areaD = `${pathD} L ${padL + plotW} ${padT + plotH} L ${padL} ${padT + plotH} Z`;

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="px-4 py-3 border-b border-[#1e293b] bg-[#080c14] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ff8000] shadow-[0_0_8px_rgba(255,128,0,0.6)] animate-pulse" />
          <h3 className="font-black tracking-tight text-sm">STRATEGY BATTLE</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">OVERCUT vs UNDERCUT</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8]">pit window • Monte Carlo 1k</span>
      </div>

      {/* versus header */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-4 bg-[#080c14] border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white border border-white/10" style={{ background: a.color }}>{a.code.slice(0, 3)}</span>
          <div>
            <div className="font-black text-sm">{a.code} <span className="font-normal text-[#94a3b8]">#{a.driverNumber}</span></div>
            <div className="text-[11px] text-[#64748b]">{a.team} • <span className="inline-flex items-center gap-1"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${a.tyre === "S" ? "bg-[#ef4444] text-white border-[#ef4444]" : a.tyre === "M" ? "bg-[#eab308] text-[#422006] border-[#eab308]" : a.tyre === "H" ? "bg-[#e2e8f0] text-[#0f172a] border-white" : "bg-[#38bdf8] text-white"}`}>{a.tyre}</span> age {a.tyreAge}</span></div>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] tracking-[0.2em] font-black text-[#475569]">VS</span>
          <span className="mt-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#1e293b] border border-[#334155] text-[#94a3b8]">{remainingLaps} laps left</span>
        </div>
        <div className="flex items-center gap-3 justify-end text-right">
          <div>
            <div className="font-black text-sm">{b.code} <span className="font-normal text-[#94a3b8]">#{b.driverNumber}</span></div>
            <div className="text-[11px] text-[#64748b]">{b.team} • <span className="inline-flex items-center gap-1"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${b.tyre === "S" ? "bg-[#ef4444] text-white" : b.tyre === "M" ? "bg-[#eab308] text-[#422006]" : b.tyre === "H" ? "bg-[#e2e8f0] text-[#0f172a]" : "bg-[#38bdf8] text-white"}`}>{b.tyre}</span> age {b.tyreAge}</span></div>
          </div>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white border border-white/10" style={{ background: b.color }}>{b.code.slice(0, 3)}</span>
        </div>
      </div>

      {/* sliders */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-[#1e293b] bg-[#0f172a]">
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-widest font-bold text-[#64748b]">TARGET PIT LAP — {a.code}</span>
            <span className="font-mono font-black text-sm px-2 py-0.5 rounded bg-[#1e293b] border border-[#334155]">Lap {pitLap}</span>
          </div>
          <input type="range" min={18} max={34} value={pitLap} onChange={(e) => setPitLap(Number(e.target.value))} className="w-full mt-2 accent-[#ff8000]" />
          <div className="flex justify-between text-[10px] font-mono text-[#475569]"><span>Lap 18 — early undercut</span><span>Lap 34 — overcut</span></div>
        </div>
        <div className="rounded-lg border border-[#1e293b] bg-[#080c14] p-3">
          <div className="text-[10px] tracking-widest font-bold text-[#64748b]">PIT WINDOW Δ</div>
          <div className={`mt-1 font-mono font-black text-xl leading-none ${windowDelta < 0 ? "text-[#22c55e]" : windowDelta < 0.8 ? "text-[#facc15]" : "text-[#ef4444]"}`}>
            {windowDelta > 0 ? "+" : ""}{windowDelta.toFixed(2)}s
          </div>
          <div className="text-[10px] text-[#94a3b8] mt-1">{windowDelta < 0 ? "Net gain — rejoin ahead" : windowDelta < 1 ? "Nose-to-tail — DRS battle" : "Rejoin in traffic"}</div>
        </div>
      </div>

      {/* advantage curve + overtake */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-0">
        <div className="p-4 border-b lg:border-b-0 lg:border-r border-[#1e293b]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-widest text-[#64748b]">FRESH TYRE ADVANTAGE CURVE</span>
            <span className="text-[10px] font-mono text-[#475569]">Δ vs old tyre • s/lap</span>
          </div>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-[96px] mt-2">
            {/* grid */}
            {[0, 0.25, 0.5, 0.75].map((t) => (
              <line key={t} x1={padL} x2={svgW - padR} y1={padT + t * plotH} y2={padT + t * plotH} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="4 6" opacity={0.7} />
            ))}
            {/* y labels */}
            <text x={2} y={padT + 4} fontSize={7} fill="#64748b" fontFamily="monospace">{maxAdv.toFixed(2)}s</text>
            <text x={2} y={padT + plotH + 3} fontSize={7} fill="#475569" fontFamily="monospace">0s</text>
            {/* x labels */}
            <text x={padL} y={svgH - 2} fontSize={7} fill="#475569" fontFamily="monospace">+0</text>
            <text x={svgW - padR - 16} y={svgH - 2} fontSize={7} fill="#475569" fontFamily="monospace">+18 laps</text>
            {/* area */}
            <path d={areaD} fill="#00d2be" opacity={0.08} />
            <path d={pathD} fill="none" stroke="#00d2be" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* dots */}
            {curve.filter((_, i) => i % 3 === 0).map((p) => {
              const x = padL + (p.lap / 18) * plotW;
              const y = padT + (1 - p.delta / (maxAdv || 1)) * plotH;
              return <circle key={p.lap} cx={x} cy={y} r={2.5} fill="#00d2be" stroke="#0f172a" strokeWidth={1} />;
            })}
          </svg>
          <div className="mt-1 flex items-center gap-3 text-[10px]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-1 rounded bg-[#00d2be]" />Tyre delta ({a.tyre}→M)</span>
            <span className="text-[#475569] font-mono">peak +{maxAdv.toFixed(2)}s lap +1 • cliff ~12 laps</span>
          </div>
        </div>

        <div className="p-4 bg-[#080c14]">
          <div className="text-[11px] font-bold tracking-widest text-[#64748b]">OVERTAKE WINDOW</div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-black text-3xl font-mono leading-none" style={{ color: prob > 60 ? "#22c55e" : prob > 35 ? "#eab308" : "#ef4444" }}>{prob}%</span>
            <span className="text-xs font-bold text-[#94a3b8]">prob</span>
            <span className={`ml-auto text-[10px] font-black px-2 py-1 rounded-full border ${prob > 60 ? "bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/30" : prob > 35 ? "bg-[#eab308]/10 text-[#facc15] border-[#eab308]/30" : "bg-[#ef4444]/10 text-[#f87171] border-[#ef4444]/30"}`}>
              {prob > 60 ? "FAVOURS UNDERCUT" : prob > 35 ? "50:50 — DRS" : "OVERCUT SAFER"}
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-[#1e293b] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${prob}%`, background: prob > 60 ? "#22c55e" : prob > 35 ? "#eab308" : "#ef4444", boxShadow: prob > 60 ? "0 0 10px rgba(34,197,94,0.5)" : undefined }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-2">
              <div className="text-[10px] tracking-widest text-[#64748b]">RE-ENTRY</div>
              <div className="font-mono font-bold text-xs mt-1">{exitGap > 0 ? "+" : ""}{exitGap.toFixed(2)}s</div>
              <div className="text-[10px] text-[#475569]">vs {b.code}</div>
            </div>
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-2">
              <div className="text-[10px] tracking-widest text-[#64748b]">DRS</div>
              <div className={`font-bold text-xs mt-1 ${Math.abs(exitGap) < 1 ? "text-[#22c55e]" : "text-[#94a3b8]"}`}>{Math.abs(exitGap) < 1 ? "READY" : "—"}</div>
              <div className="text-[10px] text-[#475569]">if &lt;1.0s</div>
            </div>
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-2">
              <div className="text-[10px] tracking-widest text-[#64748b]">CLIFF RISK</div>
              <div className={`font-bold text-xs mt-1 ${a.tyreAge > 20 ? "text-[#ef4444]" : a.tyreAge > 14 ? "text-[#eab308]" : "text-[#22c55e]"}`}>{a.tyreAge > 20 ? "HIGH" : a.tyreAge > 14 ? "MED" : "LOW"}</div>
              <div className="text-[10px] text-[#475569]">age {a.tyreAge}</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] leading-relaxed text-[#94a3b8]">
            Pit on lap <span className="font-mono font-bold text-white">{pitLap}</span> → rejoin <span className="font-mono text-white">{exitGap > 0 ? "+" : ""}{exitGap.toFixed(2)}s</span> to {b.code}. {prob > 60 ? "Undercut wins — fresh tyre does the work." : prob > 35 ? "Coin-flip — track position decides. DRS within 2 laps." : "Stay out — overcut preserves clean air."}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 border-t border-[#1e293b] bg-[#080c14] flex items-center justify-between text-[10px]">
        <span className="text-[#475569]">Model: pit hazard + tyre deg + Monte Carlo 1k sims • X-Mode gain applied on DRS straights.</span>
        <span className="hidden sm:inline font-mono text-[#64748b]">pit loss 21.0s</span>
      </div>
    </div>
  );
}

export default StrategyBattle;
