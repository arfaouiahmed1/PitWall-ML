import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const detail = fs.readFileSync(path.join(root, "apps/web/app/drivers/[driver]/DriverDetailClient.tsx"), "utf8");
const roster = fs.readFileSync(path.join(root, "apps/web/app/drivers/page.tsx"), "utf8");

if (/Math\.sin|79\.15|P1 Contender|1:19\.28|Avg Deg/.test(detail)) {
  throw new Error("Driver detail contains generated lap metrics or unsourced rank/pace claims");
}
if (!detail.includes("api.openf1.org/v1/laps") || !detail.includes("Historical lap records unavailable")) {
  throw new Error("Driver history must use source lap records and expose an unavailable state");
}
if (!detail.includes("PerformanceRadarChart series={[]}") || !roster.includes("team-level car profile")) {
  throw new Error("Unavailable driver measurements must not be represented as driver performance");
}
