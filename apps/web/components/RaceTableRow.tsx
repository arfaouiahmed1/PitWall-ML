import * as React from "react";
import { useState } from "react";
import { DriverPaceSparkline } from "@/components/DriverPaceSparkline";
import { TyreStintBadge } from "@/components/TyreStintBadge";

export type Pace = { q10?: number; q50?: number; q90?: number };
export type RaceRow = {
  driver_number: number;
  position: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  image?: string;
  gap?: string;
  gapToLeader?: string;
  gapToAhead?: string;
  gapDelta?: number;
  drs?: boolean;
  tyre: "S" | "M" | "H" | "I" | "W";
  tyreAge: number;
  tyreWear?: number;
  forecast?: string;
  pace?: Pace;
  interval?: string;
  pitProb?: number;
  pit?: { p1?: number; p3?: number; p5?: number };
  finishing?: { p1?: number; podium?: number; points?: number };
  stintLaps?: number[];
  pitStopLaps?: number[];
  sectorTimes?: { s1?: number; s2?: number; s3?: number };
  lastLap?: string;
};

function shown(value: number | string | undefined): string {
  return value == null ? "-" : String(value);
}

export function RaceTableRow({ row }: { row: RaceRow }) {
  const [expanded, setExpanded] = useState(false);
  const pace = row.pace;
  const q10 = pace?.q10;
  const q50 = pace?.q50;
  const q90 = pace?.q90;
  return <>
    <tr className="border-b border-pitwall-border/60 hover:bg-pitwall-border/30">
      <td className="px-3 py-3">{shown(row.position)}</td>
      <td className="px-3 py-2"><span className="font-bold">{shown(row.code)}</span>{row.name ? <span className="ml-2 text-pitwall-fog">{row.name}</span> : null}{row.team ? <span className="ml-2 text-pitwall-muted">{row.team}</span> : null}<span className="ml-2 text-pitwall-steel">#{row.driver_number}</span></td>
      <td className="px-3 py-2 text-pitwall-ink">{shown(row.gap)}</td>
      <td className="px-3 py-2"><TyreStintBadge compound={row.tyre} age={row.tyreAge} wear={row.tyreWear} /></td>
      <td className="px-3 py-2 tabular-nums">{shown(q10)} / {shown(q50)} / {shown(q90)}</td>
      <td className="px-3 py-2"><button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for ${row.code ?? `car ${row.driver_number}`}`} onClick={() => setExpanded((value) => !value)} className="rounded px-2 py-1 text-pitwall-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitwall-cyan">{expanded ? "Hide" : "Details"}</button></td>
    </tr>
    {expanded ? <tr className="border-b border-pitwall-border/60 bg-pitwall-bg"><td colSpan={6} className="px-4 py-3 text-pitwall-fog">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div><dt className="text-pitwall-muted">Gap to leader</dt><dd>{shown(row.gapToLeader)}</dd></div>
        <div><dt className="text-pitwall-muted">Gap to ahead</dt><dd>{shown(row.gapToAhead)}</dd></div>
        <div><dt className="text-pitwall-muted">Gap delta</dt><dd>{shown(row.gapDelta)}</dd></div>
        <div><dt className="text-pitwall-muted">DRS</dt><dd>{row.drs == null ? "N/A" : row.drs ? "Active" : "Inactive"}</dd></div>
        <div><dt className="text-pitwall-muted">Sectors</dt><dd>S1 {shown(row.sectorTimes?.s1)} · S2 {shown(row.sectorTimes?.s2)} · S3 {shown(row.sectorTimes?.s3)}</dd></div>
        <div><dt className="text-pitwall-muted">Pit laps</dt><dd>{row.pitStopLaps?.join(", ") ?? "-"}</dd></div>
        <div><dt className="text-pitwall-muted">Last lap</dt><dd>{shown(row.lastLap)}</dd></div>
        <div><dt className="text-pitwall-muted">Stint laps</dt><dd><DriverPaceSparkline values={row.stintLaps} color={row.color} /></dd></div>
        <div><dt className="text-pitwall-muted">Tyre wear</dt><dd>{row.tyreWear == null ? "N/A" : `${row.tyreWear}%`}</dd></div>
        <div><dt className="text-pitwall-muted">Pit probability</dt><dd>{row.pit ? `1L ${shown(row.pit.p1)} / 3L ${shown(row.pit.p3)} / 5L ${shown(row.pit.p5)}` : shown(row.pitProb)}</dd></div>
        <div><dt className="text-pitwall-muted">Finish probabilities</dt><dd>{row.finishing ? `P1 ${shown(row.finishing.p1)} / Podium ${shown(row.finishing.podium)} / Points ${shown(row.finishing.points)}` : "N/A"}</dd></div>
      </dl>
    </td></tr> : null}
  </>;
}
