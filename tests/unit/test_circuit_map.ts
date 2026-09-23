import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import { CircuitMap, getTimestampedDrivers, type DriverDot } from "../../apps/web/components/CircuitMap";

const webRequire = createRequire(resolve(__dirname, "../../apps/web/package.json"));
const { createElement } = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

function render(drivers?: DriverDot[]): string {
  return renderToStaticMarkup(createElement(CircuitMap, { circuitId: "monza", drivers }));
}

// Given no caller-supplied driver telemetry, when the circuit map renders,
// then it shows an unavailable state and no named pseudo-driver.
const emptyMarkup = render([]);
assert.match(emptyMarkup, /Driver positions unavailable/i);
assert.doesNotMatch(emptyMarkup, />(VER|NOR|LEC|RUS|HAM|PIA)</);
assert.deepEqual(getTimestampedDrivers(), []);

// Given an actual driver position with a fresh source timestamp, when rendered,
// then only the supplied driver is shown on the map.
const actualDriver: DriverDot = {
  driverNumber: 22,
  code: "TSU",
  color: "#3671c6",
  progress: 0.42,
  sourceTimestamp: new Date().toISOString(),
};
const actualMarkup = render([actualDriver]);
assert.doesNotMatch(actualMarkup, />(VER|NOR|LEC|RUS|HAM|PIA)</);
assert.deepEqual(getTimestampedDrivers([actualDriver]), [actualDriver]);
assert.deepEqual(getTimestampedDrivers([{ ...actualDriver, sourceTimestamp: "not-a-timestamp" }]), []);

// Given a driver update without its source interval timestamp, when rendered,
// then the component reports the position as unavailable.
const missingTimestampMarkup = render([{ ...actualDriver, sourceTimestamp: undefined }]);
assert.deepEqual(getTimestampedDrivers([{ ...actualDriver, sourceTimestamp: undefined }]), []);
assert.match(missingTimestampMarkup, /Driver positions unavailable/i);

// Given a driver position whose source timestamp is older than the 60s freshness window,
// when filtered and rendered, then it is treated as stale and the map shows
// an unavailable state carrying the stale source time and reason.
const staleDriver: DriverDot = { ...actualDriver, sourceTimestamp: "2020-01-01T00:00:00.000Z" };
assert.deepEqual(getTimestampedDrivers([staleDriver]), []);
const staleMarkup = render([staleDriver]);
assert.match(staleMarkup, /Driver positions unavailable/i);
assert.match(staleMarkup, /2020-01-01T00:00:00\.000Z/);
assert.match(staleMarkup, /stale/i);

// Given no live weather source at render time (static markup runs no effects),
// when the circuit map renders, then the conditions strip must show an explicit
// unavailable state instead of presenting baseline numeric temperatures as live.
assert.match(emptyMarkup, /Conditions unavailable/i);
assert.doesNotMatch(emptyMarkup, /Track 37\.2/);

console.log("Circuit map telemetry contracts verified successfully.");
