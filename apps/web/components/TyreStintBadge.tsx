import * as React from "react";

const COMPOUND_CLASS: Record<string, string> = {
  S: "border-pitwall-danger text-pitwall-danger",
  M: "border-pitwall-yellow text-pitwall-yellow",
  H: "border-pitwall-fog text-pitwall-fog",
  I: "border-pitwall-green text-pitwall-green",
  W: "border-pitwall-cyan text-pitwall-cyan",
};

export function TyreStintBadge({ compound, age, wear }: { compound?: string; age?: number; wear?: number }) {
  if (!compound && age == null) return <span className="text-pitwall-muted">N/A</span>;
  return <span className={`inline-flex items-center gap-2 rounded border px-2 py-1 ${COMPOUND_CLASS[compound ?? ""] ?? "border-pitwall-steel text-pitwall-fog"}`}>
    <span>{compound ?? "-"}</span>
    <span className="text-pitwall-fog">age {age ?? "-"}</span>
    {wear == null ? <span className="text-pitwall-muted">wear N/A</span> : <span className="text-pitwall-fog">wear {wear}%</span>}
  </span>;
}
