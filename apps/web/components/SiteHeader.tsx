"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";

const FLAG_META: Record<Flag, { label: string; dot: string; bar: string; cls: string }> = {
  GREEN: { label: "GREEN", dot: "bg-[#22c55e]", bar: "bg-[#22c55e]", cls: "flag-green" },
  YELLOW: { label: "YELLOW", dot: "bg-[#eab308]", bar: "bg-[#eab308]", cls: "flag-yellow" },
  SC: { label: "SAFETY CAR", dot: "bg-[#f59e0b]", bar: "bg-[#f59e0b]", cls: "flag-sc" },
  VSC: { label: "VIRTUAL SC", dot: "bg-[#eab308]", bar: "bg-[#eab308]", cls: "flag-vsc" },
  RED: { label: "RED FLAG", dot: "bg-[#ef4444]", bar: "bg-[#ef4444]", cls: "flag-red" },
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
  const [flag, setFlag] = useState<Flag>("GREEN");
  const [lap, setLap] = useState(31);
  const [totalLaps] = useState(66);
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState(18);
  const [replaySpeed] = useState("20x");

  useEffect(() => {
    let ws: WebSocket | null = null;
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (url) {
      try {
        const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
        const host = url.replace(/^wss?:\/\//, "");
        ws = new WebSocket(`${proto}://${host}/ws/race?speed=${replaySpeed}`);
        ws.onopen = () => setConnected(true);
        ws.onclose = () => setConnected(false);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.race_state?.lap) setLap(msg.race_state.lap);
            if (msg.race_state?.flag) setFlag(msg.race_state.flag as Flag);
          } catch {}
        };
      } catch {}
    }
    let t: ReturnType<typeof setInterval>;
    if (!url) {
      t = setInterval(() => {
        setLatency((v) => Math.max(8, Math.min(42, v + (Math.random() - 0.5) * 6)) | 0);
        if (Math.random() < 0.04) {
          const flags: Flag[] = ["GREEN", "GREEN", "GREEN", "YELLOW", "SC", "VSC"];
          setFlag(flags[Math.floor(Math.random() * flags.length)]);
        }
      }, 1200);
    } else {
      t = setInterval(() => {
        setLatency((v) => Math.max(8, Math.min(90, v + (Math.random() - 0.5) * 4)) | 0);
      }, 1800);
    }
    return () => {
      clearInterval(t);
      try {
        ws?.close();
      } catch {}
    };
  }, [replaySpeed]);

  const fm = FLAG_META[flag];

  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-[#080c14]/85 border-b border-[#1e293b]">
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#ff1801] flex items-center justify-center font-black text-white text-sm leading-none">
              PW
            </div>
            <span className="font-black tracking-tight text-lg text-white">
              PITWALL<span className="text-[#ff1801] ml-1">ML</span>
            </span>
          </Link>
          <span className="hidden sm:inline-flex ml-2 text-[10px] tracking-widest px-2 py-1 rounded-full bg-[#0f172a] text-[#8b9bb4] border border-[#1e293b]">
            V2 • PIT WALL OPS
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold tracking-wide text-[11px] ${
              connected
                ? "bg-[#00d2be]/10 text-[#00d2be] border-[#00d2be]/30"
                : "bg-[#ff8000]/10 text-[#eab308] border-[#ff8000]/25"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-[#00d2be]" : "bg-[#eab308]"} latency-dot`} />
            {connected ? "REPLAY LIVE" : "CLIENT SIM"}
            <span className="opacity-60 font-mono">• {replaySpeed}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] ${
              connected
                ? "bg-[#0f172a] text-[#e2e8f0] border-[#1e293b]"
                : "bg-[#0f172a] text-[#94a3b8] border-[#1e293b]"
            }`}
            title={connected ? "WebSocket round-trip" : "Client-side simulation"}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-[#22c55e]" : "bg-[#64748b]"}`} />
            {connected ? `WebSocket • ${latency}ms` : "Client Engine • active"}
          </span>

          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0f172a] border border-[#1e293b] font-mono font-black text-white text-xs">
            LAP <span className="text-[#ff1801]">{lap}</span> / {totalLaps}
          </span>

          <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-black tracking-widest ${fm.cls} ${
              flag === "GREEN"
                ? "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/40"
                : flag === "YELLOW"
                  ? "bg-[#eab308]/15 text-[#eab308] border-[#eab308]/40"
                  : flag === "SC" || flag === "VSC"
                    ? "bg-[#f59e0b]/15 text-[#fbbf24] border-[#f59e0b]/30"
                    : "bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/40"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${fm.dot}`} />
            {fm.label}
          </span>
        </div>
      </div>

      <nav className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-t border-[#0f172a] -mb-px">
          {NAV.map((item) => {
            const active = isActive(pathname ?? "", item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative whitespace-nowrap px-3.5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-[#ff1801] text-white"
                    : "border-transparent text-[#8b9bb4] hover:text-white hover:border-[#1e293b]"
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
