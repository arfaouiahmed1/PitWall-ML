# Design-system gate evidence

Generated on 2026-09-23 for the unlinked `/design-system` route.

| Success criterion | Scenario and invocation | Binary observable | Captured artifact |
|---|---|---|---|
| Existing system is codified before product UI work | Direct extraction from `app/globals.css`, `tailwind.config.js`, `app/layout.tsx`, and all nine `components/ui/*` primitives | `DESIGN.md` has Sections 1 through 8 and no greenfield research log; it records existing tokens, type, layout, components, motion, depth, accessibility, and accepted debt | `DESIGN.md` |
| Private showcase uses shared primitives | `/design-system` loaded in Chromium via Playwright Core | Meaningful heading rendered; `imageCount: 0`; all buttons, badges, cards, table, tabs, dialog, dropdown, separator, and tooltip are live DOM components | `browser-qa-rendered.json`; `showcase-adversarial.json`; source `apps/web/app/design-system/page.tsx` |
| Narrow/mobile viewport has no horizontal overflow | 375x844 Chromium capture with `document.documentElement.scrollWidth > window.innerWidth` check | `horizontalOverflow: false`, title present, no framework error overlay | `showcase-postmotion-375x844.png`; `postmotion-responsive-qa.json` |
| Tablet viewport has no horizontal overflow | 768x1024 Chromium capture with the same check | `horizontalOverflow: false`, title present, no framework error overlay | `showcase-postmotion-768x1024.png`; `postmotion-responsive-qa.json` |
| Desktop viewport has no horizontal overflow | 1440x1024 Chromium capture with the same check | `horizontalOverflow: false`, title present, no framework error overlay | `showcase-postmotion-1440x1024.png`; `postmotion-responsive-qa.json` |
| Keyboard focus works | Playwright focuses the `Open control guidance` Button | Active element has that accessible name and computed `outlineStyle: solid` | `showcase-rendered-keyboard-focus-1440.png`; `browser-qa-rendered.json` |
| Overlay and menu states are usable | Playwright opens Dialog, presses Escape, opens Dropdown Menu | Dialog visible then absent after Escape; menu visible; unavailable item disabled | `showcase-rendered-dialog-open-1440.png`; `browser-qa-rendered.json` |
| Loading, empty, and error containers are honest | Playwright selects Empty then Error tabs | Explicit static source condition text is visible; no telemetry is fabricated | `showcase-rendered-error-1440.png`; `browser-qa-rendered.json` |
| Loading motion respects reduced-motion | Playwright clicks `Preview loading motion` in normal and `prefers-reduced-motion: reduce` contexts | Normal loader computes `animationName: "spin"`; reduced-motion loader computes `animationName: "none"`; both have no viewport overflow | `showcase-normal-motion-1440.png`; `showcase-reduced-motion-1440.png`; `reduced-motion-qa.json` |
| Showcase remains unlinked and contains no raster substitute | 375x844 page DOM query | `linkedFromHeader: false`, `imageCount: 0`, `viewportOverflow: false` | `showcase-adversarial.json` |
| Changed route passes targeted lint | `npx eslint app/design-system/page.tsx` from `apps/web` | Exit code 0 | `showcase-eslint.log` |

## Browser capture notes

The computer-use environment had no enabled browser surface, and the bundled Playwright CLI expected a missing `chrome-headless-shell`. Fresh captures therefore used the already-installed Microsoft Edge executable through the already-installed `playwright-core` package. Development-only React Scan/React Grab scripts render inspector overlays that obscure product content, so the rendered QA run fulfilled only those external development scripts with empty JavaScript. This matches the intended production surface without changing source or configuration. The raw development run remains in `browser-qa.json` and records a single existing `/favicon.ico` 404; `browser-404-diagnosis.json` identifies that exact resource.

## Validation limits and unrelated failures

- Baseline `npm run build` compiled application code then failed TypeScript validation because `app/monitoring/page.tsx` exports `parseEraReport`; see `baseline-build.log` and `postchange-typecheck.log`.
- Post-change `npm run build` compiled application code then failed the concurrent tooling worker's `app/layout.tsx` synchronous external script lint rule; see `postchange-build.log`.
- These files were not changed by this gate. The owned route's targeted ESLint invocation passes.

## Oracle A repair

Oracle A found that the showcase loading preview did not suppress `animate-spin` under a reduced-motion preference. `apps/web/app/design-system/page.tsx` now applies the existing `motion-reduce:animate-none` variant to that loader. The fresh reduced-motion browser run above proves the effective animation is removed while normal preference keeps the spin.

## Required independent review

The root agent has been asked to dispatch the two independent read-only visual oracle reviewers required by the Visual QA skill against the current screenshots, report, and source. Their verdicts are required before final design-system gate approval.
