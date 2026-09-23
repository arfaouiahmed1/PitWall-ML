# Design-system gate visual oracle — FAIL

Reviewed 2026-09-23 against the current `apps/web/app/design-system/page.tsx` (mtime 14:31:52 +0100), `DESIGN.md`, the shared primitives, and the supplied browser artifacts. This is a read-only review; no build or product edit was run.

## Recommendation

**REQUEST_CHANGES** — the implemented reduced-motion behavior is supported by current source and its fresh normal/reduced evidence, and the showcase is real DOM using shared primitives. The gate cannot pass because the required current interaction evidence is stale and the claimed responsive screenshot dimensions do not match their named viewports.

## Findings

### HIGH — [evidence] Interaction evidence predates the current route source

`apps/web/app/design-system/page.tsx` was modified at 14:31:52 +0100. The only evidence used for keyboard focus, dialog Escape/menu disabled state, and empty/error state is `browser-qa-rendered.json` plus its screenshots, all stamped 14:24:26–14:24:27 +0100. The gate report relies on those stale artifacts. The visual-QA completion gate requires fresh captures after the last source edit, so the claims cannot be approved on the current revision.

**Required fix:** rerun the focus, dialog/Escape, menu/disabled, empty, and error scenarios against the current route; save fresh JSON and screenshots, then have both independent reviewers judge that fresh complete set.

### HIGH — [evidence] Responsive screenshot files are not the viewport dimensions they claim

`postmotion-responsive-qa.json` labels the captures as 375x844, 768x1024, and 1440x1024. File signatures report `showcase-postmotion-375x844.png` as 375x2410, `showcase-postmotion-768x1024.png` as 768x1754, and `showcase-postmotion-1440x1024.png` as 1440x1673. They are full-page images, not viewport-sized captures. That makes the report/file naming inaccurate and fails the visual-QA capture-dimension requirement.

**Required fix:** retain full-page images separately if useful, but capture and record viewport-sized PNGs at the three stated viewport dimensions; validate their signatures/dimensions before review.

### MEDIUM — [product/docs] The motion documentation overstates dropdown behavior

`DESIGN.md` §5 says dialog, menu, and tooltip use existing opacity animations. `apps/web/components/ui/dropdown-menu.tsx:21-24` has no animation utility, while dialog and tooltip do (`dialog.tsx:15,23`, `tooltip.tsx:14`). The documentation should either limit the claim to dialog/tooltip or add a verified dropdown animation as a separate product change.

### LOW — [evidence] Button-state result is a timeout, not a passed state check

`showcase-button-states.json` records a 30-second locator timeout for the `default` button. It is not cited by the gate report, but it should not be retained as positive button-state evidence.

## Verified good

- `page.tsx:7-15` imports the shared Button, Badge, Card, Dialog, Dropdown Menu, Separator, Table, Tabs, and Tooltip primitives; its JSX composes them directly at `page.tsx:46-128`. The source contains no image element or background-image substitute, and `showcase-adversarial.json` reports `imageCount: 0`.
- The repaired loader at `page.tsx:102` applies `motion-reduce:animate-none`. `reduced-motion-qa.json`, captured after that edit, reports `spin` under normal preference and `none` under `reduce`; the normal/reduced PNGs are valid 1440x1024 files and show the same stable hierarchy.
- The fresh responsive JSON reports no horizontal overflow or framework error at all three configured widths, and the supplied full-page renders visibly preserve the dark token-based system, hierarchy, local table layout, honest static states, and mobile navigation.
- `DESIGN.md` accurately records the base token values, fonts, root container, shared Card/Table behavior, and the known rounded-card/focus-ring debt, subject to the dropdown-motion correction above.

## Evidence inspected

- `DESIGN.md`
- `apps/web/app/design-system/page.tsx`
- `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/tailwind.config.js`
- `apps/web/components/ui/{button,badge,card,table,tabs,dialog,dropdown-menu,tooltip,separator}.tsx`
- `.omo/evidence/design-system-gate/gate-report.md`
- `.omo/evidence/design-system-gate/{reduced-motion-qa.json,postmotion-responsive-qa.json,browser-qa-rendered.json,showcase-button-states.json,showcase-adversarial.json}`
- All supplied normal/reduced-motion, responsive, focus, dialog, and error PNGs.
