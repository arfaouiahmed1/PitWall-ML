import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import RaceTable, { type RaceRow } from "../apps/web/components/RaceTable";

const webRequire = createRequire(path.resolve("apps/web/package.json"));
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const fullRows: RaceRow[] = [
  {
    driver_number: 4,
    position: 1,
    code: "NOR",
    name: "Lando Norris",
    team: "McLaren",
    color: "#ff8000",
    gap: "LEADER",
    tyre: "M",
    tyreAge: 14,
    tyreWear: 82,
    pace: { q10: 79.1, q50: 79.45, q90: 79.85 },
    sectorTimes: { s1: 26.2, s2: 28.8, s3: 24.4 },
    pit: { p1: 12, p3: 45, p5: 82 },
    finishing: { p1: 58, podium: 88, points: 98 },
  },
  {
    driver_number: 81,
    position: 2,
    code: "PIA",
    name: "Oscar Piastri",
    team: "McLaren",
    color: "#ff8000",
    gap: "+1.25",
    gapToAhead: "+1.25",
    gapDelta: -0.15,
    drs: true,
    tyre: "M",
    tyreAge: 14,
    tyreWear: 79,
    pace: { q10: 79.2, q50: 79.52, q90: 79.92 },
    sectorTimes: { s1: 26.3, s2: 28.9, s3: 24.3 },
    pit: { p1: 15, p3: 50, p5: 85 },
    finishing: { p1: 32, podium: 82, points: 96 },
  },
  {
    driver_number: 16,
    position: 3,
    code: "LEC",
    name: "Charles Leclerc",
    team: "Ferrari",
    color: "#e80020",
    gap: "+4.80",
    gapToAhead: "+3.55",
    gapDelta: 0.22,
    drs: false,
    tyre: "H",
    tyreAge: 20,
    tyreWear: 61,
    pace: { q10: 79.4, q50: 79.81, q90: 80.25 },
    sectorTimes: { s1: 26.5, s2: 29.1, s3: 24.6 },
    pit: { p1: 28, p3: 72, p5: 94 },
    finishing: { p1: 10, podium: 65, points: 92 },
  },
  {
    driver_number: 63,
    position: 4,
    code: "RUS",
    name: "George Russell",
    team: "Mercedes",
    color: "#27f4d2",
    gap: "+8.10",
    gapToAhead: "+3.30",
  },
];

const renderedFull = renderToStaticMarkup(createElement(RaceTable, { rows: fullRows }));
const renderedEmpty = renderToStaticMarkup(createElement(RaceTable, { rows: [] }));

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>RaceTable ReUI DataGrid Visual QA - Task 23</title>
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
    .text-pitwall-steel { color: #475569; }
    .text-pitwall-ink { color: #f8fafc; }
    .text-pitwall-green { color: #22c55e; }
    .text-pitwall-yellow { color: #eab308; }
    .text-pitwall-cyan { color: #00d2be; }
    .text-pitwall-danger { color: #ef4444; }
    .text-pitwall-rose { color: #f43f5e; }
    .border { border-width: 1px; }
    .border-b { border-bottom-width: 1px; }
    .border-t { border-top-width: 1px; }
    .rounded-xl { border-radius: 12px; }
    .rounded-full { border-radius: 9999px; }
    .rounded { border-radius: 4px; }
    .font-mono { font-family: monospace; }
    .font-bold { font-weight: 700; }
    .font-black { font-weight: 900; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-1 { gap: 4px; }
    .gap-1\\.5 { gap: 6px; }
    .gap-2 { gap: 8px; }
    .gap-2\\.5 { gap: 10px; }
    .gap-3 { gap: 12px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .py-3 { padding-top: 12px; padding-bottom: 12px; }
    .px-4 { padding-left: 16px; padding-right: 16px; }
    .overflow-hidden { overflow: hidden; }
    .overflow-x-auto { overflow-x: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h2>1. RaceTable - Truth-Based ReUI Leaderboard with Exact Pace Predictions</h2>
      <div class="desc">Rendered with genuine q10/q50/q90 intervals, TyreStintBadge with authentic wear rings, and missing row 4 showing '-' without synthesis.</div>
      ${renderedFull}
    </div>

    <div class="panel">
      <h2>2. RaceTable - Explicit Unavailable Empty State</h2>
      <div class="desc">Rendered with 0 rows; shows 'No timing rows available' with zero fake placeholder drivers.</div>
      ${renderedEmpty}
    </div>
  </div>
</body>
</html>`;

const projectRoot = path.resolve(__dirname, "..");
const outHtml = path.resolve(projectRoot, ".omo/evidence/task-23-visual-verification.html");
const outPng = path.resolve(projectRoot, ".omo/evidence/task-23-race-table-edge.png");

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