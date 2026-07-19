# Spacing (Padding/Margin) Audit & Standard — 2026-07-19

Branch `fix/token` · Scope: `web/src` (excluding `*.spec.*`, `src/test/**`, `__mocks__`, vendored echarts, and `src/lib/styles/tokens/**`).

**Supersedes the 2026-07-18 audit.** The quantitative sections (§0–§1) were regenerated on 2026-07-19 after the arbitrary-value codemod landed (see _Execution status_). The per-surface tables (§3–§6) were re-spot-checked on 2026-07-19 and still hold — the codemod changed the *form* of many values (`px-[0.625rem]`→`px-2.5`) but not their *magnitude*, so the structural drift is unchanged.

**What this document is.** Two things:
1. **An audit** (§0–§6) — which raw spacing values the app uses and why surfaces feel inconsistently spaced.
2. **A standard** (§7 _The Grid-Line Alignment Standard_ + §8 _Which spacing, where_) — the structured, copy-ready rules for **how to space a surface**: where content sits, where separators go, and which step to reach for. This is the part to read when building or reviewing new UI.

Companion docs: [RAW_TOKEN_AUDIT.md](RAW_TOKEN_AUDIT.md) (all raw-value categories), [DESIGN_TOKEN_STANDARD.md](DESIGN_TOKEN_STANDARD.md) (color/text/radius/shadow — spacing is explicitly out of its scope and defers here), [FONT_AUDIT.md](FONT_AUDIT.md) (type scale). The house rules for authoring new UI live in the `ui-architect` skill ([house-rules.md](../.claude/skills/ui-architect/references/house-rules.md)) — rule 3 (no hardcoded px) and rule 4 (form-field `gap-5`) are the spacing-relevant ones; this document is their per-surface elaboration.

---

## Execution status (2026-07-19)

**✅ Phase 1 shipped — the arbitrary→class codemod.** The exact-equivalent bracket rewrites (`py-[0.625rem]`→`py-2.5`, `gap-[0.375rem]`→`gap-1.5`, …) landed as part of `refactor(web): A(1) rewrite 645 exact arbitrary values to Tailwind scale`. Measured effect on spacing:

| Metric | 2026-07-18 | 2026-07-19 | Δ |
|---|---:|---:|---:|
| Arbitrary bracket spacing values (uses) | 679 | **211** | −468 |
| Distinct arbitrary spacing values | ~200 | **93** | ↓ |
| Distinct spacing utility classes | 426 | **352** | −74 |
| CSS `padding`/`margin` decls in `<style>` | 368 | **340** | −28 |
| …of which still `px`-valued | 43 | **27** | −16 |
| Inline `style="padding/margin…"` | 49 | **27** | −22 |

Note the codemod converted the exact-equivalents only. The **off-grid drift** (values that sit *between* scale steps) mostly survived — it needs snap-to-scale decisions, not a mechanical rewrite. That is Phase 2, still pending.

**⏳ Not yet done — Phases 2–7** (§7.5 / §9). Nothing structural has shipped: the staircase misalignment (§7.1), the unowned drawer bodies (§5), the per-module page chrome (§6), and the dead spacing-token layer (§2) are all still present. No CI ratchet guards spacing yet.

---

## 0. TL;DR — the spacing story in six points

1. **The spacing token layer is still dead.** `--spacing-3…10` exist in `base.css` `:root` but are in **no `@theme` block**; app code consumes `var(--spacing-*)` exactly **once**. All real spacing flows through Tailwind's default 0.25rem grid. The "token scale" is a fiction; the *de facto* system is unguarded Tailwind numeric steps (§2).
2. **~10,002 spacing utilities, 352 distinct classes, 35 distinct scale steps.** The core is healthy (2/1/3/4 dominate). Phase 1 removed most of the arbitrary noise, but a long tail of invented steps survives (`px-1.25`×167, `2.25`, `5.5`, `4.5`, `1.75`, `8.5`…) plus **211 arbitrary bracket values** still off-grid (§1).
3. **No vertical-rhythm convention.** `mb-1/2/3/4` and `mt-*` are all used heavily for the same job — spacing stacked blocks — chosen per-file by feel. The single biggest "every page stacks differently" cause (§8.2).
4. **The alignment defect the standard fixes: a left-inset staircase.** Going down a CRUD page the content inset steps **16px → 12px → 8px** (header `px-4` → table toolbar/search `px-3` → table cells `px-2`). Separators are already full-bleed — only the *content* insets disagree, so nothing lines up into a grid (§7.1).
5. **Drawer bodies are unowned space.** ODrawer bakes in header/footer padding but the body slot has none — consumers invented **9 distinct body paddings** (0 → 24px) and **14 ad-hoc vw widths** on top of the 5 presets; 2 drawers bypass ODrawer entirely (§5).
6. **Page/listing chrome has drifted per module** — 5 root-container class strings for the same shape, a legacy 10px inset on 3 pages (logs, About, Overview) vs the 16px standard, sidebar widths set three different ways (`w-57.5` vs `w-[14.375rem]` vs inline `style="width:230px"`) (§3, §6).

**The counter-example that proves the fix:** dialogs. One primitive (ODialog) + component tokens = **zero spacing overrides across 87 files** (§4). Inconsistency lives exactly where no primitive owns the spacing.

---

## 1. The numbers (regenerated 2026-07-19)

| Metric | Count | Note |
|---|---:|---|
| Tailwind spacing utilities (p/m/gap/space-*) | **10,002** | 352 distinct classes |
| …of which arbitrary bracket values | **211** | 93 distinct; the drift that remains |
| Distinct numeric scale steps in use | **35** | healthy core 0–4; long tail below |
| CSS `padding:`/`margin:` declarations in `<style>` | **340** (182 distinct) | 27 still px-valued |
| CSS `gap:` declarations | **60** (25 distinct) | incl. off-grid `0.5625rem`, `0.4375rem`, `0.8125rem` |
| Inline `style="padding/margin…"` | 27 | negligible; mostly dynamic bindings |
| `padding/margin … !important` | 44 | override-pressure vs Quasar/legacy CSS |
| `var(--spacing-*)` consumed outside token files | **1** | the token scale is unused |

### 1a. Scale-step histogram (all spacing props aggregated)

```
step   uses      step   uses      step  uses
2      2,579     0.5     357      7     14
1      1,733     1.25    167 ←    5.5   13   ←
3      1,566     6       158      2.25  12   ←
4        938     3.5     129      12    12
0        703     5       109      4.5   11   ←
1.5      570     8        60      1.75  10   ←
2.5      523     0.75     52      9      5
                 20       25      7.5    3   ←
                 10       16      2.75   3   ←
                                  … singletons: 5.75, 5.25, 4.25, 14, 8.5, 36, 3.75, 3.25, 18, 15
```
`←` = steps not on Tailwind's classic half-step grid — per-file inventions. `px-1.25` alone appears 167× (an ad-hoc "5px" convention). These are the Phase-2 snap targets (§7.5).

### 1b. Arbitrary spacing values — 211 uses, 93 distinct (the surviving drift)

Post-codemod these are genuinely *between* grid steps, i.e. several "small gap" inventions living side by side. Snap them to the blessed scale:

| Cluster | Values seen (examples) | Snap to |
|---|---|---|
| "hairline" ~1px | `py-[0.0625rem]` (7) | `*-px` or drop |
| "tiny gap" ~2–3px | `gap-[0.15rem]` (6), `gap-[0.1rem]` (3), `mt-[0.1rem]` (3), `mb-[0.2rem]` | `*-0.5` (2px) |
| "small gap" ~3–5px | `gap-[0.2rem]` (10), `gap-[0.3rem]` (4), `py-[0.18rem]` (6), `pb-[0.185rem]` | `*-1` (4px) |
| "5–6px" | `px-[0.325rem]` (6), `mr-[0.325rem]` (6), `mr-[0.3125rem]` (6), `gap-[0.4rem]` (9), `px-[0.4rem]` (4), `p-[0.325rem]` | `*-1.5` (6px) |
| "10–12px" | `py-[0.725rem]`, `p-[0.675rem]`, `pb-[1.125rem]` | `*-2.5` / `*-3` |
| icon-inset | `pl-[2.15rem]` (7 — search-input icon inset) | `pl-9` (36px) |
| stray `px` compounds | `p-[8px_12px]` (5), `p-[8px_10px]` (3), `p-[12px_14px]`, `p-[10px_14px]` | rem class pairs (`py-2 px-3`, …) |

**Worst files** (arbitrary-spacing count): `plugins/traces/SessionDetails.vue` (26), `plugins/traces/ThreadView.vue` (18), `views/HomeChatHistory.vue` (9), `plugins/traces/TraceDetailsSidebar.vue` (9), `components/settings/DiscoveredServices.vue` (7), `plugins/traces/TraceDetails.vue` (5), `enterprise/…/ScorerFormPage.vue` (5), `components/EnterpriseUpgradeDialog.vue` (5). The traces plugin is the concentration point.

### 1c. CSS declarations in `<style>` blocks (340)

Beyond `margin: 0`/`padding: 0` resets, the rest is a per-file value zoo: `padding: 0.75rem`, `0.5rem 1rem`, `0.5rem 0.75rem`, `0.375rem 0.5rem`, `0.3rem 0.5rem`… plus off-grid `gap: 0.5625rem`, `0.4375rem`, `0.8125rem`, `1.125rem`. None reference tokens. 27 are still px-valued.

---

## 2. Architecture finding — where spacing *actually* comes from

- `base.css` defines `--spacing-px, -3, -4, -5, -6, -8, -10` in plain `:root`. They are **not** in any `@theme` block, so Tailwind ignores them; utilities like `p-3` resolve from Tailwind v4's built-in `--spacing: 0.25rem` multiplier. Values happen to coincide, so no visual bug — but the project scale and the working scale are two disconnected systems.
- The only real consumers of `--spacing-*` are component tokens in `component.css` (`--spacing-dialog-header-px/py`, `--spacing-dialog-content-px/py`, `--spacing-dialog-footer-px/py`, `--spacing-tabs-height`, `--text-icon-*`, `--spacing-field-width-*`).
- Consequence: **the de facto spacing system is "Tailwind numeric utilities, any value allowed, no guard."** Since Tailwind v4 generates *any* numeric step (`px-1.25`, `mb-5.75` all compile), nothing stops off-grid inventions — hence the 35-step histogram.

---

## 3. Listing pages, module by module

All 16 listing pages use `OTable`; **no page overrides cell/row padding** — table density is fully owned by the lib component. The drift is in the page chrome around the table.

### Root container — 5 different class strings for the same shape

| Convention | Pages |
|---|---|
| `flex flex-col h-full p-0` | AlertsDestinationList, TemplateList, RegexPatternList, CipherKeys |
| `p-0 h-full flex flex-col` (same, reordered) | User, ListOrganizations, ServiceAccountsList |
| `flex flex-col h-full [min-h-0]` (no `p-0`) | AlertList, FunctionList, PipelinesList, EnrichmentTableList |
| `h-full` only | LogStream, ReportList, ActionScripts |
| `PageLayout` as root, no wrapper div | Dashboards |

The `p-0` is a no-op carried around in two orderings — pure copy-paste drift. **16 files** still carry a `p-0` root.

### Header — canonical string `shrink-0 px-4 border-b border-border-default`

`AppPageHeader` content sits at the **16px (`px-4`) page inset** and draws a **full-bleed** bottom divider. Two mounting patterns coexist: `PageLayout #header` slot (7 pages) vs `AppPageHeader` used directly (8 pages). Deviations:

| File | Deviation |
|---|---|
| [FunctionList.vue](src/components/functions/FunctionList.vue) | missing `border-b border-border-default` — no divider under header |
| [EnrichmentTableList.vue](src/components/functions/EnrichmentTableList.vue) | missing `border-b` (uses `tabs-below`) |
| [SyntheticMonitoring.vue](src/views/SyntheticMonitoring.vue) | missing `shrink-0` — header can collapse under flex pressure |
| [PipelinesList.vue](src/components/pipeline/PipelinesList.vue) | **no AppPageHeader at all** — only listing page without a page header; toolbar lives in OTable `#toolbar` |

### Sidebar width — three mechanisms for the same ~230px folder rail

| File | Mechanism |
|---|---|
| [AlertList.vue](src/components/alerts/AlertList.vue) | `w-57.5` (Tailwind step) |
| [SyntheticMonitoring.vue](src/views/SyntheticMonitoring.vue) | `w-[14.375rem]` (arbitrary rem) |
| [ReportList.vue](src/components/reports/ReportList.vue) | inline `:style="{ width: 230 + 'px' }"` (hardcoded px) |

---

## 4. Dialogs — ✅ the one clean surface (proof the token approach works)

Every real dialog is an `ODialog` (117 usages in 87 files; raw `q-dialog` = **0**), and `ODialog` applies all padding through the `--spacing-dialog-*` tokens:

| Region | Value | Source |
|---|---|---|
| Header / content / footer | `20px / 12px` (`--spacing-5`/`--spacing-3`) | [ODialog.vue](src/lib/overlay/Dialog/ODialog.vue) |
| Footer button gap | `gap-2` everywhere — built-in **and** custom `#footer` slots | — |
| `full` size body | `p-0` — full-screen bodies own their padding | ODialog.vue |

Sampled 30+ dialogs across every module: **zero files override the token values.** The only sanctioned deviation is the full-bleed pattern (negative margins `-mx-dialog-content-px …`) in 3 files. **Single off-token outlier:** [O2AIConfirmDialog.vue](src/components/O2AIConfirmDialog.vue) — a bespoke overlay div, not an ODialog.

**Why this matters:** dialogs prove the recipe — one lib primitive + component tokens + slots = zero drift across 87 files. Listing pages, forms, and vertical rhythm drifted precisely because they lack an equivalent owned primitive/convention.

---

## 5. Drawers — half-owned: header/footer consistent, body a free-for-all

`ODrawer` bakes in header/footer padding (reuses the dialog tokens → 20px/12px, uniform) but **the body slot has no built-in padding** — every consumer invents its own. Across ~45 drawers:

**9 distinct body paddings** — same "detail drawer" concept, nine densities: `p-0` (own layout) · `px-1 py-2.5` · `px-2 py-2` · `p-2.5` · `p-3`/`px-3` · `px-4`/`p-4` · `px-4 py-2` · `p-5`/`px-5 py-4` · `px-6 py-4`.

**19 distinct widths** — presets `sm/md/lg/xl/full` (lg=640px most common) **plus 14 ad-hoc vw values**: 30, 40, 45, 47, 50, 60, 65, 70, 74, 80, 85, 90, 97, 100. Nobody chose between 45 and 47 for a reason.

**2 drawers bypass ODrawer entirely:** [ExecutionDetailDrawer.vue](src/components/synthetics/results/ExecutionDetailDrawer.vue) (hand-rolled Teleport, `max-w-2xl`), [IncidentDetailDrawer.vue](src/components/alerts/IncidentDetailDrawer.vue) (hand-rolled panel, three section paddings in one file).

---

## 6. Page containers & tab panels

**Dominant (good) convention — ~19 of 29 sampled views:** no padding on the page root; `AppPageHeader` carries `px-4`; content areas manage their own inset. Deviations — the legacy 10px inset that survived the Quasar migration (`q-pa-sm`≈8px eyeballed to 10px), now in class form after Phase 1:

| File | Deviation |
|---|---|
| [About.vue](src/views/About.vue) | `px-2.5 pb-2.5 pt-2.5` root inset — 10px, matches no other page |
| [OverviewTab.vue](src/views/OverviewTab.vue) | `pt-2.5 pr-3.5 pb-2.5 pl-2.5` — 10px with a 14px right edge |
| [plugins/logs/Index.vue](src/plugins/logs/Index.vue) | inner `pt-2.5 pl-2.5` — 10px top/left only |
| [MonitorRuns.vue](src/views/synthetics/MonitorRuns.vue) | header `px-2` instead of `px-4` |
| [PromQL/QueryBuilder.vue](src/views/PromQL/QueryBuilder.vue) | content `px-2.5` — its own inset value |

These three pages (logs/About/Overview) have visibly tighter/odd chrome than the `px-4` (16px) standard.

**Tab panels:** all O2. `OTabPanel` defaults to `p-0`; 50 of 54 instances keep the default. Consistent — the panel-owner-pads model works because the default is 0, mirroring the dialog lesson.

---

# 7. The Grid-Line Alignment Standard

> This is the rule the rest of the app should be measured against. It answers "which spacing, and where" for any surface, and it's the fix for the staircase defect (§0.4).

## 7.1 The principle — one inset, full-bleed separators

Two rules, applied to every surface:

1. **Content aligns to a single inset.** Every stacked block on a surface starts its content at the **same horizontal inset from the surface edge**. Pick one value per surface and everything — header title, toolbar, search box, table's first column, section body — begins on that line. The eye should be able to draw one straight vertical line down the left edge (and one down the right) and have every piece of content touch it.

2. **Separators are full-bleed.** Every divider — a header's bottom border, a toolbar's border, a table row hairline, a sidebar section rule — **runs edge-to-edge of its container, touching both ends**. A divider is never inset to line up with content; it spans the full width so the horizontals read as continuous rules.

Together these produce **grid lines**: content on a consistent vertical rhythm, separators as unbroken horizontals — the layout reads as an aligned grid, not a staircase.

**The blessed page inset is `px-4` (16px)** for primary content areas (page headers, listing chrome, main panels). Narrow rails/sidebars may use a tighter inset (`px-2`/`px-3`) but must apply it consistently and still keep dividers full-bleed. Never mix insets within one visual column.

## 7.2 The defect today — the staircase

Going down a standard CRUD listing page, the **left content inset** currently steps down three times while the **separators** already span full width:

| Band (top → bottom) | Content inset | Class | Separator |
|---|---:|---|---|
| Page header (`AppPageHeader`) | **16px** | `px-4` | full-bleed `border-b` ✅ |
| Table toolbar / built-in search | **12px** | `px-3` | full-bleed `border-b` ✅ |
| Table column headers (`th`) | **8px** | `px-2` | full-bleed `border-b` ✅ |
| Table body cells (`td`) | **8px** | `px-2` | full-bleed row hairline ✅ |

So the separators are already correct (rule 2 holds) — the **content insets disagree** (rule 1 broken): 16 → 12 → 8. The page title sits 8px to the right of the first table column, and the search box sits between them. Nothing lines up.

**Where the values live** (for whoever implements the fix later):
- Header inset: `shrink-0 px-4 …` on the `PageLayout` header slot / `AppPageHeader` mount.
- Toolbar + built-in search: `px-3 py-2` on the two toolbar `<div>`s in [OTable.vue](src/lib/core/Table/OTable.vue) (`data-test="o2-table-toolbar"` and `o2-table-global-filter`).
- Cell padding: `px-2` (default) / `px-1` (compactPadding) / `px-0` (spacer) in [OTableBodyCell.vue](src/lib/core/Table/sub-components/OTableBodyCell.vue) and the `headerPaddingClass()` in [OTableHeader.vue](src/lib/core/Table/sub-components/OTableHeader.vue).

## 7.3 The target — how a CRUD page should align

Make all bands share the **16px** page inset while keeping every separator full-bleed:

```
┌───────────────────────────────────────────────┐
│⇥16px  [icon] Alert Destinations      [+ Add]   │  header content @ 16px
├───────────────────────────────────────────────┤  ← border-b full-bleed (touches both edges)
│⇥16px  [🔍 Search…]              [columns ▾]     │  toolbar/search @ 16px
├───────────────────────────────────────────────┤  ← border-b full-bleed
│⇥16px  NAME          TYPE         ACTIONS        │  column header @ 16px
├───────────────────────────────────────────────┤  ← header border-b full-bleed
│⇥16px  slack-prod    Webhook      ⋯             │  first cell content @ 16px
├───────────────────────────────────────────────┤  ← row hairline full-bleed
│⇥16px  pagerduty     PagerDuty    ⋯             │
└───────────────────────────────────────────────┘
   ↑ one vertical grid line at 16px, unbroken horizontals
```

Concretely (target, **not yet implemented** — see §7.5 / §9):
- **Toolbar & search:** `px-3` → **`px-4`**.
- **Table content inset without insetting the hairlines:** keep interior cells at `px-2` (so the inter-column gutter stays a consistent 16px = 8+8), but give the **first visible cell** a left inset that reaches 16px and the **last visible cell** a right inset that reaches 16px. The row hairline (`border-b` on each `td`) still spans the full table width, so dividers stay full-bleed while content aligns to the page inset. "First/last visible cell" must account for the selection-checkbox / expand / drag / pinned columns — whichever cell is physically first/last gets the inset, not necessarily the first *data* column.
- **Do not** add horizontal padding to a wrapper `<div>` around the `<table>` to achieve this — that insets the whole table including the hairlines, breaking rule 2. The inset must live on the cells; the borders must stay on the full-width table.

## 7.4 The target — how a sidebar/rail should align

The folder rails (Dashboards, Alerts, Reports, IAM, Settings) and the logs field list are vertical stacks of sections. Same two rules, tuned for a narrow column:

- **One rail width.** Pick a single token/value for the ~230px folder rail; today it's set three ways (`w-57.5`, `w-[14.375rem]`, inline `230px` — §3).
- **Equal content inset on all four sides.** Every section's content (header row, search box, list rows) sits at the same horizontal inset from the rail edges, and each section gets **equal top and bottom padding** so the stack breathes evenly — not `p-2` on one section and `py-2.5 pb-[0.3rem]` on the next (the current FolderList state).
- **Section separators are full-bleed.** A rule between the "header/search" zone and the scrollable list, and the rail's own right border, **touch the rail edges** — they are not inset to match the content. Same grid-line effect, vertically: content on one inset, dividers spanning the full rail width.

```
┌─────────────────────┐  ← rail right border full-bleed
│⇥ Folders      [+]   │  section content @ rail inset
│⇥ [🔍 Search…]       │
├─────────────────────┤  ← divider full-bleed (touches both rail edges)
│⇥ ★ Favorites        │  list rows @ same inset
│⇥ Default            │
│⇥ Production         │
└─────────────────────┘
```

## 7.5 Blessed spacing scale (guard target)

Decide the allowed steps and guard them so off-grid inventions can't return:

**Blessed steps:** `0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12` (× 0.25rem) + layout sizes (`14, 16, 20, 24…` for widths/heights, not gaps).

**Banned (the survivors to snap):** `1.25` (167 uses), `1.75`, `2.25`, `2.75`, `3.25`, `3.75`, `4.25`, `4.5`, `5.25`, `5.5`, `5.75`, `7.5`, `8.5`, and all 211 arbitrary brackets (§1b).

**Enforcement (proposed):** add a `spacing` category to `web/scripts/check-design-consistency.mjs` that counts (a) arbitrary spacing brackets (`p/m/gap/space-[…]`) and (b) non-blessed numeric steps, baseline the current totals, and ratchet monotonically down — same mechanism the color/radius/shadow ratchets already use. Wire it into the per-PR `lint:design` gate so no PR can add a new off-scale spacing value.

---

# 8. Which spacing, where — the authoring guide

> The lookup table for building or reviewing UI. Pick the surface, apply the row. All values are the blessed steps from §7.5.

## 8.1 Per-surface reference

| Surface | Horizontal content inset | Vertical rhythm | Separators | Owned by |
|---|---|---|---|---|
| **Page header** | `px-4` (16px) | fixed `h-15` band | full-bleed `border-b border-border-default` | `AppPageHeader` — never restyle from outside |
| **Page root** | *none* — root has no padding | `flex flex-col h-full min-h-0` | — | the view |
| **CRUD table toolbar / search** | `px-4` (16px) — align to header | `py-2` | full-bleed `border-b` | `OTable` |
| **CRUD table cells** | first/last cell reach 16px; interior `px-2` (16px gutter) | row height var | full-bleed row hairline | `OTable` — pages never override cell padding |
| **Sidebar / folder rail** | one consistent inset (`px-2`/`px-3`), equal 4 sides | equal `py-2` per section | full-bleed section rule + rail `border-r` | the rail component |
| **Dialog** | token 20px / 12px | form `gap-5` | token-owned (do not override) | `ODialog` |
| **Drawer body** | one owned padding — **propose `p-4`** (16px) as the default | form `gap-5` | header/footer token-owned | `ODrawer` (needs a `padding` prop — §9 Phase 4) |
| **Validated form** | — | **`gap-5`** on `<OForm>` (house rule) | — | `OForm` |
| **Card / section content** | `p-4` (16px) typical; `p-3` dense | `flex flex-col gap-4` | full-bleed if the card is edge-to-edge | the component |

## 8.2 Vertical rhythm — stop the `mb-*` chains

The single biggest "every page stacks differently" cause is spacing stacked blocks with per-element `mb-1/2/3/4` chosen by feel. Fix:

- **Space a stack with `flex flex-col gap-*` on the container, not `mb-*`/`mt-*` on each child.** One decision (the gap) instead of N.
- Blessed vertical steps: **`gap-2`** (8px, tight/related) · **`gap-4`** (16px, default between sections) · **`gap-6`** (24px, major group separation). Forms use **`gap-5`** (20px) per the house rule.
- Reserve `mt-*`/`mb-*` for a genuine one-off nudge, not for the primary rhythm of a list of blocks.

## 8.3 The three questions to ask when spacing anything new

1. **What inset does this surface already use?** Match it. On a main content area that's `px-4` (16px). Don't introduce a fourth value.
2. **Is this line a separator?** If yes, make it full-bleed — span the container, touch both ends. Never inset a divider to line up with content; align the *content*, not the rule.
3. **Is this a scale step?** Only `0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12`. If your value isn't one of these, you're eyeballing — snap to the nearest, or if you truly need a new one, it's a design decision, not a per-file `[0.325rem]`.

## 8.4 Copy-ready recipes

**CRUD listing page** (root → header → table; the table owns its own toolbar/search/rows):
```vue
<template>
  <div class="flex flex-col h-full min-h-0">   <!-- root: no padding, no p-0 -->
    <PageLayout :header-class="'shrink-0 px-4 border-b border-border-default'">
      <template #header>
        <AppPageHeader :title="t('…')" icon="…" :subtitle="t('…')">
          <template #actions>…</template>
        </AppPageHeader>
      </template>
      <div class="bg-card-glass-bg flex-1 min-h-0">
        <OTable … />   <!-- do not add px here; the table aligns its own content -->
      </div>
    </PageLayout>
  </div>
</template>
```

**Validated form inside a dialog/drawer** — the gap is on `OForm`, not on each field:
```vue
<OForm class="flex flex-col gap-5" :schema="schema" @submit="…">
  <OFormInput name="name" :label="t('…')" />
  <OFormSelect name="type" :label="t('…')" :options="…" />
</OForm>
```

**A stacked content section** — one `gap`, no `mb-*` chain:
```vue
<div class="flex flex-col gap-4 p-4">   <!-- 16px inset, 16px rhythm -->
  <section>…</section>
  <section>…</section>
</div>
```

---

# 9. Remediation plan (status)

Ordered by leverage; Phase 1 shipped, 2–7 pending. The alignment standard (§7) is the acceptance criterion for Phases 4–5.

| Phase | Work | Status | Risk |
|---|---|---|---|
| 1 | **Codemod** 501+ bracket→class rewrites (`py-[0.625rem]`→`py-2.5` …) — identical CSS output | ✅ **done** (2026-07-19) | none |
| 2 | **Snap the ~211 remaining off-grid values** (§1b) + 27 px CSS decls → rem/scale | ⏳ pending | low — 1–2px shifts, visual spot-check |
| 3 | **Define the blessed scale & guard it** (§7.5): kill off-scale steps (`px-1.25`×167, `2.25`, `4.5`, `5.5`…); add the `spacing` ratchet to `check-design-consistency.mjs`, wired into the per-PR `lint:design` gate | ⏳ pending | medium |
| 4 | **Grid-line alignment — the primitives.** OTable toolbar/search `px-3`→`px-4`; first/last cell content reaches 16px with hairlines staying full-bleed (§7.3). Give ODrawer a `padding` prop (default `p-4`); migrate the 9 body-padding variants; collapse the 14 ad-hoc vw widths onto presets; rewrite the 2 hand-rolled drawers onto ODrawer | ⏳ pending | medium — visible (intended) shifts, needs visual QA |
| 5 | **Standardize page chrome:** one root recipe (`flex flex-col h-full min-h-0`, drop the 16 `p-0` no-ops); canonical header string enforced (FunctionList/EnrichmentTableList/SyntheticMonitoring/MonitorRuns); add AppPageHeader to PipelinesList; migrate the 10px-inset pages (About, OverviewTab, logs/Index) to `px-4`; one sidebar-width token (fix ReportList's inline `230px`) | ⏳ pending | medium — visible (intended) |
| 6 | **Vertical rhythm + forms** (§8.2): `flex flex-col gap-*` over `mb-*` chains; `gap-5` on OForm; apply opportunistically on touched files, enforce for new code via review/ratchet | ⏳ pending | low per-file |
| 7 | **Reconcile the token layer:** either register the blessed steps as real `--spacing-*` `@theme` tokens (so `p-3` resolves from project tokens) or delete the dead `:root` scale and document "Tailwind grid is the scale" — currently it's half of each | ⏳ pending | low |

**Model to copy:** §4 dialogs — a single lib primitive owning all chrome spacing via component tokens produced zero drift across 87 files without any enforcement. Drawer body, page chrome, and forms drift exactly where no primitive owns the spacing.

---

Regenerate the §1 numbers any time: `bash web/scripts/spacing-audit.sh` (writes per-category lists to `/tmp/spacing_audit_*.txt`; needs ripgrep + python3). The §3–§6 surface tables were compiled by file-by-file reading of all 16 listing pages, 30+ dialogs, ~45 drawers, and ~29 routed views (2026-07-18), re-spot-checked 2026-07-19. The §7–§8 standard is new (2026-07-19) and unimplemented — it is the target, not a description of current state.
