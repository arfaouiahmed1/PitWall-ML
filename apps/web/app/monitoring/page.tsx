"use client";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";
import { fetchJson, isRecord, num, startPoller } from "@/lib/fetcher";
import { DataBadge } from "@/components/DataBadge";

type Overview = {
  model_version: string;
  metrics: { mae: number; rmse: number; coverage_80: number; p95_ms: number; tyre_mae?: number; pit_auc?: number };
  drift_ratio: number;
  drifted_features: string[];
  promotion_passed?: boolean;
  // extended
  wasserstein?: number;
  psi?: number;
  ks_p?: number;
  js?: number;
  health?: { ws_clients: number; freshness_s: number; error_rate: number; events_per_sec?: number; processing_lag_s?: number };
};

type DriftRow = { feature: string; wasserstein: number; ks: number; ks_p: number; psi: number; js: number; severity: "none" | "moderate" | "severe" };

// FRONTEND-ONLY demo drift table: no backend endpoint emits per-feature
// W1/KS/PSI/JS rows. Live /monitoring/drift returns {drift: {per_feature (KS
// p_value/statistic/drifted only), drift_ratio, drifted_features, method}} and
// mapped rows keep W1/PSI/JS at 0 (see mapDriftFeature below).
const FALLBACK_DRIFT: DriftRow[] = [
  { feature: "speed_trap_max_kmh", wasserstein: 1.82, ks: 0.34, ks_p: 0.002, psi: 0.31, js: 0.18, severity: "severe" },
  { feature: "brake_intensity_mean", wasserstein: 1.21, ks: 0.22, ks_p: 0.018, psi: 0.19, js: 0.11, severity: "moderate" },
  { feature: "x_mode_ratio", wasserstein: 1.64, ks: 0.29, ks_p: 0.004, psi: 0.27, js: 0.15, severity: "severe" },
  { feature: "lap_time_variance", wasserstein: 0.42, ks: 0.11, ks_p: 0.21, psi: 0.08, js: 0.04, severity: "none" },
  { feature: "track_temp_c", wasserstein: 0.88, ks: 0.18, ks_p: 0.07, psi: 0.14, js: 0.07, severity: "moderate" },
  { feature: "compound", wasserstein: 0.31, ks: 0.09, ks_p: 0.34, psi: 0.06, js: 0.03, severity: "none" },
  { feature: "tyre_age", wasserstein: 0.55, ks: 0.13, ks_p: 0.12, psi: 0.09, js: 0.05, severity: "none" },
  { feature: "lift_and_coast_ratio", wasserstein: 0.71, ks: 0.15, ks_p: 0.09, psi: 0.12, js: 0.06, severity: "moderate" },
];

// Cold-start fallback = backend truth (artifacts/champion/metrics.json):
// mae 1.27135, rmse 3.15936, coverage_80 0.5836, p95 5.8586,
// tyre_mae 1.7068, pit_auc 0.7407. Version demo-v0 (backend default when no
// MLflow tracking URI is configured; "champion" only with MLflow).
// wasserstein/psi/ks_p/js/health are FRONTEND-ONLY: /monitoring/overview emits
// only {model_version, metrics, drift_ratio, drifted_features, promotion_passed}.
const fallback: Overview = {
  model_version: "demo-v0",
  metrics: { mae: 1.2714, rmse: 3.1594, coverage_80: 0.5836, p95_ms: 5.8586, tyre_mae: 1.7068, pit_auc: 0.7407 },
  drift_ratio: 0.12,
  drifted_features: ["track_temp_c", "compound"],
  promotion_passed: true,
  wasserstein: 1.18,
  psi: 0.14,
  ks_p: 0.04,
  js: 0.08,
  health: { ws_clients: 3, freshness_s: 1.2, error_rate: 0.002, events_per_sec: 48, processing_lag_s: 0.14 },
};
export default function MonitoringPage() {
  const [data, setData] = useState<Overview>(fallback);
  const [driftRows, setDriftRows] = useState<DriftRow[]>(FALLBACK_DRIFT);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const base = API_URL.replace(/\/$/, "");

    // Backend contracts (apps/api/pitwall_api/main.py):
    // - GET /monitoring/overview -> {model_version, metrics, drift_ratio,
    //   drifted_features, promotion_passed} (no wasserstein/psi/js/health).
    // - GET /monitoring/drift -> {drift: {drift_ratio, per_feature,
    //   drifted_features, method}, model_version}. per_feature values carry KS
    //   {statistic, p_value, drifted} (or heuristic {mean_shift, drifted}).
    const mapDriftFeature = (feature: string, v: unknown): DriftRow => {
      const r = isRecord(v) ? v : {};
      return {
        feature,
        wasserstein: 0, // no backend endpoint emits per-feature W1
        ks: num(r.statistic) ?? num(r.ks) ?? 0,
        ks_p: num(r.p_value) ?? num(r.ks_p) ?? 1,
        psi: 0, // no backend endpoint emits per-feature PSI
        js: 0, // no backend endpoint emits per-feature JS
        severity: r.drifted === true ? "moderate" : "none",
      };
    };

    const pollOverview = async () => {
      const [ov, dr] = await Promise.all([
        fetchJson<{
          model_version?: string;
          metrics?: Overview["metrics"];
          drift_ratio?: number;
          drifted_features?: string[];
          promotion_passed?: boolean;
        }>(`${base}/monitoring/overview`),
        fetchJson<{ drift?: { drift_ratio?: unknown; drifted_features?: unknown; per_feature?: unknown } }>(
          `${base}/monitoring/drift`
        ),
      ]);
      if (cancelled) return;
      // Cold-start backend returns {metrics: {}}: the fallback above already carries
      // champion truth, so only overwrite with non-empty payloads.
      if (ov) {
        setData((prev) => ({
          ...prev,
          model_version: typeof ov.model_version === "string" && ov.model_version ? ov.model_version : prev.model_version,
          metrics:
            isRecord(ov.metrics) && Object.keys(ov.metrics).length
              ? (ov.metrics as Overview["metrics"])
              : prev.metrics,
          drift_ratio: num(ov.drift_ratio) ?? prev.drift_ratio,
          drifted_features: Array.isArray(ov.drifted_features) ? ov.drifted_features : prev.drifted_features,
          promotion_passed: typeof ov.promotion_passed === "boolean" ? ov.promotion_passed : prev.promotion_passed,
        }));
        if (isRecord(ov.metrics) && Object.keys(ov.metrics).length) setLive(true);
      }
      if (dr && isRecord(dr.drift)) {
        const per = isRecord(dr.drift.per_feature) ? dr.drift.per_feature : {};
        const rows = Object.entries(per).map(([feature, v]) => mapDriftFeature(feature, v));
        if (rows.length) setDriftRows(rows);
        setData((prev) => ({
          ...prev,
          drift_ratio: num(dr.drift?.drift_ratio) ?? prev.drift_ratio,
          drifted_features: Array.isArray(dr.drift?.drifted_features)
            ? (dr.drift.drifted_features as string[])
            : prev.drifted_features,
        }));
      }
    };

    pollOverview();
    // Live polling every 12 seconds, paused while the tab is hidden.
    const stop = startPoller(pollOverview, 12000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const m = data.metrics;
  const covOk = m.coverage_80 >= 0.72 && m.coverage_80 <= 0.88;
  const maeOk = m.mae < 2.5;
  const psiSevere = (data.psi ?? 0) > 0.25;
  const wSevere = (data.wasserstein ?? 0) > 1.5;

  const health = data.health ?? fallback.health!;

  const maxW = useMemo(() => Math.max(...driftRows.map((r) => r.wasserstein), 2.0), [driftRows]);
  const maxPsi = useMemo(() => Math.max(...driftRows.map((r) => r.psi), 0.5), [driftRows]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">MLOPS & DRIFT • 2025 → 2026 ERA TRANSITION</h1>
            <p className="text-xs text-pitwall-muted mt-1">Regulation era drift panel + serving health gauges • Prometheus → Grafana • Evidently rolling 3-race window</p>
          </div>
          <span className="flex flex-wrap items-center gap-2 min-w-0"><span className={`text-xs px-3 py-1.5 rounded-full border font-bold ${live ? "bg-pitwall-green/12 text-pitwall-mint border-pitwall-green/30" : "bg-pitwall-amber/10 text-pitwall-amberlight border-pitwall-amber/20"}`}>{live ? "● LIVE API" : "● FALLBACK DEMO"} • {data.model_version}</span>{live ? <DataBadge variant="LIVE" detail="/monitoring/overview" /> : <DataBadge variant="MOCK" detail="fallback demo" />}</span>
        </div>

        {/* serving health gauges */}
        <div aria-live="polite" className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { k: "p95 LATENCY", v: `${m.p95_ms.toFixed(1)} ms`, sub: m.p95_ms < 25 ? "HEALTHY" : "ELEVATED", col: m.p95_ms < 25 ? "#22c55e" : "#eab308" },
            { k: "WS CLIENTS", v: `${health.ws_clients}`, sub: health.ws_clients ? "connected" : "idle", col: "#00d2be" },
            { k: "FRESHNESS", v: `${health.freshness_s.toFixed(1)} s`, sub: health.freshness_s < 2 ? "fresh" : "stale", col: health.freshness_s < 2 ? "#22c55e" : "#ef4444" },
            { k: "ERROR RATE", v: `${(health.error_rate * 100).toFixed(2)}%`, sub: health.error_rate < 0.01 ? "low" : "high", col: health.error_rate < 0.01 ? "#22c55e" : "#ef4444" },
            { k: "DRIFT RATIO", v: `${(data.drift_ratio * 100).toFixed(1)}%`, sub: data.drift_ratio > 0.25 ? "drift" : "stable", col: data.drift_ratio > 0.25 ? "#ef4444" : "#22c55e" },
          ].map((g) => (
            <div key={g.k} className="rounded-xl bg-pitwall-bg border border-pitwall-border p-4 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: g.col }} />
              <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">{g.k}</div>
              <div className="font-mono font-black text-lg mt-1">{g.v}</div>
              <div className="text-[10px] font-bold mt-1" style={{ color: g.col }}>{g.sub.toUpperCase()}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">Events/sec</span><span className="font-mono font-bold">{health.events_per_sec ?? 42}</span></div>
          <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">Processing lag</span><span className="font-mono font-bold">{(health.processing_lag_s ?? 0.18).toFixed(2)}s</span></div>
          <div className={`rounded-lg border p-3 flex justify-between ${covOk ? "bg-pitwall-green/10 border-pitwall-green/20" : "bg-pitwall-danger/10 border-pitwall-danger/20"}`}><span className={covOk ? "text-pitwall-green" : "text-pitwall-danger"}>Coverage 80%</span><span className="font-mono font-black">{(m.coverage_80 * 100).toFixed(1)}% • {covOk ? "OK" : "ALERT"}</span></div>
        </div>
      </div>

      {/* era drift panel */}
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-xs tracking-widest">REGULATION ERA DRIFT • 2025 → 2026 ACTIVE AERO & ENERGY</h2>
          <span className="text-[10px] px-2 py-1 rounded-full bg-pitwall-border text-pitwall-fog border border-pitwall-edge font-mono">W₁ • KS • PSI • JS</span>
        </div>
        <p className="text-xs text-pitwall-muted mt-1">2026 Active Aero X/Z-Mode, speed traps, brake intensity and energy difficulty vs 2025 baseline • tuned alerts: W₁{">"}1.5 warning, PSI{">"}0.25 severe, MAE{">"}2.5s</p>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`rounded-xl border p-4 text-center min-w-0 ${wSevere ? "bg-pitwall-danger/10 border-pitwall-danger/30" : "bg-pitwall-bg border-pitwall-border"}`}>
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">WASSERSTEIN W₁</div>
            <div className={`font-mono font-black text-xl mt-1 ${wSevere ? "text-pitwall-danger" : "text-pitwall-ink"}`}>{(data.wasserstein ?? 1.34).toFixed(2)}</div>
            <div className={`text-[10px] font-bold mt-1 ${wSevere ? "text-pitwall-danger" : "text-pitwall-green"}`}>{wSevere ? "DRIFT HIGH" : "WITHIN TOLERANCE"}</div>
            <div className="text-[10px] text-pitwall-muted">threshold 1.5 • 10m window</div>
          </div>
          <div className="rounded-xl bg-pitwall-bg border border-pitwall-border p-4 text-center min-w-0">
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">KS STATISTIC</div>
            <div className="font-mono font-black text-xl mt-1">{(driftRows[0]?.ks ?? 0.34).toFixed(2)}</div>
            <div className="text-[10px] text-pitwall-muted">p={(driftRows[0]?.ks_p ?? 0.002).toExponential(1)} • {driftRows[0]?.ks_p != null && driftRows[0].ks_p < 0.05 ? "significant" : "ns"}</div>
            <div className="text-[10px] text-pitwall-muted">Kolmogorov-Smirnov</div>
          </div>
          <div className={`rounded-xl border p-4 text-center min-w-0 ${psiSevere ? "bg-pitwall-danger/10 border-pitwall-danger/30" : "bg-pitwall-bg border-pitwall-border"}`}>
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">PSI</div>
            <div className={`font-mono font-black text-xl mt-1 ${psiSevere ? "text-pitwall-danger" : "text-pitwall-ink"}`}>{(data.psi ?? 0.18).toFixed(2)}</div>
            <div className={`text-[10px] font-bold mt-1 ${psiSevere ? "text-pitwall-danger" : "text-pitwall-muted"}`}>{psiSevere ? "SEVERE" : data.psi != null && data.psi > 0.15 ? "MODERATE" : "STABLE"}</div>
            <div className="text-[10px] text-pitwall-muted">threshold 0.25 severe</div>
          </div>
          <div className="rounded-xl bg-pitwall-bg border border-pitwall-border p-4 text-center min-w-0">
            <div className="text-[10px] tracking-widest text-pitwall-muted font-bold">JENSEN-SHANNON</div>
            <div className="font-mono font-black text-xl mt-1">{(data.js ?? 0.09).toFixed(2)}</div>
            <div className="text-[10px] text-pitwall-muted">divergence • 0 = identical</div>
            <div className="text-[10px] text-pitwall-muted">symmetric KL</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <span className={`px-2 py-1 rounded-full border font-bold ${maeOk ? "bg-pitwall-green/12 text-pitwall-mint border-pitwall-green/20" : "bg-pitwall-danger/12 text-pitwall-rose border-pitwall-danger/20"}`}>MAE {m.mae.toFixed(3)}s • {maeOk ? "OK (<2.5s)" : "ALERT (>2.5s)"}</span>
          <span className="px-2 py-1 rounded-full bg-pitwall-border text-pitwall-fog border border-pitwall-edge">coverage {(m.coverage_80 * 100).toFixed(1)}% • band 72 to 88%</span>
          <span className={`px-2 py-1 rounded-full border ${data.promotion_passed ? "bg-pitwall-green/12 text-pitwall-mint border-pitwall-green/20" : "bg-pitwall-border text-pitwall-fog border-pitwall-edge"}`}>{data.promotion_passed ? "PROMOTION PASS" : "PROMOTION HOLD"}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 rounded-xl bg-pitwall-card border border-pitwall-border p-5">
          <h3 className="font-black text-xs tracking-widest">TOP DRIFTING FEATURES • PSI & WASSERSTEIN</h3>
          <div className="mt-4 space-y-2">
            {driftRows.slice(0, 8).map((r) => (
              <div key={r.feature} className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">{r.feature}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${r.severity === "severe" ? "bg-pitwall-danger/15 text-pitwall-rose border-pitwall-danger/30" : r.severity === "moderate" ? "bg-pitwall-yellow/15 text-pitwall-yellow border-pitwall-yellow/30" : "bg-pitwall-border text-pitwall-fog border-pitwall-edge"}`}>{r.severity.toUpperCase()}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-pitwall-muted">W₁</span><span className="font-bold">{r.wasserstein.toFixed(2)}</span></div>
                    <div className="mt-1 relative h-1.5 rounded-full bg-pitwall-border overflow-visible">
                      <div className="h-full rounded-full overflow-hidden" style={{ width: `${Math.min(100, (r.wasserstein / maxW) * 100)}%`, background: r.wasserstein > 1.5 ? "#ef4444" : r.wasserstein > 0.8 ? "#eab308" : "#22c55e" }} />
                      {/* W₁ threshold tick at 1.5 / maxW */}
                      <div className="absolute top-0 bottom-0 w-px bg-pitwall-fog/60" style={{ left: `${Math.min(100, (1.5 / maxW) * 100)}%` }} aria-hidden="true" />
                    </div>
                    <div className="text-[10px] font-mono text-pitwall-muted/70 mt-0.5" style={{ marginLeft: `${Math.min(96, (1.5 / maxW) * 100)}%` }}>W₁ 1.5</div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-pitwall-muted">PSI</span><span className="font-bold">{r.psi.toFixed(2)}</span></div>
                    <div className="mt-1 relative h-1.5 rounded-full bg-pitwall-border overflow-visible">
                      <div className="h-full rounded-full overflow-hidden" style={{ width: `${Math.min(100, (r.psi / maxPsi) * 100)}%`, background: r.psi > 0.25 ? "#ef4444" : r.psi > 0.12 ? "#eab308" : "#22c55e" }} />
                      {/* PSI threshold tick at 0.25 / maxPsi */}
                      <div className="absolute top-0 bottom-0 w-px bg-pitwall-fog/60" style={{ left: `${Math.min(100, (0.25 / maxPsi) * 100)}%` }} aria-hidden="true" />
                    </div>
                    <div className="text-[10px] font-mono text-pitwall-muted/70 mt-0.5" style={{ marginLeft: `${Math.min(96, (0.25 / maxPsi) * 100)}%` }}>PSI 0.25</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-3 text-[10px] font-mono text-pitwall-muted"><span>KS {r.ks.toFixed(2)} • p {r.ks_p.toExponential(1)}</span><span>JS {r.js.toFixed(2)}</span></div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-4">
          <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5">
            <h3 className="font-black text-xs tracking-widest">KS P-VALUE HEATMAP • PHYSICAL TELEMETRY</h3>
            <p className="text-xs text-pitwall-muted mt-1">Lower p = stronger drift vs 2025 era baseline</p>
            <div className="mt-4 grid grid-cols-4 gap-2 text-[10px] font-mono">
              {driftRows.map((r) => {
                const intensity = Math.max(0, Math.min(1, 1 - r.ks_p * 8));
                const alpha = 0.12 + intensity * 0.75;
                const bg = `rgba(239,68,68,${alpha})`;
                // fog (#cbd5e1) when alpha < 0.4 (low intensity), ink (#e2e8f0) above
                const col = alpha >= 0.4 ? "#e2e8f0" : "#cbd5e1";
                return (
                  <div key={r.feature} className="rounded-lg border border-pitwall-border p-2 text-center" style={{ background: bg, color: col }} title={`${r.feature} — KS p-value: ${r.ks_p.toExponential(2)}`}>
                    <div className="truncate font-bold text-[10px]">{r.feature.slice(0, 12)}</div>
                    <div className="text-[10px]">p {r.ks_p.toExponential(1)}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-pitwall-muted">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-pitwall-danger" /> drift (p &lt; 0.05)</span>
              <span className="inline-flex items-center gap-1 ml-2"><span className="w-3 h-3 rounded bg-pitwall-border" /> stable</span>
              <span className="ml-auto text-[10px]">alpha = 0.12 (low) → 0.87 (high drift)</span>
            </div>
          </div>

          <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5">
            <h3 className="font-black text-xs tracking-widest">SERVING HEALTH • REAL-TIME PIPELINE</h3>
            <div className="mt-3 space-y-2 text-xs">
              <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">Replay ingestion</span><span className="font-mono font-bold">{health.events_per_sec} events/s</span></div>
              <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">Processing lag</span><span className="font-mono font-bold">{(health.processing_lag_s ?? 0.18).toFixed(2)}s</span></div>
              <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">HTTP latency buckets</span><span className="font-mono text-[11px]">p50 4ms • p95 {m.p95_ms}ms • p99 22ms</span></div>
              <div className="bg-pitwall-bg rounded-lg border border-pitwall-border p-3 flex justify-between"><span className="text-pitwall-muted">Feature freshness</span><span className="font-mono font-bold">{health.freshness_s.toFixed(1)}s</span></div>
            </div>
            <div className="mt-3 text-xs text-pitwall-muted">Prometheus scrapes <code className="bg-pitwall-bg border border-pitwall-border px-1 rounded">/metrics</code> • alerts: PaceMAE{">"}2.5s, Coverage 72 to 88%, W₁{">"}1.5, PSI{">"}0.25, HardMAE{">"}5s</div>
          </div>

          <div className="rounded-xl bg-pitwall-bg border border-pitwall-border p-4">
            <div className="text-xs tracking-widest text-pitwall-muted font-bold">EVIDENTLY • 3-RACE ROLLING DRIFT RATIO</div>
            <div className="mt-2 flex items-baseline gap-2"><span className="text-2xl font-mono font-black">{(data.drift_ratio * 100).toFixed(1)}%</span><span className="text-xs text-pitwall-muted">features drifted • {data.drifted_features.length} flagged</span></div>
            <div className="mt-2 h-2 rounded-full bg-pitwall-border overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, data.drift_ratio * 100)}%`, background: data.drift_ratio > 0.25 ? "#ef4444" : data.drift_ratio > 0.12 ? "#eab308" : "#22c55e" }} /></div>
            <div className="mt-2 text-xs text-pitwall-muted">Flagged: {data.drifted_features.join(", ") || "None"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
