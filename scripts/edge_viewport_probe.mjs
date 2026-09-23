import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const evidenceDir = path.join(projectRoot, ".omo", "evidence");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port)) return true;
    await sleep(2000);
  }
  return false;
}

async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (id, method, params = {}) => new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id === id) {
        ws.removeEventListener("message", onMessage);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send(1, "Emulation.setDeviceMetricsOverride", {
    width: Number(process.env.PROBE_WIDTH ?? "375"),
    height: Number(process.env.PROBE_HEIGHT ?? "812"),
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send(2, "Page.navigate", { url: process.env.PROBE_URL });
  await sleep(9000);
  const evalResult = await send(3, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  const shot = await send(4, "Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  ws.close();
  return { value: evalResult.result?.value, pngBase64: shot.data };
}

async function main() {
  const width = Number(process.env.PROBE_WIDTH ?? "375");
  const height = Number(process.env.PROBE_HEIGHT ?? "812");
  const cdpPort = Number(process.env.PROBE_CDP_PORT ?? "9333");
  const outPng = process.env.PROBE_OUT_PNG ?? path.join(evidenceDir, "task-28-circuit-375.png");
  const outJson = process.env.PROBE_OUT_JSON ?? path.join(evidenceDir, "task-28-viewport.json");

  const edge = spawn(EDGE, [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${cdpPort}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    if (!(await waitForPort(cdpPort, 30))) throw new Error("Edge CDP port never opened.");
    const tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = tabs.find((t) => t.type === "page") ?? tabs[0];
    if (!page) throw new Error("No CDP page target found.");
    const { value, pngBase64 } = await cdpEvaluate(
      page.webSocketDebuggerUrl,
      "({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })"
    );
    fs.writeFileSync(outPng, Buffer.from(pngBase64, "base64"));
    const record = { width, url: process.env.PROBE_URL, ...value, fits: value.scrollWidth <= width };
    let merged = {};
    if (fs.existsSync(outJson)) {
      try { merged = JSON.parse(fs.readFileSync(outJson, "utf8")); } catch { merged = {}; }
    }
    merged[width === 375 ? "mobile375" : `desktop${width}`] = record;
    fs.writeFileSync(outJson, JSON.stringify(merged, null, 2), "utf8");
    console.log(JSON.stringify(record));
    if (!record.fits) process.exitCode = 2;
  } finally {
    try { execFileSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"]); } catch { edge.kill(); }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
