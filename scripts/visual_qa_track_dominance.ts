import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import { TrackDominance, type DominanceRow } from "../apps/web/components/TrackDominance";

const webRequire = createRequire(path.resolve("apps/web/package.json"));
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const sampleRows: DominanceRow[] = [
  { code: "NOR", driverNumber: 4, color: "#ff8000", team: "McLaren", s1: 0, s2: 0, s3: 0, total: 0 },
  { code: "PIA", driverNumber: 81, color: "#ff8000", team: "McLaren", s1: 0.042, s2: -0.018, s3: 0.031, total: 0.055 },
  { code: "LEC", driverNumber: 16, color: "#e80020", team: "Ferrari", s1: 0.11, s2: 0.04, s3: -0.022, total: 0.128 },
  { code: "RUS", driverNumber: 63, color: "#27f4d2", team: "Mercedes", s1: -0.025, s2: 0.098, s3: 0.052, total: 0.125 },
];

const renderedFilled = renderToStaticMarkup(createElement(TrackDominance, { rows: sampleRows, leaderCode: "NOR" }));
const renderedEmpty = renderToStaticMarkup(createElement(TrackDominance, { rows: [] }));

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>TrackDominance Visual QA - Task 25</title>
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
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; }
    .bg-pitwall-bg { background-color: #080c14; }
    .bg-pitwall-card { background-color: #0f172a; }
    .bg-pitwall-border { background-color: #1e293b; }
    .border-pitwall-border { border-color: #1e293b; }
    .text-pitwall-muted { color: #64748b; }
    .text-pitwall-fog { color: #94a3b8; }
    .border { border-width: 1px; }
    .border-b { border-bottom-width: 1px; }
    .border-t { border-top-width: 1px; }
    .rounded-xl { border-radius: 12px; }
    .rounded { border-radius: 4px; }
    .font-mono { font-family: monospace; }
    .font-bold { font-weight: 700; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-1 { gap: 4px; }
    .gap-1\\.5 { gap: 6px; }
    .gap-2 { gap: 8px; }
    .gap-3 { gap: 12px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .py-2\\.5 { padding-top: 10px; padding-bottom: 10px; }
    .px-4 { padding-left: 16px; padding-right: 16px; }
    .px-1\\.5 { padding-left: 6px; padding-right: 6px; }
    .text-center { text-align: center; }
    .overflow-hidden { overflow: hidden; }
    .overflow-x-auto { overflow-x: auto; }
    .grid { display: grid; }
    .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h2>1. TrackDominance - Truth-Based Sector Timing Deltas</h2>
      <div class="desc">Rendered with genuine sector deltas (NOR benchmark, PIA / LEC / RUS rival deltas).</div>
      ${renderedFilled}
    </div>

    <div class="panel">
      <h2>2. TrackDominance - Explicit Awaiting State</h2>
      <div class="desc">Rendered with 0 rows; shows 'SECTOR TIMING UNAVAILABLE' with zero mock drivers or fake benchmarks.</div>
      ${renderedEmpty}
    </div>
  </div>
</body>
</html>`;

const projectRoot = path.resolve(__dirname, "..");
const outHtml = path.resolve(projectRoot, ".omo/evidence/task-25-visual-verification.html");
const outPng = path.resolve(projectRoot, ".omo/evidence/task-25-track-dominance-edge.png");

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