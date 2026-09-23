import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import SiteHeader from "../apps/web/components/SiteHeader";

const webRequire = createRequire(path.resolve("apps/web/package.json"));
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const desktopCockpit = renderToStaticMarkup(
  createElement(SiteHeader, {
    pathname: "/",
    status: "REPLAY",
    speed: "20x",
    lap: 12,
    totalLaps: 53,
    flag: "GREEN",
  })
);

const desktopApiDocs = renderToStaticMarkup(
  createElement(SiteHeader, {
    pathname: "/api-docs",
    status: "LIVE",
    lap: 4,
    totalLaps: 78,
    flag: "YELLOW",
  })
);

const desktopOffline = renderToStaticMarkup(
  createElement(SiteHeader, {
    pathname: "/api-docs",
    status: "OFFLINE",
    lap: null,
    totalLaps: null,
    flag: "GREEN",
  })
);

const mobileMenuOpen = renderToStaticMarkup(
  createElement(SiteHeader, {
    pathname: "/api-docs",
    status: "REPLAY",
    speed: "5x",
    lap: 22,
    totalLaps: 44,
    initialMobileOpen: true,
  })
);

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>SiteHeader Visual QA - Task 14</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #080c14;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .panel {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 16px;
      overflow: hidden;
    }
    h2 {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 12px 0;
      color: #00d2be;
    }
    .desc {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 12px;
    }
    /* Tailwind utilities used by SiteHeader */
    .sticky { position: sticky; }
    .top-0 { top: 0; }
    .z-50 { z-index: 50; }
    .backdrop-blur { backdrop-filter: blur(8px); }
    .bg-pitwall-bg\\/85 { background-color: rgba(8, 12, 20, 0.85); }
    .bg-pitwall-bg\\/95 { background-color: rgba(8, 12, 20, 0.95); }
    .border-b { border-bottom-width: 1px; }
    .border-t { border-top-width: 1px; }
    .border-pitwall-border { border-color: #1e293b; }
    .border-pitwall-card { border-color: #0f172a; }
    .max-w-\\[1400px\\] { max-width: 1400px; }
    .mx-auto { margin-left: auto; margin-right: auto; }
    .px-6 { padding-left: 24px; padding-right: 24px; }
    .py-2\\.5 { padding-top: 10px; padding-bottom: 10px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .py-1 { padding-top: 4px; padding-bottom: 4px; }
    .py-3 { padding-top: 12px; padding-bottom: 12px; }
    .px-2\\.5 { padding-left: 10px; padding-right: 10px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .px-3\\.5 { padding-left: 14px; padding-right: 14px; }
    .px-2 { padding-left: 8px; padding-right: 8px; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .flex-wrap { flex-wrap: wrap; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-3 { gap: 12px; }
    .gap-2 { gap: 8px; }
    .gap-1 { gap: 4px; }
    .gap-1\\.5 { gap: 6px; }
    .size-8 { width: 32px; height: 32px; }
    .size-4 { width: 16px; height: 16px; }
    .size-2 { width: 8px; height: 8px; }
    .rounded { border-radius: 4px; }
    .rounded-md { border-radius: 6px; }
    .rounded-full { border-radius: 9999px; }
    .bg-pitwall-accent { background-color: #e10600; }
    .bg-pitwall-accent\\/15 { background-color: rgba(225, 6, 0, 0.15); }
    .border-pitwall-accent\\/30 { border-color: rgba(225, 6, 0, 0.3); }
    .border-pitwall-accent { border-color: #e10600; }
    .text-pitwall-accent { color: #e10600; }
    .text-white { color: #ffffff; }
    .font-black { font-weight: 900; }
    .font-bold { font-weight: 700; }
    .font-medium { font-weight: 500; }
    .font-mono { font-family: monospace; }
    .text-sm { font-size: 14px; }
    .text-xs { font-size: 12px; }
    .text-\\[10px\\] { font-size: 10px; }
    .text-\\[11px\\] { font-size: 11px; }
    .text-lg { font-size: 18px; }
    .tracking-tight { letter-spacing: -0.02em; }
    .tracking-widest { letter-spacing: 0.1em; }
    .tracking-wide { letter-spacing: 0.05em; }
    .leading-none { line-height: 1; }
    .ml-1 { margin-left: 4px; }
    .ml-2 { margin-left: 8px; }
    .ml-0\\.5 { margin-left: 2px; }
    .-mb-px { margin-bottom: -1px; }
    .w-full { width: 100%; }
    .h-\\[2px\\] { height: 2px; }
    .opacity-80 { opacity: 0.8; }
    .opacity-60 { opacity: 0.6; }
    .border { border-width: 1px; border-style: solid; }
    .border-b-2 { border-bottom-width: 2px; border-bottom-style: solid; }
    .border-transparent { border-color: transparent; }
    .whitespace-nowrap { white-space: nowrap; }
    .overflow-x-auto { overflow-x: auto; }
    .bg-pitwall-card { background-color: #0f172a; }
    .bg-pitwall-green { background-color: #22c55e; }
    .bg-pitwall-green\\/10 { background-color: rgba(34, 197, 94, 0.1); }
    .bg-pitwall-green\\/15 { background-color: rgba(34, 197, 94, 0.15); }
    .border-pitwall-green\\/30 { border-color: rgba(34, 197, 94, 0.3); }
    .border-pitwall-green\\/40 { border-color: rgba(34, 197, 94, 0.4); }
    .text-pitwall-green { color: #22c55e; }
    .bg-pitwall-cyan { background-color: #00d2be; }
    .bg-pitwall-cyan\\/10 { background-color: rgba(0, 210, 190, 0.1); }
    .border-pitwall-cyan\\/30 { border-color: rgba(0, 210, 190, 0.3); }
    .text-pitwall-cyan { color: #00d2be; }
    .bg-pitwall-yellow { background-color: #eab308; }
    .bg-pitwall-yellow\\/15 { background-color: rgba(234, 179, 8, 0.15); }
    .border-pitwall-yellow\\/40 { border-color: rgba(234, 179, 8, 0.4); }
    .text-pitwall-yellow { color: #eab308; }
    .bg-pitwall-amber { background-color: #f59e0b; }
    .bg-pitwall-amber\\/10 { background-color: rgba(245, 158, 11, 0.1); }
    .border-pitwall-amber\\/30 { border-color: rgba(245, 158, 11, 0.3); }
    .text-pitwall-amber { color: #f59e0b; }
    .bg-pitwall-muted { background-color: #64748b; }
    .text-pitwall-muted { color: #64748b; }
    a { text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h2>1. Desktop Navigation - Replay Mode at Cockpit (Monza 53 Laps, 20x Speed)</h2>
      <div class="desc">Active tab: Race Cockpit. Sourced replay metadata (Lap 12/53, 20x speed, GREEN flag). API DOCS tab visible.</div>
      ${desktopCockpit}
    </div>

    <div class="panel">
      <h2>2. Desktop Navigation - Active API DOCS Route (Monaco 78 Laps, LIVE Mode)</h2>
      <div class="desc">Active tab: API DOCS (with active indicator and aria-current="page"). Sourced live session (Lap 4/78, YELLOW flag).</div>
      ${desktopApiDocs}
    </div>

    <div class="panel">
      <h2>3. Desktop Navigation - Offline Standby (Laps Unavailable: N/A, Zero Fake Defaults)</h2>
      <div class="desc">Status: OFFLINE. Total laps: N/A (no hardcoded 66 fallback). Lap: -. API DOCS link present.</div>
      ${desktopOffline}
    </div>

    <div class="panel" style="max-width: 480px;">
      <h2>4. Mobile Navigation - Menu Open with API DOCS Link</h2>
      <div class="desc">Hamburger menu expanded. Full navigation list rendered including active API DOCS link.</div>
      ${mobileMenuOpen}
    </div>
  </div>
</body>
</html>`;

const projectRoot = path.resolve(__dirname, "..");
const outHtml = path.resolve(projectRoot, ".omo/evidence/task-14-visual-verification.html");
const outPng = path.resolve(projectRoot, ".omo/evidence/task-14-site-header-edge.png");

fs.writeFileSync(outHtml, html, "utf8");
console.log(`Rendered verification HTML to: ${outHtml}`);

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (fs.existsSync(edgePath)) {
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      "--window-size=1440,1200",
      `--screenshot=${outPng}`,
      `file:///${outHtml.replace(/\\/g, "/")}`,
    ], { timeout: 15000 });
    console.log(`Edge screenshot captured successfully: ${outPng}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Edge screenshot invocation failed: ${msg}`);
  }
} else {
  console.log(`Edge not found at ${edgePath}`);
}
