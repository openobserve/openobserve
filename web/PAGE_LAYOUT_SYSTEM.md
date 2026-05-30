# OpenObserve Page Layout System (PLS)

> Status: **DRAFT for review.** Dashboards (list + view) is the pilot/reference
> implementation. Once this document is signed off, we harden Dashboards against
> it, then migrate other modules one at a time, design-checking each.
>
> Hard rule: **any new shared component is created via the `o2-component-create`
> skill** (strict TS, design tokens, no UI-override props, added to the O2
> catalog). Never hand-roll a component that belongs in the library.

---

## 1. Purpose & principles

We are demoing this to Fortune-50 customers. Every screen must feel like **one
product**, be **data-dense without feeling cramped**, and look **best-in-class**
(shadcn / Linear / OpenRouter calibre). Principles:

1. **One language.** Same surfaces, header, spacing, density, empty states,
   focus, and motion everywhere.
2. **Flat & soft.** No drop-shadow cards. Hairline-bordered panels on a tinted
   canvas (the legacy `.card-container` shadow is being retired).
3. **Data-first density.** Dense tables (≈36px rows). Chrome is minimal so the
   data gets the screen. Target: **~16–20 rows on a 13" MacBook**.
4. **Tokens, not hardcodes.** Color/spacing/radius come from design tokens so
   light/dark and theming "just work."
5. **Consistency over cleverness.** Prefer one shared layout/primitive over
   per-page variants.

---

## 2. Page archetypes

The whole product reduces to **three** archetypes:

| | Archetype | Examples | Nav model |
|---|---|---|---|
| **A** | **List / Management** | Dashboards, Streams, Reports, Alerts, Incidents, Functions | Page header + toolbar + table (optional left folder rail) |
| **B** | **Settings / IAM** | IAM (Users/Roles/Groups…), Management/Settings | Secondary nav (sub-sections) → each section is an **A** (table) or a **Form** |
| **C** | **Explorer** | Logs, Metrics, Traces | Command bar (mode + time-range + Run) → field rail + results (histogram + virtual table) |

**Decision: B converges onto A.** A Settings/IAM page is *not* a different
design — it is **a standard secondary-nav shell wrapping Template-A content** (or
a standard Form). So B reuses A's header/surfaces/toolbar/table/empty-state; only
the secondary-nav shell is extra. See §6.

**C stays distinct** (it has a fundamentally different job — querying), but it
**shares the primitives** in §4 (surfaces, buttons, time picker, density, field
rail styling, focus). It does **not** use `AppPageHeader`.

---

## 3. Design tokens & surfaces

Tailwind v4 with the `tw:` prefix. Colors come from semantic tokens
(`web/src/lib/styles/tokens/*.css`). **No SCSS for new work; no `dark:` variant
exists — theming is via the `.dark` class overriding CSS-var tokens.**

Surface roles (theme-correct, already in use by Dashboards):

| Role | Token | Light | Dark |
|---|---|---|---|
| **Workspace canvas** (gutters / page bg) | `surface-panel` | grey-50 | grey-900 |
| **Raised surface** (chrome, panels, table, cards) | `surface-base` | white | grey-950 |
| Hover / avatar / chip fills | `surface-subtle` | grey-100 | grey-800 |
| Borders | `border-default` (hairline), `border-strong` | grey-200 / grey-400 | grey-700 / grey-500 |
| Brand accent / active | `primary-*`, `tabs-active-bg` / `tabs-active-text` | — | — |

Why `surface-base` for panels (not a custom token): OTable's internals
(`--color-table-cell-bg`, header) are built on `surface-base`, so panels on
`surface-base` keep pinned cells / headers consistent in both themes. Also set
`--color-table-header-bg = surface-base` (a dull grey header read as "merged").

Radius: panels `rounded-xl`. Focus: **soft glow** = `ring-4 ring-primary-500/25`
(no hard offset) on inputs/selects/switches/custom controls (see §4).

Why explicit `:global(.dark)` overrides occasionally appear (e.g. empty-state dot
color): some decorative colors must invert and there is no `dark:` variant.

---

## 4. Shared primitives (use these; don't reinvent)

| Primitive | Component / convention | Notes |
|---|---|---|
| **Page header** | `AppPageHeader` (`web/src/components/common/AppPageHeader.vue`) | icon tile (brand-tinted via `tabs-active` tokens) + `<h1>` title + optional subtitle + `#actions`. Fixed height (`h-12`) so async titles don't shift the icon. Title size set with `!important` to beat the global unlayered `h1`. |
| **Surfaces** | inline `tw:bg-surface-panel` / `tw:bg-surface-base` + `tw:border tw:border-border-default tw:rounded-xl` | retire `.card-container`. |
| **Toolbar** | a flex row: search (left) + actions (right) | search can be **scoped** (see Dashboards: a segmented "This folder / All folders" control inside the field). Refresh is an `OButton` `variant="outline" size="icon-sm" icon-left="refresh"`. |
| **Data table** | `OTable` | **dense (default, 36px)**; `:default-columns="false"` + explicit `size` per column for deterministic widths; server pagination for large datasets; row hover + clickable cursor when `@row-click` is set. |
| **Empty state** | `web/src/components/common/empty-states/` — `EmptyState`, `NoDashboards`, `NoPanels`, `QuickStartCard` | animated SMIL illustration (no CSS keyframes) + title + description + actionable quick-start cards + subtle dot-grid/glow backdrop. |
| **Secondary nav** (B) | `ORouteTab` (route-driven tabs) | one component, one style. Left-vertical rail today; top sub-tabs is an option to test (§6). |
| **Folder rail** (A, optional) | Tailwind `<button>` nav list using `tabs-active-*` tokens | NOT `OTabs` (overriding it needed scoped CSS). Matches the app side nav's active style. |
| **Buttons / inputs / dropdowns / switch** | `OButton`, `OInput`, `OSelect`, `ODropdown`, `OSwitch` | hover transitions + the unified focus glow. Cancel = `outline`, Save = `primary`, both `size="sm-action"`. |
| **Dialogs / drawers** | `ODialog`, `ODrawer` | — |
| **Confirm** | `ConfirmDialog` | — |

If a needed primitive does **not** exist in the O2 catalog, **stop and build it
with `o2-component-create`** before using it.

---

## 5. Template A — List / Management page (canonical)

Reference: `web/src/views/Dashboards/Dashboards.vue`.

### Anatomy (top → bottom)
```
┌──────────────────────────────────────────────────────────────┐
│ AppPageHeader  [icon] Title / subtitle …………… [Import] [+ New] │  h-12, px-6
├──────────────────────────────────────────────────────────────┤
│ Toolbar:  [🔍 Search … │ scope]                       [↻]      │  ~36px, gap-3
├───────────────┬──────────────────────────────────────────────┤
│ Folder rail   │  ☐  Name        Owner   Created   ⋯           │  table panel
│ (optional,    │  ───────────────────────────────────────────  │  (surface-base,
│  surface-base │  ☐  …            …       …        ⋯           │   rounded-xl)
│  rounded-xl)  │  (dense 36px rows · sticky header)            │
│               ├──────────────────────────────────────────────┤
│               │  N items                    ‹ 1/… › │ 20 ▾     │  footer
└───────────────┴──────────────────────────────────────────────┘
        page canvas = surface-panel · px-6 · header+content share inset
```

### Rules
- **Page root**: `tw:bg-surface-panel tw:flex tw:flex-col tw:px-6` (one horizontal
  inset for header AND content → aligned left edges).
- **Header**: `AppPageHeader` with `icon`, `title`, optional `subtitle`,
  `#actions` (Import/New, etc.). No per-page title styling.
- **Toolbar**: one row, `shrink-0`. Search left (scoped where it helps), refresh /
  filters right. Omit entirely if a page has no search/filter.
- **Content**: optional folder rail (`surface-base` panel) + table panel
  (`surface-base`, `rounded-xl`, `overflow-hidden`). Table is **dense**.
- **Empty / loading / error**: use the shared `EmptyState` kit; OTable's built-in
  loading skeleton + error slot. Never a bare "No data".
- **Footer**: item count + bulk actions (left), pagination (right) via OTable
  `#bottom`.

### Control zones (where every control goes)
A deliberate two-zone model — improves on the legacy "everything in one header
row" while keeping page actions top-right (consistent with the rest of the app):

| Zone | Contents | Rule of thumb |
|---|---|---|
| **Page header** (top, full width) | icon + title + subtitle (left) · **create / import** actions (right) | acts on the *page* / makes new things |
| **Table toolbar** — rendered **inside the table frame** via OTable's `#toolbar` slot (above the column header, with a divider) so it reads as part of the table | **scoped search** (fills the bar) · **refresh + future filters / sort / column-visibility / density** (right) | *shapes the data* below it |
| **Folder rail** (if present) | add-folder + folder search | rail-local navigation |
| **Table footer** | result count + bulk actions (on selection) + pagination | acts on *selected rows* |

The table toolbar is the designated home for **all data controls** (filter, sort,
columns, density) so they never crowd the header. Search sits with the data it
filters (above the table), not in the page header.

### Density budget (13" MacBook, ~720–760px page height)
header `h-12` (48) + toolbar (~44) + table header (36) + pagination (44) ≈ 172px
chrome. **Data is king → use a tighter `:row-height` (≈32px)** so ~18–20 rows are
visible on a 13"; shrink in-row controls to match (avatar ≈20px, row actions
`icon-xs-sq` ≈28px). Larger displays scale up.

---

## 6. Template B — Settings / IAM (converge to A)

Today: legacy `card-container` + `h-[68px]` `text-xl` header inside a left
vertical `ORouteTab` rail. Target:

- **Secondary-nav shell** (standard): `ORouteTab` rail (route-driven, collapsible
  via `OSplitter`) using the same active tokens as the app side nav. *Open
  decision:* keep left-vertical vs move to **top horizontal sub-tabs** (frees
  horizontal space, matches more SaaS settings UIs). Test both on one module.
- **Each section = Template A** (for tables) or a **standard Form layout**
  (for settings forms): `AppPageHeader` (compact) + soft panels + dense table /
  `OForm` with `GroupHeader` sections. Retire `card-container`.
- Net: B = "a standard sub-nav shell + A content." No bespoke chrome.

A reusable **`SettingsSubNav` / `SecondaryNav`** wrapper may be warranted — if so,
build it via `o2-component-create`.

---

## 7. Template C — Explorer (Logs / Metrics / Traces)

Keep the distinct query nav, but standardize the shared layer:
- **Command bar**: built from `OToggleGroup` (mode) + the shared **time-range
  picker** + `OButton` Run/Cancel + `ODropdown` overflow. Lives on `surface-base`,
  hairline bottom border (no shadow). No `AppPageHeader`.
- **Field rail**: collapsible left panel (`OSplitter`), `surface-base`, same
  active/hover tokens, same collapse affordance as the folder rail.
- **Results**: histogram + dense virtual table; shared density + focus tokens.
- Reconcile inconsistencies: Metrics has no field rail (OK), Traces adds mode
  tabs (OK) — but spacing, surfaces, buttons, and density must match.

C is **out of scope for the first rollout**; align it after A/B are proven.

---

## 8. Data states (every list/table must handle all four)

1. **Loading** — OTable skeleton (built-in), no layout shift.
2. **Empty** — shared `EmptyState` + illustration + quick-start actions.
3. **Error** — OTable error slot with a retry.
4. **Populated** — dense rows, hover, row actions, bulk actions in footer.

---

## 9. Component inventory & new components

**Use (exist in O2):** OTable, OButton, OInput, OSelect, ODropdown(+Item),
OSwitch, OToggleGroup(+Item), OTooltip, OIcon, ODialog, ODrawer, OSeparator,
OSplitter, OBadge, OSpinner, ORouteTab/OTabs, OPagination.

**App-level shared (exist):** `AppPageHeader`, `EmptyState` + `NoDashboards` /
`NoPanels` / `QuickStartCard`, `ConfirmDialog`.

**Candidate NEW shared components (build with `o2-component-create`):**
- `ListPageLayout` — thin Template-A scaffold: slots `header`, `toolbar`,
  `rail?`, `table`, `empty`. Goal: sibling list pages become ~50 lines and can't
  drift.
- `SecondaryNav` — the standard Settings/IAM sub-nav shell.
- (maybe) `SearchScope` — extract the scoped-search segmented control if a 2nd
  page needs it.

> Reminder: do **not** create these inline. Run the `o2-component-create`
> workflow (Analysis → Design → Implement → Test → Validate), add to the O2
> catalog, then consume.

---

## 10. Density & responsive targets

- Dense tables (36px) by default across A and B-tables.
- 13" MacBook: ≥16 rows (aim 20 on larger displays); never fewer than the legacy
  pages.
- Header + toolbar = at most **two thin rows** (≤ ~96px combined).
- Graceful at ≥1024px content width; controls wrap/collapse below that.

---

## 11. Accessibility

- One `<h1>` per page (in `AppPageHeader`); never skip heading levels.
- Focus visible everywhere via the unified glow; keyboard-operable rows,
  toggles (`role`/`aria-checked`), and menus.
- Color from tokens → AA contrast in both themes.
- Tooltips/`title` on icon-only controls.

---

## 12. Design check (per-page acceptance checklist)

Run this on every migrated page before sign-off:

- [ ] Surfaces: `surface-panel` canvas, `surface-base` panels, **no `.card-container`**.
- [ ] Header: `AppPageHeader` (icon + title + optional subtitle + actions); aligned left edge with content.
- [ ] Toolbar: ≤1 row; search left, actions right; consistent button variants/sizes.
- [ ] Table: dense; deterministic column widths; sticky header; row hover + cursor.
- [ ] All four data states (loading / empty / error / populated) implemented.
- [ ] Empty state uses the shared kit (illustration + actions).
- [ ] Light **and** dark verified (panels read as raised; no merged/dull greys; actions column matches rows).
- [ ] Focus glow + hover transitions on all interactive elements.
- [ ] 13" density target met (≥16 rows).
- [ ] No Quasar (`q-*`); no hand-rolled components that belong in O2.
- [ ] data-test hooks preserved; existing specs pass (or updated intentionally).

---

## 13. Rollout plan

1. **Sign off this document.**
2. **Harden Dashboards** to 100% of Template A + pass the §12 checklist (list + view). ← **we are here**
3. Extract **`ListPageLayout`** (via `o2-component-create`); refactor Dashboards onto it (proves the scaffold).
4. Build **`SecondaryNav`** (left vertical rail, via `o2-component-create`).
5. **Proof point: migrate a Template-B page — IAM or Settings** — onto `SecondaryNav` + Template-A content. This validates the sub-nav shell, the B→A convergence, and the layout in one module. Design-check it.
6. Review, then roll out remaining A and B modules.
7. Align **Explorer (C)** primitives last.

Each step ends with the §12 design check + a light visual pass in light & dark.

---

## 14. Decisions (resolved 2026-05) & remaining

**Resolved:**
- **B sub-nav → LEFT vertical rail** (keep the side rail, not top tabs). May still
  trial top-tabs later, but default is left.
- **First proof point → a Template-B navigation page (IAM or Settings)**, NOT a
  sibling list page. Rationale: it exercises the sub-nav shell + Template-A
  content + the B→A convergence in one go.
- **Density → denser is default. "Data is king."** Data-heavy tables use a tighter
  `row-height` (≈32px) below the 36px standard; shrink in-row controls to match
  (owner avatar ≈20px, row-action buttons `icon-xs-sq` ≈28px). Accept that 20 rows
  on a 13" is the goal, not 16–18.

**Still open:**
- **Page subtitle:** keep on landing/list pages (charm) — drop on dense sub-pages?
- **Folder rail** as a shared component (Dashboards, Alerts, Reports share it)?
- Which first: **IAM** or **Settings** for the Template-B proof?

## 15. Unified Navigation System

One model for "where am I / how do I go up," at every depth, in every module.
The user's goals: Grafana/Datadog data density, an unmistakable breadcrumb, and
a single consistent answer for both few-section modules (Pipelines) and
many-section modules (IAM/Settings).

### 15.1 The four levels (never show more than two at once)

- **L1 — Global rail** (`MainLayout` → `ONavbar`): the app's top-level modules
  (Logs, Metrics, Dashboards, Pipelines, Alerts, …). Always present, never
  changes. *Roadmap:* make it collapsible to a ~56px icon rail (the
  `miniMode`/`leftDrawerOpen` plumbing already exists but is dead — wire a real
  toggle + hover tooltips). Until then it stays the 84px icon+label rail.
- **L2 — Module section nav**: the peer sections *within* a module. Two
  renderings, **same** `OTabs`/`ORouteTab` primitive, chosen by count:
  - **≤ 5 sections → horizontal tabs** in `AppPageHeader`'s `#tabs` slot, inline
    right of the icon+title. (Pipelines: Pipelines | Functions | Enrichment |
    Eval.)
  - **> 5 sections → vertical left rail** in `PageLayout`'s `#sidebar`
    (drag-collapsible via `OSplitter`). (Settings: 15 items; IAM: up to 7.)
    Must be `dense` rows + `overflow-y-auto` (vertical `OTabs` has no built-in
    scroll). *Roadmap:* extract one `SecondaryNav` component so IAM (220px) and
    Settings (250px) stop being two divergent code paths (one width, one active
    style, declarative `visible`, a `defaultTab`, built-in detail breadcrumb).
- **L3 — Detail / drill-in**: opening an item replaces L2 with an
  **`AppBreadcrumb`** in `AppPageHeader`'s subtitle band: `Module › … › Item`,
  the terminal crumb bold + `aria-current`, parents clickable. Item-specific
  actions sit in the header's `#actions`. Never show L2 tabs and an L3 breadcrumb
  together.
- **L4+ — Deeper** (panel inside a dashboard, variable inside a panel): same
  `AppBreadcrumb`, which **auto-collapses** middles into a `…` dropdown
  (`maxInline`, default 3) so the shape stays `Root › … › Parent › Current` and
  never overflows at any depth.

### 15.2 The single-header law (one header per page)

`AppPageHeader` is the only header. **Row 1** (`h-12`): module icon tile +
`#title` + right `#actions`. **Row 2** (`h-5` band): exactly one of L2 tabs
(`#tabs`) **xor** L3 breadcrumb (`breadcrumb` prop / `#subtitle`) **xor** a
tagline. A page must **never** render its own second title bar.

**Header-actions portal** (for nested detail pages that render *inside* a module
shell and so can't own the header): the shell renders a portal target
`<div id="o2-page-actions">` in its `#actions` on detail routes; each detail page
`<Teleport to="#o2-page-actions">`s its own controls there, keeping its state
local (no provide/inject, no state hoisting). This is how Pipelines kills its
double headers — see 15.4.

**Overlays / dialogs** (drawers, near-fullscreen panels) that don't change the
URL: don't fake a breadcrumb — use `AppPageHeader`'s `back` prop / `#back` slot
to render a leading `‹ Parent` back-pill.

### 15.3 Breadcrumb rules (so "where am I" is always answered)

- Parents are links; the current item is the bold non-interactive terminal crumb
  and **mirrors the H1 title**.
- Distinct targets matter: e.g. ViewDashboard's `Dashboards` crumb → list (no
  folder), `Folder` crumb → list scoped to that folder. Always carry
  `org_identifier`.
- A drill-in that can be left with unsaved changes (pipeline editor, add-panel):
  the breadcrumb crumb and the explicit Cancel/Discard must share the **same**
  dirty-check, or the crumb can silently discard edits. (Open gap on
  PipelineEditor — the crumb currently bypasses Cancel's confirm.)

### 15.4 Reference implementation — Pipelines (the most complex module)

Pipelines is the deepest real nesting (`pipeline` shell → `pipelines` list → 5
detail children through two nested `<RouterView>`s) and now demonstrates the
whole system:
- **L2**: `Functions.vue` renders `AppPageHeader` (icon `lan`, title `Pipelines`)
  with the 4 module tabs inline + list actions (History/Backfill/Import/New) on
  the right.
- **L3**: on `pipelineEditor`/`createPipeline`/`importPipeline`/`pipelineHistory`/
  `pipelineBackfill`, the shell swaps tabs → `Pipelines › <item>` breadcrumb and
  exposes the `#o2-page-actions` portal target.
- **Detail pages** (`PipelineEditor`, `PipelineHistory`, `BackfillJobsList`) had
  their bespoke header cards removed; they now `Teleport` their controls
  (Save/Cancel/JSON; date-picker + pipeline filter; status/pipeline filters) into
  the shell header. Result: one header, one title, controls beside the
  breadcrumb, ~70–80px of stacked chrome reclaimed per detail page.

### 15.5 Per-module application (covers every current scenario)

| Module | L2 | L3 / deeper | Status |
|---|---|---|---|
| **Pipelines** | horizontal tabs (4) | breadcrumb + portal actions; editor/history/backfill | **implemented (reference)** |
| **Dashboards** | none (single landing) | `Dashboards › Folder › Dashboard` (view), `… › Panel` (add-panel, collapses), `Dashboards › Import` | **implemented** (each page owns `AppPageHeader`; overlays = Settings/JSON/Scheduled drawers → give them the `#back` pill) |
| **IAM** | vertical rail (≤7) | edit group/role → breadcrumb `Identity & Access › <name>` (currently missing — add) | rail exists; **adopt `SecondaryNav` + add detail breadcrumb** |
| **Settings** | vertical rail (15, scroll) | flat (no detail) | rail exists + scroll fixed; **adopt `SecondaryNav`, consider grouping the 15** |
| **Alerts / Streams / Reports / RUM** | most are flat single lists (no L2) | add/edit routes → breadcrumb `Module › <item>` via `AppPageHeader breadcrumb` prop; today they roll bespoke `card-container`+`h-[68px]`+`text-xl` headers | **migrate to `AppPageHeader` + breadcrumb** (drop bespoke arrow-back headers) |

### 15.6 Density (shipped) — "data is king"

~205px of fixed chrome sat above the first table row. App-wide reclaims now in:
`AppPageHeader` `h-14→h-12`; OTable `#toolbar` `py-1.5→py-1`; dense column header
`h-7→h-6` (also fixed a draggable/non-draggable mismatch); pagination
`~50→40px`; Settings rail `overflow-y-auto`. Row height stays 36px (legibility);
dropping to 32px is the biggest remaining lever but is opt-in per table.
