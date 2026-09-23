import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import RaceTable, { type RaceRow } from "../../apps/web/components/RaceTable";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tablePath = path.resolve(__dirname, "../../apps/web/components/RaceTable.tsx");
const source = fs.readFileSync(tablePath, "utf-8");

assert(!source.includes("—") && !source.includes("–"), "RaceTable.tsx must not contain em-dashes or en-dashes");
assert(!source.includes("79.2 +") && !source.includes("79.3 +"), "RaceTable.tsx must not synthesize lap times");
assert(!source.includes("DRIVER_FALLBACK") && !source.includes("shapTop3"), "RaceTable must not substitute fallback drivers or fabricated SHAP");

const sampleRow: RaceRow = {
  driver_number: 4,
  position: 1,
  code: "NOR",
  name: "Lando Norris",
  team: "McLaren",
  color: "#ff8000",
  gap: "LEADER",
  tyre: "M",
  tyreAge: 12,
  pace: { q10: 79.1, q50: 79.5, q90: 79.9 },
};

const markup = renderToStaticMarkup(React.createElement(RaceTable, { rows: [sampleRow] }));
assert(markup.includes("NOR"), "Must render driver code");
assert(markup.includes("79.1 / 79.5 / 79.9"), "Must render supplied q10/q50/q90 values exactly");
assert(markup.includes("LEADER"), "Must render gap for leader");

const missingPaceRow: RaceRow = {
  driver_number: 81,
  position: 2,
  code: "PIA",
  name: "Oscar Piastri",
  team: "McLaren",
  color: "#ff8000",
  gap: "+1.24",
  tyre: undefined as unknown as RaceRow["tyre"],
  tyreAge: undefined as unknown as number,
};

const missingMarkup = renderToStaticMarkup(React.createElement(RaceTable, { rows: [missingPaceRow] }));
assert(missingMarkup.includes("PIA"), "Must render second driver");
assert(!missingMarkup.includes("1:19.9"), "Must not synthesize pace when pace is missing");
assert(missingMarkup.includes("- / - / -"), "Must render dash placeholders for missing pace quantiles");
assert(missingMarkup.includes("N/A"), "Missing tyre fields must be explicitly unavailable");
assert(missingMarkup.includes("+1.24"), "Must retain supplied gap");
assert(!missingMarkup.includes(">LEADER<"), "Must not derive a leader label from position");

const emptyMarkup = renderToStaticMarkup(React.createElement(RaceTable, { rows: [] }));
assert(emptyMarkup.includes("No timing rows") || emptyMarkup.includes("unavailable"), "Empty rows must render clear empty state");

console.log("RaceTable contract tests verified successfully.");
