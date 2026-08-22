"use client";
import { useEffect, useState } from "react";
import { API_URL } from "../../lib/api";

type Overview = {
  model_version: string;
  metrics: { mae: number; rmse: number; coverage_80: number; p95_ms: number; tyre_mae?: number; pit_auc?: number };
  drift_ratio: number;
  drifted_features: string[];
  promotion_passed?: boolean;
};

const fallback: Overview = {
  model_version: "local:v2_shap_test",
  metrics: { mae: 0.504, rmse: 0.616, coverage_80: 0.642, p95_ms: 8.3, tyre_mae: 0.445, pit_auc: 1.0 },
  drift_ratio: 0.12,
  drifted_features: ["track_temp_c", "compound"],
  promotion_passed: true,
};

export default function MonitoringPage() {
  const [data, setData] = useState<Overview>(fallback);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const base = API_URL.replace(/\/$/, "");
    fetch(`${base}/monitoring/overview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setData({
          model_version: j.model_version || fallback.model_version,
          metrics: j.metrics || fallback.metrics,
          drift_ratio: j.drift_ratio ?? fallback.drift_ratio,
          drifted_features: j.drifted_features || fallback.drifted_features,
          promotion_passed: j.promotion_passed,
        });
        setLive(true);
      })
      .catch(() => {});
  }, []);

  const m = data.metrics;
  const covOk = m.coverage_80 >= 0.75 && m.coverage_80 <= 0.85;
  const driftPct = (data.drift_ratio * 100).toFixed(1);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight">PACE MODEL — V2 QUANTILE</h1>
            <div className="mono text-[10px] text-[#5a6b84] mt-1">registry version: {data.model_version}</div>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded-full border ${live ? "bg-[#00d084]/15 text-[#00d084] border-[#00d084]/30" : "bg-[#1e2a3a] text-[#8b9bb4] border-[#243447]"}`}>
            {live ? "LIVE • /monitoring/overview" : "DEMO • fallback"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PERFORMANCE</div>
            <div className="mono font-bold mt-1">MAE {m.mae.toFixed(3)}s • p95 {m.p95_ms.toFixed(1)}ms</div>
            <div className={`text-xs ${m.p95_ms > 100 ? "text-[#ff3b30]" : "text-[#00d084]"}`}>{m.p95_ms > 100 ? "p95 breach >100ms — ALERT" : "p95 ok <100ms — HighInferenceLatency gate passed"}</div>
          </div>
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">UNCERTAINTY</div>
            <div className="mono font-bold mt-1">80% coverage {(m.coverage_80 * 100).toFixed(1)}%</div>
            <div className={`text-xs ${covOk ? "text-[#00d084]" : "text-[#ff3b30]"}`}>{covOk ? "Within tolerance 75–85%" : "Outside 75–85% — IntervalCoverageLow"}</div>
          </div>
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">FEATURE DRIFT — 3-race window</div>
            <div className="mono font-bold mt-1">{data.drifted_features.length} / 9 drifting • {driftPct}%</div>
            <div className="text-xs text-[#8b9bb4] truncate">{data.drifted_features.join(" • ") || "none"}</div>
            <div className={`text-[11px] mt-1 ${data.drift_ratio > 0.2 ? "text-[#ff3b30]" : data.drift_ratio > 0.1 ? "text-[#f59e0b]" : "text-[#00d084]"}`}>
              {data.drift_ratio > 0.2 ? "DriftingFeaturesHigh >20% — ALERT" : data.drift_ratio > 0.1 ? "WATCH" : "LOW"}
            </div>
          </div>
        </div>
        {data.promotion_passed !== undefined && (
          <div className={`mt-4 p-3 rounded text-xs border ${data.promotion_passed ? "bg-[#00d084]/10 border-[#00d084]/20 text-[#00d084]" : "bg-[#ff3b30]/10 border-[#ff3b30]/20 text-[#ff3b30]"}`}>
            Promotion gate: {data.promotion_passed ? "PASSED — challenger promotes to @champion (mae -3% + coverage ok)" : "FAILED — see /registry/promotion"}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-black text-sm">PROMETHEUS • GRAFANA • ALERTS</h2>
        <p className="text-xs text-[#8b9bb4] mt-2">Metrics: http_requests_total, inference_duration_seconds (p95), event_processing_lag_seconds, pace_mae_seconds, pace_interval_coverage, drifting_features_ratio (Evidently), pit_auc. Alerts: HighInferenceLatency, EventProcessingLag, FeatureStale, PaceMAERegression, DriftingFeaturesHigh, IntervalCoverageLow.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] mono">
          <a href="http://localhost:9090" target="_blank" className="rounded bg-[#0a0e14] border border-[#1e2a3a] p-3 hover:border-[#ff3b30]/30">
            <div className="text-[#8b9bb4]">Prometheus</div>
            <div className="font-bold">http://localhost:9090</div>
            <div className="text-[#5a6b84]">targets: api:8000/metrics (5s), alerts.yml</div>
            <div className="text-[#fbbf24]/90 mt-1">Part of the local Docker stack — not reachable from this hosted demo.</div>
          </a>
          <a href="http://localhost:3001" target="_blank" className="rounded bg-[#0a0e14] border border-[#1e2a3a] p-3 hover:border-[#ff3b30]/30">
            <div className="text-[#8b9bb4]">Grafana</div>
            <div className="font-bold">http://localhost:3001 (admin/pitwall)</div>
            <div className="text-[#5a6b84]">dashboard pitwall-v3 (9 panels) • datasource Prometheus</div>
            <div className="text-[#fbbf24]/90 mt-1">Part of the local Docker stack — not reachable from this hosted demo.</div>
          </a>
        </div>
        <div className="mt-3 text-[11px] text-[#5a6b84]">Run `docker compose --profile monitoring up --build` — Grafana provisioned via monitoring/grafana/datasources + dashboards/pitwall.json</div>
        <div className="mt-2 text-[11px] text-[#5a6b84]">Try: `curl localhost:8000/metrics | grep pace_mae` • `curl localhost:8000/monitoring/drift | jq .drift.drift_ratio`</div>
      </div>
    </div>
  );
}
