import * as React from "react";
import { COMPOUND_NAMES } from "@/lib/drivers";

export type TyreCompound = "S" | "M" | "H" | "I" | "W";

const COMPOUND_STYLE: Record<TyreCompound, { bg: string; text: string; border: string; label: string }> = {
  S: { bg: "bg-pitwall-danger", text: "text-white", border: "border-pitwall-danger", label: "S" },
  M: { bg: "bg-pitwall-yellow", text: "text-pitwall-card", border: "border-pitwall-yellow", label: "M" },
  H: { bg: "bg-pitwall-fog", text: "text-pitwall-card", border: "border-white", label: "H" },
  I: { bg: "bg-pitwall-green", text: "text-white", border: "border-pitwall-green", label: "I" },
  W: { bg: "bg-pitwall-cyan", text: "text-white", border: "border-pitwall-cyan", label: "W" },
};

function wearColor(w: number): string {
  if (w > 55) return "#22c55e";
  if (w > 25) return "#eab308";
  return "#ef4444";
}

export type TyreStintBadgeProps = {
  compound?: TyreCompound | string;
  age?: number | null;
  wear?: number | null;
};

export const TyreStintBadge = React.memo(function TyreStintBadge({
  compound,
  age,
  wear,
}: TyreStintBadgeProps) {
  const normalizedCompound = typeof compound === "string" ? compound.toUpperCase() : undefined;
  const validCompound = normalizedCompound && normalizedCompound in COMPOUND_STYLE
    ? normalizedCompound as TyreCompound
    : undefined;

  if (!validCompound) {
    return <span className="text-xs font-mono text-pitwall-muted">N/A</span>;
  }

  const style = COMPOUND_STYLE[validCompound];
  const hasWear = typeof wear === "number" && Number.isFinite(wear);
  const normWear = hasWear ? Math.max(0, Math.min(100, wear)) : null;

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-9 h-9 shrink-0">
        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" aria-hidden="true">
          <circle cx={18} cy={18} r={14} fill="none" stroke="#1e293b" strokeWidth={3.5} />
          {normWear !== null && (
            <circle
              cx={18}
              cy={18}
              r={14}
              fill="none"
              stroke={wearColor(normWear)}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeDasharray={`${(normWear / 100) * 87.96} 87.96`}
              className={normWear < 22 ? "animate-pulse" : undefined}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center w-9 h-9">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black border ${style.bg} ${style.text} ${style.border}`}>
            {style.label}
          </span>
        </span>
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-bold text-xs">
          {COMPOUND_NAMES[validCompound] ?? validCompound}{" "}
          <span className="text-pitwall-fog font-normal">
            {typeof age === "number" ? `x ${age}` : "x -"}
          </span>
        </span>
        <span
          className="text-[10px] font-mono mt-0.5"
          style={{ color: normWear !== null ? wearColor(normWear) : "#94a3b8" }}
        >
          {normWear !== null ? (
            `${normWear < 22 ? "CLIFF ● " : normWear < 45 ? "Graining " : "Fresh "}${Math.round(normWear)}%`
          ) : (
            "-"
          )}
        </span>
        {normWear !== null && (
          <span className="mt-1 w-16 h-1 rounded-full bg-pitwall-border overflow-hidden block">
            <span
              className="block h-full rounded-full transition-all"
              style={{ width: `${normWear}%`, background: wearColor(normWear) }}
            />
          </span>
        )}
      </div>
    </div>
  );
});

export default TyreStintBadge;
