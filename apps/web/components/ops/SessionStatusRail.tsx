"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type SessionStage = {
  label: string;
  detail?: string;
  status: "active" | "complete" | "pending" | "alert";
};

export function SessionStatusRail({
  stages,
  className,
}: {
  stages: SessionStage[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 p-2 bg-pitwall-card border border-pitwall-border rounded-md text-xs font-mono",
        className
      )}
    >
      {stages.map((stage, idx) => {
        const isAlert = stage.status === "alert";
        const isActive = stage.status === "active";
        const isComplete = stage.status === "complete";

        return (
          <div key={stage.label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded border",
                isActive && "bg-pitwall-green/10 text-pitwall-mint border-pitwall-green/30",
                isComplete && "bg-pitwall-bg text-pitwall-fog border-pitwall-border",
                isAlert && "bg-pitwall-danger/10 text-pitwall-rose border-pitwall-danger/30",
                stage.status === "pending" && "bg-pitwall-bg text-pitwall-muted border-pitwall-border/40 opacity-70"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive && "bg-pitwall-green animate-pulse",
                  isComplete && "bg-pitwall-fog",
                  isAlert && "bg-pitwall-danger animate-pulse",
                  stage.status === "pending" && "bg-pitwall-steel"
                )}
                aria-hidden="true"
              />
              <span className="font-bold tracking-wide">{stage.label}</span>
              {stage.detail && (
                <span className="text-pitwall-muted border-l border-pitwall-border/60 pl-1.5 ml-0.5 text-[11px]">
                  {stage.detail}
                </span>
              )}
            </div>
            {idx < stages.length - 1 && (
              <span className="text-pitwall-steel text-xs select-none" aria-hidden="true">
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
