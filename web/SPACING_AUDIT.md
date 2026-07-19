# Spacing (Padding / Margin) Standard

Scope: `web/src`. Companion docs: [RAW_TOKEN_AUDIT.md](RAW_TOKEN_AUDIT.md), [DESIGN_TOKEN_STANDARD.md](DESIGN_TOKEN_STANDARD.md) (color/text/radius/shadow — spacing defers here), [house-rules.md](../.claude/skills/ui-architect/references/house-rules.md).

This document is two things: **the issues** with how the app spaces surfaces today (§1–§6), and **the standard** that fixes them — how to space any surface, which step to use where, and what to change (§7–§9). Read §7–§8 when building or reviewing UI.

---

## 1. The issues, in short

1. **The spacing token layer is dead.** `--spacing-3…10` exist in `base.css` `:root` but are in **no `@theme` block**; app code consumes `var(--spacing-*)` exactly **once**. All real spacing flows through Tailwind's default 0.25rem grid. The "token scale" is a fiction; the working system is unguarded Tailwind numeric steps (§2).
2. **Off-grid inventions.** ~10,000 spacing utilities across **35 distinct scale steps**. The core is healthy (2/1/3/4 dominate) but a long tail of invented steps survives (`px-1.25`×167, `2.25`, `5.5`, `4.5`, `1.75`, `8.5`…) plus **211 arbitrary bracket values** genuinely between grid steps — five different "small gap" sizes can appear on one screen (§1a/§1b).
3. **No vertical-rhythm convention.** `mb-1/2/3/4` and `mt-*` are all used heavily for the same job — spacing stacked blocks — chosen per-file by feel. The single biggest "every page stacks differently" cause (§8.2).
4. **The alignment defect (the main one): a left-inset staircase.** Going down a CRUD page the content inset steps **16px → 12px → 8px** (header `px-4` → table toolbar/search `px-3` → table cells `px-2`). Separators are already full-bleed — only the *content* insets disagree, so nothing lines up into a grid (§7).
5. **Drawer bodies are unowned space.** `ODrawer` bakes in header/footer padding but the body slot has none — consumers invented **9 distinct body paddings** (0 → 24px) and **14 ad-hoc widths** on top of the 5 presets; 2 drawers bypass ODrawer entirely (§5).
6. **Page/listing chrome drifted per module** — 5 root-container class strings for the same shape, a legacy 10px inset on 3 pages (logs, About, Overview) vs the 16px standard, sidebar widths set three different ways (`w-57.5` vs `w-[14.375rem]` vs inline `width:230px`) (§3, §6).

**The counter-example that proves the fix:** dialogs. One primitive (`ODialog`) + component tokens = **zero spacing overrides across 87 files** (§4). Inconsistency lives exactly where no primitive owns the spacing.

---

## 1a. Scale-step histogram (all spacing props aggregated)

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
                                  … singletons: 5.75, 5.25, 4.25, 8.5, 3.75, 3.25, 14, 15, 18, 36
```
`←` = steps not on Tailwind's half-step grid — per-file inventions. `px-1.25` alone appears 167× (an ad-hoc "5px" convention). These are the snap targets (§7.5).

## 1b. Arbitrary spacing values — the surviving drift (211 uses, 93 distinct)

Values that sit *between* grid steps, i.e. several "small gap" inventions side by side. Snap each to the blessed scale:

| Cluster | Values seen (examples) | Snap to |
|---|---|---|
| "hairline" ~1px | `py-[0.0625rem]` | `*-px` or drop |
| "tiny gap" ~2–3px | `gap-[0.15rem]`, `gap-[0.1rem]`, `mt-[0.1rem]`, `mb-[0.2rem]` | `*-0.5` (2px) |
| "small gap" ~3–5px | `gap-[0.2rem]`, `gap-[0.3rem]`, `py-[0.18rem]`, `pb-[0.185rem]` | `*-1` (4px) |
| "5–6px" | `px-[0.325rem]`, `mr-[0.325rem]`, `mr-[0.3125rem]`, `gap-[0.4rem]`, `px-[0.4rem]` | `*-1.5` (6px) |
| "10–12px" | `py-[0.725rem]`, `p-[0.675rem]`, `pb-[1.125rem]` | `*-2.5` / `*-3` |
| icon-inset | `pl-[2.15rem]` (search-input icon inset) | `pl-9` (36px) |
| stray `px` compounds | `p-[8px_12px]`, `p-[8px_10px]`, `p-[12px_14px]` | rem class pairs (`py-2 px-3`, …) |

**Worst files** (arbitrary-spacing count): `plugins/traces/SessionDetails.vue`, `plugins/traces/ThreadView.vue`, `views/HomeChatHistory.vue`, `plugins/traces/TraceDetailsSidebar.vue`, `components/settings/DiscoveredServices.vue`, `components/EnterpriseUpgradeDialog.vue`. The traces plugin is the concentration point.

---

## 2. Where spacing actually comes from

- `base.css` defines `--spacing-px, -3, -4, -5, -6, -8, -10` in plain `:root`. They are **not** in any `@theme` block, so Tailwind ignores them; utilities like `p-3` resolve from Tailwind v4's built-in `--spacing: 0.25rem` multiplier. Values coincide, so no visual bug — but the project scale and the working scale are two disconnected systems.
- The only real consumers of `--spacing-*` are component tokens in `component.css` (`--spacing-dialog-*`, `--spacing-tabs-height`, `--text-icon-*`, `--spacing-field-width-*`).
- Consequence: **the de facto system is "Tailwind numeric utilities, any value allowed, no guard."** Tailwind v4 generates *any* numeric step (`px-1.25`, `mb-5.75` all compile), so nothing stops off-grid inventions.

---

## 3. Listing pages

All 16 listing pages use `OTable`; **no page overrides cell/row padding** — table density is owned by the lib component. The drift is in the chrome around the table.

**Root container — 5 different class strings for the same shape:**

| Convention | Pages |
|---|---|
| `flex flex-col h-full p-0` | AlertsDestinationList, TemplateList, RegexPatternList, CipherKeys |
| `p-0 h-full flex flex-col` (reordered) | User, ListOrganizations, ServiceAccountsList |
| `flex flex-col h-full [min-h-0]` (no `p-0`) | AlertList, FunctionList, PipelinesList, EnrichmentTableList |
| `h-full` only | LogStream, ReportList, ActionScripts |
| `PageLayout` as root, no wrapper | Dashboards |

The `p-0` is a no-op carried around in two orderings — copy-paste drift; **16 files** still carry it.

**Header — canonical string `shrink-0 px-4 border-b border-border-default`.** Content sits at the **16px (`px-4`)** page inset with a **full-bleed** bottom divider. Deviations:

| File | Deviation |
|---|---|
| [FunctionList.vue](src/components/functions/FunctionList.vue) | missing `border-b` — no divider under header |
| [EnrichmentTableList.vue](src/components/functions/EnrichmentTableList.vue) | missing `border-b` (uses `tabs-below`) |
| [SyntheticMonitoring.vue](src/views/SyntheticMonitoring.vue) | missing `shrink-0` — header can collapse |
| [PipelinesList.vue](src/components/pipeline/PipelinesList.vue) | **no AppPageHeader at all** — toolbar lives in OTable `#toolbar` |

**Sidebar width — three mechanisms for the same ~230px folder rail:** `w-57.5` ([AlertList](src/components/alerts/AlertList.vue)) vs `w-[14.375rem]` ([SyntheticMonitoring](src/views/SyntheticMonitoring.vue)) vs inline `:style="{ width: 230 + 'px' }"` ([ReportList](src/components/reports/ReportList.vue)).

---

## 4. Dialogs — the one clean surface (proof the token approach works)

Every real dialog is an `ODialog` (117 usages in 87 files; raw `q-dialog` = **0**), applying all padding through `--spacing-dialog-*` tokens:

| Region | Value | Source |
|---|---|---|
| Header / content / footer | `20px / 12px` | [ODialog.vue](src/lib/overlay/Dialog/ODialog.vue) |
| Footer button gap | `gap-2` everywhere | — |
| `full` size body | `p-0` — bodies own their padding | ODialog.vue |

**Zero files override the token values.** One off-token outlier: [O2AIConfirmDialog.vue](src/components/O2AIConfirmDialog.vue) — a bespoke overlay div, not an ODialog. Dialogs prove the recipe: one lib primitive + component tokens = zero drift. Everything else drifted precisely where no primitive owns the spacing.

---

## 5. Drawers — half-owned: header/footer consistent, body a free-for-all

`ODrawer` bakes in header/footer padding (dialog tokens → 20px/12px) but **the body slot has no built-in padding** — every consumer invents its own. Across ~45 drawers:

- **9 distinct body paddings** — same "detail drawer" concept, nine densities: `p-0` · `px-1 py-2.5` · `px-2 py-2` · `p-2.5` · `p-3` · `px-4`/`p-4` · `px-4 py-2` · `p-5`/`px-5 py-4` · `px-6 py-4`.
- **19 distinct widths** — presets `sm/md/lg/xl/full` **plus 14 ad-hoc vw values** (30, 40, 45, 47, 50, 60, 65, 70, 74, 80, 85, 90, 97, 100). Nobody chose between 45 and 47 for a reason.
- **2 drawers bypass ODrawer entirely:** [ExecutionDetailDrawer.vue](src/components/synthetics/results/ExecutionDetailDrawer.vue), [IncidentDetailDrawer.vue](src/components/alerts/IncidentDetailDrawer.vue).

---

## 6. Page containers & tab panels

**Dominant (good) convention — ~19 of 29 sampled views:** no padding on the page root; `AppPageHeader` carries `px-4`; content areas manage their own inset. Deviations — a legacy 10px inset that survived the Quasar migration:

| File | Deviation |
|---|---|
| [About.vue](src/views/About.vue) | `px-2.5 pb-2.5 pt-2.5` — 10px, matches no other page |
| [OverviewTab.vue](src/views/OverviewTab.vue) | `pt-2.5 pr-3.5 pb-2.5 pl-2.5` — 10px with a 14px right edge |
| [plugins/logs/Index.vue](src/plugins/logs/Index.vue) | inner `pt-2.5 pl-2.5` — 10px top/left only |
| [MonitorRuns.vue](src/views/synthetics/MonitorRuns.vue) | header `px-2` instead of `px-4` |
| [PromQL/QueryBuilder.vue](src/views/PromQL/QueryBuilder.vue) | content `px-2.5` |

These pages read visibly tighter/odd vs the `px-4` (16px) standard.

**Tab panels:** all O2. `OTabPanel` defaults to `p-0`; 50 of 54 keep the default — consistent, because the default is 0 (panel-owner-pads, mirroring the dialog lesson).

---

# 7. The Grid-Line Alignment Standard

The rule the app should be measured against. It fixes the staircase (§1.4) and answers "which spacing, and where" for any surface.

## 7.1 The principle — one inset, full-bleed separators

1. **Content aligns to a single inset.** Every stacked block on a surface starts its content at the **same horizontal inset from the surface edge**. Pick one value per surface — header title, toolbar, search box, table's first column, section body all begin on that line. The eye should draw one straight vertical line down the left edge (and the right) and have every piece of content touch it.
2. **Separators are full-bleed.** Every divider — a header's bottom border, a toolbar border, a table row hairline, a sidebar section rule — **runs edge-to-edge of its container, touching both ends**. A divider is never inset to line up with content; align the *content*, not the rule.

Together these produce **grid lines**: content on a consistent vertical rhythm, separators as unbroken horizontals — the layout reads as a grid, not a staircase.

**The blessed page inset is `px-4` (16px)** for primary content areas (page headers, listing chrome, main panels). Narrow rails/sidebars may use a tighter inset (`px-2`/`px-3`) but must apply it consistently and still keep dividers full-bleed. Never mix insets within one visual column.

## 7.2 The defect — the staircase

Going down a CRUD listing page the **left content inset** steps down three times while the **separators** already span full width:

| Band (top → bottom) | Content inset | Class | Separator |
|---|---:|---|---|
| Page header (`AppPageHeader`) | **16px** | `px-4` | full-bleed `border-b` ✅ |
| Table toolbar / built-in search | **12px** | `px-3` | full-bleed `border-b` ✅ |
| Table column headers (`th`) | **8px** | `px-2` | full-bleed `border-b` ✅ |
| Table body cells (`td`) | **8px** | `px-2` | full-bleed row hairline ✅ |

Separators are correct (rule 2 holds) — the **content insets disagree** (rule 1 broken): 16 → 12 → 8. The title sits 8px right of the first column; the search box sits between them. Nothing lines up.

**Where the values live:**
- Header inset: `shrink-0 px-4 …` on the `PageLayout` header slot / `AppPageHeader` mount.
- Toolbar + search: `px-3 py-2` on the two toolbar `<div>`s in [OTable.vue](src/lib/core/Table/OTable.vue) (`o2-table-toolbar`, `o2-table-global-filter`).
- Cell padding: `px-2` (default) / `px-1` (compactPadding) / `px-0` (spacer) in [OTableBodyCell.vue](src/lib/core/Table/sub-components/OTableBodyCell.vue) and `headerPaddingClass()` in [OTableHeader.vue](src/lib/core/Table/sub-components/OTableHeader.vue).

## 7.3 The fix — how a CRUD page should align

Make every band share the **16px** page inset while keeping every separator full-bleed:

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

How:
- **Toolbar & search:** `px-3` → **`px-4`**.
- **Table content inset without insetting the hairlines:** keep interior cells at `px-2` (so the inter-column gutter stays a consistent 16px = 8+8), but give the **first visible cell** a left inset reaching 16px and the **last visible cell** a right inset reaching 16px. The row hairline (`border-b` on each `td`) still spans the full table width, so dividers stay full-bleed while content aligns to the page inset. "First/last visible cell" must account for the selection-checkbox / expand / drag / pinned columns — whichever cell is physically first/last gets the inset, not necessarily the first *data* column.
- **Do not** add horizontal padding to a wrapper `<div>` around the `<table>` — that insets the whole table including the hairlines, breaking rule 2. The inset lives on the cells; the borders stay on the full-width table.

## 7.4 The fix — how a sidebar / rail should align

Folder rails (Dashboards, Alerts, Reports, IAM, Settings) and the logs field list are vertical stacks of sections. Same two rules, tuned for a narrow column:

- **One rail width.** Pick a single token/value for the ~230px folder rail; today it's set three ways (§3).
- **Equal content inset on all four sides.** Every section's content (header row, search box, list rows) sits at the same horizontal inset from the rail edges, and each section gets **equal top and bottom padding** so the stack breathes evenly — not `p-2` on one section and `py-2.5 pb-[0.3rem]` on the next.
- **Section separators are full-bleed.** A rule between the header/search zone and the scrollable list, and the rail's own right border, **touch the rail edges** — not inset to match the content.

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

## 7.5 Blessed spacing scale (and guard it)

**Allowed steps:** `0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12` (× 0.25rem) + layout sizes (`14, 16, 20, 24…` for widths/heights, not gaps).

**Banned (the survivors to snap):** `1.25` (167 uses), `1.75`, `2.25`, `2.75`, `3.25`, `3.75`, `4.25`, `4.5`, `5.25`, `5.5`, `5.75`, `7.5`, `8.5`, and all 211 arbitrary brackets (§1b).

**Guard:** add a `spacing` category to `web/scripts/check-design-consistency.mjs` that counts (a) arbitrary spacing brackets and (b) non-blessed numeric steps, baseline the current totals, and ratchet monotonically down — the same mechanism the color/radius/shadow ratchets use. Wire it into the per-PR `lint:design` gate so no PR can add a new off-scale spacing value.

---

# 8. Which spacing, where — the authoring guide

The lookup table for building or reviewing UI. All values are the blessed steps from §7.5.

## 8.1 Per-surface reference

| Surface | Horizontal content inset | Vertical rhythm | Separators | Owned by |
|---|---|---|---|---|
| **Page header** | `px-4` (16px) | fixed `h-15` band | full-bleed `border-b border-border-default` | `AppPageHeader` — never restyle from outside |
| **Page root** | *none* — root has no padding | `flex flex-col h-full min-h-0` | — | the view |
| **CRUD table toolbar / search** | `px-4` (16px) — align to header | `py-2` | full-bleed `border-b` | `OTable` |
| **CRUD table cells** | first/last cell reach 16px; interior `px-2` (16px gutter) | row height var | full-bleed row hairline | `OTable` — pages never override cell padding |
| **Sidebar / folder rail** | one consistent inset (`px-2`/`px-3`), equal 4 sides | equal `py-2` per section | full-bleed section rule + rail `border-r` | the rail component |
| **Dialog** | token 20px / 12px | form `gap-5` | token-owned (do not override) | `ODialog` |
| **Drawer body** | one owned padding — **propose `p-4`** (16px) default | form `gap-5` | header/footer token-owned | `ODrawer` (needs a `padding` prop — §9) |
| **Validated form** | — | **`gap-5`** on `<OForm>` (house rule) | — | `OForm` |
| **Card / section content** | `p-4` (16px) typical; `p-3` dense | `flex flex-col gap-4` | full-bleed if the card is edge-to-edge | the component |

## 8.2 Vertical rhythm — stop the `mb-*` chains

The biggest "every page stacks differently" cause is spacing stacked blocks with per-element `mb-1/2/3/4` chosen by feel. Fix:

- **Space a stack with `flex flex-col gap-*` on the container, not `mb-*`/`mt-*` on each child.** One decision (the gap) instead of N.
- Blessed vertical steps: **`gap-2`** (8px, tight/related) · **`gap-4`** (16px, default between sections) · **`gap-6`** (24px, major group). Forms use **`gap-5`** (20px) per the house rule.
- Reserve `mt-*`/`mb-*` for a genuine one-off nudge, not the primary rhythm of a list of blocks.

## 8.3 The three questions to ask when spacing anything new

1. **What inset does this surface already use?** Match it. On a main content area that's `px-4` (16px). Don't introduce a fourth value.
2. **Is this line a separator?** If yes, make it full-bleed — span the container, touch both ends. Align the *content*, not the rule.
3. **Is this a scale step?** Only `0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12`. If your value isn't one of these, you're eyeballing — snap to the nearest.

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

**Validated form** — the gap is on `OForm`, not each field:
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

# 9. What to fix (ordered by leverage)

| # | Work | Risk |
|---|---|---|
| 1 | **Snap the off-grid values** (§1b): the ~211 arbitrary brackets + the non-blessed steps (`px-1.25`×167, `2.25`, `4.5`, `5.5`…) → the blessed scale; 27 px CSS decls → rem | low — 1–2px shifts, visual spot-check |
| 2 | **Guard the scale** (§7.5): add the `spacing` ratchet to `check-design-consistency.mjs`, wired into the per-PR `lint:design` gate | low |
| 3 | **Grid-line alignment — the primitives** (§7.3–§7.4): OTable toolbar/search `px-3`→`px-4`; first/last cell content reaches 16px with hairlines staying full-bleed; give ODrawer a `padding` prop (default `p-4`) and migrate the 9 body-padding variants; collapse the 14 ad-hoc drawer widths onto presets; rewrite the 2 hand-rolled drawers onto ODrawer | medium — visible (intended) shifts, needs visual QA |
| 4 | **Standardize page chrome** (§3, §6): one root recipe (`flex flex-col h-full min-h-0`, drop the 16 `p-0` no-ops); canonical header string enforced (FunctionList / EnrichmentTableList / SyntheticMonitoring / MonitorRuns); add AppPageHeader to PipelinesList; migrate the 10px-inset pages (About, OverviewTab, logs/Index) to `px-4`; one sidebar-width token (fix ReportList's inline `230px`) | medium — visible (intended) |
| 5 | **Vertical rhythm + forms** (§8.2): `flex flex-col gap-*` over `mb-*` chains; `gap-5` on OForm; apply opportunistically on touched files, enforce for new code via review/ratchet | low per-file |
| 6 | **Reconcile the token layer** (§2): either register the blessed steps as real `--spacing-*` `@theme` tokens (so `p-3` resolves from project tokens) or delete the dead `:root` scale and document "Tailwind grid is the scale" — currently it's half of each | low |

**Model to copy:** §4 dialogs — a single lib primitive owning all chrome spacing via component tokens produced zero drift across 87 files without any enforcement. Drawer body, page chrome, and forms drift exactly where no primitive owns the spacing.

---

Regenerate the §1 numbers: `bash web/scripts/spacing-audit.sh` (needs ripgrep + python3; writes per-category lists to `/tmp/spacing_audit_*.txt`).
