export default function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h1 className="text-xl font-black tracking-tight">MODEL HEALTH — PACE v13</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PERFORMANCE</div>
            <div className="mono font-bold mt-1">MAE 0.421s</div>
            <div className="text-xs text-[#fbbf24]">Δ vs training +2.1% — WATCH</div>
          </div>
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">UNCERTAINTY</div>
            <div className="mono font-bold mt-1">80% coverage 81.2%</div>
            <div className="text-xs text-[#00d084]">Within tolerance (nominal 80% ±5%)</div>
          </div>
          <div className="bg-[#0a0e14] rounded p-4 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">FEATURE DRIFT</div>
            <div className="mono font-bold mt-1">3 / 24 drifting</div>
            <div className="text-xs text-[#8b9bb4]">track_temp HIGH • compound MEDIUM</div>
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-black text-sm">PROMETHEUS • GRAFANA</h2>
        <p className="text-xs text-[#8b9bb4] mt-2">Metrics: http_requests_total, inference_duration_seconds (p95 &lt;100ms), event_processing_lag_seconds, prediction_error_rolling, drifting_features_ratio. Alerts via Alertmanager → Slack/webhook.</p>
        <div className="mt-4 h-32 rounded bg-[#0a0e14] border border-[#1e2a3a] flex items-center justify-center text-xs text-[#5a6b84]">Grafana dashboard iframe — available at localhost:3001 when running compose --profile monitoring</div>
      </div>
    </div>
  );
}
