import * as React from "react";
import { DriverAvatar } from "@/components/DriverAvatar";
import { TyreStintBadge } from "./TyreStintBadge";
import { DriverPaceSparkline } from "./DriverPaceSparkline";
import type { EnrichedRow } from "./types";

export type RaceTableRowProps = {
  row: EnrichedRow;
  isHovered: boolean;
  isExpanded: boolean;
  onToggleExpand: (driverNumber: number) => void;
  setHovered: React.Dispatch<React.SetStateAction<number | null>>;
};

export const RaceTableRow = React.memo(function RaceTableRow({
  row: r,
  isHovered,
  isExpanded,
  onToggleExpand,
  setHovered,
}: RaceTableRowProps) {
  const delta = r.gapDelta ?? null;
  const closing = delta !== null && delta < -0.1;
  const dropping = delta !== null && delta > 0.1;
  const deltaLabel = closing ? "closing" : dropping ? "dropping" : "stable";

  return (
    <>
      <tr
        tabIndex={0}
        onClick={() => onToggleExpand(r.driver_number)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand(r.driver_number);
          }
        }}
        onMouseEnter={() => setHovered(r.driver_number)}
        onFocus={() => setHovered(r.driver_number)}
        onMouseLeave={() => setHovered((v) => (v === r.driver_number ? null : v))}
        onBlur={() => setHovered((v) => (v === r.driver_number ? null : v))}
        className={`border-b border-pitwall-border/60 transition cursor-pointer ${
          isExpanded
            ? "bg-pitwall-border/70"
            : isHovered
              ? "bg-pitwall-border/50"
              : "hover:bg-pitwall-border/30 focus-visible:bg-pitwall-border/50"
        }`}
      >
        <td className="px-3 py-3">
          <span
            className={`inline-flex w-7 h-7 items-center justify-center rounded-lg font-black text-xs border ${
              r.position <= 3
                ? "bg-pitwall-yellow text-pitwall-card border-pitwall-yellow"
                : "bg-pitwall-border text-pitwall-ink border-pitwall-steel"
            }`}
          >
            {r.position}
          </span>
        </td>

        <td className="px-3 py-2">
          <div className="flex items-center gap-2.5 min-w-[190px]">
            <span
              aria-hidden="true"
              className="w-1 h-8 rounded-full shrink-0"
              style={{ background: r.info.color }}
            />
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
                <span className="text-[10px] px-1 py-0.5 rounded bg-pitwall-border border border-pitwall-steel text-pitwall-fog">
                  #{r.driver_number}
                </span>
              </span>
              <span className="text-[11px] text-pitwall-fog font-sans truncate max-w-[110px]">
                {r.info.name}
              </span>
            </span>
            <span
              className="hidden lg:inline-flex text-[9px] px-1.5 py-0.5 rounded-full border font-bold tracking-widest shrink-0"
              style={{
                background: `${r.info.color}18`,
                color: r.info.color,
                borderColor: `${r.info.color}40`,
              }}
            >
              {r.info.team?.slice(0, 3).toUpperCase() || "F1"}
            </span>
          </div>
        </td>

        <td className="px-3 py-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`font-bold ${r.position === 1 ? "text-pitwall-green" : "text-pitwall-ink"}`}>
                {r.gap ?? "-"}
              </span>
              {delta !== null ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border ${
                    closing
                      ? "bg-pitwall-green/15 text-pitwall-green border-pitwall-green/30"
                      : dropping
                        ? "bg-pitwall-danger/12 text-pitwall-rose border-pitwall-danger/30"
                        : "bg-pitwall-border text-pitwall-muted border-pitwall-steel"
                  }`}
                  title={`Gap delta ${delta > 0 ? "+" : ""}${delta.toFixed(3)} s/lap`}
                >
                  <span
                    aria-hidden="true"
                    className={`${
                      closing ? "text-pitwall-green" : dropping ? "text-pitwall-danger" : "text-pitwall-steel"
                    } text-[11px] leading-none`}
                  >
                    {closing ? "▲" : dropping ? "▼" : "•"}
                  </span>
                  <span className="sr-only">{deltaLabel}</span>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(2)}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-pitwall-steel">{r.gapToAhead ?? "-"}</span>
              {r.position !== 1 && typeof r.drs === "boolean" && (
                <span
                  className={`text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded border ${
                    r.drs
                      ? "bg-pitwall-cyan/15 text-pitwall-cyan border-pitwall-cyan/30 shadow-[0_0_6px_rgba(0,210,190,0.25)]"
                      : "bg-pitwall-border text-pitwall-steel border-pitwall-steel"
                  }`}
                >
                  <span aria-hidden="true">{r.drs ? "DRS ●" : "DRS -"}</span>
                  <span className="sr-only">{r.drs ? "DRS active" : "DRS inactive"}</span>
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="px-3 py-2">
          <TyreStintBadge compound={r.tyre} age={r.tyreAge} wear={r.tyreWear} />
        </td>

        <td className="px-3 py-2">
          <DriverPaceSparkline pace={r.paceVal} />
        </td>

        <td className="px-3 py-2">
          {r.sectorTimesVal ? (
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-fog" title="Sector 1">
                <span className="text-[9px] text-pitwall-muted mr-1">S1</span>
                {r.sectorTimesVal.s1.toFixed(1)}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-mint" title="Sector 2">
                <span className="text-[9px] text-pitwall-muted mr-1">S2</span>
                {r.sectorTimesVal.s2.toFixed(1)}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-fog" title="Sector 3">
                <span className="text-[9px] text-pitwall-muted mr-1">S3</span>
                {r.sectorTimesVal.s3.toFixed(1)}
              </span>
            </div>
          ) : (
            <span className="text-xs font-mono text-pitwall-muted">-</span>
          )}
        </td>

        <td className="px-3 py-2">
          {r.pitVal ? (
            <div className="flex items-center gap-1.5">
              {(["p1", "p3", "p5"] as const).map((k) => {
                const v = r.pitVal![k];
                return (
                  <div key={k} className="flex flex-col items-center gap-1">
                    <span className="text-[9px] tracking-widest font-bold text-pitwall-muted">{k.toUpperCase()}</span>
                    <span className="text-[10px] font-black">{v}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-xs font-mono text-pitwall-muted">-</span>
          )}
        </td>

        <td className="px-3 py-2">
          {r.finishingVal ? (
            <div className="min-w-[120px] space-y-1">
              {[
                { k: "P1", v: r.finishingVal.p1, col: "#eab308" },
                { k: "Pod", v: r.finishingVal.podium, col: "#38bdf8" },
                { k: "Pts", v: r.finishingVal.points, col: "#22c55e" },
              ].map((f) => (
                <div key={f.k} className="flex items-center gap-1.5">
                  <span className="text-[9px] w-6 font-bold text-pitwall-muted">{f.k}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-pitwall-border overflow-hidden">
                    <span className="block h-full rounded-full" style={{ width: `${f.v}%`, background: f.col }} />
                  </div>
                  <span className="text-[10px] font-mono w-6 text-right">{f.v}%</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs font-mono text-pitwall-muted">-</span>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-pitwall-bg/95 border-b border-pitwall-border">
          <td colSpan={8} className="px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-white">
                  Driver #{r.driver_number} Telemetry Drawer
                </div>
                <div className="text-[11px] text-pitwall-muted mt-0.5">
                  {r.info.team ? `${r.info.team} • ` : ""}Tyre compound {r.tyre} (Age: {r.tyreAge} laps)
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export default RaceTableRow;