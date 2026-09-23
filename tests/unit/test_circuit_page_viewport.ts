import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const pagePath = path.resolve(__dirname, "../../apps/web/app/circuit/page.tsx");
const layoutPath = path.resolve(__dirname, "../../apps/web/app/layout.tsx");
const schedulePath = path.resolve(__dirname, "../../apps/web/components/WeekendSchedule.tsx");
const mapPath = path.resolve(__dirname, "../../apps/web/components/CircuitMap.tsx");

const page = fs.readFileSync(pagePath, "utf8");
const layout = fs.readFileSync(layoutPath, "utf8");
const schedule = fs.readFileSync(schedulePath, "utf8");
const map = fs.readFileSync(mapPath, "utf8");

assert(/width:\s*"device-width"/.test(layout), "root layout must set viewport width to device-width.");
assert(/initialScale:\s*1/.test(layout), "root layout must set viewport initialScale to 1.");

function hasNoOverflowMask(source: string, label: string): void {
  assert(!/overflow-x-hidden/.test(source), `${label} must not mask overflow with overflow-x-hidden.`);
  assert(!/overflow-hidden[^"]*"(?=[^>]*space-y-6)/.test(source), `${label} root must not mask overflow.`);
}

hasNoOverflowMask(page, "circuit page");
hasNoOverflowMask(schedule, "WeekendSchedule");
hasNoOverflowMask(map, "CircuitMap");

assert(/min-w-0/.test(page), "circuit page must constrain grid children with min-w-0.");
assert(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-5/.test(page), "stats grid must step through an sm breakpoint.");
assert(/max-w-full/.test(page), "circuit select must be capped with max-w-full.");
assert(/flex-wrap/.test(schedule), "schedule countdown banner must wrap on narrow viewports.");
assert(/shrink-0/.test(schedule), "schedule time block and status rail must not shrink-squeeze content.");
assert(/min-w-0/.test(map), "CircuitMap strips must constrain cells with min-w-0.");

console.log("Circuit page viewport contracts verified successfully.");
