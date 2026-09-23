import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import { CircuitMap, type DriverDot } from "../apps/web/components/CircuitMap";

const webRequire = createRequire(path.resolve(__dirname, "../apps/web/package.json"));
const { createElement } = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const freshDriver: DriverDot = {
  driverNumber: 22,
  code: "TSU",
  color: "#3671c6",
  progress: 0.42,
  position: 1,
  gap: "LEADER",
  sourceTimestamp: new Date().toISOString(),
};
const staleDriver: DriverDot = { ...freshDriver, sourceTimestamp: "2020-01-01T00:00:00.000Z" };

const liveHtml = renderToStaticMarkup(
  createElement(CircuitMap, { circuitId: "monza", drivers: [freshDriver], lap: 12, flag: "GREEN" })
);
const staleHtml = renderToStaticMarkup(
  createElement(CircuitMap, { circuitId: "monza", drivers: [staleDriver], flag: "UNKNOWN" })
);
const emptyHtml = renderToStaticMarkup(
  createElement(CircuitMap, { circuitId: "monza", drivers: [] })
);

const fullPageHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>PitWall ML - CircuitMap Truthfulness (Todo 17)</title>
  <style>
    body { margin: 0; padding: 24px; background: #080c14; color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
    .panel { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px;
      padding: 16px; margin-bottom: 24px; max-width: 900px; }
    h1 { font-size: 18px; font-weight: 900; color: #00d2be; margin-bottom: 20px; }
    h2 { font-size: 13px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; margin: 0 0 12px 0; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>PITWALL ML - CIRCUIT MAP TRUTHFULNESS (TODO 17)</h1>
  <div class="panel"><h2>1. Fresh timestamped telemetry renders the supplied driver only</h2>${liveHtml}</div>
  <div class="panel"><h2>2. Stale source timestamp renders visible unavailable state with source time</h2>${staleHtml}</div>
  <div class="panel"><h2>3. Empty telemetry renders visible unavailable state, conditions unavailable</h2>${emptyHtml}</div>
</body>
</html>`;

const projectRoot = path.resolve(__dirname, "..");
const outHtml = path.resolve(projectRoot, ".omo/evidence/task-17-visual-verification.html");
const outPng = path.resolve(projectRoot, ".omo/evidence/task-17-circuit-map.png");
fs.writeFileSync(outHtml, fullPageHtml, "utf8");
console.log(`Rendered verification HTML to: ${outHtml}`);

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (fs.existsSync(edgePath)) {
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      "--window-size=1440,2400",
      `--screenshot=${outPng}`,
      `file:///${outHtml.replace(/\\/g, "/")}`,
    ], { timeout: 15000 });
    console.log(`Visual screenshot captured successfully: ${outPng}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Edge screenshot invocation failed: ${msg}`);
  }
} else {
  console.log("No Edge executable found for visual capture.");
}
