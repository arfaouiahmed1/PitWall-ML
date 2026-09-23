"use client";

import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import type { DriverInfo } from "@/lib/drivers";
import { RaceTableRow } from "./table/RaceTableRow";
import { TyreStintBadge } from "./table/TyreStintBadge";
import { DriverPaceSparkline } from "./table/DriverPaceSparkline";
import type { RaceRow, Pace, PitHazard, FinishingDist, EnrichedRow } from "./table/types";

export type { RaceRow, Pace, PitHazard, FinishingDist };
export { RaceTableRow, TyreStintBadge, DriverPaceSparkline };

export type SortKey = "pos" | "gap" | "pace";
export type SortDirection = "asc" | "desc";

export type RaceTableProps = {
  rows?: RaceRow[] | null;
  className?: string;
};

export const RaceTable = React.memo(function RaceTable({
  rows,
  className = "",
}: RaceTableProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [expandedDriver, setExpandedDriver] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const toggleExpand = useCallback((dn: number) => {
    setExpandedDriver((prev) => (prev === dn ? null : dn));
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const enriched: EnrichedRow[] = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const seen = new Set<number>();
    const uniqueRows: RaceRow[] = [];
    for (const r of rows) {
      const dn = r.driver_number;
      if (dn != null && seen.has(dn)) continue;
      if (dn != null) seen.add(dn);
      uniqueRows.push(r);
    }

    return uniqueRows.map((r, idx) => {
      const dn = r.driver_number ?? idx + 1;
      const info: DriverInfo = {
        name: r.name ?? `Driver ${dn}`,
        code: r.code ?? String(dn),
        team: r.team ?? "",
        color: r.color ?? "#334155",
        image: r.image,
      };

      return {
        ...r,
        driver_number: dn,
        position: r.position ?? idx + 1,
        tyre: r.tyre,
        tyreAge: r.tyreAge,
        info,
        paceVal: r.pace ?? null,
        pitVal: r.pit ?? null,
        finishingVal: r.finishing ?? null,
        sectorTimesVal: r.sectorTimes ?? null,
      };
    });
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...enriched].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "pos") {
        cmp = a.position - b.position;
      } else if (sortKey === "gap") {
        const gapA = a.gap === "LEADER" ? 0 : parseFloat(String(a.gap ?? "999").replace(/[^\d.-]/g, "")) || 999;
        const gapB = b.gap === "LEADER" ? 0 : parseFloat(String(b.gap ?? "999").replace(/[^\d.-]/g, "")) || 999;
        cmp = gapA - gapB;
      } else if (sortKey === "pace") {
        const paceA = a.paceVal?.q50 ?? 999;
        const paceB = b.paceVal?.q50 ?? 999;
        cmp = paceA - paceB;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [enriched, sortKey, sortDir]);

  return (
    <div className={`overflow-hidden rounded-xl border border-pitwall-border bg-pitwall-card ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 bg-pitwall-bg border-b border-pitwall-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-pitwall-accent shadow-[0_0_8px_rgba(255,24,1,0.6)] animate-pulse" />
          <h2 className="font-black tracking-tight text-sm text-white">
            RACE LEADERBOARD : LIVE PREDICTIONS
          </h2>
          <span className="hidden lg:inline text-[10px] tracking-widest px-2 py-1 rounded-full bg-pitwall-border border border-pitwall-steel text-pitwall-muted">
            q10 / q50 / q90
          </span>
        </div>
        <span className="text-[11px] text-pitwall-muted hidden sm:inline">
          Click row to expand telemetry
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <caption className="sr-only">Race leaderboard with pace forecasts and pit hazards</caption>
          <thead className="sticky top-0 z-10 text-[10px] tracking-widest text-pitwall-muted bg-pitwall-bg border-b border-pitwall-border">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-bold cursor-pointer select-none" onClick={() => handleSort("pos")}>
                POS {sortKey === "pos" ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold">
                DRIVER
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold cursor-pointer select-none" onClick={() => handleSort("gap")}>
                GAP / DRS {sortKey === "gap" ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold">
                TYRE
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold cursor-pointer select-none" onClick={() => handleSort("pace")}>
                PACE q50 + interval {sortKey === "pace" ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold">
                SECTORS
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold">
                PIT HAZARD
              </th>
              <th scope="col" className="text-left px-3 py-2 font-bold">
                FINISHING DIST
              </th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-pitwall-muted">
                  No timing rows available.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <RaceTableRow
                  key={row.driver_number}
                  row={row}
                  isHovered={hovered === row.driver_number}
                  isExpanded={expandedDriver === row.driver_number}
                  onToggleExpand={toggleExpand}
                  setHovered={setHovered}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 bg-pitwall-bg border-t border-pitwall-border flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <span className="inline-flex flex-wrap items-center gap-2 text-pitwall-steel">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full border-2 border-pitwall-green" /> Fresh
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full border-2 border-pitwall-yellow" /> Graining
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full border-2 border-pitwall-danger animate-pulse" /> Cliff
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-pitwall-green">▲ closing</span>{" "}
            <span className="text-pitwall-danger">▼ dropping</span> (±0.1s/lap)
          </span>
        </span>
        <span className="font-mono text-pitwall-steel hidden sm:inline">
          80% conformal interval • DRS if gap &lt;1.0s
        </span>
      </div>
    </div>
  );
});

export default RaceTable;