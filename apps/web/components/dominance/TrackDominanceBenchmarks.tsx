import * as React from "react";
import { type SectorBenchmarks, type DominanceRow, formatDelta } from "./types";

export type TrackDominanceBenchmarksProps = {
  benchmarks: SectorBenchmarks;
  leaderRow: DominanceRow;
};

export const TrackDominanceBenchmarks = React.memo(function TrackDominanceBenchmarks({
  benchmarks,
  leaderRow,
}: TrackDominanceBenchmarksProps) {
  const sectors = [
    { label: "S1", fastest: benchmarks.s1Fastest, delta: benchmarks.s1Fastest.s1 },
    { label: "S2", fastest: benchmarks.s2Fastest, delta: benchmarks.s2Fastest.s2 },
    { label: "S3", fastest: benchmarks.s3Fastest, delta: benchmarks.s3Fastest.s3 },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2.5 bg-pitwall-bg/60 border-b border-pitwall-border text-[11px]">
      {sectors.map((sec) => (
        <div
          key={sec.label}
          className="flex items-center justify-between px-2 py-1.5 rounded border border-purple-500/30 bg-purple-950/20"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-1.5 h-3 rounded-full shrink-0"
              style={{ backgroundColor: sec.fastest.color }}
            />
            <span className="text-[10px] font-bold text-purple-300">{sec.label}</span>
          </div>
          <div className="flex items-center gap-1 tabular-nums">
            <span className="font-bold text-white">{sec.fastest.code}</span>
            <span className="text-purple-300 text-[10px]">
              {formatDelta(sec.delta, sec.fastest.code === leaderRow.code)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});

export default TrackDominanceBenchmarks;