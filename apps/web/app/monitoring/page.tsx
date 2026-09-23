"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { fetchJson, isRecord, startPoller } from "@/lib/fetcher";

type DriftMetric = {
  feature: string;
  ks_statistic: number;
  ks_pvalue: number | null;
  wasserstein: number;
  psi: number;
  js_divergence: number;
  drifted: boolean;
  severity: string;
  reference_mean: number;
  current_mean: number;
  relative_shift_pct: number;
};

type EraReport = {
  status: "available" | "no_data" | "unavailable";
  reason: string | null;
  reference_era: string;
  current_era: string;
  n_reference_sessions: number;
  n_current_sessions: number;
  results: DriftMetric[];
  metric_count: number;
  overall_drift_ratio: number;
  max_severity: string;
  broken_features: string[];
  source_fingerprint: string;
};

type Overview = {
  status: string;
  model_version?: string;
  metrics: Record<string, number>;
  drift_ratio?: number;
  drifted_features?: string[];
  promotion_passed?: boolean;
  timestamp?: string;
};

type MonitoringData = {
  era: EraReport | null;
  overview: Overview | null;
  unavailable: boolean;
};

export function parseEraReport(value: unknown): EraReport | null {
  if (!isRecord(value) || (value.status !== "available" && value.status !== "no_data" && value.status !== "unavailable")) return null;
  if (!Array.isArray(value.results)) return null;
  const results = value.results.filter((row): row is DriftMetric =>
    isRecord(row) && typeof row.feature === "string" &&
    typeof row.ks_statistic === "number" && typeof row.wasserstein === "number" &&
    typeof row.psi === "number" && typeof row.js_divergence === "number" &&
    typeof row.drifted === "boolean" && typeof row.severity === "string" &&
    typeof row.reference_mean === "number" && typeof row.current_mean === "number" &&
    typeof row.reference_std === "number" && typeof row.current_std === "number" &&
    typeof row.relative_shift_pct === "number" &&
    (row.ks_pvalue === null || typeof row.ks_pvalue === "number"),
  );
  if (
    results.length !== value.results.length || typeof value.reference_era !== "string" ||
    typeof value.current_era !== "string" || typeof value.n_reference_sessions !== "number" ||
    typeof value.n_current_sessions !== "number" || typeof value.metric_count !== "number" ||
    typeof value.overall_drift_ratio !== "number" || typeof value.max_severity !== "string" ||
    typeof value.source_fingerprint !== "string"
  ) return null;
  return {
    status: value.status,
    reason: typeof value.reason === "string" ? value.reason : null,
    reference_era: value.reference_era,
    current_era: value.current_era,
    n_reference_sessions: value.n_reference_sessions,
    n_current_sessions: value.n_current_sessions,
    results,
    metric_count: value.metric_count,
    overall_drift_ratio: value.overall_drift_ratio,
    max_severity: value.max_severity,
    broken_features: Array.isArray(value.broken_features) ? value.broken_features.filter((item): item is string => typeof item === "string") : [],
    source_fingerprint: value.source_fingerprint,
  };
}

function parseOverview(value: unknown): Overview | null {
  if (!isRecord(value) || typeof value.status !== "string" || !isRecord(value.metrics)) return null;
  const metrics = Object.fromEntries(Object.entries(value.metrics).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  return {
    status: value.status,
    metrics,
    ...(typeof value.model_version === "string" ? { model_version: value.model_version } : {}),
    ...(typeof value.drift_ratio === "number" ? { drift_ratio: value.drift_ratio } : {}),
    ...(Array.isArray(value.drifted_features) ? { drifted_features: value.drifted_features.filter((item): item is string => typeof item === "string") } : {}),
    ...(typeof value.promotion_passed === "boolean" ? { promotion_passed: value.promotion_passed } : {}),
    ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
  };
}

const initial: MonitoringData = { era: null, overview: null, unavailable: false };

export default function MonitoringPage() {
  const [data, setData] = useState<MonitoringData>(initial);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = API_URL.replace(/\/$/, "");
    const poll = async () => {
      const [eraPayload, overviewPayload] = await Promise.all([
        fetchJson<unknown>(`${base}/monitoring/era-drift`),
        fetchJson<unknown>(`${base}/monitoring/overview`),
      ]);
      if (cancelled) return;
      const era = parseEraReport(eraPayload);
      const overview = parseOverview(overviewPayload);
      setData({ era, overview, unavailable: eraPayload === null && overviewPayload === null });
      if (era || overview) setCheckedAt(Date.now());
    };
    void poll();
    const stop = startPoller(() => void poll(), 12000);
    return () => { cancelled = true; stop(); };
  }, []);

  const report = data.era;
  const overview = data.overview;
  const stale = checkedAt !== null && Date.now() - checkedAt > 36000;
  const state = stale ? "stale" : data.unavailable ? "unavailable" : report?.status ?? overview?.status ?? "loading";
  const reason = report?.reason ?? (data.unavailable ? "Monitoring endpoints did not return data." : null);

  return (
    <main className="space-y-5" aria-live="polite">
      <header className="rounded-xl border border-pitwall-border bg-pitwall-card p-6">
        <h1 className="text-xl font-black">Monitoring and era drift</h1>
        <p className="mt-1 text-sm text-pitwall-muted">Observed API measurements with source and freshness details.</p>
        <p className="mt-3 text-sm" role="status">Status: {state}{reason ? ` - ${reason}` : ""}</p>
        {overview?.timestamp && <p className="mt-1 text-xs text-pitwall-muted">Overview response timestamp: {overview.timestamp}</p>}
        {report?.source_fingerprint && <p className="mt-1 break-all text-xs text-pitwall-muted">Era drift source fingerprint: {report.source_fingerprint}</p>}
        {checkedAt !== null && <p className="mt-1 text-xs text-pitwall-muted">Last checked {new Date(checkedAt).toISOString()}{stale ? " - stale" : " - current"}</p>}
        {overview?.model_version && <p className="mt-1 text-xs text-pitwall-muted">Model version: {overview.model_version}</p>}
      </header>

      {report?.status === "available" && report.results.length > 0 ? (
        <section className="rounded-xl border border-pitwall-border bg-pitwall-card p-6" aria-labelledby="drift-title">
          <h2 id="drift-title" className="font-bold">{report.reference_era} to {report.current_era} drift</h2>
          <p className="mt-1 text-xs text-pitwall-muted">{report.n_reference_sessions} reference sessions, {report.n_current_sessions} current sessions - {report.metric_count} measured features</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="text-xs text-pitwall-muted"><th className="p-2">Feature</th><th className="p-2">Wasserstein</th><th className="p-2">KS</th><th className="p-2">PSI</th><th className="p-2">JS divergence</th><th className="p-2">Severity</th></tr></thead>
              <tbody>{report.results.map((metric) => <tr key={metric.feature} className="border-t border-pitwall-border"><th scope="row" className="p-2 font-mono">{metric.feature}</th><td className="p-2">{metric.wasserstein}</td><td className="p-2">{metric.ks_statistic}{metric.ks_pvalue === null ? "" : ` (p=${metric.ks_pvalue})`}</td><td className="p-2">{metric.psi}</td><td className="p-2">{metric.js_divergence}</td><td className="p-2">{metric.severity}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-pitwall-muted">Overall drift ratio: {report.overall_drift_ratio} - flagged: {report.broken_features.join(", ") || "none"}</p>
        </section>
      ) : report?.status === "no_data" ? <p className="rounded-xl border border-pitwall-border bg-pitwall-card p-6" role="status">No drift observations: {report.reason ?? "the source contains no measurable feature rows."}</p>
        : report?.status === "unavailable" ? <p className="rounded-xl border border-pitwall-border bg-pitwall-card p-6" role="status">Era drift is unavailable: {report.reason ?? "the source could not be read."}</p>
          : !report && !data.unavailable ? <p className="rounded-xl border border-pitwall-border bg-pitwall-card p-6" role="status">Waiting for monitoring data.</p> : null}

      {overview && Object.keys(overview.metrics).length > 0 && <section className="rounded-xl border border-pitwall-border bg-pitwall-card p-6" aria-labelledby="overview-title">
        <h2 id="overview-title" className="font-bold">Observed overview metrics</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(overview.metrics).map(([name, value]) => <div key={name}><dt className="text-xs text-pitwall-muted">{name}</dt><dd className="font-mono">{value}</dd></div>)}</dl>
      </section>}
    </main>
  );
}
