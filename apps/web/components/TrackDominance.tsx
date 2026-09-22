"use client";

import { useMemo } from "react";

export type DominanceRow = {
  code: string;
  driverNumber?: number;
  color: string;
  team?: string;
  s1: number; // delta vs leader seconds (+ slower, - faster)
  s2: number;
  s3: number;
  total: number;
};

const MOCK_ROWS: DominanceRow[] = [
  { code: "VER", driverNumber: 1, color: "#3671C6", team: "Red Bull", s1: 0, s2: 0, s3: 0, total: 0 },
  { code: "NOR", driverNumber: 4, color: "#FF8000", team: "McLaren", s1: 0.042, s2: -0.018, s3: 0.031, total: 0.055 },
  { code: "LEC", driverNumber: 16, color: "#E8002D", team: "Ferrari", s1: 0.11, s2: 0.04, s3: -0.022, total: 0.128 },
  { code: "RUS", driverNumber: 63, color: "#27F4D2", team: "Mercedes", s1: -0.025, s2: 0.098, s3: 0.052, total: 0.125 },
  { code: "HAM", driverNumber: 44, color: "#E8002D", team: "Ferrari", s1: 0.067, s2: 0.021, s3: 0.089, total: 0.177 },
  { code: "PIA", driverNumber: 81, color: "#FF8000", team: "McLaren", s1: 0.02, s2: 0.015, s3: 0.02, total: 0.055 },
  { code: "ANT", driverNumber: 12, color: "#27F4D2", team: "Mercedes", s1: 0.14, s2: 0.06, s3: 0.03, total: 0.23 },
];

type SectorStatus = "purple" | "green" | "amber" | "red";

const STATUS_CONFIG: Record<
  SectorStatus,
  {
    cellClass: string;
    barClass: string;
    name: string;
  }
> = {
  purple: {
    cellClass: "bg-purple-950/40 text-purple-300 border-purple-500/40",
    barClass: "bg-[#a855f7]",
    name: "Fastest / Benchmark",
  },
  green: {
    cellClass: "bg-emerald-950/40 text-emerald-300 border-emerald-500/40",
    barClass: "bg-[#22c55e]",
    name: "Faster than Benchmark",
  },
  amber: {
    cellClass: "bg-amber-950/40 text-amber-300 border-amber-500/40",
    barClass: "bg-[#f59e0b]",
    name: "Normal Delta",
  },
  red: {
    cellClass: "bg-rose-950/40 text-rose-300 border-rose-500/40",
    barClass: "bg-[#ef4444]",
    name: "Severe Loss (>+0.12s)",
  },
};

function getSectorStatus(
  val: number,
  minVal: number,
  isLeader: boolean
): SectorStatus {
  // Session fastest sector: driver achieved the lowest delta in the session
  const isSessionFastest = val <= minVal + 0.0005;
  // Leader benchmark: reference lap baseline when not eclipsed
  const isLeaderBenchmark = isLeader && val <= 0.0005;

  if (isSessionFastest || isLeaderBenchmark) {
    return "purple";
  }
  // Faster than leader benchmark
  if (val < -0.0005) {
    return "green";
  }
  // Severe loss (>+0.12s)
  if (val > 0.12) {
    return "red";
  }
  // Normal delta
  return "amber";
}

function getTotalStatus(total: number, isLeader: boolean): SectorStatus {
  if (isLeader) return "purple";
  if (total < -0.0005) return "green";
  if (total > 0.12) return "red";
  return "amber";
}

function formatDelta(val: number, isLeaderBenchmark: boolean = false): string {
  if (isLeaderBenchmark || Math.abs(val) < 0.0005) return "0.000";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(3)}`;
}

export function TrackDominance({
  rows,
  leaderCode,
}: {
  rows?: DominanceRow[];
  leaderCode?: string;
}) {
  const data = rows && rows.length ? rows : MOCK_ROWS;
  const leader = leaderCode ?? data[0]?.code ?? "VER";
  const leaderRow = data.find((r) => r.code === leader) ?? data[0];

  // Calculate sector minimums (fastest delta) across all drivers
  const { minS1, minS2, minS3, s1Fastest, s2Fastest, s3Fastest } = useMemo(() => {
    let min1 = Number.POSITIVE_INFINITY;
    let min2 = Number.POSITIVE_INFINITY;
    let min3 = Number.POSITIVE_INFINITY;
    let f1 = data[0];
    let f2 = data[0];
    let f3 = data[0];

    for (const r of data) {
      if (r.s1 < min1) {
        min1 = r.s1;
        f1 = r;
      }
      if (r.s2 < min2) {
        min2 = r.s2;
        f2 = r;
      }
      if (r.s3 < min3) {
        min3 = r.s3;
        f3 = r;
      }
    }

    return {
      minS1: min1,
      minS2: min2,
      minS3: min3,
      s1Fastest: f1,
      s2Fastest: f2,
      s3Fastest: f3,
    };
  }, [data]);

  return (
    <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card font-mono">
      {/* Console Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <h3 className="font-bold tracking-wider text-xs text-white">TRACK DOMINANCE</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-muted">
            SECTOR DELTAS
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-pitwall-card border border-pitwall-border text-pitwall-fog tabular-nums">
          <span className="text-pitwall-muted">REF</span>
          <span className="font-bold text-white">{leaderRow.code}</span>
          <span className="text-pitwall-muted">•</span>
          <span>GAP (s)</span>
        </div>
      </div>

      {/* Sector Benchmark Dominance Bar */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5 bg-pitwall-bg/60 border-b border-pitwall-border text-[11px]">
        <div className="flex items-center justify-between px-2 py-1.5 rounded border border-purple-500/30 bg-purple-950/20">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-3 rounded-full shrink-0" style={{ backgroundColor: s1Fastest.color }} />
            <span className="text-[10px] font-bold text-purple-300">S1</span>
          </div>
          <div className="flex items-center gap-1 tabular-nums">
            <span className="font-bold text-white">{s1Fastest.code}</span>
            <span className="text-purple-300 text-[10px]">
              {formatDelta(s1Fastest.s1, s1Fastest.code === leaderRow.code)}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 rounded border border-purple-500/30 bg-purple-950/20">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-3 rounded-full shrink-0" style={{ backgroundColor: s2Fastest.color }} />
            <span className="text-[10px] font-bold text-purple-300">S2</span>
          </div>
          <div className="flex items-center gap-1 tabular-nums">
            <span className="font-bold text-white">{s2Fastest.code}</span>
            <span className="text-purple-300 text-[10px]">
              {formatDelta(s2Fastest.s2, s2Fastest.code === leaderRow.code)}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 rounded border border-purple-500/30 bg-purple-950/20">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-3 rounded-full shrink-0" style={{ backgroundColor: s3Fastest.color }} />
            <span className="text-[10px] font-bold text-purple-300">S3</span>
          </div>
          <div className="flex items-center gap-1 tabular-nums">
            <span className="font-bold text-white">{s3Fastest.code}</span>
            <span className="text-purple-300 text-[10px]">
              {formatDelta(s3Fastest.s3, s3Fastest.code === leaderRow.code)}
            </span>
          </div>
        </div>
      </div>

      {/* Sector Dominance Timing Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] tracking-wider text-pitwall-muted border-b border-pitwall-border bg-pitwall-bg/30">
              <th className="text-left px-3 py-2 font-bold">DRIVER</th>
              <th className="text-center px-1.5 py-2 font-bold">S1</th>
              <th className="text-center px-1.5 py-2 font-bold">S2</th>
              <th className="text-center px-1.5 py-2 font-bold">S3</th>
              <th className="text-center px-1.5 py-2 font-bold">TOTAL Δ</th>
              <th className="text-left px-3 py-2 font-bold">SECTORS</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const isLeader = r.code === leaderRow.code;
              const s1Status = getSectorStatus(r.s1, minS1, isLeader);
              const s2Status = getSectorStatus(r.s2, minS2, isLeader);
              const s3Status = getSectorStatus(r.s3, minS3, isLeader);
              const totalStatus = getTotalStatus(r.total, isLeader);

              return (
                <tr
                  key={r.code}
                  className={`border-b border-pitwall-border/60 ${
                    isLeader ? "bg-white/[0.02]" : "hover:bg-pitwall-border/20"
                  }`}
                >
                  {/* Driver info */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1 h-5 rounded-full shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-white tracking-wide">
                            {r.code}
                          </span>
                          {isLeader && (
                            <span className="text-[8px] font-bold px-1 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-500/40 leading-tight">
                              P1
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-pitwall-muted truncate max-w-[85px]">
                          {r.driverNumber ? `#${r.driverNumber} ` : ""}
                          {r.team ?? ""}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* S1 Delta */}
                  <td className="px-1.5 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s1Status].cellClass}`}
                    >
                      {formatDelta(r.s1, isLeader && r.s1 === 0)}
                    </span>
                  </td>

                  {/* S2 Delta */}
                  <td className="px-1.5 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s2Status].cellClass}`}
                    >
                      {formatDelta(r.s2, isLeader && r.s2 === 0)}
                    </span>
                  </td>

                  {/* S3 Delta */}
                  <td className="px-1.5 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s3Status].cellClass}`}
                    >
                      {formatDelta(r.s3, isLeader && r.s3 === 0)}
                    </span>
                  </td>

                  {/* Total Delta */}
                  <td className="px-1.5 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[totalStatus].cellClass}`}
                    >
                      {formatDelta(r.total, isLeader && r.total === 0)}
                    </span>
                  </td>

                  {/* Individual Sector Micro-Bars */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {[
                        { label: "S1", val: r.s1, status: s1Status },
                        { label: "S2", val: r.s2, status: s2Status },
                        { label: "S3", val: r.s3, status: s3Status },
                      ].map((sec) => (
                        <div
                          key={sec.label}
                          className="group/sec relative flex flex-col items-center"
                          title={`${r.code} ${sec.label}: ${formatDelta(sec.val, isLeader && sec.val === 0)} (${STATUS_CONFIG[sec.status].name})`}
                        >
                          <span
                            className={`w-4 h-2 rounded-[2px] transition-transform group-hover/sec:scale-110 ${STATUS_CONFIG[sec.status].barClass}`}
                          />
                        </div>
                      ))}
                      {/* Cumulative Delta Comparison Micro-Bar */}
                      <div className="hidden sm:block w-12 h-1.5 rounded-[1px] bg-pitwall-border ml-1 overflow-hidden">
                        <div
                          className={`h-full ${STATUS_CONFIG[totalStatus].barClass}`}
                          style={{
                            width: `${
                              isLeader
                                ? 100
                                : Math.min(100, Math.max(10, (Math.abs(r.total) / 0.25) * 100))
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Timing Console Legend */}
      <div className="px-4 py-2.5 border-t border-pitwall-border bg-pitwall-bg/60 flex flex-wrap items-center justify-between gap-2.5 text-[10px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-purple-300">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#a855f7]" />
            Fastest / Benchmark
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#22c55e]" />
            Faster (&lt;0.000)
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#f59e0b]" />
            Normal (≤+0.12s)
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-300">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#ef4444]" />
            Loss (&gt;+0.12s)
          </span>
        </div>
        <span className="text-pitwall-muted text-[10px]">FIA Timing Telemetry</span>
      </div>
    </div>
  );
}

export default TrackDominance;
