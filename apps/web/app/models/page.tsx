"use client";

import { useEffect, useMemo, useState } from "react";
import { FeatureWaterfallChart } from "@/components/charts/FeatureWaterfallChart";
import { API_URL } from "@/lib/api";
import { fetchJson, isRecord, num, startPoller } from "@/lib/fetcher";

type MetricValues = Readonly<Record<string, number>>;
type CircuitResult = Readonly<{
  circuit: string;
  test_laps?: number;
  router_mae_ms?: number;
  router_rmse_ms?: number;
  router_cov80_pct?: number;
  router_p95_ms?: number;
}>;
type Benchmark = Readonly<{
  circuit: string;
  testLaps?: number;
  maeMs?: number;
  rmseMs?: number;
  coveragePct?: number;
  p95Ms?: number;
}>;

function readMetrics(payload: unknown): MetricValues {
  if (!isRecord(payload)) return {};
  return Object.fromEntries(
    Object.entries(payload).flatMap(([key, value]) => {
      const parsed = num(value);
      return parsed === undefined ? [] : [[key, parsed]];
    }),
  );
}

function readShap(payload: unknown): MetricValues {
  if (!isRecord(payload)) return {};
  return readMetrics(payload.shap_summary);
}

function readBenchmarks(payload: unknown): readonly Benchmark[] {
  if (!isRecord(payload) || !Array.isArray(payload.circuit_results)) return [];
  return payload.circuit_results.flatMap((item) => {
    if (!isRecord(item) || typeof item.circuit !== "string") return [];
    const result: CircuitResult = {
      circuit: item.circuit,
      test_laps: num(item.test_laps),
      router_mae_ms: num(item.router_mae_ms),
      router_rmse_ms: num(item.router_rmse_ms),
      router_cov80_pct: num(item.router_cov80_pct),
      router_p95_ms: num(item.router_p95_ms),
    };
    return [{
      circuit: result.circuit,
      ...(result.test_laps !== undefined && { testLaps: result.test_laps }),
      ...(result.router_mae_ms !== undefined && { maeMs: result.router_mae_ms }),
      ...(result.router_rmse_ms !== undefined && { rmseMs: result.router_rmse_ms }),
      ...(result.router_cov80_pct !== undefined && { coveragePct: result.router_cov80_pct }),
      ...(result.router_p95_ms !== undefined && { p95Ms: result.router_p95_ms }),
    }];
  });
}

const unavailable = <p className="mt-3 text-xs text-pitwall-muted">Unavailable: the API has not returned this observation.</p>;

export default function ModelsPage() {
  const [metrics, setMetrics] = useState<MetricValues>({});
  const [shap, setShap] = useState<MetricValues>({});
  const [benchmarks, setBenchmarks] = useState<readonly Benchmark[]>([]);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [reason, setReason] = useState("Waiting for API response.");

  useEffect(() => {
    let cancelled = false;
    const base = API_URL.replace(/\/$/, "");
    const poll = async () => {
      const [info, shapPayload, challengerPayload] = await Promise.all([
        fetchJson<unknown>(`${base}/models/info`),
        fetchJson<unknown>(`${base}/models/shap`),
        fetchJson<unknown>(`${base}/benchmarks/challengers`),
      ]);
      if (cancelled) return;
      if (isRecord(info)) {
        setMetrics(readMetrics(info.metrics));
        setTimestamp(typeof info.timestamp === "string" ? info.timestamp : null);
        setReason(Object.keys(readMetrics(info.metrics)).length ? "" : "The API returned no model metrics.");
      } else {
        setMetrics({});
        setTimestamp(null);
        setReason("The models info endpoint is unavailable or returned no valid response.");
      }
      setShap(readShap(shapPayload));
      setBenchmarks(readBenchmarks(challengerPayload));
    };
    void poll();
    const stop = startPoller(poll, 15000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const importances = useMemo(
    () => Object.entries(shap).map(([feature, importance]) => ({ feature, importance })),
    [shap],
  );
  const metricLabels: Readonly<Record<string, string>> = {
    mae: "MAE (s)", rmse: "RMSE (s)", coverage_80: "80% coverage",
    mean_width: "Mean width (s)", p95_ms: "p95 latency (ms)", tyre_mae: "Tyre MAE",
    tyre_rmse: "Tyre RMSE", pit_auc: "Pit AUC", pit_logloss: "Pit log loss",
  };

  return (
    <main className="space-y-6">
      <header className="rounded-xl border border-pitwall-border bg-pitwall-card p-6">
        <h1 className="text-xl font-black tracking-tight">MODEL INTELLIGENCE</h1>
        <p className="mt-2 text-xs text-pitwall-muted" role="status">
          {timestamp ? `API observation: ${timestamp}` : "API observation timestamp unavailable."}
          {reason ? ` ${reason}` : ""}
        </p>
      </header>

      <section className="rounded-xl border border-pitwall-border bg-pitwall-card p-5" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="font-black text-xs tracking-widest">MODEL METRICS FROM /models/info</h2>
        {Object.keys(metrics).length === 0 ? unavailable : (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-pitwall-border bg-pitwall-bg p-3">
                <dt className="text-[10px] text-pitwall-muted">{metricLabels[key] ?? key}</dt>
                <dd className="mt-1 font-mono text-sm font-bold">
                  {key === "coverage_80" ? `${(value * 100).toFixed(1)}%` : value.toFixed(3)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-pitwall-border bg-pitwall-card p-5">
        <h2 className="font-black text-xs tracking-widest">CHALLENGER BENCHMARK OBSERVATIONS</h2>
        {benchmarks.length === 0 ? unavailable : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-pitwall-muted"><tr><th className="p-2">Circuit</th><th className="p-2">Test laps</th><th className="p-2">Router MAE (ms)</th><th className="p-2">Router RMSE (ms)</th><th className="p-2">80% coverage</th><th className="p-2">p95 (ms)</th></tr></thead>
              <tbody>{benchmarks.map((row) => (
                <tr key={row.circuit} className="border-t border-pitwall-border">
                  <th scope="row" className="p-2">{row.circuit}</th>
                  <td className="p-2">{row.testLaps ?? "N/A"}</td>
                  <td className="p-2">{row.maeMs?.toFixed(1) ?? "N/A"}</td>
                  <td className="p-2">{row.rmseMs?.toFixed(1) ?? "N/A"}</td>
                  <td className="p-2">{row.coveragePct === undefined ? "N/A" : `${row.coveragePct.toFixed(1)}%`}</td>
                  <td className="p-2">{row.p95Ms?.toFixed(2) ?? "N/A"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <FeatureWaterfallChart data={{ kind: "global", importances }} title="GLOBAL SHAP FEATURE IMPORTANCE" />
        <section className="rounded-xl border border-pitwall-border bg-pitwall-card p-5" aria-labelledby="calibration-heading">
          <h2 id="calibration-heading" className="font-black text-xs tracking-widest">CALIBRATION OBSERVATIONS</h2>
          <p className="mt-3 text-xs text-pitwall-muted" role="status">
            Unavailable: /models/info, /models/shap, and /benchmarks/challengers do not provide empirical calibration points.
          </p>
        </section>
      </div>
    </main>
  );
}
