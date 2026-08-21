export default function ModelsPage() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h1 className="text-xl font-black tracking-tight">PACE MODEL</h1>
        <p className="text-xs text-[#8b9bb4] mt-1">Champion vs Challenger • MLflow Model Registry @champion alias</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <div className="rounded-lg bg-[#0a0e14] border border-[#00d084]/30 p-4">
            <div className="text-[10px] tracking-widest text-[#00d084]">PRODUCTION — @CHAMPION</div>
            <div className="font-black mt-1">pace-v13 • LightGBM</div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center mono text-xs">
              <div><div className="text-[#8b9bb4] text-[10px]">MAE</div><div className="font-bold">0.421s</div></div>
              <div><div className="text-[#8b9bb4] text-[10px]">COVERAGE 80%</div><div className="font-bold">81.2%</div></div>
              <div><div className="text-[#8b9bb4] text-[10px]">P95</div><div className="font-bold">24ms</div></div>
            </div>
            <div className="mt-3 flex gap-2 text-[10px]">
              <span className="px-2 py-1 rounded bg-[#00d084]/15 text-[#00d084] border border-[#00d084]/20">DATA DRIFT LOW</span>
              <span className="px-2 py-1 rounded bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/20">PERF WATCH</span>
            </div>
          </div>
          <div className="rounded-lg bg-[#0a0e14] border border-[#1e2a3a] p-4">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">CHALLENGER — @CHALLENGER</div>
            <div className="font-black mt-1">pace-v14 • CatBoost</div>
            <div className="text-xs text-[#8b9bb4] mt-2">Shadow: 3 / 5 races • Relative MAE -2.8% • Group regression +3.1% — pending gate</div>
            <div className="mt-3 w-full bg-[#1e2a3a] rounded-full h-1.5"><div className="bg-[#ff3b30] h-1.5 rounded-full" style={{width:"60%"}} /></div>
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-black text-sm">FEATURE IMPORTANCE (SHAP TreeExplainer)</h2>
        <div className="mt-4 space-y-2 text-xs mono">
          {[
            ["tyre_age", 92],
            ["rolling_median_3", 84],
            ["track_temp", 61],
            ["gap_ahead", 42],
            ["race_progress", 33],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-32 text-[#8b9bb4]">{k}</span>
              <div className="flex-1 bg-[#0a0e14] rounded h-2"><div className="bg-[#ff3b30] h-2 rounded" style={{width: `${v}%`}} /></div>
              <span className="w-8 text-right">{v}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#5a6b84] mt-4">SHAP explains the model&apos;s attribution; it does not prove causal effect on lap time.</p>
      </div>
    </div>
  );
}
