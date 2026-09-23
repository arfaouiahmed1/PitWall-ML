"use client";

import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useRaceSocket } from "@/lib/useRaceSocket";
import { HISTORICAL_REPLAYS } from "@/lib/calendar";

export type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";
export type ConnectionStatus = "LIVE" | "REPLAY" | "STALE" | "OFFLINE";

const FLAG_META: Record<Flag, { label: string; dot: string; bar: string; cls: string }> = {
  GREEN: { label: "GREEN", dot: "bg-pitwall-green", bar: "bg-pitwall-green", cls: "flag-green" },
  YELLOW: { label: "YELLOW", dot: "bg-pitwall-yellow", bar: "bg-pitwall-yellow", cls: "flag-yellow" },
  SC: { label: "SAFETY CAR", dot: "bg-pitwall-amber", bar: "bg-pitwall-amber", cls: "flag-sc" },
  VSC: { label: "VIRTUAL SC", dot: "bg-pitwall-yellow", bar: "bg-pitwall-yellow", cls: "flag-vsc" },
  RED: { label: "RED FLAG", dot: "bg-pitwall-danger", bar: "bg-pitwall-danger", cls: "flag-red" },
};

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dot: string; cls: string }> = {
  LIVE: {
    label: "LIVE",
    dot: "bg-pitwall-green",
    cls: "bg-pitwall-green/10 text-pitwall-green border-pitwall-green/30",
  },
  REPLAY: {
    label: "REPLAY",
    dot: "bg-pitwall-cyan",
    cls: "bg-pitwall-cyan/10 text-pitwall-cyan border-pitwall-cyan/30",
  },
  STALE: {
    label: "STALE",
    dot: "bg-pitwall-amber",
    cls: "bg-pitwall-amber/10 text-pitwall-amber border-pitwall-amber/30",
  },
  OFFLINE: {
    label: "OFFLINE",
    dot: "bg-pitwall-muted",
    cls: "bg-pitwall-card text-pitwall-muted border-pitwall-border",
  },
};

export const NAV = [
  { href: "/", label: "Race Cockpit" },
  { href: "/strategy", label: "Strategy Sandbox" },
  { href: "/drivers", label: "Driver Telemetry" },
  { href: "/circuit", label: "Circuit & Schedule" },
  { href: "/models", label: "Model Intelligence" },
  { href: "/monitoring", label: "MLOps & Drift" },
  { href: "/api-docs", label: "API DOCS" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function resolveCircuitTotalLaps(sessionId?: string | null): number | null {
  if (!sessionId) return null;
  const raw = sessionId.toLowerCase();
  const directReplay = HISTORICAL_REPLAYS.find((r) => r.id === sessionId || raw.includes(r.circuitId));
  if (directReplay) return directReplay.totalLaps;
  return null;
}

export type SiteHeaderProps = {
  pathname?: string;
  status?: ConnectionStatus;
  totalLaps?: number | null;
  lap?: number | null;
  flag?: Flag;
  speed?: string | null;
  sessionName?: string | null;
  sourceTimestamp?: string | null;
  provenance?: string | null;
  initialMobileOpen?: boolean;
};

export default function SiteHeader(props: SiteHeaderProps = {}) {
  const routerPathname = usePathname();
  const currentPathname = props.pathname ?? routerPathname ?? "";

  const socket = useRaceSocket();
  const [mobileOpen, setMobileOpen] = useState(Boolean(props.initialMobileOpen));

  const effectiveConnected = socket.connected;
  const effectiveSpeed = props.speed ?? socket.speed;

  const effectiveStatus: ConnectionStatus =
    props.status ??
    (effectiveConnected
      ? (socket.status && socket.status !== "OFFLINE" ? socket.status : (effectiveSpeed ? "REPLAY" : "LIVE"))
      : socket.status === "STALE"
        ? "STALE"
        : "OFFLINE");

  const sc = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.OFFLINE;

  const socketTotalLaps = socket.totalLaps ?? resolveCircuitTotalLaps(socket.sessionId);
  const effectiveTotalLaps =
    props.totalLaps !== undefined ? props.totalLaps : socketTotalLaps;

  const effectiveLap =
    props.lap !== undefined
      ? props.lap
      : (effectiveConnected || socket.status === "STALE") && socket.lap > 0
        ? socket.lap
        : null;

  const currentLapDisplay = effectiveLap != null && effectiveLap > 0 ? String(effectiveLap) : "-";

  const effectiveFlag: Flag = props.flag ?? (socket.flag as Flag) ?? "GREEN";
  const fm = FLAG_META[effectiveFlag] ?? FLAG_META.GREEN;

  const effectiveSessionName =
    props.sessionName ??
    (socket.sessionId
      ? (HISTORICAL_REPLAYS.find((r) => r.id === socket.sessionId)?.circuitName ?? socket.sessionId)
      : null);

  const effectiveTimestamp = props.sourceTimestamp ?? socket.sourceTimestamp ?? null;
  const effectiveProvenance = props.provenance ?? socket.provenance ?? (socket.connected ? socket.status : null);

  const sessionTag = effectiveSessionName
    ? (effectiveTimestamp ? `${effectiveSessionName} • ${effectiveTimestamp.slice(11, 19)} UTC` : effectiveSessionName)
    : effectiveProvenance
      ? `${effectiveProvenance}${effectiveTimestamp ? ` • ${effectiveTimestamp.slice(11, 19)} UTC` : ""}`
      : "N/A";

  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-pitwall-bg/85 border-b border-pitwall-border">
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="size-8 rounded bg-pitwall-accent flex items-center justify-center font-black text-white text-sm leading-none">
              PW
            </div>
            <span className="font-black tracking-tight text-lg text-white">
              PITWALL<span className="text-pitwall-accent ml-1">ML</span>
            </span>
          </Link>
          <span
            role="status"
            aria-label={`Session: ${sessionTag}`}
            className="hidden sm:inline-flex ml-2 text-[10px] tracking-widest px-2 py-1 rounded-full bg-pitwall-card text-pitwall-muted border border-pitwall-border font-mono uppercase"
          >
            {sessionTag}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
          <span
            role="status"
            aria-label={`Session status: ${sc.label}${effectiveTimestamp ? `, source time: ${effectiveTimestamp}` : ""}`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold tracking-wide text-[11px] ${sc.cls}`}
          >
            <span className={`size-2 rounded-full ${sc.dot}`} aria-hidden="true" />
            <span>{sc.label}</span>
            {effectiveStatus === "REPLAY" && effectiveSpeed && (
              <span className="opacity-60 font-mono text-[10px] ml-0.5">• {effectiveSpeed}</span>
            )}
          </span>

          <span
            role="status"
            aria-label={
              effectiveTotalLaps != null
                ? `Lap ${currentLapDisplay} of ${effectiveTotalLaps}`
                : `Lap ${currentLapDisplay}, total laps unavailable`
            }
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pitwall-card border border-pitwall-border font-mono font-black text-white text-xs"
          >
            <span className="text-pitwall-muted">LAP</span>{" "}
            <span className="text-pitwall-accent">{currentLapDisplay}</span> /{" "}
            <span className={effectiveTotalLaps != null ? "" : "text-pitwall-muted font-normal"}>
              {effectiveTotalLaps != null ? effectiveTotalLaps : "N/A"}
            </span>
          </span>

          <span
            role="status"
            aria-label={`Track flag: ${fm.label}`}
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-black tracking-widest ${fm.cls} ${
              effectiveFlag === "GREEN"
                ? "bg-pitwall-green/15 text-pitwall-green border-pitwall-green/40"
                : effectiveFlag === "YELLOW"
                  ? "bg-pitwall-yellow/15 text-pitwall-yellow border-pitwall-yellow/40"
                  : effectiveFlag === "SC" || effectiveFlag === "VSC"
                    ? "bg-pitwall-amber/15 text-pitwall-amberlight border-pitwall-amber/30"
                    : "bg-pitwall-danger/15 text-pitwall-danger border-pitwall-danger/40"
            }`}
          >
            <span className={`size-2 rounded-full ${fm.dot}`} aria-hidden="true" />
            {fm.label}
          </span>

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="md:hidden p-1.5 rounded-md border border-pitwall-border bg-pitwall-card text-pitwall-muted hover:text-white transition-colors"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile Navigation"
          className="md:hidden border-t border-pitwall-card bg-pitwall-bg/95 px-6 py-2 flex flex-col gap-1"
        >
          {NAV.map((item) => {
            const active = isActive(currentPathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-pitwall-accent/15 text-pitwall-accent border border-pitwall-accent/30 font-bold"
                    : "text-pitwall-muted hover:text-white hover:bg-pitwall-card"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      <nav aria-label="Desktop Navigation" className="hidden md:block max-w-[1400px] mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-t border-pitwall-card -mb-px">
          {NAV.map((item) => {
            const active = isActive(currentPathname, item.href);
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
