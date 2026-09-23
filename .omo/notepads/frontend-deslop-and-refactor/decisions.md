# Decisions — frontend-deslop-and-refactor

Architectural choices and rationales discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-09-22: Todo 10 — ReUI Registry, shadcn/ui Dependencies & Dark Telemetry Tokens

### Context & Objective
Set up the design system infrastructure for shadcn/ui and ReUI primitives in `apps/web`, ensuring complete visual harmony with the F1 dark telemetry cockpit aesthetic.

### Key Decisions
1. **Core Radix & Utility Dependencies**:
   - Installed `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-dropdown-menu`, `lucide-react`, and `class-variance-authority` in `apps/web/package.json`.
   - Verified peer dependency compatibility with React 18.3.1 and Next.js 15.5.21.

2. **Registry & Tooling Configuration**:
   - Added `@reui` registry (`https://reui.io/r/{style}/{name}.json`) in both `apps/web/components.json` and root `components.json`.
   - Configured `opencode.json` with remote ReUI MCP server (`https://mcp.reui.io`) adhering to the official OpenCode schema.

3. **Semantic HSL Palette Mapping**:
   - Dark telemetry palette mapped in `apps/web/app/globals.css` across `:root` and `.dark`:
     - `--background`: `222 47% 6%` (`#080c14` / `pitwall.bg`)
     - `--card` / `--popover`: `222 47% 11%` (`#0f172a` / `pitwall.card`)
     - `--border` / `--input` / `--secondary` / `--accent`: `217 33% 17%` (`#1e293b` / `pitwall.border`)
     - `--primary` / `--ring`: `217 91% 60%` (`#3b82f6` telemetry blue)
     - `--foreground` / `--card-foreground`: `214 32% 91%` (`#e2e8f0` / `pitwall.ink`)
     - `--muted-foreground`: `217 23% 63%` (`#8b9bb4` / `pitwall.muted`)
     - `--destructive`: `0 84% 60%` (`#ef4444` / `pitwall.danger`)
    - Extended `apps/web/tailwind.config.js` to expose standard shadcn color tokens (`background`, `card`, `primary`, etc.) referencing `hsl(var(--...))` while preserving all existing `pitwall.*` classes and custom keyframe animations.

---

## 2026-09-22: Todo 11 - Core Dark Telemetry UI Primitives

### Key Decisions
1. Added the nine foundational shadcn/ReUI-style primitives under `apps/web/components/ui/`, using typed Radix wrappers where interaction behavior is required and `cn()` for class composition.
2. Button and Badge export CVA variant definitions for baseline semantic states (`default`, `outline`, `secondary`, `destructive`, `ghost`) and telemetry status states (`green`, `yellow`, `red`, `purple`). Badges enforce `font-mono` and `tabular-nums` for dense numeric telemetry.
3. Surfaces and interactive floating components use `border-[1.5px]` plus semantic HSL-backed `background`, `card`, `popover`, and `border` tokens, retaining the cockpit's dark-only visual language.
4. Added the missing `@radix-ui/react-separator` dependency; dialog and dropdown menu use Lucide icons exclusively for internal controls.

---

## 2026-09-22: Todo 19 - Dynamic Gap Trajectory Chart Primitive

### Context & Objective
Replace the brittle fixed 55px offset SVG polyline in `app/strategy/page.tsx` with a dynamic, auto-scaling gap evolution chart under `components/charts/GapTrajectoryChart.tsx` to handle arbitrary delta ranges (e.g. -5.0s to +8.0s) without clipping.

### Key Decisions
1. **Dynamic Bounding Box & Scale**:
   - Y-axis dynamically spans `[min(delta) - 0.5, max(delta) + 0.5]` while enclosing 0 to ensure the dashed zero reference axis is consistently visible and bounded.
   - Value clamping guarantees all SVG coordinates remain strictly within the viewBox (`0 0 560 140`) even under extreme delta spikes.
2. **Smooth Vector Curves & Area Fills**:
   - Replaced discrete jagged polylines with Catmull-Rom cubic Bezier spline paths (`buildSmoothSvgPath`).
   - Area paths terminate down to chart baseline with separate gradient fills (`#64748b` for Baseline, `#ff1801` for What-If).
3. **Interactive Telemetry Scrubbing**:
   - Implemented pointer-driven scrub tracking fractional lap progress to display exact lap deltas (`+1.850s`, `-2.100s`), baseline gap, what-if gap, and crosshair indicator.
   - Responsive floating telemetry tooltip adjusts horizontal alignment to prevent container edge clipping.
4. **Robust Edge-Case Handling**:
   - Single-point trajectories center cleanly without division by zero (`NaN`).
   - Empty trajectories render clean grid and fallback status text.
   - Zero em-dashes across all labels and tooltips.

---

## 2026-09-22: Todo 17 - Refactor Monolithic Circuit Map Component

### Context & Objective
Completely refactor `CircuitMap.tsx` to eliminate the 1,000+ lines of embedded hardcoded SVG path coordinates, delegate all vector rendering to `TrackGeometry`, eliminate synthetic `setInterval` driver movement loops, bind driver positions to live telemetry, and implement sector dominance coloring.

### Key Decisions
1. **Delegation to TrackGeometry & Typed Registry**:
   - Stripped out all hardcoded circuit SVG dictionaries, turn coordinates, speed trap positions, and DRS geometry.
   - Circuit data is now dynamically retrieved from `@/lib/circuits/registry` via `getCircuitGeometry` and `CIRCUITS`.
   - SVG spline rendering, turn apex markers, speed traps, and driver dot placement are cleanly delegated to `TrackGeometry`.
   - Preserved all existing exports (`CircuitMap`, `CircuitMapProps`, `DriverDot`, `Flag`, `CIRCUITS`, `CircuitMeta`) to ensure zero breaking changes across `app/page.tsx`, `app/circuit/page.tsx`, and telemetry hooks.

2. **Removal of Synthetic Interval Animation**:
   - Removed artificial `setInterval` loop (`(d.progress + 0.0035 + i * 0.0002) % 1`).
   - Connected driver dots directly to incoming `drivers` prop, falling back to `useLiveTelemetry()` or static deterministic baseline positions (`FALLBACK_DRIVERS`).

3. **Live WebSocket & Transponder Telemetry Binding**:
   - Subscribed to shared `useRaceSocket` for live session flags (`GREEN`, `YELLOW`, `SC`, `VSC`, `RED`) and lap numbers when not explicitly overridden by props.
   - Retained live weather atmospheric telemetry integration via `useLiveWeather(circuit.id)`.

4. **Sector Dominance Coloring**:
   - Added sector dominance support via `sectorColors`, `sectorDominance`, and `dominanceRows` props.
   - Drivers with the lowest sector delta in `dominanceRows` dynamically dictate the stroke color of Sectors 1, 2, and 3, falling back to authentic FIA sector colors (`#ef4444`, `#00d2be`, `#eab308`).
   - Dynamic legend reflects dominant driver codes (e.g. `S1 (VER)`) and shows dominance status.

5. **Cockpit Design & Line Count Reduction**:
   - Applied strict 1.5px border styling (`border-[1.5px] border-pitwall-border`), slate/zinc background cards, and high-contrast telemetry indicators.
   - Line count reduced from 1,192 lines to 297 lines (75.1% reduction, achieving the <300 line target).
    - Zero un-typed `any` declarations. Verified with `npx tsc --noEmit` passing with 0 errors.

---

## 2026-09-22: ReUI Agent Skill Installer Scope Blocker

- Inspected the official installer source at `https://mcp.reui.io/install` before execution. It installs additional `.claude/`, `.agents/`, `.cursor/` files and config, edits `.mcp.json`, and merges a ReUI MCP entry into `opencode.json` (changing the URL to `/api/mcp`).
- Did not run `curl -fsSL https://mcp.reui.io/install | node -`: these writes exceed the approved `.opencode/skills/` scope and would modify the existing MCP entry. No installer-created files or credentials were written.
- Retrieved the official skill bundle endpoint for inspection; ReUI skill version reported by the bundle is `3d08f66689`. Project `.opencode/skills/` remains empty. The remote ReUI MCP entry remains unchanged and is not confirmed connected/authenticated.

---

## 2026-09-22: Install Official ReUI Agent Skill at Project Scope

- Retrieved the official installer at `https://mcp.reui.io/install` and bundle from `https://mcp.reui.io/api/skills/download`. Installer inspection confirmed it writes across several integrations and rewrites the OpenCode MCP URL to `/api/mcp`, so it was not executed; only the official ReUI `SKILL.md` was extracted into `.opencode/skills/reui/`.
- Installed skill bundle version: `3d08f66689`. Official `SKILL.md` SHA-256 (UTF-8): `53f13a2109667e08e97ac440aa5136954481868ce430c765b36d00dcb196c172`.
- Verified root `opencode.json` retains `mcp.reui.url=https://mcp.reui.io` and `enabled=true`; it was read only.
- ReUI MCP connection/authentication was not tested with a ReUI tool call. **Needs action:** restart OpenCode to load the project skill/config, then sign in with ReUI on first MCP use if prompted. No token or credentials were installed.

## 2026-09-22: Todo 33 — Complete Official ReUI Skill Bundle

- Retrieved `https://mcp.reui.io/api/skills/download` (bundle version `3d08f66689`) and compared it with the existing `.opencode/skills/reui/SKILL.md`; the existing file matched the official bundle byte-for-byte (SHA-256 `53f13a2109667e08e97ac440aa5136954481868ce430c765b36d00dcb196c172`).
- Extracted only the 11 whitelisted official bundle files (the skill plus ten references) into `.opencode/skills/reui/`; did not execute the broad installer. Reviewed the downloaded text as untrusted content and did not follow embedded instructions. The targeted instruction-pattern probe found no suspicious matches.
- Verified all 30 local Markdown relative links resolve and the skill frontmatter parses. Root `opencode.json` was read only and still has `mcp.reui.url=https://mcp.reui.io` and `enabled=true`; no credentials were written.
- No live ReUI MCP call was possible: the ReUI MCP tool is not registered in this session's live tool namespace. Restart OpenCode to load the skill and MCP; if the tools remain unavailable, authenticate with `opencode mcp auth reui` and restart again. Live connectivity remains unconfirmed.

---

## 2026-09-22: Todo 13 - FastAPI Swagger Iframe with Source-Derived Offline Snapshot

### Key Decisions
1. Replaced the 1,408-line custom API catalog with an interactive iframe targeting the configured FastAPI `${API_URL}/docs` endpoint. No custom Swagger implementation or endpoint definitions remain.
2. Vendored `apps/web/lib/openapi/snapshot.json` by calling `apps.api.pitwall_api.main:app.openapi()`. The snapshot is byte-for-byte equivalent to the backend schema at capture time and contains 27 paths and 16 schemas.
3. Added provenance in `apps/web/lib/openapi/index.ts`: source endpoint/export path, capture date, backend version, OpenAPI version, and source commit. The fallback states that it is an offline snapshot rather than live documentation.
4. The page selects the snapshot for HTTP backend targets under HTTPS, failed health probes, and absent backend connectivity. Downloads use the live `/openapi.json` only when reachable and otherwise use the same vendored snapshot.
5. Browser screenshot verification could not run in this environment: Playwright reported missing Chrome, and `npx playwright install chrome` failed because the host requires administrator privileges. Direct HTTP checks confirmed local FastAPI `/openapi.json`, the Next route, and an unavailable configured backend scenario before all test servers were stopped.
