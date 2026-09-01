"use client";

import { useMemo, useState } from "react";
import { COMPOUND_NAMES, DRIVER_FALLBACK, readableTextColor, type DriverInfo } from "@/lib/drivers";

// ─────────────────────────────────────────────────────────────────────────────
// Types — unified leaderboard row (accepts legacy shape + enriched fields)
// ─────────────────────────────────────────────────────────────────────────────
export type Pace = { q50: number; q10: number; q90: number };
export type PitHazard = { p1: number; p3: number; p5: number }; // 0-100
export type FinishingDist = { p1: number; podium: number; points: number }; // 0-100

export type RaceRow = {
  driver_number: number;
  position: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  image?: string;
  // gaps
  gap?: string; // display string e.g. "+2.41" or "LEADER"
  gapToLeader?: string;
  gapToAhead?: string;
  gapDelta?: number; // s/lap trend vs car ahead (negative = closing)
  drs?: boolean; // computed if gap <1.0
  // tyre
  tyre: "S" | "M" | "H" | "I" | "W";
  tyreAge: number;
  tyreWear?: number; // 0-100 remaining life (100 = fresh)
  // pace forecast
  forecast?: string; // legacy string fallback
  pace?: Pace; // seconds, e.g. q50=79.31
  interval?: string; // legacy
  // hazards & distributions
  pitProb?: number; // legacy 0-100 for ≤3
  pit?: PitHazard;
  finishing?: FinishingDist;
  // hover
  stintLaps?: number[];
  shapTop3?: { feature: string; value: string }[];
  lastLap?: string;
};

type Enriched = Required<Pick<RaceRow, "driver_number" | "position" | "tyre" | "tyreAge">> & Omit<RaceRow, "driver_number" | "position" | "tyre" | "tyreAge"> & {
  info: DriverInfo;
  paceNorm: Pace;
  pitNorm: PitHazard;
  finishingNorm: FinishingDist;
  gapDeltaNorm: number;
  wearNorm: number;
};

const COMPOUND_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  S: { bg: "bg-[#ef4444]", text: "text-white", border: "border-[#ef4444]", label: "S" },
  M: { bg: "bg-[#eab308]", text: "text-[#422006]", border: "border-[#eab308]", label: "M" },
  H: { bg: "bg-[#f8fafc]", text: "text-[#0f172a]", border: "border-white", label: "H" },
  I: { bg: "bg-[#22c55e]", text: "text-white", border: "border-[#22c55e]", label: "I" },
  W: { bg: "bg-[#38bdf8]", text: "text-white", border: "border-[#38bdf8]", label: "W" },
};

function fmtPace(p: Pace): string {
  const m = Math.floor(p.q50 / 60);
  const s = (p.q50 % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}
function intervalHalf(p: Pace): number {
  return (p.q90 - p.q10) / 2;
}
function wearColor(w: number): string {
  if (w > 55) return "#22c55e";
  if (w > 25) return "#eab308";
  return "#ef4444";
}

export function RaceTable({ rows }: { rows: RaceRow[] | any[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [sortBy] = useState<"pos">("pos");

  const enriched: Enriched[] = useMemo(() => {
    const list: Enriched[] = (rows as RaceRow[]).map((r, idx) => {
      const dn = (r.driver_number ?? (idx + 1)) as number;
      const fallback = DRIVER_FALLBACK[dn];
      const info: DriverInfo = {
        name: r.name ?? fallback?.name ?? `Driver ${dn}`,
        code: r.code ?? fallback?.code ?? String(dn),
        team: r.team ?? fallback?.team ?? "",
        color: r.color ?? fallback?.color ?? "#334155",
        image: r.image ?? fallback?.image,
      };
      // pace normalization: if legacy forecast string, parse rough
      let paceNorm: Pace;
      if (r.pace) paceNorm = r.pace;
      else if (typeof r.forecast === "string") {
        // fallback demo: map forecast string not parseable → synthesize near 79s + tyre age jitter
        const base = 79.2 + (r.tyreAge ?? 0) * 0.05;
        const band = 0.28 + (r.tyreAge ?? 0) * 0.015;
        paceNorm = { q50: base, q10: base - band, q90: base + band };
      } else {
        const base = 79.3 + (r.tyreAge ?? 10) * 0.04 + idx * 0.12;
        const band = 0.3;
        paceNorm = { q50: base, q10: base - band, q90: base + band };
      }
      const pitNorm: PitHazard = r.pit ?? {
        p1: Math.round(Math.min(92, Math.max(4, (r.pitProb ?? 18) * 0.28))),
        p3: Math.round(r.pitProb ?? 18),
        p5: Math.round(Math.min(98, (r.pitProb ?? 18) * 1.8)),
      };
      const finishingNorm: FinishingDist = r.finishing ?? {
        p1: Math.max(1, 38 - idx * 7 - Math.floor(Math.random() * 6)),
        podium: Math.max(2, 72 - idx * 9),
        points: Math.max(5, 92 - idx * 4),
      };
      const gapDeltaNorm = typeof r.gapDelta === "number" ? r.gapDelta : (Math.random() - 0.52) * 0.4;
      const wearNorm = typeof r.tyreWear === "number" ? r.tyreWear : Math.max(6, 100 - (r.tyreAge ?? 0) * 3.2 - idx * 2);
      const gapStr = r.gap ?? (idx === 0 ? "LEADER" : `+${(idx * 1.8 + Math.random() * 1.2).toFixed(2)}`);
      return {
        driver_number: dn,
        position: r.position ?? idx + 1,
        code: info.code,
        name: info.name,
        team: info.team,
        color: info.color,
        image: info.image,
        gap: gapStr,
        gapToLeader: r.gapToLeader ?? gapStr,
        gapToAhead: r.gapToAhead ?? (idx === 0 ? "—" : `+${(0.6 + Math.random() * 1.4).toFixed(2)}`),
        gapDelta: gapDeltaNorm,
        drs: typeof r.drs === "boolean" ? r.drs : idx !== 0 && Math.random() > 0.45,
        tyre: (r.tyre ?? "M") as RaceRow["tyre"],
        tyreAge: r.tyreAge ?? 10 + idx * 2,
        tyreWear: wearNorm,
        forecast: r.forecast,
        pace: paceNorm,
        interval: r.interval,
        pitProb: r.pitProb,
        pit: pitNorm,
        finishing: finishingNorm,
        stintLaps: r.stintLaps ?? Array.from({ length: 7 }, (_, i) => 79.2 + (Math.random() - 0.5) * 0.6 + i * 0.04),
        shapTop3: r.shapTop3 ?? [
          { feature: "tyre_age", value: "+0.21s" },
          { feature: "track_temp", value: "-0.08s" },
          { feature: "gap_ahead", value: "+0.04s" },
        ],
        lastLap: r.lastLap ?? fmtPace(paceNorm),
        info,
        paceNorm,
        pitNorm,
        finishingNorm,
        gapDeltaNorm,
        wearNorm,
      };
    });
    return list.sort((a, b) => a.position - b.position);
  }, [rows]);

  const hoverRow = hovered != null ? enriched.find((r) => r.driver_number === hovered) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[#1e293b] bg-[#0f172a]">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#080c14] border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ff1801] shadow-[0_0_8px_rgba(255,24,1,0.6)] animate-pulse" />
          <h2 className="font-black tracking-tight text-sm">RACE LEADERBOARD — LIVE PREDICTIONS</h2>
          <span className="hidden lg:inline text-[10px] tracking-widest px-2 py-1 rounded-full bg-[#1e293b] border border-[#334155] text-[#64748b]">q10–q50–q90 • Monte Carlo 1k</span>
        </div>
        <span className="hidden sm:inline text-[11px] text-[#64748b]">hover row → SHAP + sparkline</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="text-[10px] tracking-widest text-[#64748b] bg-[#080c14] border-b border-[#1e293b]">
            <tr>
              <th className="text-left px-3 py-2 font-bold">POS</th>
              <th className="text-left px-3 py-2 font-bold">DRIVER</th>
              <th className="text-left px-3 py-2 font-bold">GAP / DRS</th>
              <th className="text-left px-3 py-2 font-bold">TYRE</th>
              <th className="text-left px-3 py-2 font-bold">PACE q50 ± interval</th>
              <th className="text-left px-3 py-2 font-bold">PIT HAZARD P1/P3/P5</th>
              <th className="text-left px-3 py-2 font-bold">FINISHING DIST</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {enriched.map((r) => {
              const comp = COMPOUND_STYLE[r.tyre] ?? COMPOUND_STYLE.M;
              const delta = r.gapDeltaNorm;
              const closing = delta < -0.1;
              const dropping = delta > 0.1;
              const half = intervalHalf(r.paceNorm);
              const widthPct = Math.min(100, (half / 0.7) * 100);
              const isHovered = hovered === r.driver_number;
              return (
                <tr
                  key={r.driver_number}
                  onMouseEnter={() => setHovered(r.driver_number)}
                  onMouseLeave={() => setHovered((v) => (v === r.driver_number ? null : v))}
                  className={`border-b border-[#1e293b]/60 transition ${isHovered ? "bg-[#1e293b]/50" : "hover:bg-[#1e293b]/30"} cursor-pointer`}
                >
                  {/* POS */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex w-7 h-7 items-center justify-center rounded-lg font-black text-xs border ${r.position <= 3 ? "bg-[#eab308] text-[#422006] border-[#eab308]" : "bg-[#1e293b] text-[#e2e8f0] border-[#334155]"}`}>
                      {r.position}
                    </span>
                  </td>

                  {/* DRIVER */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5 min-w-[190px]">
                      <span aria-hidden className="w-1 h-8 rounded-full shrink-0" style={{ background: r.info.color }} />
                      {r.info.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.info.image} alt={r.info.name} width={30} height={30} loading="lazy" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover border border-[#334155] bg-[#080c14] shrink-0" />
                      ) : (
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black border border-[#334155] shrink-0" style={{ background: r.info.color, color: readableTextColor(r.info.color) }}>
                          {r.info.code.slice(0, 3)}
                        </span>
                      )}
                      <span className="flex flex-col leading-tight">
                        <span className="flex items-center gap-1.5">
                          <span className="font-black text-xs font-sans">{r.info.code}</span>
                          <span className="text-[10px] px-1 py-0.5 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8]">#{r.driver_number}</span>
                        </span>
                        <span className="text-[11px] text-[#94a3b8] font-sans truncate max-w-[110px]">{r.info.name}</span>
                      </span>
                      <span className="hidden lg:inline-flex text-[9px] px-1.5 py-0.5 rounded-full border font-bold tracking-widest shrink-0" style={{ background: `${r.info.color}18`, color: r.info.color, borderColor: `${r.info.color}40` }}>
                        {r.info.team?.slice(0, 3).toUpperCase() || "F1"}
                      </span>
                    </div>
                  </td>

                  {/* GAP / DRS + delta arrow */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${r.position === 1 ? "text-[#22c55e]" : "text-[#e2e8f0]"}`}>{r.gap}</span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border ${closing ? "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30" : dropping ? "bg-[#ef4444]/12 text-[#f87171] border-[#ef4444]/30" : "bg-[#1e293b] text-[#64748b] border-[#334155]"}`}
                          title={`Gap delta ${delta > 0 ? "+" : ""}${delta.toFixed(3)} s/lap`}
                        >
                          <span className={`${closing ? "text-[#22c55e]" : dropping ? "text-[#ef4444]" : "text-[#475569]"} text-[11px] leading-none`}>
                            {closing ? "▲" : dropping ? "▼" : "—"}
                          </span>
                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#475569]">{r.gapToAhead}</span>
                        {r.position !== 1 && (
                          <span className={`text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded border ${r.drs ? "bg-[#00d2be]/15 text-[#00d2be] border-[#00d2be]/30 shadow-[0_0_6px_rgba(0,210,190,0.25)]" : "bg-[#1e293b] text-[#475569] border-[#334155]"}`}>
                            {r.drs ? "DRS ●" : "DRS —"}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* TYRE pill + age ring + wear ring */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {/* age ring */}
                      <div className="relative w-9 h-9 shrink-0">
                        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                          <circle cx={18} cy={18} r={14} fill="none" stroke="#1e293b" strokeWidth={3.5} />
                          <circle
                            cx={18}
                            cy={18}
                            r={14}
                            fill="none"
                            stroke={wearColor(r.wearNorm)}
                            strokeWidth={3.5}
                            strokeLinecap="round"
                            strokeDasharray={`${(r.wearNorm / 100) * 87.96} 87.96`}
                            className={r.wearNorm < 22 ? "animate-pulse" : undefined}
                            style={r.wearNorm < 22 ? { filter: "drop-shadow(0 0 4px rgba(239,68,68,0.7))" } : undefined}
                          />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center w-9 h-9`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black border ${comp.bg} ${comp.text} ${comp.border}`}>{comp.label}</span>
                        </span>
                      </div>
                      <span className="flex flex-col leading-none">
                        <span className="font-bold text-xs">{COMPOUND_NAMES[r.tyre] ?? r.tyre} <span className="text-[#94a3b8] font-normal">× {r.tyreAge}</span></span>
                        <span className="text-[10px] font-mono" style={{ color: wearColor(r.wearNorm) }}>
                          {r.wearNorm < 22 ? "CLIFF ● " : r.wearNorm < 45 ? "Graining " : "Fresh "} {Math.round(r.wearNorm)}%
                        </span>
                        {/* thermal mini bar */}
                        <span className="mt-1 w-16 h-1 rounded-full bg-[#1e293b] overflow-hidden block">
                          <span className="block h-full rounded-full transition-all" style={{ width: `${r.wearNorm}%`, background: wearColor(r.wearNorm) }} />
                        </span>
                      </span>
                    </div>
                  </td>

                  {/* PACE q50 ± interval + confidence bar */}
                  <td className="px-3 py-2">
                    <div className="min-w-[170px]">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-black text-xs">{fmtPace(r.paceNorm)}</span>
                        <span className="text-[11px] text-[#94a3b8]">±{half.toFixed(3)}s</span>
                        <span className={`ml-1 w-1.5 h-1.5 rounded-full ${half < 0.32 ? "bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.6)]" : half < 0.5 ? "bg-[#eab308]" : "bg-[#ef4444]"}`} title="interval width" />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-[#475569]">{r.paceNorm.q10.toFixed(2)}</span>
                        <span className="flex-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden relative">
                          <span className="absolute inset-y-0 rounded-full" style={{ left: `${Math.max(0, 50 - widthPct / 2)}%`, width: `${widthPct}%`, background: half < 0.35 ? "#22c55e" : half < 0.5 ? "#eab308" : "#ef4444", opacity: 0.95 }} />
                          <span className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-white rounded-full" style={{ left: "50%" }} />
                        </span>
                        <span className="text-[9px] font-mono text-[#475569]">{r.paceNorm.q90.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-[#475569] mt-0.5">{r.paceNorm.q10.toFixed(2)} — {r.paceNorm.q50.toFixed(2)} — {r.paceNorm.q90.toFixed(2)}</div>
                    </div>
                  </td>

                  {/* PIT HAZARD gauges P1/P3/P5 */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {(["p1", "p3", "p5"] as const).map((k) => {
                        const v = r.pitNorm[k];
                        const label = k.toUpperCase();
                        return (
                          <div key={k} className="flex flex-col items-center gap-1">
                            <span className="text-[9px] tracking-widest font-bold text-[#64748b]">{label}</span>
                            <div className="relative w-9 h-9">
                              <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                                <circle cx={18} cy={18} r={13} fill="none" stroke="#1e293b" strokeWidth={3} />
                                <circle cx={18} cy={18} r={13} fill="none" stroke={v > 60 ? "#ef4444" : v > 30 ? "#eab308" : "#22c55e"} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${(v / 100) * 81.68} 81.68`} />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black">{v}%</span>
                            </div>
                            <span className={`w-9 h-1 rounded-full ${v > 60 ? "bg-[#ef4444]" : v > 30 ? "bg-[#eab308]" : "bg-[#22c55e]"}`} style={{ opacity: 0.9 }} />
                          </div>
                        );
                      })}
                    </div>
                  </td>

                  {/* FINISHING distribution bars */}
                  <td className="px-3 py-2">
                    <div className="min-w-[140px] space-y-1.5">
                      {[
                        { k: "P1", v: r.finishingNorm.p1, col: "#eab308" },
                        { k: "Pod", v: r.finishingNorm.podium, col: "#38bdf8" },
                        { k: "Pts", v: r.finishingNorm.points, col: "#22c55e" },
                      ].map((f) => (
                        <div key={f.k} className="flex items-center gap-1.5">
                          <span className="text-[9px] w-7 font-bold tracking-widest text-[#64748b]">{f.k}</span>
                          <span className="flex-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${f.v}%`, background: f.col }} />
                          </span>
                          <span className="text-[10px] font-mono w-7 text-right">{f.v}%</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* hover card */}
      {hoverRow && (
        <div className="pointer-events-none fixed z-50 hidden lg:block" style={{ left: 0, top: 0 }}>
          {/* anchored via JS would be better; use absolute inside relative wrapper fallback */}
        </div>
      )}
      {/* inline hover card below table on hover (avoids fixed positioning issues) */}
      {hoverRow && (
        <div className="border-t border-[#1e293b] bg-[#080c14] px-4 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            {hoverRow.info.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hoverRow.info.image} alt={hoverRow.info.name} width={44} height={44} referrerPolicy="no-referrer" className="w-11 h-11 rounded-full object-cover border-2" style={{ borderColor: hoverRow.info.color }} />
            ) : (
              <span className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2" style={{ background: hoverRow.info.color, color: readableTextColor(hoverRow.info.color), borderColor: hoverRow.info.color }}>
                {hoverRow.info.code.slice(0, 2)}
              </span>
            )}
            <div>
              <div className="font-black text-sm">{hoverRow.info.name} <span className="text-[#94a3b8] font-normal">{hoverRow.info.code} #{hoverRow.driver_number}</span></div>
              <div className="text-[11px] text-[#64748b]">Stint laps • last 7 • tyre {hoverRow.tyre} age {hoverRow.tyreAge}</div>
            </div>
          </div>
          {/* sparkline */}
          <div className="flex items-center gap-1 h-10">
            {hoverRow.stintLaps!.map((v, i) => {
              const min = Math.min(...hoverRow.stintLaps!);
              const max = Math.max(...hoverRow.stintLaps!);
              const h = max === min ? 16 : 6 + ((v - min) / (max - min)) * 22;
              return <span key={i} className="w-1.5 rounded-full" style={{ height: `${h}px`, background: hoverRow.info.color, opacity: 0.85 }} />;
            })}
          </div>
          <div className="text-[10px] font-mono text-[#475569] hidden sm:block">
            {hoverRow.stintLaps!.map((v) => v.toFixed(2)).join(" • ")}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] tracking-widest font-bold text-[#64748b]">TOP SHAP</span>
            {hoverRow.shapTop3!.map((s) => (
              <span key={s.feature} className="text-[11px] px-2 py-1 rounded-full bg-[#1e293b] border border-[#334155]">
                <span className="font-bold text-[#e2e8f0]">{s.feature}</span> <span className="font-mono text-[#94a3b8]">{s.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-2 bg-[#080c14] border-t border-[#1e293b] flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <span className="inline-flex flex-wrap items-center gap-2 text-[#475569]">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-[#22c55e]" /> Fresh</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-[#eab308]" /> Graining</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-[#ef4444] animate-pulse" /> Cliff</span>
          <span className="hidden sm:inline">•</span>
          <span className="inline-flex items-center gap-1"><span className="text-[#22c55e]">▲ closing</span> <span className="text-[#ef4444]">▼ dropping</span> (±0.1s/lap)</span>
        </span>
        <span className="font-mono text-[#475569] hidden sm:inline">80% conformal interval • hazard = P(pit in N laps) • DRS if gap &lt;1.0s</span>
      </div>
    </div>
  );
}

export default RaceTable;
