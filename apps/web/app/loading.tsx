export default function Loading() {
  return (
    <div className="rounded-xl bg-pitwall-bg border border-pitwall-border p-12 text-center" role="status" aria-label="Loading">
      <div className="text-sm font-black tracking-widest text-pitwall-ink">LOADING COCKPIT…</div>
      <div className="text-xs text-pitwall-muted mt-2">Fetching session state and model telemetry.</div>
    </div>
  );
}
