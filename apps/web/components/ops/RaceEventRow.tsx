"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type RaceEventItem = {
  id: string | number;
  lap: number;
  timestamp?: string;
  source: string;
  category: "FASTEST" | "PIT" | "ANOMALY" | "OVERTAKE" | "DRS" | "FLAG" | "SYSTEM";
  summary: string;
  detail?: string;
  driverNumber?: number;
};

const CATEGORY_STYLES: Record<RaceEventItem["category"], { label: string; text: string; bg: string; border: string }> = {
  FASTEST: { label: "FL", text: "text-pitwall-cyan", bg: "bg-pitwall-cyan/10", border: "border-pitwall-cyan/30" },
  PIT: { label: "PIT", text: "text-pitwall-amberlight", bg: "bg-pitwall-amber/10", border: "border-pitwall-amber/30" },
  ANOMALY: { label: "DELTA", text: "text-pitwall-rose", bg: "bg-pitwall-danger/10", border: "border-pitwall-danger/30" },
  OVERTAKE: { label: "PASS", text: "text-pitwall-mint", bg: "bg-pitwall-green/10", border: "border-pitwall-green/30" },
  DRS: { label: "DRS", text: "text-pitwall-cyan", bg: "bg-pitwall-cyan/10", border: "border-pitwall-cyan/30" },
  FLAG: { label: "FLAG", text: "text-pitwall-yellow", bg: "bg-pitwall-yellow/10", border: "border-pitwall-yellow/30" },
  SYSTEM: { label: "SYS", text: "text-pitwall-fog", bg: "bg-pitwall-border", border: "border-pitwall-steel" },
};

export function RaceEventRow({
  event,
  className,
}: {
  event: RaceEventItem;
  className?: string;
}) {
  const meta = CATEGORY_STYLES[event.category] ?? CATEGORY_STYLES.SYSTEM;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2 border-b border-pitwall-border/50 text-xs font-mono hover:bg-pitwall-border/20 transition-colors",
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-muted shrink-0">
          L{event.lap}
        </span>
        <span
          className={cn(
            "text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 tracking-wider",
            meta.text,
            meta.bg,
            meta.border
          )}
        >
          {meta.label}
        </span>
        {event.driverNumber != null && (
          <span className="font-bold text-pitwall-ink shrink-0">#{event.driverNumber}</span>
        )}
        <span className="text-pitwall-fog truncate text-xs">{event.summary}</span>
      </div>

      {event.detail && (
        <span className="text-[11px] text-pitwall-muted shrink-0 max-w-[200px] truncate hidden sm:inline">
          {event.detail}
        </span>
      )}
    </div>
  );
}
