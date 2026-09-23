import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackDominance, type DominanceRow } from "../../apps/web/components/TrackDominance";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const componentPath = path.resolve(__dirname, "../../apps/web/components/TrackDominance.tsx");
const pagePath = path.resolve(__dirname, "../../apps/web/app/page.tsx");

const source = fs.readFileSync(componentPath, "utf-8");
const pageSource = fs.readFileSync(pagePath, "utf-8");

assert(!source.includes("MOCK_ROWS"), "TrackDominance.tsx must not contain MOCK_ROWS");
assert(!pageSource.includes("charCodeAt"), "page.tsx must not use ASCII charCodeAt hashing for sector dominance");
assert(!source.includes("—") && !source.includes("–"), "TrackDominance.tsx must not contain em-dashes or en-dashes");

const emptyMarkup = renderToStaticMarkup(React.createElement(TrackDominance, { rows: [] }));
assert(emptyMarkup.includes("SECTOR TIMING UNAVAILABLE") || emptyMarkup.includes("Awaiting"), "Empty rows must render explicit awaiting state");
assert(!emptyMarkup.includes("VER"), "Empty state must not render mock leader VER");

const sampleRows: DominanceRow[] = [
  { code: "NOR", driverNumber: 4, color: "#ff8000", team: "McLaren", s1: 0, s2: 0, s3: 0, total: 0 },
  { code: "PIA", driverNumber: 81, color: "#ff8000", team: "McLaren", s1: 0.042, s2: -0.018, s3: 0.031, total: 0.055 },
];

const filledMarkup = renderToStaticMarkup(React.createElement(TrackDominance, { rows: sampleRows, leaderCode: "NOR" }));
assert(filledMarkup.includes("NOR"), "Must render leader NOR");
assert(filledMarkup.includes("PIA"), "Must render rival PIA");
assert(filledMarkup.includes("+0.042"), "Must render positive delta");
assert(filledMarkup.includes("-0.018"), "Must render negative delta");

console.log("TrackDominance contract tests verified successfully.");