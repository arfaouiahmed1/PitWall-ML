import * as React from "react";
import {
  type DominanceRow,
  type SectorBenchmarks,
  STATUS_CONFIG,
  getSectorStatus,
  getTotalStatus,
  formatDelta,
} from "./types";

export type TrackDominanceRowProps = {
  row: DominanceRow;
  benchmarks: SectorBenchmarks;
  isLeader: boolean;
};

export const TrackDominanceRow = React.memo(function TrackDominanceRow({
  row: r,
  benchmarks,
  isLeader,
}: TrackDominanceRowProps) {
  const s1Status = getSectorStatus(r.s1, benchmarks.minS1, isLeader);
  const s2Status = getSectorStatus(r.s2, benchmarks.minS2, isLeader);
  const s3Status = getSectorStatus(r.s3, benchmarks.minS3, isLeader);
  const totalStatus = getTotalStatus(r.total, isLeader);

  const sectorBars = [
    { label: "S1", val: r.s1, status: s1Status },
    { label: "S2", val: r.s2, status: s2Status },
    { label: "S3", val: r.s3, status: s3Status },
  ];

  return (
    <tr
      className={`border-b border-pitwall-border/60 ${
        isLeader ? "bg-white/[0.02]" : "hover:bg-pitwall-border/20"
      }`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="w-1 h-5 rounded-full shrink-0"
            style={{ backgroundColor: r.color }}
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-white tracking-wide">{r.code}</span>
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

      <td className="px-1.5 py-2 text-center">
        <span
          className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s1Status].cellClass}`}
        >
          {formatDelta(r.s1, isLeader && r.s1 === 0)}
        </span>
      </td>

      <td className="px-1.5 py-2 text-center">
        <span
          className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s2Status].cellClass}`}
        >
          {formatDelta(r.s2, isLeader && r.s2 === 0)}
        </span>
      </td>

      <td className="px-1.5 py-2 text-center">
        <span
          className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[s3Status].cellClass}`}
        >
          {formatDelta(r.s3, isLeader && r.s3 === 0)}
        </span>
      </td>

      <td className="px-1.5 py-2 text-center">
        <span
          className={`inline-flex min-w-[56px] justify-center px-1.5 py-1 rounded border font-bold text-[11px] tabular-nums ${STATUS_CONFIG[totalStatus].cellClass}`}
        >
          {formatDelta(r.total, isLeader && r.total === 0)}
        </span>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {sectorBars.map((sec) => (
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
});

export default TrackDominanceRow;