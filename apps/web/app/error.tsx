"use client";

export default function Error({ reset }: { error?: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl bg-pitwall-bg border border-pitwall-danger/30 p-12 text-center" role="alert">
      <div className="text-sm font-black tracking-widest text-pitwall-danger">COCKPIT ERROR</div>
      <div className="text-xs text-pitwall-muted mt-2">This panel failed to render. Live timing state is preserved.</div>
      <button
        onClick={() => reset()}
        className="mt-4 px-4 py-2 rounded-lg bg-pitwall-border border border-pitwall-steel text-xs font-bold text-white hover:border-pitwall-cyan"
      >
        Retry panel
      </button>
    </div>
  );
}
