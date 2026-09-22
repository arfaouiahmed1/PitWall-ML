"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function InsightMetric({
  label,
  value,
  unit,
  delta,
  thresholdLabel,
  status = "normal",
  note,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string | number; positiveIsGood?: boolean };
  thresholdLabel?: string;
  status?: "normal" | "healthy" | "warning" | "critical";
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "p-3 rounded-md bg-pitwall-card border border-pitwall-border flex flex-col justify-between gap-2 font-mono",
        status === "healthy" && "border-pitwall-green/30",
        status === "warning" && "border-pitwall-amber/30",
        status === "critical" && "border-pitwall-danger/40 bg-pitwall-danger/5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-wider font-bold text-pitwall-muted uppercase truncate">
          {label}
        </span>
        {thresholdLabel && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-pitwall-bg text-pitwall-muted border border-pitwall-border/70 shrink-0">
            {thresholdLabel}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-black text-pitwall-ink">{value}</span>
        {unit && <span className="text-xs text-pitwall-muted">{unit}</span>}
        {delta && (
          <span
            className={cn(
              "ml-auto text-[11px] font-bold",
              delta.positiveIsGood ? "text-pitwall-mint" : "text-pitwall-rose"
            )}
          >
            {delta.value}
          </span>
        )}
      </div>

      {note && <div className="text-[10px] text-pitwall-muted truncate">{note}</div>}
    </div>
  );
}
