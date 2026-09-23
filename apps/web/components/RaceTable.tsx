"use client";

import * as React from "react";
import { memo, useMemo, useState } from "react";
import { RaceTableRow } from "@/components/RaceTableRow";
import type { Pace, RaceRow } from "@/components/RaceTableRow";

export type { Pace, RaceRow } from "@/components/RaceTableRow";

type SortKey = "position" | "driver_number" | "gap" | "pace" | "tyreAge";

function sortValue(row: RaceRow, key: SortKey): number | string | null {
  if (key === "gap") {
    if (row.gap == null) return null;
    if (row.gap === "LEADER") return 0;
    const value = Number(row.gap.replace(/^\+/, ""));
    return Number.isFinite(value) ? value : null;
  }
  if (key === "pace") return row.pace?.q50 ?? null;
  return row[key] ?? null;
}

function compareRows(a: RaceRow, b: RaceRow, key: SortKey, direction: "asc" | "desc"): number {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
  return direction === "asc" ? result : -result;
}

export const RaceTable = memo(function RaceTable({ rows }: { rows: RaceRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "position", direction: "asc" });
  const sortedRows = useMemo(() => [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.direction)), [rows, sort]);

  function changeSort(key: SortKey): void {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: "position", label: "POS" },
    { key: "driver_number", label: "DRIVER" },
    { key: "gap", label: "GAP" },
    { key: "tyreAge", label: "TYRE" },
    { key: "pace", label: "PACE q10 / q50 / q90 (s)" },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-pitwall-border bg-pitwall-card">
      <div className="border-b border-pitwall-border bg-pitwall-bg px-4 py-3">
        <h2 className="font-black text-sm tracking-tight">RACE LEADERBOARD</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Race leaderboard. Activate a column heading to sort.</caption>
          <thead className="sticky top-0 z-10 border-b border-pitwall-border bg-pitwall-bg text-left text-[10px] tracking-widest text-pitwall-muted">
            <tr>{headers.map(({ key, label }) => (
              <th key={key} scope="col" aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2 font-bold">
                <button type="button" onClick={() => changeSort(key)} className="rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitwall-cyan">
                  {label}{sort.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}<th scope="col" className="px-3 py-2">DETAILS</th></tr>
          </thead>
          <tbody className="font-mono text-xs">
            {sortedRows.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-pitwall-muted">No timing rows available.</td></tr> : sortedRows.map((row) => <RaceTableRow key={`${row.driver_number}-${row.position}`} row={row} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
});

export default RaceTable;
