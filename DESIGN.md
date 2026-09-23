# PitWall ML Design System

## 1. Atmosphere & Identity

PitWall ML is a dark, data-dense race-control cockpit: quiet navy surfaces make timing, strategy, and incident signals readable at speed. Its signature is the contrast between subdued instrument panels and a small set of explicit race-status colors; color communicates a state or team association, while thin technical borders keep information panels distinct.

## 2. Color

### Palette

| Role | Existing token | Value | Usage |
|---|---|---:|---|
| App background | `--pit-bg` / `background` | `#080c14` / `hsl(222 47% 6%)` | Page canvas and scrollbar track |
| Primary text | `--pitwall-ink` / `foreground` | `#e2e8f0` / `hsl(214 32% 91%)` | Primary content |
| Card and popover | `--pit-card` / `card` / `popover` | `#0f172a` / `hsl(222 47% 11%)` | Panels, dialogs, menus, tooltips |
| Secondary fill | `secondary`, `muted`, `accent` | `hsl(217 33% 17%)` | Selected controls, hover rows, tab rail |
| Secondary text | `--pitwall-muted` / `muted-foreground` | `#8b9bb4` / `hsl(217 23% 63%)` | Labels and supporting copy |
| Default border | `--pit-border` / `border` | `#1e293b` / `hsl(217 33% 17%)` | Panels, rows, dividers |
| Focus and primary action | `ring` / `primary` | `hsl(217 91% 60%)` | Shared primitive focus rings and primary buttons |
| Global focus outline / live | `--pit-cyan` | `#00d2be` | Browser-visible outline, live and DRS semantics |
| Strategy accent | `--pit-accent` | `#ff1801` | CTA and what-if emphasis |
| Accent gradient end | `pitwall-ember` | `#ff6b35` | `accent-bar` gradient only |
| Team blue / papaya / Ferrari | `pitwall-blue`, `pitwall-papaya`, `pitwall-ferrari` | `#3671c6`, `#ff8000`, `#e8002d` | Team-specific information |
| Healthy | `pitwall-green` / `pitwall-mint` | `#22c55e` / `#4ade80` | Pass, fresh, healthy states |
| Caution | `pitwall-yellow` / `pitwall-amber` / `pitwall-amberlight` | `#eab308`, `#f59e0b`, `#fbbf24` | SC/VSC and caution semantics |
| Danger | `destructive` / `pitwall-danger` / `pitwall-rose` | `hsl(0 84% 60%)`, `#ef4444`, `#f87171` | Errors and destructive actions |
| Chip text | `pitwall-fog` | `#cbd5e1` | Text on `#1e293b` chips |

Dark mode is the only implemented color scheme. Do not use signal colors as decoration: cyan denotes live telemetry, red denotes action or risk, green denotes healthy/pass, and yellow/amber denotes caution. Add a semantic role to this table before adding a color.

## 3. Typography

| Level | Existing implementation | Usage |
|---|---|---|
| Page title | Tailwind `text-2xl` or `text-3xl`, semibold/bold | Route and major panel titles |
| Section and card title | `text-sm` to `text-base`, semibold, tight tracking | Card headers and control groups |
| Body | browser 16px / `text-sm` | Values, explanatory copy, menu content |
| Metadata | `text-xs` | Footer and secondary UI |
| Telemetry label | `font-mono text-[10px] font-semibold uppercase tracking-wider` | Table heads, badges, menu labels |

- Sans: `var(--font-geist-sans)`, Inter, system UI, sans-serif. The layout loads Geist through `next/font`.
- Mono: `var(--font-geist-mono)`, `JetBrains Mono`, ui-monospace, monospace.
- Numeric timing and telemetry use `tabular-nums`. Keep prose in the sans face and compact operational labels in mono.

## 4. Spacing & Layout

The system follows Tailwind's 4px spacing scale: `1`/4px, `2`/8px, `3`/12px, `4`/16px, `6`/24px, `8`/32px, `12`/48px. Shared cards use `p-6`; dense tables use `p-3`; buttons are 32, 40, or 44px high. The root content container is `max-w-[1400px]` with `px-6 py-6`; product routes use responsive grids and collapse to one readable column on narrow screens. Existing Tailwind breakpoints are `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, and `2xl` 1536px.

Shape grammar is intentionally mixed: outer cards are generally `rounded-lg` (the global shape comment reserves `rounded-xl` for outer cards, but the shared `Card` currently resolves to `rounded-lg`); stat cells are `rounded-lg`; badges and bars are `rounded-full`; menus and triggers are `rounded-md`/`rounded-sm`.

## 5. Components

### Button and Badge
- **Structure:** native button or inline badge with token border/fill/text.
- **Variants:** Button: default, outline, secondary, destructive, ghost, green, yellow, red, purple; sizes default, sm, lg, icon. Badge: default, outline, secondary, destructive, ghost, green, yellow, red, purple.
- **States:** Buttons provide hover, visible ring focus, native press, and disabled opacity/pointer suppression. Badges are presentational labels and expose focus styling when made focusable by a consumer.
- **Accessibility:** use native button labels; icon-only buttons need an accessible name. Disabled communicates an unavailable action.

### Card, Separator, and Table
- **Structure:** `Card` composes header, title, description, content, and optional footer. `Separator` divides groups. `Table` wraps a scrollable table with header, body, row, cells, caption, and footer.
- **States:** Table rows provide hover and `data-state=selected`; data containers must render an explicit loading, empty, or error message rather than fabricated results.
- **Layout:** cards form responsive grids; tables own local horizontal scrolling where a narrow viewport cannot preserve columns.
- **Accessibility:** tables require real header cells and a caption when the relationship is not clear from a nearby heading.

### Tabs, Dialog, Dropdown Menu, and Tooltip
- **Structure:** Radix-backed composition: root, trigger/list, content, and portal where the primitive provides one.
- **States:** Tabs expose active, focus, and disabled state; dialog and menu expose keyboard-triggerable open/closed state; menu items expose focus and disabled state; tooltips appear on hover/focus.
- **Accessibility:** retain the Radix keyboard, focus-return, aria, and escape-key behavior. Dialogs require a title and description. Do not replace primitive triggers with inert elements.
- **Motion:** dialog, menu, and tooltip use existing opacity animations; their open/close state must remain usable without motion.

## 6. Motion & Interaction

Shared controls use `transition-colors`; dialog and overlay use a 200ms opacity entrance/exit. Flag states use existing CSS animations: green breathe 2.2s, yellow flash 0.9s, safety-car marquee 0.8s, VSC breathe 1.4s, red flash 0.45s, and latency pulse 1.6s. Keep interaction feedback on color, opacity, or transform. Focus stays visible through the global cyan outline and shared blue `ring` utilities.

## 7. Depth & Surface

**Strategy: mixed.** The resting hierarchy relies on tonal surfaces (`background` → `card`/`popover`) with 1px or 1.5px `border` boundaries. Floating dialog, dropdown, and tooltip surfaces add `shadow-xl`/`shadow-2xl`; live flag states add targeted glow. Do not add general card shadows or glass treatments.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- Target WCAG 2.2 AA: 4.5:1 for ordinary text and 3:1 for large text and control boundaries.
- Every interactive element must be keyboard reachable with an accessible name and visible focus.
- Retain Radix dialog/menu/tab keyboard behavior, including Escape to close overlays and focus return to their trigger.
- Respect `prefers-reduced-motion` before adding a new animation; content and status must remain understandable when animation is absent.
- At 375px, product content must avoid viewport horizontal overflow; table wrappers may scroll locally to preserve relationships.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| `rounded-xl` shape comment conflicts with shared `rounded-lg` Card and `.card` radius | `app/globals.css`, `components/ui/card.tsx` | Existing implementation is preserved during system extraction. | Frontend consolidation task; resolve after product-screen baseline. |
| Shared primitives use blue focus rings while global `:focus-visible` applies cyan outline | `components/ui/*`, `app/globals.css` | Both are existing visible focus treatments; no restyle is part of this gate. | Accessibility/token consolidation task. |
| Flag/latency animations have no documented reduced-motion override | `app/globals.css` | Existing behavior is recorded, not changed, by this gate. | Motion accessibility task before adding status animation. |
| React dev tool gate is not wired (`react-grab`, `react-doctor`, `react-scan`) | `apps/web/package.json`, `app/layout.tsx` | Dependency/config changes are owned by the parallel tooling task. | React tooling worker; verify development-only gating after install. |
