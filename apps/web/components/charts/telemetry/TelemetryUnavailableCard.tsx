import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface TelemetryUnavailableCardProps {
  title: string;
  subtitle: string;
  className?: string;
  reason?: string;
}

export function TelemetryUnavailableCard({
  title,
  subtitle,
  className,
  reason,
}: TelemetryUnavailableCardProps) {
  const errorReason = reason
    ? reason === "corrupt_throttle_bounds"
      ? "Corrupt throttle values outside [0, 100]%"
      : reason === "corrupt_brake_bounds"
      ? "Corrupt brake values outside [0, 100]%"
      : reason === "corrupt_speed_bounds"
      ? "Corrupt speed values outside [0, 450] km/h"
      : reason === "out_of_order_timestamps"
      ? "Out-of-order source timestamps detected"
      : reason === "missing_timestamps"
      ? "Incomplete timestamps in telemetry stream"
      : reason === "missing_axis"
      ? "Missing timeline axis (no timestamp or distance)"
      : reason === "missing_throttle"
      ? "Missing source throttle value"
      : reason === "missing_brake"
      ? "Missing source brake value"
      : reason === "missing_speed"
      ? "Missing source speed value"
      : reason === "missing_gear"
      ? "Missing source gear value"
      : reason === "missing_drs"
      ? "Missing source DRS value"
      : reason
    : "No telemetry samples recorded for this session or driver.";

  return (
    <Card className={cn("bg-pitwall-card border-pitwall-border overflow-hidden", className)}>
      <CardHeader className="p-4 border-b border-pitwall-border bg-pitwall-bg/60">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xs font-black tracking-widest text-pitwall-fog uppercase">
              {title}
            </CardTitle>
            <CardDescription className="text-[11px] text-pitwall-muted mt-0.5">
              {subtitle}
            </CardDescription>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-400">
            UNAVAILABLE
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-3">
        <div className="text-xs font-mono text-pitwall-muted uppercase tracking-wider">
          Telemetry Data Unavailable
        </div>
        <p className="text-xs text-pitwall-steel max-w-sm">
          {errorReason}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 w-full max-w-md text-xs font-mono">
          <div className="p-2 rounded border border-pitwall-border bg-pitwall-bg text-center">
            <div className="text-[10px] text-pitwall-steel">SPEED</div>
            <div className="text-pitwall-muted font-bold mt-0.5">- km/h</div>
          </div>
          <div className="p-2 rounded border border-pitwall-border bg-pitwall-bg text-center">
            <div className="text-[10px] text-pitwall-steel">THROTTLE</div>
            <div className="text-pitwall-muted font-bold mt-0.5">-%</div>
          </div>
          <div className="p-2 rounded border border-pitwall-border bg-pitwall-bg text-center">
            <div className="text-[10px] text-pitwall-steel">BRAKE</div>
            <div className="text-pitwall-muted font-bold mt-0.5">-%</div>
          </div>
          <div className="p-2 rounded border border-pitwall-border bg-pitwall-bg text-center">
            <div className="text-[10px] text-pitwall-steel">GEAR</div>
            <div className="text-pitwall-muted font-bold mt-0.5">-</div>
          </div>
          <div className="p-2 rounded border border-pitwall-border bg-pitwall-bg text-center">
            <div className="text-[10px] text-pitwall-steel">DRS</div>
            <div className="text-pitwall-muted font-bold mt-0.5">-</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
