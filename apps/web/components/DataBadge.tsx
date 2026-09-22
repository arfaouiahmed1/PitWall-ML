"use client";

export type DataProvenance = "LIVE" | "STALE" | "MOCK" | "SIMULATED";

const META: Record<DataProvenance, { label: string; classes: string; dot: string }> = {
  LIVE: {
    label: "LIVE",
    classes: "bg-pitwall-green/12 text-pitwall-green border-pitwall-green/30",
    dot: "bg-pitwall-green",
  },
  STALE: {
    label: "STALE",
    classes: "bg-pitwall-yellow/12 text-pitwall-yellow border-pitwall-yellow/30",
    dot: "bg-pitwall-yellow",
  },
  MOCK: {
    label: "MOCK",
    classes: "bg-pitwall-blue/12 text-pitwall-fog border-pitwall-blue/30",
    dot: "bg-pitwall-blue",
  },
  SIMULATED: {
    label: "SIMULATED",
    classes: "bg-pitwall-cyan/10 text-pitwall-cyan border-pitwall-cyan/30",
    dot: "bg-pitwall-cyan",
  },
};

export function DataBadge({
  variant,
  detail,
  className = "",
}: {
  variant: DataProvenance;
  detail?: string;
  className?: string;
}) {
  const m = META[variant];
  const label = detail ? `${m.label}: ${detail}` : `${m.label} data`;
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-black tracking-widest ${m.classes} ${className}`}
    >
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
      {detail ? <span className="font-mono font-normal normal-case tracking-normal opacity-80">{detail}</span> : null}
    </span>
  );
}

export default DataBadge;
