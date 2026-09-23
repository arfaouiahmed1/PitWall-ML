import * as React from "react";

export type PacePrediction = {
  q10?: number;
  q50?: number;
  q90?: number;
};

export type DriverPaceSparklineProps = {
  pace?: PacePrediction | null;
  className?: string;
};

function fmtPace(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

export const DriverPaceSparkline = React.memo(function DriverPaceSparkline({
  pace,
  className = "",
}: DriverPaceSparklineProps) {
  const q10 = pace?.q10;
  const q50 = pace?.q50;
  const q90 = pace?.q90;
  const hasQ10 = typeof q10 === "number" && Number.isFinite(q10);
  const hasQ50 = typeof q50 === "number" && Number.isFinite(q50);
  const hasQ90 = typeof q90 === "number" && Number.isFinite(q90);

  if (!hasQ10 && !hasQ50 && !hasQ90) {
    return (
      <div className={`min-w-[170px] text-xs font-mono text-pitwall-muted ${className}`}>
        <span>-</span>
        <div className="text-[10px] text-pitwall-steel font-mono mt-0.5">
          - / - / -
        </div>
      </div>
    );
  }

  const half = hasQ10 && hasQ90 ? Math.max(0, (q90 - q10) / 2) : undefined;
  const widthPct = half === undefined ? undefined : Math.min(100, Math.max(10, (half / 0.7) * 100));

  return (
    <div className={`min-w-[170px] ${className}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-black text-xs font-mono text-white">{hasQ50 ? fmtPace(q50) : "-"}</span>
        {half !== undefined ? <span className="text-[11px] text-pitwall-fog font-mono">+{half.toFixed(3)}s</span> : null}
        {half !== undefined ? <span
          className={`ml-1 w-1.5 h-1.5 rounded-full ${
            half < 0.32
              ? "bg-pitwall-green shadow-[0_0_6px_rgba(34,197,94,0.6)]"
              : half < 0.5
                ? "bg-pitwall-yellow"
                : "bg-pitwall-danger"
          }`}
          title="Interval width"
        /> : null}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-pitwall-steel">{hasQ10 ? q10 : "-"}</span>
        {widthPct !== undefined ? <span className="flex-1 h-1.5 rounded-full bg-pitwall-border overflow-hidden relative">
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${Math.max(0, 50 - widthPct / 2)}%`,
              width: `${widthPct}%`,
              background: half < 0.35 ? "#22c55e" : half < 0.5 ? "#eab308" : "#ef4444",
              opacity: 0.95,
            }}
          />
          <span className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-white rounded-full" style={{ left: "50%" }} />
        </span> : <span className="flex-1 h-px bg-pitwall-border" />}
        <span className="text-[9px] font-mono text-pitwall-steel">{hasQ90 ? q90 : "-"}</span>
      </div>
      <div className="text-[10px] text-pitwall-steel font-mono mt-0.5">
        {hasQ10 ? q10 : "-"} / {hasQ50 ? q50 : "-"} / {hasQ90 ? q90 : "-"}
      </div>
    </div>
  );
});

export default DriverPaceSparkline;
