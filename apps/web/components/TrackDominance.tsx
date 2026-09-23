"use client";

import * as React from "react";
import { useMemo } from "react";
import { TrackDominanceBenchmarks } from "./dominance/TrackDominanceBenchmarks";
import { TrackDominanceRow } from "./dominance/TrackDominanceRow";
import type { DominanceRow, SectorBenchmarks } from "./dominance/types";

export type { DominanceRow };
export { TrackDominanceBenchmarks, TrackDominanceRow };

export function TrackDominance({
  rows,
  leaderCode,
}: {
  rows?: DominanceRow[];
  leaderCode?: string;
}) {
  const data = useMemo(() => (Array.isArray(rows) && rows.length > 0 ? rows : []), [rows]);
  const hasRows = data.length > 0;
  const leader = leaderCode ?? data[0]?.code ?? "";
  const leaderRow = data.find((r) => r.code === leader) ?? data[0];

  const benchmarks = useMemo<SectorBenchmarks | null>(() => {
    if (!data.length) return null;
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <h3 className="font-bold tracking-wider text-xs text-white">TRACK DOMINANCE</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-muted">
            SECTOR DELTAS
          </span>
        </div>
        {leaderRow && (
          <div className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-pitwall-card border border-pitwall-border text-pitwall-fog tabular-nums">
            <span className="text-pitwall-muted">REF</span>
            <span className="font-bold text-white">{leaderRow.code}</span>
            <span className="text-pitwall-muted">•</span>
            <span>GAP (s)</span>
          </div>
        )}
      </div>

      {!hasRows || !benchmarks || !leaderRow ? (
        <div className="p-8 text-center text-xs font-mono text-pitwall-muted bg-pitwall-bg/40">
          <div className="font-bold text-sm text-white mb-1">SECTOR TIMING UNAVAILABLE</div>
          <div>Awaiting live sector timing from race events.</div>
        </div>
      ) : (
        <>
          <TrackDominanceBenchmarks benchmarks={benchmarks} leaderRow={leaderRow} />

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
                {data.map((r) => (
                  <TrackDominanceRow
                    key={r.code}
                    row={r}
                    benchmarks={benchmarks}
                    isLeader={r.code === leaderRow.code}
                  />
                ))}
              </tbody>
            </table>
          </div>

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
        </>
      )}
    </div>
  );
}

export default TrackDominance;