"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { getCalendarStatus, formatCountdown } from "@/lib/calendar";
import { useRaceSocket } from "@/lib/useRaceSocket";
import { useNow } from "@/lib/useNow";
type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";

const FLAG_META: Record<Flag, { label: string; dot: string; bar: string; cls: string }> = {
  GREEN: { label: "GREEN", dot: "bg-pitwall-green", bar: "bg-pitwall-green", cls: "flag-green" },
  YELLOW: { label: "YELLOW", dot: "bg-pitwall-yellow", bar: "bg-pitwall-yellow", cls: "flag-yellow" },
  SC: { label: "SAFETY CAR", dot: "bg-pitwall-amber", bar: "bg-pitwall-amber", cls: "flag-sc" },
  VSC: { label: "VIRTUAL SC", dot: "bg-pitwall-yellow", bar: "bg-pitwall-yellow", cls: "flag-vsc" },
  RED: { label: "RED FLAG", dot: "bg-pitwall-danger", bar: "bg-pitwall-danger", cls: "flag-red" },
};

const NAV = [
  { href: "/", label: "Race Cockpit" },
  { href: "/strategy", label: "Strategy Sandbox" },
  { href: "/drivers", label: "Driver Telemetry" },
  { href: "/circuit", label: "Circuit & Schedule" },
  { href: "/models", label: "Model Intelligence" },
  { href: "/monitoring", label: "MLOps & Drift" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function SiteHeader() {
  const pathname = usePathname();
  // Pure subscriber: the cockpit page owns the single shared socket (see lib/useRaceSocket).
  const { connected, lap, flag, latencyMs: latency, speed } = useRaceSocket();
  const now = useNow(30000);
  const totalLaps = 66;
  // Deterministic calendar state resolver
  const calendarStatus = useMemo(() => getCalendarStatus(now), [now]);
  const nextGpCity = calendarStatus.mode === "OFF_TRACK" ? calendarStatus.nextGrandPrix?.city ?? "R1" : "R1";

  const fm = FLAG_META[flag];

  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-pitwall-bg/85 border-b border-pitwall-border">
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-pitwall-accent flex items-center justify-center font-black text-white text-sm leading-none">
              PW
            </div>
            <span className="font-black tracking-tight text-lg text-white">
              PITWALL<span className="text-pitwall-accent ml-1">ML</span>
            </span>
          </Link>
          <span className="hidden sm:inline-flex ml-2 text-[10px] tracking-widest px-2 py-1 rounded-full bg-pitwall-card text-pitwall-muted border border-pitwall-border">
            2025/26 season
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
          <span
            role="status"
            aria-label={connected ? `Session status: WebSocket connected, replay ${speed}` : calendarStatus.mode === "LIVE_SESSION" ? `Session status: live ${calendarStatus.session.type}` : `Session status: standby, next ${nextGpCity}`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold tracking-wide text-[11px] ${
              connected
                ? "bg-pitwall-cyan/10 text-pitwall-cyan border-pitwall-cyan/30"
                : calendarStatus.mode === "LIVE_SESSION"
                  ? "bg-pitwall-green/10 text-pitwall-green border-pitwall-green/30"
                  : "bg-pitwall-card text-pitwall-muted border-pitwall-border"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-pitwall-cyan" : calendarStatus.mode === "LIVE_SESSION" ? "bg-pitwall-green" : "bg-pitwall-muted"} latency-dot`} />
            {connected
              ? "WS CONNECTED"
              : calendarStatus.mode === "LIVE_SESSION"
                ? `LIVE : ${calendarStatus.session.type}`
                : `STANDBY • NEXT: ${nextGpCity}`}
            {connected && <span className="opacity-60 font-mono">• {speed}</span>}
          </span>

          <span
            role="status"
            aria-label={connected && latency != null ? `Telemetry latency ${latency} milliseconds` : "Telemetry latency unavailable"}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] bg-pitwall-card text-pitwall-fog border-pitwall-border"
            title={connected ? "WebSocket round-trip" : "Session telemetry state"}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-pitwall-green" : "bg-pitwall-muted"}`} />
            {connected && latency != null ? `ws • ${latency}ms` : calendarStatus.mode === "LIVE_SESSION" ? "on track" : "off track"}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pitwall-card border border-pitwall-border font-mono font-black text-white text-xs">
            {calendarStatus.mode === "OFF_TRACK" && !connected ? (
              <>
                <span className="text-pitwall-muted">FINAL</span> {calendarStatus.lastGrandPrix?.laps ?? 66} / {calendarStatus.lastGrandPrix?.laps ?? 66}
              </>
            ) : (
              <>
                LAP <span className="text-pitwall-accent">{lap}</span> / {totalLaps}
              </>
            )}
          </span>

          <span
            role="status"
            aria-label={`Track flag: ${fm.label}`}
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-black tracking-widest ${fm.cls} ${
              flag === "GREEN"
                ? "bg-pitwall-green/15 text-pitwall-green border-pitwall-green/40"
                : flag === "YELLOW"
                  ? "bg-pitwall-yellow/15 text-pitwall-yellow border-pitwall-yellow/40"
                  : flag === "SC" || flag === "VSC"
                    ? "bg-pitwall-amber/15 text-pitwall-amberlight border-pitwall-amber/30"
                    : "bg-pitwall-danger/15 text-pitwall-danger border-pitwall-danger/40"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${fm.dot}`} />
            {fm.label}
          </span>
        </div>
      </div>

      <nav className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-t border-pitwall-card -mb-px">
          {NAV.map((item) => {
            const active = isActive(pathname ?? "", item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative whitespace-nowrap px-3.5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-pitwall-accent text-white"
                    : "border-transparent text-pitwall-muted hover:text-white hover:border-pitwall-border"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className={`h-[2px] w-full ${fm.bar} ${fm.cls} opacity-80`} />
    </header>
  );
}
