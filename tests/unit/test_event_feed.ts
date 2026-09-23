import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import { parseRaceSocketFrame } from "../../apps/web/lib/raceSocketProtocol";
import { EventFeed } from "../../apps/web/components/EventFeed";

const webRequire = createRequire(path.resolve(__dirname, "../../apps/web/package.json"));
const React = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.resolve(__dirname, "../../apps/web/components/EventFeed.tsx"), "utf8");
assert(!source.includes("MOCK_EVENTS"), "EventFeed must not declare mocked events");
assert(!source.includes("Last SC"), "EventFeed must not show an invented safety-car banner");
assert(source.includes("event.sourceTimestamp ?? \"Time unavailable\""), "Feed rows must render the source timestamp without a fallback time");
assert(source.includes("{event.text}"), "Feed rows must render the socket event text directly");

const emptyMarkup = renderToStaticMarkup(React.createElement(EventFeed, {}));
assert(emptyMarkup.includes("No race events available"), "Empty socket state must explain that events are unavailable");
assert(!emptyMarkup.includes("Last SC"), "Empty socket state must not show the old static banner");
assert(!emptyMarkup.includes("GREEN"), "Unknown socket flag must not become a green default");

const frame = parseRaceSocketFrame(JSON.stringify({
  type: "race_update",
  race_state: { lap: null, track_status: "UNKNOWN" },
  event: {
    source_id: "race-control-evt-9",
    event_type: "yellow_flag",
    source_timestamp: "2026-09-23T12:34:56.789Z",
    received_at: "2026-09-23T12:34:57.001Z",
    source: "openf1",
  },
}), undefined, "live");
const event = frame?.snapshot.events[0];
assert(event?.id === "race-control-evt-9", "Socket frame id must remain unchanged");
assert(event?.type === "yellow_flag", "Socket event type must remain unchanged");
assert(event?.sourceTimestamp === "2026-09-23T12:34:56.789Z", "Event source timestamp must remain unchanged");
assert(event?.lap === null, "Missing event lap must remain unavailable");

console.log("Event feed source and socket contracts verified successfully.");
