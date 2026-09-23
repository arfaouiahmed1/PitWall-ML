import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import { EventFeed } from "../apps/web/components/EventFeed";

const webRequire = createRequire(path.resolve("apps/web/package.json"));
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const renderedEmpty = renderToStaticMarkup(createElement(EventFeed, {}));

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>EventFeed Visual QA - Task 24</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #080c14;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    }
    .container {
      max-width: 800px;
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
    .bg-pitwall-bg { background-color: #080c14; }
    .bg-pitwall-card { background-color: #0f172a; }
    .bg-pitwall-border { background-color: #1e293b; }
    .border-pitwall-border { border-color: #1e293b; }
    .text-pitwall-muted { color: #64748b; }
    .text-pitwall-fog { color: #94a3b8; }
    .border { border-width: 1px; }
    .border-b { border-bottom-width: 1px; }
    .rounded-xl { border-radius: 12px; }
    .rounded { border-radius: 4px; }
    .font-mono { font-family: monospace; }
    .font-black { font-weight: 900; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .px-4 { padding-left: 16px; padding-right: 16px; }
    .py-3 { padding-top: 12px; padding-bottom: 12px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .p-8 { padding: 32px; }
    .text-center { text-align: center; }
    .text-xs { font-size: 12px; }
    .text-sm { font-size: 14px; }
    .text-\\[10px\\] { font-size: 10px; }
    .text-\\[11px\\] { font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h2>1. EventFeed - Live Race Control Stream (Empty / Standby State)</h2>
      <div class="desc">Rendered with 0 events; displays 'No race events available' without hardcoded mock arrays or fake SC copy.</div>
      ${renderedEmpty}
    </div>
  </div>
</body>
</html>`;

const projectRoot = path.resolve(__dirname, "..");
const outHtml = path.resolve(projectRoot, ".omo/evidence/task-24-visual-verification.html");
const outPng = path.resolve(projectRoot, ".omo/evidence/task-24-event-feed-edge.png");

fs.writeFileSync(outHtml, html, "utf8");
console.log(`Rendered verification HTML to: ${outHtml}`);

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (fs.existsSync(edgePath)) {
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      "--window-size=1200,800",
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