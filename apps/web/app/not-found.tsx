import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-xl bg-pitwall-bg border border-pitwall-border p-12 text-center">
      <div className="text-sm font-black tracking-widest text-pitwall-ink">404 • TRACK LIMITS</div>
      <div className="text-xs text-pitwall-muted mt-2">This sector does not exist. Back to the race cockpit.</div>
      <Link
        href="/"
        className="mt-4 inline-block px-4 py-2 rounded-lg bg-pitwall-accent text-white text-xs font-black tracking-wide"
      >
        ← Race Cockpit
      </Link>
    </div>
  );
}
