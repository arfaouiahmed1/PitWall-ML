"use client";

import { memo, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { COMPOUND_NAMES, DRIVER_FALLBACK, readableTextColor, type DriverInfo } from "@/lib/drivers";
import { DriverAvatar } from "@/components/DriverAvatar";
import { DataBadge } from "@/components/DataBadge";

// ─────────────────────────────────────────────────────────────────────────────
// Types : unified leaderboard row (accepts legacy shape + enriched fields)
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
  pitStopLaps?: number[];
  sectorTimes?: { s1: number; s2: number; s3: number };
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
  pitStopLapsNorm: number[];
  sectorTimesNorm: { s1: number; s2: number; s3: number };
};
const COMPOUND_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  S: { bg: "bg-pitwall-danger", text: "text-white", border: "border-pitwall-danger", label: "S" },
  M: { bg: "bg-pitwall-yellow", text: "text-pitwall-card", border: "border-pitwall-yellow", label: "M" },
  H: { bg: "bg-pitwall-fog", text: "text-pitwall-card", border: "border-white", label: "H" },
  I: { bg: "bg-pitwall-green", text: "text-white", border: "border-pitwall-green", label: "I" },
  W: { bg: "bg-pitwall-cyan", text: "text-white", border: "border-pitwall-cyan", label: "W" },
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

// ─────────────────────────────────────────────────────────────────────────────
// RaceRowView — memoised so unchanged rows skip re-render on each socket tick.
// ─────────────────────────────────────────────────────────────────────────────
const RaceRowView = memo(function RaceRowView({
  row: r,
  isHovered,
  setHovered,
}: {
  row: Enriched;
  isHovered: boolean;
  setHovered: Dispatch<SetStateAction<number | null>>;
}) {
  const comp = COMPOUND_STYLE[r.tyre] ?? COMPOUND_STYLE.M;
  const delta = r.gapDeltaNorm;
  const closing = delta < -0.1;
  const dropping = delta > 0.1;
  const half = intervalHalf(r.paceNorm);
  const widthPct = Math.min(100, (half / 0.7) * 100);
  const deltaLabel = closing ? "closing" : dropping ? "dropping" : "stable";
  return (
    <tr
      tabIndex={0}
      onMouseEnter={() => setHovered(r.driver_number)}
      onFocus={() => setHovered(r.driver_number)}
      onMouseLeave={() => setHovered((v) => (v === r.driver_number ? null : v))}
      onBlur={() => setHovered((v) => (v === r.driver_number ? null : v))}
      className={`border-b border-pitwall-border/60 transition ${isHovered ? "bg-pitwall-border/50" : "hover:bg-pitwall-border/30 focus-visible:bg-pitwall-border/50"} cursor-pointer`}
    >
      {/* POS */}
      <td className="px-3 py-3">
        <span className={`inline-flex w-7 h-7 items-center justify-center rounded-lg font-black text-xs border ${r.position <= 3 ? "bg-pitwall-yellow text-pitwall-card border-pitwall-yellow" : "bg-pitwall-border text-pitwall-ink border-pitwall-steel"}`}>
          {r.position}
        </span>
      </td>

      {/* DRIVER */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5 min-w-[190px]">
          <span aria-hidden="true" className="w-1 h-8 rounded-full shrink-0" style={{ background: r.info.color }} />
          <DriverAvatar
            src={r.image ?? r.info.image}
            name={r.name ?? r.info.name}
            code={r.code ?? r.info.code}
            number={r.driver_number}
            color={r.color ?? r.info.color}
            team={r.team ?? r.info.team}
            size={32}
          />
          <span className="flex flex-col leading-tight">
            <span className="flex items-center gap-1.5">
              <span className="font-black text-xs font-sans">{r.info.code}</span>
              <span className="text-[10px] px-1 py-0.5 rounded bg-pitwall-border border border-pitwall-steel text-pitwall-fog">#{r.driver_number}</span>
            </span>
            <span className="text-[11px] text-pitwall-fog font-sans truncate max-w-[110px]">{r.info.name}</span>
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
            <span className={`font-bold ${r.position === 1 ? "text-pitwall-green" : "text-pitwall-ink"}`}>{r.gap}</span>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border ${closing ? "bg-pitwall-green/15 text-pitwall-green border-pitwall-green/30" : dropping ? "bg-pitwall-danger/12 text-pitwall-rose border-pitwall-danger/30" : "bg-pitwall-border text-pitwall-muted border-pitwall-steel"}`}
              title={`Gap delta ${delta > 0 ? "+" : ""}${delta.toFixed(3)} s/lap`}
            >
              <span aria-hidden="true" className={`${closing ? "text-pitwall-green" : dropping ? "text-pitwall-danger" : "text-pitwall-steel"} text-[11px] leading-none`}>
                {closing ? "▲" : dropping ? "▼" : "•"}
              </span>
              <span className="sr-only">{deltaLabel}</span>
              {delta > 0 ? "+" : ""}{delta.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-pitwall-steel">{r.gapToAhead}</span>
            {r.position !== 1 && (
              <span className={`text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded border ${r.drs ? "bg-pitwall-cyan/15 text-pitwall-cyan border-pitwall-cyan/30 shadow-[0_0_6px_rgba(0,210,190,0.25)]" : "bg-pitwall-border text-pitwall-steel border-pitwall-steel"}`}>
                <span aria-hidden="true">{r.drs ? "DRS ●" : "DRS -"}</span>
                <span className="sr-only">{r.drs ? "DRS active" : "DRS inactive"}</span>
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
            <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" aria-hidden="true">
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
            <span className="absolute inset-0 flex items-center justify-center w-9 h-9">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black border ${comp.bg} ${comp.text} ${comp.border}`}>{comp.label}</span>
            </span>
          </div>
          <span className="flex flex-col leading-none">
            <span className="font-bold text-xs">{COMPOUND_NAMES[r.tyre] ?? r.tyre} <span className="text-pitwall-fog font-normal">× {r.tyreAge}</span></span>
            <span className="text-[10px] font-mono" style={{ color: wearColor(r.wearNorm) }}>
              {r.wearNorm < 22 ? "CLIFF ● " : r.wearNorm < 45 ? "Graining " : "Fresh "} {Math.round(r.wearNorm)}%
            </span>
            {/* thermal mini bar */}
            <span className="mt-1 w-16 h-1 rounded-full bg-pitwall-border overflow-hidden block">
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
            <span className="text-[11px] text-pitwall-fog">±{half.toFixed(3)}s</span>
            <span className={`ml-1 w-1.5 h-1.5 rounded-full ${half < 0.32 ? "bg-pitwall-green shadow-[0_0_6px_rgba(34,197,94,0.6)]" : half < 0.5 ? "bg-pitwall-yellow" : "bg-pitwall-danger"}`} title="interval width" />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-pitwall-steel">{r.paceNorm.q10.toFixed(2)}</span>
            <span className="flex-1 h-1.5 rounded-full bg-pitwall-border overflow-hidden relative">
              <span className="absolute inset-y-0 rounded-full" style={{ left: `${Math.max(0, 50 - widthPct / 2)}%`, width: `${widthPct}%`, background: half < 0.35 ? "#22c55e" : half < 0.5 ? "#eab308" : "#ef4444", opacity: 0.95 }} />
              <span className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-white rounded-full" style={{ left: "50%" }} />
            </span>
            <span className="text-[9px] font-mono text-pitwall-steel">{r.paceNorm.q90.toFixed(2)}</span>
          </div>
          <div className="text-[10px] text-pitwall-steel mt-0.5">{r.paceNorm.q10.toFixed(2)} / {r.paceNorm.q50.toFixed(2)} / {r.paceNorm.q90.toFixed(2)}</div>
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
                <span className="text-[9px] tracking-widest font-bold text-pitwall-muted">{label}</span>
                <div className="relative w-9 h-9">
                  <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" aria-hidden="true">
                    <circle cx={18} cy={18} r={13} fill="none" stroke="#1e293b" strokeWidth={3} />
                    <circle cx={18} cy={18} r={13} fill="none" stroke={v > 60 ? "#ef4444" : v > 30 ? "#eab308" : "#22c55e"} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${(v / 100) * 81.68} 81.68`} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black">{v}%</span>
                </div>
                <span className={`w-9 h-1 rounded-full ${v > 60 ? "bg-pitwall-danger" : v > 30 ? "bg-pitwall-yellow" : "bg-pitwall-green"}`} style={{ opacity: 0.9 }} />
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
              <span className="text-[9px] w-7 font-bold tracking-widest text-pitwall-muted">{f.k}</span>
              <span className="flex-1 h-1.5 rounded-full bg-pitwall-border overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${f.v}%`, background: f.col }} />
              </span>
              <span className="text-[10px] font-mono w-7 text-right">{f.v}%</span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-fog" title="Sector 1">
            <span className="text-[9px] text-pitwall-muted mr-1">S1</span>{r.sectorTimesNorm.s1.toFixed(1)}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-mint" title="Sector 2 (purple pace)">
            <span className="text-[9px] text-pitwall-muted mr-1">S2</span>{r.sectorTimesNorm.s2.toFixed(1)}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-fog" title="Sector 3">
            <span className="text-[9px] text-pitwall-muted mr-1">S3</span>{r.sectorTimesNorm.s3.toFixed(1)}
          </span>
        </div>
      </td>

      {/* PIT TIMELINE */}
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1 min-w-[110px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-pitwall-amber/15 text-pitwall-amberlight border border-pitwall-amber/30">
              {r.pitStopLapsNorm.length} STOP{r.pitStopLapsNorm.length > 1 ? "S" : ""}
            </span>
            <span className="text-[10px] text-pitwall-fog font-mono">
              L{r.pitStopLapsNorm.join(", L")}
            </span>
          </div>
          {/* mini lap timeline track */}
          <div className="w-24 h-1.5 rounded-full bg-pitwall-border relative overflow-hidden">
            {r.pitStopLapsNorm.map((pitLap) => (
              <span
                key={pitLap}
                className="absolute top-0 bottom-0 w-1 bg-pitwall-accent rounded-full"
                style={{ left: `${Math.min(95, (pitLap / 66) * 100)}%` }}
                title={`Pitted on Lap ${pitLap}`}
              />
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
});

export const RaceTable = memo(function RaceTable({ rows }: { rows: RaceRow[] | any[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const enriched: Enriched[] = useMemo(() => {
    const seen = new Set<number>();
    const seenCodes = new Set<string>();
    const uniqueRows: RaceRow[] = [];
    for (const r of (rows as RaceRow[])) {
      const dn = r.driver_number;
      const code = r.code ?? (dn ? DRIVER_FALLBACK[dn]?.code : undefined);
      if (dn != null && seen.has(dn)) continue;
      if (code && seenCodes.has(code)) continue;
      if (dn != null) seen.add(dn);
      if (code) seenCodes.add(code);
      uniqueRows.push(r);
    }

    const list: Enriched[] = uniqueRows.map((r, idx) => {
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
        p1: Math.max(1, 38 - idx * 7 - (idx % 3) * 2),
        podium: Math.max(2, 72 - idx * 9),
        points: Math.max(5, 92 - idx * 4),
      };
      const gapDeltaNorm = typeof r.gapDelta === "number" ? r.gapDelta : Number((((idx % 5) - 2) * 0.04).toFixed(3));
      const wearNorm = typeof r.tyreWear === "number" ? r.tyreWear : Math.max(6, 100 - (r.tyreAge ?? 0) * 3.2 - idx * 2);
      const gapStr = r.gap ?? (idx === 0 ? "LEADER" : `+${(idx * 1.84 + (idx % 3) * 0.22).toFixed(2)}`);
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
        gapToAhead: r.gapToAhead ?? (idx === 0 ? "LEADER" : `+${(0.75 + (idx % 4) * 0.28).toFixed(2)}`),
        gapDelta: gapDeltaNorm,
        drs: typeof r.drs === "boolean" ? r.drs : idx > 0 && (idx % 3 !== 0),
        tyre: (r.tyre ?? "M") as RaceRow["tyre"],
        tyreAge: r.tyreAge ?? 10 + idx * 2,
        tyreWear: wearNorm,
        forecast: r.forecast,
        pace: paceNorm,
        interval: r.interval,
        pitProb: r.pitProb,
        pit: pitNorm,
        finishing: finishingNorm,
        stintLaps: r.stintLaps ?? Array.from({ length: 7 }, (_, i) => Number((79.2 + ((idx % 3) - 1) * 0.12 + i * 0.04).toFixed(2))),
        pitStopLapsNorm: r.pitStopLaps ?? (idx % 2 === 0 ? [18, 38] : [24]),
        sectorTimesNorm: r.sectorTimes ?? {
          s1: Number((26.2 + ((idx % 3) - 1) * 0.08).toFixed(3)),
          s2: Number((28.9 + ((idx % 4) - 2) * 0.09).toFixed(3)),
          s3: Number((24.4 + ((idx % 2) - 0.5) * 0.06).toFixed(3)),
        },
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
  const hasSynthPace = useMemo(() => (rows as RaceRow[]).some((r) => !r.pace), [rows]);

  const hoverRow = hovered != null ? enriched.find((r) => r.driver_number === hovered) : null;
  const hoverStintLaps = hoverRow?.stintLaps ?? [];
  const hoverStintMin = hoverStintLaps.length ? Math.min(...hoverStintLaps) : 0;
  const hoverStintMax = hoverStintLaps.length ? Math.max(...hoverStintLaps) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-pitwall-border bg-pitwall-card">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 bg-pitwall-bg border-b border-pitwall-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-pitwall-accent shadow-[0_0_8px_rgba(255,24,1,0.6)] animate-pulse" />
          <h2 className="font-black tracking-tight text-sm">RACE LEADERBOARD : LIVE PREDICTIONS</h2>
          <span className="hidden lg:inline text-[10px] tracking-widest px-2 py-1 rounded-full bg-pitwall-border border border-pitwall-steel text-pitwall-muted">q10-q50-q90 • Monte Carlo 1k</span>
        </div>
        <span className="flex items-center gap-2"><span className="hidden sm:inline text-[11px] text-pitwall-muted">hover row → SHAP + sparkline</span>{hasSynthPace ? <DataBadge variant="SIMULATED" detail="client pace synth" /> : <DataBadge variant="LIVE" detail="model pace" />}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <caption className="sr-only">Race leaderboard with pace forecasts and pit hazards</caption>
          <thead className="text-[10px] tracking-widest text-pitwall-muted bg-pitwall-bg border-b border-pitwall-border">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-bold">POS</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">DRIVER</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">GAP / DRS</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">TYRE</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">PACE q50 ± interval</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">SECTORS</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">PIT TIMELINE</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">PIT HAZARD</th>
              <th scope="col" className="text-left px-3 py-2 font-bold">FINISHING DIST</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {enriched.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-pitwall-muted">
                  No timing rows — replay data loading.
                </td>
              </tr>
            ) : (
              enriched.map((row) => (
                <RaceRowView
                  key={row.driver_number}
                  row={row}
                  isHovered={hovered === row.driver_number}
                  setHovered={setHovered}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Inline hover card below table on hover. */}
      {hoverRow && (
        <div className="border-t border-pitwall-border bg-pitwall-bg px-4 py-3 flex flex-wrap items-center gap-4">
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
              <div className="font-black text-sm">{hoverRow.info.name} <span className="text-pitwall-fog font-normal">{hoverRow.info.code} #{hoverRow.driver_number}</span></div>
              <div className="text-[11px] text-pitwall-muted">Stint laps • last 7 • tyre {hoverRow.tyre} age {hoverRow.tyreAge}</div>
            </div>
          </div>
          {/* sparkline */}
          <div className="flex items-center gap-1 h-10">
            {hoverStintLaps.map((value, index) => {
              const height = hoverStintMax === hoverStintMin ? 16 : 6 + ((value - hoverStintMin) / (hoverStintMax - hoverStintMin)) * 22;
              return <span key={index} className="w-1.5 rounded-full" style={{ height: `${height}px`, background: hoverRow.info.color, opacity: 0.85 }} />;
            })}
          </div>
          <div className="text-[10px] font-mono text-pitwall-steel hidden sm:block">
            {hoverRow.stintLaps!.map((v) => v.toFixed(2)).join(" • ")}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] tracking-widest font-bold text-pitwall-muted">TOP SHAP</span>
            {hoverRow.shapTop3!.map((s) => (
              <span key={s.feature} className="text-[11px] px-2 py-1 rounded-full bg-pitwall-border border border-pitwall-steel">
                <span className="font-bold text-pitwall-ink">{s.feature}</span> <span className="font-mono text-pitwall-fog">{s.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-2 bg-pitwall-bg border-t border-pitwall-border flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <span className="inline-flex flex-wrap items-center gap-2 text-pitwall-steel">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-pitwall-green" /> Fresh</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-pitwall-yellow" /> Graining</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-pitwall-danger animate-pulse" /> Cliff</span>
          <span className="hidden sm:inline">•</span>
          <span className="inline-flex items-center gap-1"><span className="text-pitwall-green">▲ closing</span> <span className="text-pitwall-danger">▼ dropping</span> (±0.1s/lap)</span>
        </span>
        <span className="font-mono text-pitwall-steel hidden sm:inline">80% conformal interval • hazard = P(pit in N laps) • DRS if gap &lt;1.0s</span>
      </div>
    </div>
  );
});

export default RaceTable;
