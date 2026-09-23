import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import SiteHeader, { NAV, isActive, resolveCircuitTotalLaps } from "../../apps/web/components/SiteHeader";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 1. Static source audit
const headerPath = path.resolve(__dirname, "../../apps/web/components/SiteHeader.tsx");
const source = fs.readFileSync(headerPath, "utf-8");
const lines = source.split("\n");

// Pure LOC check (under 250 LOC)
const nonBlankNonCommentLines = lines.filter(
  (l) => l.trim().length > 0 && !l.trim().startsWith("//") && !l.trim().startsWith("/*")
).length;
assert(nonBlankNonCommentLines <= 250, `SiteHeader.tsx must be <= 250 pure LOC; got ${nonBlankNonCommentLines}`);

// Typography anti-slop check
assert(!source.includes("—") && !source.includes("–"), "SiteHeader.tsx must not contain em-dashes or en-dashes");
assert(!source.includes("2025/26 season"), "SiteHeader.tsx must not render static '2025/26 season' badge");
assert(!source.includes("CALENDAR_2025"), "SiteHeader.tsx must not import or use CALENDAR_2025");

// No hardcoded 66 default laps
assert(!source.includes("totalLaps = 66"), "SiteHeader.tsx must not hardcode totalLaps = 66");
assert(!source.includes("?? 66"), "SiteHeader.tsx must not use fallback ?? 66 for laps");

// No example connection / fake clock indicators
assert(!source.includes('"WS CONNECTED"'), "SiteHeader.tsx must not render 'WS CONNECTED'");
assert(!source.includes("STANDBY"), "SiteHeader.tsx must not render 'STANDBY'");
assert(!source.includes("NEXT:"), "SiteHeader.tsx must not render 'NEXT:' placeholder");
assert(!source.includes('"on track"') && !source.includes('"off track"'), "SiteHeader.tsx must not render 'on track' / 'off track' placeholders");

// 2. Navigation items contract
const apiDocsItem = NAV.find((item) => item.href === "/api-docs");
assert(apiDocsItem !== undefined, "NAV must include /api-docs");
assert(apiDocsItem.label === "API DOCS", "NAV item for /api-docs must have label 'API DOCS'");

const expectedHrefs = [
  "/",
  "/strategy",
  "/drivers",
  "/circuit",
  "/models",
  "/monitoring",
  "/api-docs",
];
assert(
  JSON.stringify(NAV.map((n) => n.href)) === JSON.stringify(expectedHrefs),
  `NAV hrefs do not match expected IA: ${JSON.stringify(NAV.map((n) => n.href))}`,
);

// Verify isActive helper
assert(isActive("/", "/"), "isActive('/', '/') should be true");
assert(!isActive("/strategy", "/"), "isActive('/strategy', '/') should be false");
assert(isActive("/api-docs", "/api-docs"), "isActive('/api-docs', '/api-docs') should be true");
assert(!isActive("/api-docs", "/strategy"), "isActive('/api-docs', '/strategy') should be false");
assert(isActive("/drivers/44", "/drivers"), "isActive('/drivers/44', '/drivers') should match subroutes");
assert(!isActive("/drivers-overview", "/drivers"), "isActive('/drivers-overview', '/drivers') should not match prefix substrings");

// 3. Render tests: Navigation and active states
// Given: pathname '/api-docs'
// When: SiteHeader renders
// Then: /api-docs has aria-current="page" and inactive links do not
const apiDocsActiveMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { pathname: "/api-docs" })
);
assert(apiDocsActiveMarkup.includes('href="/api-docs"'), "Desktop nav must render /api-docs link");
assert(apiDocsActiveMarkup.includes('aria-current="page"'), "Active link must have aria-current='page'");
assert(apiDocsActiveMarkup.includes("API DOCS"), "Rendered markup must include 'API DOCS'");

const rootLinkMatches = apiDocsActiveMarkup.match(/href="\/"[^>]*aria-current="page"/);
assert(!rootLinkMatches, "Inactive root link must not have aria-current='page' when on /api-docs");

// 4. Mobile navigation: Hamburger toggle and menu
// Given: initialMobileOpen false
// When: SiteHeader renders
// Then: aria-expanded is false and mobile-nav container is omitted
const mobileClosedMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { pathname: "/api-docs", initialMobileOpen: false })
);
assert(mobileClosedMarkup.includes('aria-expanded="false"'), "Mobile toggle must have aria-expanded='false' when closed");
assert(!mobileClosedMarkup.includes('id="mobile-nav"'), "Mobile nav container must not be rendered when closed");

// Given: initialMobileOpen true
// When: SiteHeader renders
// Then: aria-expanded is true and mobile-nav renders with all links
const mobileOpenMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { pathname: "/api-docs", initialMobileOpen: true })
);
assert(mobileOpenMarkup.includes('aria-label="Toggle navigation menu"'), "Must render mobile hamburger button");
assert(mobileOpenMarkup.includes('aria-expanded="true"'), "Mobile toggle must have aria-expanded='true' when open");
assert(mobileOpenMarkup.includes('id="mobile-nav"'), "Must render mobile-nav container when open");
assert(mobileOpenMarkup.includes('aria-label="Mobile Navigation"'), "Mobile nav must have accessible label");
for (const href of expectedHrefs) {
  assert(mobileOpenMarkup.includes(`href="${href}"`), `Mobile nav must include link to ${href}`);
}

// 5. Connection and Provenance Status
// Status must ONLY be LIVE, REPLAY, STALE, or OFFLINE when sourced from real data
for (const status of ["LIVE", "REPLAY", "STALE", "OFFLINE"] as const) {
  const statusMarkup = renderToStaticMarkup(
    React.createElement(SiteHeader, { status, pathname: "/" })
  );
  assert(statusMarkup.includes(status), `SiteHeader must render status '${status}'`);
  assert(
    statusMarkup.includes(`Session status: ${status}`),
    `SiteHeader must expose accessible label for status '${status}'`,
  );
}

const replaySpeedMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { status: "REPLAY", speed: "20x", pathname: "/" })
);
assert(replaySpeedMarkup.includes("• 20x"), "Replay status must display configured replay speed");

const liveNoSpeedMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { status: "LIVE", speed: "20x", pathname: "/" })
);
assert(!liveNoSpeedMarkup.includes("• 20x"), "Live status must not display replay speed multiplier");

// 6. Dynamic Total Lap Count
// When active circuit/session metadata is supplied (e.g. Monza: 53, Spa: 44)
const monzaMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { status: "REPLAY", lap: 12, totalLaps: 53, pathname: "/" })
);
assert(monzaMarkup.includes("53"), "Header must render total laps 53 for active Monza session");
assert(!monzaMarkup.includes("66"), "Header must not render 66 when active circuit has 53 laps");
assert(monzaMarkup.includes('aria-label="Lap 12 of 53"'), "Header must expose accessible label 'Lap 12 of 53'");

const spaMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { status: "REPLAY", lap: 5, totalLaps: 44, pathname: "/" })
);
assert(spaMarkup.includes("44"), "Header must render total laps 44 for active Spa session");
assert(spaMarkup.includes('aria-label="Lap 5 of 44"'), "Header must expose accessible label 'Lap 5 of 44'");

// When total laps is unavailable, render concise unavailable label 'N/A'
const unavailableMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { status: "OFFLINE", lap: null, totalLaps: null, pathname: "/" })
);
assert(unavailableMarkup.includes("N/A"), "Header must render 'N/A' when total laps is unavailable");
assert(!unavailableMarkup.includes("66"), "Header must not default to 66 when total laps is unavailable");
assert(unavailableMarkup.includes('aria-label="Lap -, total laps unavailable"'), "Header must expose accessible label when laps unavailable");

// 7. Session ID circuit total laps resolver
assert(resolveCircuitTotalLaps("2024_monza") === 53, "resolveCircuitTotalLaps must resolve monza to 53 laps");
assert(resolveCircuitTotalLaps("spa_replay") === 44, "resolveCircuitTotalLaps must resolve spa to 44 laps");
assert(resolveCircuitTotalLaps("silverstone_2025") === 52, "resolveCircuitTotalLaps must resolve silverstone to 52 laps");
assert(resolveCircuitTotalLaps("monaco") === 78, "resolveCircuitTotalLaps must resolve monaco to 78 laps");
assert(resolveCircuitTotalLaps("live_session_openf1") === null, "Live session without known replay laps must return null");
assert(resolveCircuitTotalLaps(null) === null, "resolveCircuitTotalLaps(null) must return null");
assert(resolveCircuitTotalLaps(undefined) === null, "resolveCircuitTotalLaps(undefined) must return null");
assert(resolveCircuitTotalLaps("unknown_fictional_track") === null, "resolveCircuitTotalLaps must return null for unknown track");

const sessionSourcedMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, {
    pathname: "/",
    sessionName: "Italian Grand Prix",
    sourceTimestamp: "2026-09-22T14:30:00Z",
    provenance: "LIVE",
  })
);
assert(sessionSourcedMarkup.includes("Italian Grand Prix"), "Must render genuine sessionName");
assert(sessionSourcedMarkup.includes("14:30:00 UTC"), "Must render formatted source timestamp");

// 8. Track flag indicators
const scMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { flag: "SC", pathname: "/" })
);
assert(scMarkup.includes("SAFETY CAR"), "Header must render SAFETY CAR label for SC flag");
assert(scMarkup.includes('aria-label="Track flag: SAFETY CAR"'), "Header must expose accessible label for SC flag");

const redMarkup = renderToStaticMarkup(
  React.createElement(SiteHeader, { flag: "RED", pathname: "/" })
);
assert(redMarkup.includes("RED FLAG"), "Header must render RED FLAG label for RED flag");
assert(redMarkup.includes('aria-label="Track flag: RED FLAG"'), "Header must expose accessible label for RED flag");

// 9. Zero-prop default rendering
const defaultMarkup = renderToStaticMarkup(React.createElement(SiteHeader));
assert(defaultMarkup.includes("OFFLINE"), "Default render must report OFFLINE status");
assert(defaultMarkup.includes("N/A"), "Default render must show N/A for total laps");
assert(!defaultMarkup.includes("66"), "Default render must never display 66");
assert(defaultMarkup.includes("API DOCS"), "Default render must display API DOCS navigation");

console.log("SiteHeader contracts verified successfully.");
