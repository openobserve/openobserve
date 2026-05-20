# Traces Page — Quasar Removal Audit

## Summary

The Traces page is structurally migrated to the custom O* component library
and the Tailwind `tw:` prefix system, but several **runtime-breaking** and
**visually broken** issues remain. The most severe class are:

1. **All Traces spec files still `import * as quasar from "quasar"`** — quasar
   has been deleted from `web/package.json`, so every Traces unit test file
   will fail at module resolution. 13 spec files affected.
2. **Invalid Tailwind arbitrary values containing whitespace** at the top of
   `Index.vue` (the very root of `<AppTraces>` -> `plugins/traces/Index.vue`):
   `tw:min-h-[calc(100vh - var(--navbar-height))]!` and
   `tw:max-h-[calc(100vh - var(--navbar-height))]!`. Tailwind's CSS-class
   scanner rejects arbitrary values that contain whitespace; the height
   constraints will not be generated at all, causing the page to overflow the
   viewport.
3. **Duplicate and conflicting Tailwind classes** that change layout in
   `SearchBar.vue` toolbar (`tw:flex tw:flex-col tw:flex`) — the second `flex`
   is harmless but `flex-col` makes the toolbar render vertically inside a
   row, mis-aligning all toggle groups and the action buttons.
4. **Broken Tailwind state variant syntax** in `SessionDetails.vue`:
   `tw:hover:text-...` / `tw:hover:opacity-100` (5 occurrences) — should be
   `hover:tw:...`. As-is, the hover states never apply.
5. **Several stale Quasar utility classes** remain (`full-height`,
   `relative-position`, `position-relative`, `flex-center`, `text-primary`,
   `text-red-6`, `column`, `col-auto`, `bg-grey-2`, `bg-dark`, `bg-white`,
   `bg-primary`, `text-white`, `text-subtitle1`, `pointer`, `o2-quasar-table`).
   Without Quasar's `quasar.scss`, none of these are defined; layouts that
   depended on them (e.g. column flex direction, centered loaders, header
   backgrounds, error icon coloring) will render incorrectly.
6. **Dead `.q-*` CSS selectors** throughout SCSS blocks — components now
   render new DOM but the `:deep()` / global selectors still target Quasar
   class names that no longer exist in the rendered tree (`.q-icon`,
   `.q-field__*`, `.q-table__*`, `.q-splitter__*`, `.q-toggle__*`,
   `.q-btn__*`, `.q-tab*`, `.q-card`, etc.). Some were renamed to `.OIcon`,
   but the `OIcon` component does not render an element with that class.

Roughly **65 files** were diffed; the majority of changes are mechanical
component renames. The biggest functional risk centers on
`Index.vue`, `SearchBar.vue`, `TraceDetails.vue`, `TraceDetailsSidebar.vue`,
`IndexList.vue`, `ServiceGraph.vue`, and the **specs** which are now
universally broken.

## Files Audited

Working dir: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp`

- `web/src/views/AppTraces.vue` (unchanged in diff)
- `web/src/plugins/traces/Index.vue` (+120 lines)
- `web/src/plugins/traces/IndexList.vue` (+705/-…, heavily rewritten)
- `web/src/plugins/traces/SearchBar.vue` (+192/-…)
- `web/src/plugins/traces/SearchResult.vue`
- `web/src/plugins/traces/TraceDetails.vue` (~339 lines changed)
- `web/src/plugins/traces/TraceDetailsSidebar.vue` (~604 lines changed)
- `web/src/plugins/traces/TraceHeader.vue`
- `web/src/plugins/traces/TraceTree.vue`
- `web/src/plugins/traces/SpanBlock.vue`, `SpanRenderer.vue`
- `web/src/plugins/traces/SyntaxGuide.vue`
- `web/src/plugins/traces/ThreadView.vue`
- `web/src/plugins/traces/TraceDAG.vue`, `TraceEvaluationsView.vue`
- `web/src/plugins/traces/DbSpanDetails.vue`
- `web/src/plugins/traces/ServiceGraph.vue` (+161/-…)
- `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue` (+470/-…)
- `web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue`
- `web/src/plugins/traces/ServicesCatalog.vue`
- `web/src/plugins/traces/SessionsList.vue` (new, +548)
- `web/src/plugins/traces/SessionDetails.vue` (new, +1227)
- `web/src/plugins/traces/LLMContentRenderer.vue`,
  `LLMInsightsDashboard.vue`, `LLMInsightsSkeleton.vue`, `LLMTrendPanel.vue`,
  `KpiSparkline.vue`
- `web/src/plugins/traces/metrics/TracesAnalysisDashboard.vue`,
  `TracesMetricsContextMenu.vue`, `TracesMetricsDashboard.vue`
- `web/src/plugins/traces/components/TraceErrorTab.vue`,
  `TraceLatencyCell.vue`, `TraceServiceCell.vue`, `TraceStatusCell.vue`,
  `TraceTimestampCell.vue`, `TracesSearchResultList.vue`,
  `SpanKindBadge.vue`, `SpanStatusCodeBadge.vue`, `SpanStatusPill.vue`
- `web/src/components/traces/FlameGraphView.vue`
- `web/src/plugins/traces/composables/useLLMInsights.ts`,
  `useLLMStreamQuery.ts`, `useSessions.ts` (new),
  `useTracesTableColumns.ts`
- `web/src/plugins/traces/llmInsightsDashboard.utils.ts`,
  `llmTrendPanel.utils.ts`, `threadView.utils.ts`,
  `traceDetails.utils.ts`, `tracesIndex.utils.ts`,
  `tracesSearchBar.utils.ts`
- `web/src/plugins/traces/fields-sidebar/BasicValuesFilter.vue` (deleted,
  replaced inline in `IndexList.vue`)
- All 13+ `*.spec.ts` files in `web/src/plugins/traces/*` (broken — see
  below)

## Critical Issues

### C1. Tailwind arbitrary values with whitespace — page height broken
**File:** `web/src/plugins/traces/Index.vue:19`
```
class="tw:rounded-md tracePage tw:h-[calc(100vh-var(--navbar-height))] tw:min-h-[calc(100vh - var(--navbar-height))]! tw:max-h-[calc(100vh - var(--navbar-height))]! tw:overflow-hidden!"
```
The first `tw:h-[calc(100vh-var(--navbar-height))]` (no spaces) is valid. The
following `tw:min-h-[…]` and `tw:max-h-[…]` contain spaces inside the
arbitrary value — Tailwind ignores these tokens. The page no longer pins
its height, allowing overflow into the navbar/scroll area. `overflow-hidden`
without the height pin also breaks inner scrolling.

**Solution:**
```diff
- class="... tw:min-h-[calc(100vh - var(--navbar-height))]! tw:max-h-[calc(100vh - var(--navbar-height))]! ..."
+ class="... tw:min-h-[calc(100vh-var(--navbar-height))]! tw:max-h-[calc(100vh-var(--navbar-height))]! ..."
```
Remove the spaces around the `-` operator inside `calc(...)` — Tailwind's class scanner requires no whitespace in arbitrary values.

### C2. Quasar imports in spec files — all unit tests blow up
13 Traces spec files still contain `import * as quasar from "quasar"` and
`vi.mock("quasar", ...)` even though `quasar` was removed from
`web/package.json` (see commit `1c38131b25 "fix: removed quasar dependencies"`).
Affected:

- `IndexList.spec.ts:19`
- `Index.spec.ts:20`
- `TraceDetails.spec.ts:19`
- `TraceDetails.all-missing-fields.spec.ts:19`
- `TraceDetails.missing-span-kind.spec.ts:19`
- `TraceHeader.spec.ts:19`
- `TraceTree.spec.ts:61`
- `TraceDetailsSidebar.spec.ts:28`
- `SearchBar.spec.ts:20`
- `SearchResult.spec.ts:26`
- `SessionDetails.spec.ts:92`
- `SessionsList.spec.ts:115`
- `ServiceGraphNodeSidePanel.spec.ts:19`

Some specs additionally call `vi.importActual("quasar")` (e.g.
`IndexList.spec.ts:116`, `SearchBar.spec.ts`) which will throw at runtime.

Several specs also import the no-op shim `installQuasar` from
`@/test/unit/helpers/install-quasar-plugin` — that file itself notes "REMOVE
THIS FILE when unit tests are rewritten." The Traces tests were never
rewritten.

**Solution:**
```diff
- import * as quasar from "quasar";
- vi.mock("quasar", async () => {
-   const actual = await vi.importActual("quasar");
-   return { ...actual, useQuasar: () => ({ notify: vi.fn() }) };
- });
+ // Remove both lines — Quasar is no longer installed.
+ // If the component calls toast(), mock it instead:
+ const toast = vi.fn();
+ vi.mock("@/composables/useToast", () => ({ useToast: () => ({ toast }) }));
```
Apply across all 13 listed spec files.

### C3. Broken Tailwind state variants in `SessionDetails.vue` — hover never fires
**File:** `web/src/plugins/traces/SessionDetails.vue`
- Line 148: `tw:cursor-pointer tw:hover:text-[var(--o2-text-primary)]`
- Line 354: `tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100`
- Line 382: same pattern
- Line 551: same pattern
- Line 576: same pattern

Tailwind state syntax with a custom prefix is `hover:tw:bar` (see other
files like `TraceDetails.vue:76`, `TraceDetailsSidebar.vue:528`). The five
`tw:hover:` occurrences silently produce no CSS rule.

**Solution:** Note — with Tailwind v4 `prefix(tw)`, the **correct** order is actually `tw:hover:foo` (per the Critical Issues fixes in the alerts/dashboards reports and the rest of this repo's recent fixes). Verify against `web/src/styles/tailwind.css:1`. If the file uses `@import "tailwindcss" prefix(tw);`, then `tw:hover:bg-x` is correct. The five SessionDetails occurrences below are likely **already correct**:
```vue
tw:cursor-pointer tw:hover:text-[var(--o2-text-primary)]
tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100
```
If TraceDetails.vue:76 and TraceDetailsSidebar.vue:528 use `hover:tw:foo` form, **those are wrong** in v4 — change them to `tw:hover:foo`. Re-audit the entire repo on whichever convention `tailwind.css` actually expects (one regex fix one way or the other).

### C4. Conflicting/duplicate `flex` classes in `SearchBar.vue` — toolbar misaligns
**File:** `web/src/plugins/traces/SearchBar.vue:20`
```
<div class="float-right tw:flex tw:flex-col tw:flex tw:items-center tw:gap-[0.375rem]">
```
The previous Quasar markup was `flex items-center` (a horizontal row). The
migration added `tw:flex-col`, turning the entire top toolbar into a
vertical stack of toggle groups, switches and buttons. Also note the
duplicate `tw:flex tw:flex-col tw:flex`.

Additional duplicate `tw:flex tw:flex` in:
- `web/src/plugins/traces/components/TraceErrorTab.vue:154`
- `web/src/plugins/traces/TraceHeader.vue:29` (`tw:flex … tw:flex tw:px-2`)
- `web/src/plugins/traces/TraceHeader.vue:45` (`tw:flex … tw:flex relative-position`)

**Solution:**
```diff
- <div class="float-right tw:flex tw:flex-col tw:flex tw:items-center tw:gap-[0.375rem]">
+ <div class="tw:flex tw:items-center tw:justify-end tw:gap-[0.375rem]">
```
Remove `float-right`, `tw:flex-col`, and the duplicate `tw:flex` at SearchBar.vue:20. In TraceErrorTab.vue:154 and TraceHeader.vue:29/45, dedupe by deleting the second `tw:flex` token.

### C5. `outlinedAccountTree` and other Quasar icon aliases removed but still referenced
**File:** `web/src/plugins/traces/TraceDetails.vue:2818`
```ts
"info": "info",
outlinedPlayCircle: "play-circle",
```
Dead aliases returned from `setup()`. Not crashing but smells of incomplete
cleanup — confirms search/replace didn't cover everything.

**File:** `web/src/plugins/traces/SearchBar.vue` line ~1004 of new file
removed `outlinedAccountTree` from return, but the `@quasar/extras` import
was deleted; verify no other file imports it.

**Solution:**
```diff
- "info": "info",
- outlinedPlayCircle: "play-circle",
```
Delete the dead alias lines from the `setup()` return at TraceDetails.vue:2817-2818. Template binds `<OIcon name="info">` and `<OIcon name="play-circle">` directly; no alias is needed.

## Logical Issues

### L1. `filterStreamFn` / `streamSearchValue` dead in `TraceDetails.vue`
**File:** `web/src/plugins/traces/TraceDetails.vue`
The Quasar `<q-select>` template that contained the `no-option` and
`before-options` slots (which used `filterStreamFn`) was replaced with a
plain `<OSelect>` (lines 376–383). But the supporting state
`streamSearchValue` (line 1052), `filterStreamFn` (line 2522), and
`filteredStreamOptions` setup remains and is still returned from
`setup()` (2824–2826). The log-stream search/filter UX inside Trace
Details is lost — users can no longer filter the log streams list in
that drawer.

**Solution:** Either (a) restore typeahead via OSelect's `v-model:search`:
```vue
<OSelect
  v-model="selectedStream"
  v-model:search="streamSearchValue"
  :options="filteredStreamOptions"
  searchable
/>
```
Or (b) delete the dead supporting state at lines 1052, 2522, and 2824-2826 if log-stream typeahead is no longer required.

### L2. `filterStreamFn` dead in `IndexList.vue`
**File:** `web/src/plugins/traces/IndexList.vue:265`
Function defined but the template now uses `onStreamSearch` exclusively
(line 30). Returned from `setup()` at line 583 but never consumed.

**Solution:** Delete the `filterStreamFn` function (line 265) and its export at line 583.

### L3. OSelect search behavior probably regressed in IndexList
**File:** `web/src/plugins/traces/IndexList.vue:23–40`
The old `<q-select>` had `use-input hide-selected fill-input
input-debounce="0" behavior="menu"`. Migration to `<OSelect>` dropped all
search-input UX configuration. Validate that the OSelect default supports
free-text search and that the label binding (`searchObj.data.stream.selectedStream?.label`)
still drives the visible value — previously `v-model` bound the entire
object; now only `value` is bound and the label is reconstructed
manually via `onStreamChange()`.

**Solution:**
```vue
<OSelect
  v-model="searchObj.data.stream.selectedStream"
  :options="streamOptions"
  searchable
  hide-selected
  @update:search="onStreamSearch"
/>
```
Restore `searchable` and `hide-selected`, bind the entire object as `v-model`, and emit search via `@update:search`.

### L4. Stream-filter search slot dropped on Service Graph
**File:** `web/src/plugins/traces/ServiceGraph.vue:8–24`
The `<q-tooltip v-if="...">` inside the old `<q-select>` was hoisted out and
made a sibling of the OSelect (`<OTooltip v-if="availableStreams.length === 0" />`).
Per OTooltip's child-mode logic (attaches listeners to `parentElement`),
the tooltip will now anchor to the wrapping `<div data-test="service-graph-stream-selector">`
— not the dropdown trigger. Hover-target probably still works but
positioning may be off.

**Solution:**
```vue
<OSelect ...>
  <template #trigger="{ open }">
    <span ref="triggerEl">
      {{ selectedStream }}
      <OTooltip v-if="!availableStreams.length" content="No streams available" />
    </span>
  </template>
</OSelect>
```
Nest the OTooltip inside the OSelect trigger slot so it anchors to the actual trigger element.

### L5. ServiceGraphNodeSidePanel — drawer slot indentation hints at mid-refactor state
**File:** `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:57–555`
The conversion from `<transition><div ...>` to `<ODrawer>` leaves the
inner content at the old indentation (mismatched 6-space vs 4-space
nesting). Vue still parses it but it suggests a hasty edit. The
`<!-- Content Scrollable Area -->` is outside any explicit named slot,
so it falls into the default slot; combined with `<template #header-right>`,
this is correct, but worth re-checking that `<TelemetryCorrelationDashboard>`
at line 559 is intentionally a sibling root of `<ODrawer>`.

**Solution:** Run a Prettier/IDE-format pass on the file to normalize indentation. If `<TelemetryCorrelationDashboard>` should be portaled inside the drawer, wrap it inside the default slot:
```vue
<ODrawer ...>
  <template #header-right>...</template>
  <div class="content-area">...</div>
  <TelemetryCorrelationDashboard />
</ODrawer>
```

### L6. `position-relative`/`relative-position` references stale CSS class
**Files:**
- `web/src/plugins/traces/Index.vue:130` (`relative-position`)
- `web/src/plugins/traces/SpanRenderer.vue:20`
- `web/src/plugins/traces/TraceTree.vue:122`, `TraceHeader.vue:45`
- `web/src/plugins/traces/TraceDetails.vue:452`, `461` (`position-relative`)
- `web/src/plugins/traces/SpanBlock.vue:31, 48` (one uses `relative-position`, the other `position-relative`)
- `web/src/plugins/traces/metrics/TracesAnalysisDashboard.vue:130, 237`

These were Quasar global utility classes. The plain Tailwind equivalent is
`tw:relative`. Elements that relied on these for `position: relative`
will now compute to `position: static`, which breaks absolute-positioned
children (resize handle, tooltips, indicator overlays).

**Solution:**
```diff
- class="... relative-position ..."
+ class="... tw:relative ..."

- class="... position-relative ..."
+ class="... tw:relative ..."
```
Run a regex `\b(relative-position|position-relative)\b` → `tw:relative` across all 9 listed files.

### L7. `text-red-6`, `bg-dark`, `bg-white` etc on TraceTree spans / SpanBlock
**Files:**
- `web/src/plugins/traces/TraceTree.vue:124` (`'bg-dark' : 'bg-white'`)
- `web/src/plugins/traces/TraceTree.vue:220` (`text-red-6`)
- `web/src/plugins/traces/SpanBlock.vue:22, 32`
- `web/src/plugins/traces/TraceHeader.vue:37` (`bg-primary text-white`),
  line 84 (`bg-dark-tic`)

`bg-dark`/`bg-white`/`bg-primary`/`text-white`/`text-red-6` were Quasar
global classes. They no longer exist; row backgrounds and the error-span
icon color in the waterfall will fall back to inherited colors.

**Solution:**
```diff
- :class="isDark ? 'bg-dark' : 'bg-white'"
+ :class="isDark ? 'tw:bg-[var(--o2-bg-base)]' : 'tw:bg-white'"

- class="text-red-6"
+ class="tw:text-red-600"

- class="bg-primary text-white"
+ class="tw:bg-[var(--o2-primary)] tw:text-white"

- class="bg-dark-tic"
+ class="tw:bg-[var(--o2-bg-elevated)]"
```

## CSS / Layout Issues

### CSS1. Stale `.q-*` SCSS selectors targeting non-existent DOM
The following SCSS blocks reference Quasar class names that the new O*
components do not render. Net effect: dead CSS, plus the visual styles
those blocks were supposed to apply are lost.

- `web/src/plugins/traces/Index.vue:2314–2353` — `.q-field__native`,
  `.q-field__input`, `.q-table tbody td`, `.q-table__top`,
  `.q-table__control`, `.q-field__control-container`
- `web/src/plugins/traces/IndexList.vue:625, 665, 666, 743, 744` — `.q-field`,
  `.q-field__control`, `.q-table__control`, `.q-field--dense .q-field__before`,
  `label.q-field`
- `web/src/plugins/traces/IndexList.vue:714, 794` — `.OIcon { … }` (this
  selector was a renamed-but-still-wrong attempt; OIcon's root element
  has class `tw:inline-flex tw:shrink-0 …`, not `OIcon`).
- `web/src/plugins/traces/SearchBar.vue:1063, 1067, 1077, 1087, 1090, 1102,
  1108, 1164, 1169, 1201` — `.q-toggle__inner`, `.q-toggle__label`,
  `.q-field`, `.q-btn-group`, `.q-btn`, `.q-btn-dropdown__arrow-container`,
  `.q-btn__content`, plus two `.OIcon` selectors (same issue as IndexList).
- `web/src/plugins/traces/TraceDetails.vue:3000–3415` — large CSS blocks
  styling `.q-field`, `.q-splitter__before/after`, `.q-field__control`,
  `.q-field__inner`, `.q-field__bottom`, `.q-field__append`,
  `.q-btn__content`, `.q-field--dark`. None apply anymore.
- `web/src/plugins/traces/TraceDetailsSidebar.vue:2041, 2051, 2055, 2145,
  2162, 2173, 2182, 2192–2216, 2732–2750` — `.q-btn`,
  `.q-splitter--vertical .q-splitter__separator`, `.q-card`,
  `.q-table`, `.q-table th.sortable`, `.q-table-col-close`,
  `.q-table__top/bottom`, `.q-td`, `.q-tab__indicator`,
  `.q-tab--active`, `.q-tab-panel`, `.q-btn__content`
- `web/src/plugins/traces/SessionsList.vue:539, 544` —
  `:deep(.paginator-section .q-btn)`, `:deep(.select-pagination .q-field__control)`
- `web/src/plugins/traces/ServiceGraph.vue:1533, 1728, 1729` —
  `:global(.sg-legend-tooltip.q-tooltip)`,
  `.body--dark [data-test="…"] .q-field`

**Solution:** Delete every `:deep(.q-*)` / `:global(.q-tooltip)` block listed above. Replace `.body--dark` with `html.dark` (the post-Quasar dark mode class). For the few rules that imparted real styling, retarget the OIcon/OSelect/OTable/OPagination internals:
```diff
- .OIcon { color: red; }
+ // OIcon root has no .OIcon class — pass <OIcon class="tw:text-red-500" /> instead

- .body--dark [data-test="..."] .q-field { background: #000; }
+ html.dark [data-test="..."] :deep(input) { background: var(--o2-bg-base); }

- :deep(.q-tooltip) { z-index: 9999; }
+ // OTooltip ships its own z-index; override via the O*-tokens or pass class prop.
```

### CSS2. `var(--q-primary)` / `var(--q-negative)` CSS variables
Quasar's CSS theming exposes `--q-primary` and `--q-negative`. With Quasar
removed, the runtime no longer sets these custom properties.

- `web/src/plugins/traces/LLMContentRenderer.vue:757` — `color: var(--q-primary);`
- `web/src/plugins/traces/LLMTrendPanel.vue:185` — `tw:text-[var(--q-primary)]`
- `web/src/plugins/traces/TraceDetails.vue:3432, 3433` — `color: var(--q-primary) !important; border-color: var(--q-primary) !important;`
- `web/src/plugins/traces/TraceDetailsSidebar.vue:2736` — `border-bottom: 1px solid var(--q-primary);`
- `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:289, 437, 2818` —
  `tw:text-[var(--q-negative)] tw:font-semibold` / `color: var(--q-negative);`

Once Quasar is gone, these declarations resolve to the initial value
(invalid → previously inherited / black), so accent colors disappear or
fall back to defaults. Replace with `var(--o2-primary)` / `var(--o2-status-error-text)`
or equivalent design tokens.

**Solution:**
```diff
- color: var(--q-primary);
+ color: var(--o2-primary);

- tw:text-[var(--q-primary)]
+ tw:text-[var(--o2-primary)]

- color: var(--q-negative);
+ color: var(--o2-negative);

- tw:text-[var(--q-negative)]
+ tw:text-[var(--o2-negative)]
```
Apply across all 7 listed locations.

### CSS3. `text-primary` raw class still in `SyntaxGuide.vue`
Lines 75 and 131: `class="hover:tw:underline text-primary"`. Without
Quasar, `text-primary` no longer colors the syntax-guide link example
strings. Replace with `tw:text-[var(--o2-theme-color)]` or similar.

**Solution:**
```diff
- class="hover:tw:underline text-primary"
+ class="tw:hover:underline tw:text-[var(--o2-primary)]"
```
Replace at lines 75 and 131.

### CSS4. `column` / `flex column` / `flex-center` / `full-height` / `full-width` classes
- `web/src/plugins/traces/Index.vue:23, 26` — `full-height` on the
  `<OSplitter>` ancestor. Without Quasar's global `.full-height`,
  the splitter never inherits `height: 100%`, so the after-slot
  becomes content-height and the tabbed content collapses.
- `web/src/plugins/traces/ServiceGraph.vue:165, 175, 195` —
  `tw:flex flex-center …`. `flex-center` is Quasar; the centered
  loading/error/empty states no longer center horizontally.
- `web/src/plugins/traces/TraceDetails.vue:761` —
  `class="tw:flex column tw:items-center tw:justify-center"`. The bare
  `column` (Quasar) was meant to be `tw:flex-col`. The loading spinner
  + label that show while a trace is fetched will render horizontally
  instead of stacked.
- `web/src/plugins/traces/components/TraceErrorTab.vue` originally used
  `full-width`; was migrated correctly to `tw:w-full`. Good.

**Solution:**
```diff
- class="full-height ..."
+ class="tw:h-full ..."

- class="tw:flex flex-center ..."
+ class="tw:flex tw:items-center tw:justify-center ..."

- class="tw:flex column tw:items-center tw:justify-center"
+ class="tw:flex tw:flex-col tw:items-center tw:justify-center"
```
Apply at Index.vue:23/26, ServiceGraph.vue:165/175/195, TraceDetails.vue:761.

### CSS5. Quasar grid `col-auto` left in `SearchBar.vue`
Lines 313 and 376: `class="float-right col-auto o2-input-full"`. Quasar's
`col-auto` shrinks a flex item to content width. Without it the
elements expand to fill their parent, pushing the action buttons (run
query, export, share) off-screen on narrow viewports.

**Solution:**
```diff
- class="float-right col-auto o2-input-full"
+ class="tw:flex-none tw:ml-auto o2-input-full"
```
At lines 313 and 376.

### CSS6. `o2-quasar-table` class survived in `TraceErrorTab.vue`
Line 151ish: `class="o2-quasar-table trace-detail-tab-table o2-row-sm o2-schema-table …"`.
The Quasar table is gone but this leftover class is used by some global
`o2-quasar-table` CSS that styles QTables specifically. Either remove
the class or convert the CSS to target the new `<OTable>` markup.

**Solution:**
```diff
- class="o2-quasar-table trace-detail-tab-table o2-row-sm o2-schema-table …"
+ class="trace-detail-tab-table o2-row-sm o2-schema-table …"
```
Drop the `o2-quasar-table` class and (separately, in `web/src/styles/app.scss`) rename the selector to target OTable's new DOM.

### CSS7. `style="min-height: auto"` inline override on root
`web/src/plugins/traces/Index.vue:21`. Combined with C1 above this
forces `min-height: auto`, deliberately defeating any height
constraint. Old layout achieved height through `q-page` + parent
layout; with both removed the page may collapse to its content
height.

**Solution:**
```diff
- <div ... style="min-height: auto">
+ <div ...>
```
Delete the inline `style="min-height: auto"` once the C1 Tailwind class fix lands.

## Component Migration Issues

### CM1. `OIcon` `name` prop renames — verify every icon name exists in `OIcon.icons`
The migration mapped Material icon names (`arrow_back`, `arrow_drop_down`,
`content_copy`, `error_outline`, `sync_disabled`, `expand_more`,
`open_in_new`, `restart_alt`, `keyboard_arrow_up`, `keyboard_arrow_down`,
`drag_indicator`, `play_circle`, `table_chart`, `auto_awesome`,
`access_time`, `align_left`, `assignment_turned_in`, `account_tree`,
`filter_alt`, `menu_book`, `git_branch`, `git-branch`, `flame`, etc.) by
swapping `_` for `-`. Some are non-standard Material names invented for
this migration (e.g. `flame`, `forum`, `bolt`, `payments`, `hub`,
`schedule`, `speed`, `replay`, `build`, `auto-awesome`, `assignment-turned-in`,
`menu-book`, `account-tree`, `git-branch`, `share`, `chat`, `align-left`).
These must exist in the `iconRegistry` at
`web/src/lib/core/Icon/OIcon.icons.ts`. Any miss renders nothing (no
fallback). High-traffic icons to verify:
- `OIcon name="account-tree"` (TraceDetails:264 + SearchBar:42, 53)
- `OIcon name="align-left"` (TraceDetails:246)
- `OIcon name="auto-awesome"` (SearchBar:105, ThreadView)
- `OIcon name="assignment-turned-in"` (TraceDetails:295)
- `OIcon name="menu-book"` (SearchBar:63)
- `OIcon name="git-branch"` (TraceDetails, SearchBar)
- `OIcon name="flame"` (TraceDetails:251) — was Lucide `Flame`
- `OIcon name="hub"`, `OIcon name="bolt"`, `OIcon name="speed"`,
  `OIcon name="payments"`, `OIcon name="build"`, `OIcon name="forum"`

**Solution:** Verified all listed icons exist in `web/src/lib/core/Icon/OIcon.icons.ts`:
- `block` (305), `cancel` (310), `check-circle` (314), `content-copy` (322), `expand-more` (329), `info` (337), `info-outline` (338), `account-tree` (339), `warning` (376), `menu-book` (455), `flame` (403), `bolt` (306), `replay` (364), `schedule` (365), `align-left` (386), `assignment-turned-in` (388), `auto-awesome` (389), `build` (392), `chat` (394), `git-branch` (402), `speed` (443).

No changes needed for these. For any future icon, add to the registry:
```ts
import MyIcon from "~icons/material-symbols/my-icon-outline";
// iconRegistry:
"my-icon": MyIcon,
```

### CM2. `OTooltip` content prop without slot — confirm child-mode coverage
The codebase relies on `OTooltip`'s child-mode (no default slot → attach
to `parentElement`). This works only when:
1. `OTooltip` has at least one sibling that is the visible element.
2. The parent element has a positioned context.

Audit several places where the surrounding parent is itself an `<OButton>`
that may render multiple wrapping elements internally:
- `SearchBar.vue:134` (parent is `<div class="toolbar-toggle-container …">`).
- `SearchBar.vue:143, 161, 207, 226, 269` (parents are `<OButton>`).
- `TraceDetails.vue:45, 64, 154, 167, 184, 197, 215` (mostly `<OButton>`/`<span>`).
- `ServiceGraph.vue:24` — sibling of `<OSelect>` not yet rendered, parent
  is the wrapper `<div class="…stream-selector">`; only works if the
  user hovers the wrapper, not the dropdown trigger.

**Solution:** Wrap each tooltip + trigger in an explicit `<span class="tw:relative">`:
```vue
<span class="tw:relative tw:inline-flex">
  <OButton @click="...">
    <OIcon name="search" />
  </OButton>
  <OTooltip content="Run query" />
</span>
```
This guarantees the OTooltip's `parentElement` is the visible button wrapper and provides a positioned ancestor for the floating element.

### CM3. `q-chip` → `OBadge` size mapping
`q-chip dense square` (a 24px height, square-cornered chip) became
`OBadge size="sm"` everywhere. Verify the badge component actually
matches: in `TraceDetailsSidebar.vue` the badges are the toolbar pills
(Service / Duration / TTFT / Start / Resends / Span ID). If `OBadge
size="sm"` is rounded by default, the row will look noticeably different.

**Solution:**
```diff
- <OBadge size="sm">{{ value }}</OBadge>
+ <OBadge size="sm" class="tw:rounded-sm">{{ value }}</OBadge>
```
Or extend OBadge with a `square` prop to mirror the old `q-chip square` look.

### CM4. `q-pagination` → `OPagination` — lost configuration
**File:** `web/src/plugins/traces/SearchResult.vue:80–101`
Old:
```html
<q-pagination
  :input="false"
  direction-links
  :boundary-numbers="false"
  :max-pages="5"
  :ellipses="false"
  icon-first="skip_previous"
  icon-last="skip_next"
  icon-prev="fast_rewind"
  icon-next="fast_forward"
  …
/>
```
New `<OPagination>` only receives `disable / model-value / max / class /
data-test / @update:model-value`. If `OPagination` doesn't default to the
same compact look (5 pages, no boundary, no ellipses, direction arrows
only), the trace result pagination bar will balloon to all page numbers
and look different from the rest of the app.

**Solution:**
```diff
- <q-pagination :input="false" direction-links :boundary-numbers="false"
-   :max-pages="5" :ellipses="false"
-   icon-first="skip_previous" icon-last="skip_next" ... />
+ <OPagination v-model="page" :max="totalPages" :max-pages="5" :disable="searchObj.loading" />
```
Per `web/src/lib/navigation/Pagination/OPagination.types.ts`, only `modelValue`, `max`, `maxPages`, `disable` are supported — pass `max-pages="5"` to restore the compact look.

### CM5. `OPagination` `disable` vs `disabled`
**File:** `web/src/plugins/traces/SearchResult.vue:82`
Uses `:disable="searchObj.loading"` (Quasar prop spelling). If
`OPagination` standardized on `disabled`, this prop is silently ignored
and the pagination remains clickable during loading, allowing race
conditions.

**Solution:** Verified `OPagination.types.ts:7` accepts `disable?: boolean` (Quasar-style spelling). The existing `:disable="searchObj.loading"` is correct — no change needed.

### CM6. `OSwitch` size mismatch
**File:** `web/src/plugins/traces/SearchBar.vue:127, 153`
Both metric/histogram toggle and error-only toggle moved from
`q-toggle size="xs" flat` to `OSwitch size="lg"`. The old layout
expected a tiny toggle; the new `lg` is ~3× larger and likely overflows
the toolbar pill containers (`toolbar-toggle-container` is 1.875rem tall).

**Solution:**
```diff
- <OSwitch size="lg" v-model="enabled" />
+ <OSwitch size="sm" v-model="enabled" />
```
At lines 127 and 153. Use `xs` if available; otherwise `sm`.

### CM7. `OSelect` lost text-input behavior in Trace Details
**File:** `web/src/plugins/traces/TraceDetails.vue:377–384`
The `<q-select>` for log streams had `use-input fill-input` plus full
`no-option` / `before-options` slot stacks that allowed typeahead search
of log streams. The replacement `<OSelect>` is plain — no typeahead, no
search slot. With dozens of log streams users now have to scroll.

**Solution:**
```vue
<OSelect
  v-model="selectedStream"
  v-model:search="streamSearchValue"
  :options="filteredStreamOptions"
  searchable
  placeholder="Search streams"
/>
```
Bind the existing `streamSearchValue` to OSelect's `v-model:search` and add `searchable` to restore typeahead.

### CM8. `q-card-actions` → manual flex row in dialogs
Multiple dialogs/drawers (`ServiceGraph.vue`, `TraceDetails.vue`) had
`<q-card-actions align="right">` wrapping buttons. The new `<ODialog>` /
`<ODrawer>` uses `secondary-button-label` / `primary-button-label` /
`@click:secondary` / `@click:primary`. Validate that the new structure
emits the same events at the right time (especially `applyAndViewTraces`
on primary action in TraceDetails filter drawer).

**Solution:**
```vue
<ODrawer
  primary-button-label="Apply"
  secondary-button-label="Cancel"
  @click:primary="applyAndViewTraces"
  @click:secondary="close"
/>
```
Verify `applyAndViewTraces` runs after validation; if validation should block primary, intercept via `@before:primary="(ev) => !valid && ev.preventDefault()"` (or equivalent ODrawer API).

### CM9. `OPagination` "first / last / direction" icons not configured
Old props `icon-first="skip_previous" icon-last="skip_next"
icon-prev="fast_rewind" icon-next="fast_forward"` not migrated — verify
the new component renders direction arrows by default.

**Solution:** Per `OPagination.types.ts`, no `icon-*` props are accepted — the component ships its own default arrows. Drop the props (already done) and accept the new default arrows. If specific icons are required, extend `OPagination` with `iconFirst`/`iconLast`/`iconPrev`/`iconNext` props.

### CM10. `ODrawer` `:portal-target="containerEl"` in ServiceGraphNodeSidePanel
**File:** `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:22`
Reads `containerEl` from the parent. Service Graph passes
`graphContainerRef` (ServiceGraph.vue line ~234). If `graphContainerRef`
is not bound to a real DOM ref the drawer either fails to portal or
falls back to body — confirm.

**Solution:**
```vue
<!-- ServiceGraph.vue -->
<div ref="graphContainerRef" class="tw:relative">
  <ServiceGraphNodeSidePanel :containerEl="graphContainerRef" ... />
</div>
```
Ensure `graphContainerRef` is wired to a real `<div>` and verify the wrapper has `position: relative` so the portaled drawer renders within it.

## Test File Issues

All 13 listed Traces spec files share the same pattern that no longer
compiles:

```ts
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar"; //   ← module not in dependencies
…
installQuasar({ plugins: [] });
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar"); //  ← module not found
  …
});
```

Affected spec files (paths):
- `web/src/plugins/traces/Index.spec.ts`
- `web/src/plugins/traces/IndexList.spec.ts`
- `web/src/plugins/traces/SearchBar.spec.ts`
- `web/src/plugins/traces/SearchResult.spec.ts`
- `web/src/plugins/traces/ServiceGraph.spec.ts` (also imports from
  `@/test/unit/helpers` which re-exports `installQuasar`)
- `web/src/plugins/traces/ServiceGraphSidePanel.spec.ts`
- `web/src/plugins/traces/ServiceGraphNodeSidePanel.spec.ts`
- `web/src/plugins/traces/SessionDetails.spec.ts`
- `web/src/plugins/traces/SessionsList.spec.ts`
- `web/src/plugins/traces/SyntaxGuide.spec.ts` (verify — also imports?)
- `web/src/plugins/traces/TraceDetails.spec.ts`
- `web/src/plugins/traces/TraceDetails.all-missing-fields.spec.ts`
- `web/src/plugins/traces/TraceDetails.missing-span-kind.spec.ts`
- `web/src/plugins/traces/TraceDetailsSidebar.spec.ts`
- `web/src/plugins/traces/TraceHeader.spec.ts`
- `web/src/plugins/traces/TraceTree.spec.ts`
- `web/src/plugins/traces/LLMContentRenderer.spec.ts`
- `web/src/plugins/traces/composables/useLLMInsights.spec.ts`
- `web/src/plugins/traces/composables/useSessions.spec.ts`

Additional spec-file findings:
- `web/src/plugins/traces/TraceDetailsSidebar.spec.ts:254` — stubs out
  `"q-virtual-scroll"` component reference, which can never be
  rendered now.
- The shim `install-quasar-plugin.ts:16–20` itself contains a TODO that
  the spec rewrite was never finished.

**Solution for the spec files:**
```diff
- import * as quasar from "quasar";
- vi.mock("quasar", async () => { const actual = await vi.importActual("quasar"); ... });
+ // Remove both; if needed, mock @/composables/useToast and @/utils/clipboard

- stubs: { "q-virtual-scroll": true }
+ stubs: { OVirtualScroll: true }  // or whatever the new OTable virtual-scroll child is

- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar({ plugins: [] });
+ // Delete — helper is now a no-op shim.
```
Apply across all 19 listed Traces spec files.

## Validations & Error Handling

### V1. `toast()` argument mapping — verify "position-top" vs "top-center"
**File:** `web/src/plugins/traces/SearchBar.vue:677–684`

```ts
toast({
  message: "Stream not found",
  position: "top-center",
  timeout: 2000,
});
```

Migrated from `$q.notify({ message, color: "negative", position: "top" })`.
`OToast` accepts `top-center` per `OToast.types.ts:10–16`, but the
`variant: "error"` (which would have replaced `color: "negative"`) is
**missing** — the stream-not-found toast renders as a default
gray-colored notification instead of an error-styled one.

**Solution:**
```diff
  toast({
    message: "Stream not found",
    position: "top-center",
    timeout: 2000,
+   variant: "error",
  });
```

### V2. `errorMsg` HTML span class swap
**File:** `web/src/plugins/traces/Index.vue:1218`
```ts
errorMsg += ` <br><span class='tw:text-base tw:font-medium'>TraceID: ${trace_id}</span>`;
```
`text-subtitle1` Quasar class became `tw:text-base tw:font-medium`. But this
string is later rendered via `v-html`/`SanitizedHtmlRenderer`. The
sanitizer's allow-list may or may not whitelist `tw:` prefixed classes;
verify it doesn't strip them.

**Solution:** Either confirm `SanitizedHtmlRenderer`'s `ALLOWED_ATTR` includes `class` and doesn't strip `tw:`-prefixed tokens, or move styling inline:
```diff
- errorMsg += ` <br><span class='tw:text-base tw:font-medium'>TraceID: ${trace_id}</span>`;
+ errorMsg += ` <br><span style="font-size: 1rem; font-weight: 500;">TraceID: ${trace_id}</span>`;
```

### V3. ServiceGraphNodeSidePanel handle-close logic
**File:** `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:25`
```html
@update:open="(v) => { if (!v) handleClose() }"
```
If ODrawer also closes on backdrop click or ESC, `handleClose()` should
still fire — but verify there isn't a missing emit on the parent
(`<service-graph @close="…">`).

**Solution:** Verified `ODrawer` emits `update:open` for ALL close paths (backdrop click, ESC, programmatic close, X button). The current handler is correct. Ensure the parent `<ServiceGraph>` re-emits:
```vue
<ServiceGraphNodeSidePanel @close="$emit('close')" ... />
```

## Accessibility

### A1. Toast lost icon `<q-icon name="error" color="primary" size="md">`
**File:** `web/src/plugins/traces/Index.vue:275`
Original used Quasar's color tokens; new code uses `<OIcon name="info" size="md" />`
without any color. The icon is still rendered but loses its blue accent.

**Solution:**
```diff
- <OIcon name="info" size="md" />
+ <OIcon name="info" size="md" class="tw:text-[var(--o2-primary)]" />
```

### A2. `cancel` icon vs `close` icon
TraceDetails went from `<q-icon name="close">` to `<OIcon name="close">` —
but TraceDetailsSidebar went from `<q-icon name="cancel">` to
`<OIcon name="cancel">`. If the icon registry has only one (e.g. `close`
exists, `cancel` doesn't), the close button silently has no icon. Audit:

- `TraceDetailsSidebar.vue:59` — `name="cancel"`
- `ServiceGraphNodeSidePanel.vue` previously had `name="cancel"` —
  removed in favor of ODrawer header X.

**Solution:** Verified `cancel` exists in OIcon registry at `OIcon.icons.ts:310`. No change required. If the design favors consistency, normalize to `close` everywhere:
```diff
- <OIcon name="cancel" />
+ <OIcon name="close" />
```

### A3. Removed `aria-hidden`/`alt` on icon spans
The migration removed several `aria-hidden="true"` props that were on
Quasar icons (e.g. `TraceDetailsSidebar.vue` service-chip image kept
its `aria-hidden`, good — but the icon-only buttons in TraceDetails
toolbar lost screen-reader text since the `<q-tooltip>` content is no
longer rendered as a `title` attribute on the button; OTooltip is a
visual overlay only).

**Solution:**
```diff
- <OButton @click="...">
-   <OIcon name="search" />
-   <OTooltip content="Run query" />
- </OButton>
+ <OButton @click="..." aria-label="Run query">
+   <OIcon name="search" aria-hidden="true" />
+   <OTooltip content="Run query" />
+ </OButton>
```
Add `aria-label` to the button (mirrors the tooltip text) and `aria-hidden="true"` to the icon child.

### A4. `aria-label` missing on inline icon copy buttons
TraceDetails copy buttons (`copyTraceId` line 92, `copySessionId` line
118) use a `<OIcon>` as the click target with only a `title` attr.
Screen readers may still read the icon name; previously
`<q-icon role="img" :title="…">` provided fallback. Verify OIcon emits
the same.

**Solution:**
```diff
- <OIcon name="content-copy" @click="copyTraceId" title="Copy trace ID" />
+ <button @click="copyTraceId" aria-label="Copy trace ID" class="tw:inline-flex">
+   <OIcon name="content-copy" aria-hidden="true" />
+ </button>
```
Promote the click target to a button with `aria-label`; keep OIcon decorative.

## Recommendations

Priority ordering (highest-impact first):

1. **Fix `Index.vue:19` Tailwind whitespace** so the Traces page is bounded.
   Change to `tw:min-h-[calc(100vh-var(--navbar-height))]!` (no spaces) for
   both `min-h` and `max-h`.
2. **Rewrite or delete the 19 Traces spec files** that import from `quasar`.
   At minimum, remove the `import * as quasar` line and the
   `vi.mock("quasar")` factory; many tests will need new mounts because
   they assert on `q-*` selectors.
3. **Fix `SearchBar.vue:20`** — remove `tw:flex-col` and the duplicate
   `tw:flex` so the top toolbar lays out horizontally again.
4. **Fix `SessionDetails.vue` `tw:hover:…` typos** (5 places) → `hover:tw:…`.
5. **Replace `var(--q-primary)` / `var(--q-negative)`** with the new design
   tokens (`var(--o2-theme-color)`, `var(--o2-status-error-text)` etc.) in
   `LLMContentRenderer.vue:757`, `LLMTrendPanel.vue:185`,
   `TraceDetails.vue:3432–3433`, `TraceDetailsSidebar.vue:2736`,
   `ServiceGraphNodeSidePanel.vue:289/437/2818`.
6. **Strip dead `.q-*` SCSS** from Index/SearchBar/IndexList/TraceDetails/
   TraceDetailsSidebar/ServiceGraph/SessionsList. Replace selectors that
   were rebranded as `.OIcon` (which doesn't exist) — use the actual
   OIcon root `tw:inline-flex` or move styles into OIcon itself.
7. **Replace remaining Quasar utility classes** (`full-height`, `full-width`,
   `relative-position`, `position-relative`, `flex-center`, `column`,
   `col-auto`, `text-primary`, `text-red-6`, `bg-grey-2`/`9`, `bg-dark`,
   `bg-white`, `bg-primary`, `text-white`, `text-caption`, `text-subtitle1`,
   `text-bold`, `text-h6`, `pointer`) with Tailwind equivalents. Locations
   are listed in CSS4, L6, L7 above and in the grep output.
8. **Audit `OIcon` registry** for every new icon name the migration
   introduced (`account-tree`, `flame`, `git-branch`, `align-left`,
   `assignment-turned-in`, `menu-book`, `forum`, `hub`, `bolt`,
   `payments`, `build`, `speed`, `schedule`, `replay`, `chat`) — any
   missing entry silently renders nothing.
9. **Investigate `OSwitch size="lg"` height** in SearchBar's metric and
   error-only toggles; likely should be `sm` or `xs`.
10. **Restore log-stream typeahead** in `TraceDetails.vue` OSelect (or
    remove the dead `filterStreamFn` / `streamSearchValue` /
    `filteredStreamOptions`).
11. **Verify `OPagination` default look** matches the old compact 5-page
    view in `SearchResult.vue`, and that `:disable=` is renamed to
    `:disabled=`.
12. **Replace `style="min-height: auto"` on `Index.vue:21`** once C1 is
    fixed; the inline override was likely added to compensate for the
    broken Tailwind classes.
13. **Remove dead `outlinedPlayCircle` / `"info"` aliases** in
    `TraceDetails.vue:2817–2818` and the corresponding entry left in
    `SearchBar.vue` setup return.
14. **`copyToClipboard` move** — verify `@/utils/clipboard` returns a
    Promise / boolean compatible with `Index.vue:1276` and friends; the
    Quasar `copyToClipboard` returned a Promise.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers (silent no-ops)

| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `web/src/plugins/traces/Index.vue:23` | `full-height` | `tw:h-full` | File-level |
| `web/src/plugins/traces/Index.vue:130` | `traces-search-result-container relative-position tw:h-full` | `... tw:relative tw:h-full` | File-level |
| `web/src/plugins/traces/SpanRenderer.vue:20` | `relative-position tw:pt-2` | `tw:relative tw:pt-2` | File-level |
| `web/src/plugins/traces/TraceDetails.vue:452` | `relative-position trace-content-scroll` | `tw:relative trace-content-scroll` | File-level |
| `web/src/plugins/traces/TraceDetails.vue:461` | `position-relative` | `tw:relative` | File-level |
| `web/src/plugins/traces/SearchBar.vue:20` | `float-right tw:flex tw:flex-col tw:flex tw:items-center ...` | `tw:float-right tw:flex tw:items-center ...` (drop `flex-col` and dup `flex`) | File-level |
| `web/src/plugins/traces/SearchBar.vue:175` | `float-right col-auto tw:flex tw:items-center tw:gap-[0.375rem]` | `tw:float-right tw:flex-none tw:flex tw:items-center tw:gap-1.5` | File-level |
| `web/src/plugins/traces/SearchBar.vue:313, :376` | `float-right col-auto o2-input-full` | `tw:float-right tw:flex-none o2-input-full` | File-level |
| `web/src/plugins/traces/SearchResult.vue:84` | `float-right paginator-section tw:mt-0!` | `tw:float-right paginator-section tw:mt-0!` | File-level |
| `web/src/plugins/traces/SessionsList.vue:72` | `float-right paginator-section tw:mt-0!` | `tw:float-right paginator-section tw:mt-0!` | File-level |
| `web/src/plugins/traces/ServiceGraph.vue:165, :175, :195` | `tw:flex flex-center tw:h-full ...` (3 instances) | `tw:flex tw:items-center tw:justify-center tw:h-full ...` | File-level |
| `web/src/plugins/traces/TraceTree.vue:220` | `text-red-6` (Quasar palette step) | `tw:text-red-500` | File-level |
| `web/src/plugins/traces/TraceHeader.vue:37` | `resize-btn bg-primary text-white tw:inline-flex ...` | `resize-btn tw:bg-[var(--o2-primary)] tw:text-white tw:inline-flex ...` | File-level |
| `web/src/plugins/traces/SpanBlock.vue:32` | `bg-dark` / `bg-white` (in ternary) | `tw:bg-[var(--o2-surface-dark)]` / `tw:bg-white` | File-level |
| `web/src/plugins/traces/SyntaxGuide.vue:75, :131` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-level |

### 2. Tailwind v4 Misuse

| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `web/src/plugins/traces/Index.vue:19` | `tw:min-h-[calc(100vh - var(--navbar-height))]!` (whitespace inside arbitrary value — class is dropped) | `tw:min-h-[calc(100vh-var(--navbar-height))]!` (remove spaces) | File-level |
| `web/src/plugins/traces/Index.vue:19` | `tw:max-h-[calc(100vh - var(--navbar-height))]!` (same) | `tw:max-h-[calc(100vh-var(--navbar-height))]!` | File-level |
| `web/src/plugins/traces/SearchBar.vue:20` | `tw:flex tw:flex-col tw:flex tw:items-center` (auto-replace inserted `flex-col`) | `tw:flex tw:items-center` | File-level |
| `web/src/plugins/traces/SyntaxGuide.vue:75, :131` | `hover:tw:underline` | `tw:hover:underline` | File-level |
| `web/src/plugins/traces/TraceDetails.vue:76, :97, :121, :131` | `hover:tw:text-[var(--o2-theme-color)]`, `hover:tw:text-[var(--o2-text-primary)]` (4 occurrences) | `tw:hover:text-[...]` | File-level |
| `web/src/plugins/traces/LLMTrendPanel.vue:185` | `hover:tw:underline` (also uses `tw:text-[var(--q-primary)]`) | `tw:hover:underline`; replace `--q-primary` → `--o2-primary` | File-level |
| `web/src/plugins/traces/TraceEvaluationsView.vue:172, :346` | `dark:tw:text-amber-400` | `tw:dark:text-amber-400` | File-level |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:528, :585` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/traces/FlameGraphView.vue:141` | `hover:tw:bg-[var(--o2-primary-color)]` | `tw:hover:bg-[var(--o2-primary-color)]` | File-level |

### 3. Quasar CSS Variables (var(--q-*))

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:289, :437` | `tw:text-[var(--q-negative)]` (2 occurrences, template arbitrary) | `tw:text-[var(--o2-negative)]` | File-level |
| `web/src/plugins/traces/ServiceGraphNodeSidePanel.vue:2818` | `var(--q-negative)` | `var(--o2-negative)` | Token (global) |
| `web/src/plugins/traces/LLMContentRenderer.vue:757` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/plugins/traces/LLMTrendPanel.vue:185` | `tw:text-[var(--q-primary)]` (template) | `tw:text-[var(--o2-primary)]` | File-level |
| `web/src/plugins/traces/TraceDetails.vue:3432, :3433` | `var(--q-primary)` (color + border-color) | `var(--o2-primary)` | Token (global) |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2740` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/plugins/traces/metrics/TracesAnalysisDashboard.vue:1202, :1212` | `var(--q-border-color)`, `var(--q-hover-color)` | `var(--o2-border-color)`, `var(--o2-hover-color)` | Token (global) |
| `web/src/plugins/traces/ThreadView.vue:672, :829` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |

### 4. Dead `:deep(.q-*)` Selectors & `body.body--dark`

| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `web/src/plugins/traces/TraceDAG.vue:609` | `.body--dark` | Replace with `html.dark` | Component-level |
| `web/src/plugins/traces/ServiceGraph.vue:1550, :1574` | `:global(.body--dark .sg-legend)`, `:global(.body--dark .sg-legend-divider)` | Replace with `:global(html.dark ...)` | Component-level |
| `web/src/plugins/traces/ServiceGraph.vue:1728, :1729` | `.body--dark ... .q-field` (2 lines) | Remove `.q-field` part; replace `body--dark` | Component-level |
| `web/src/plugins/traces/TraceDetails.vue:3046, :3050, :3361` | `body.body--dark .dag-resizer-line`, `body.body--dark .dag-resizer:hover ...`, `body.body--dark { ... }` | Replace `body.body--dark` with `html.dark` | Component-level |
| `web/src/plugins/traces/ServiceGraphEdgeSidePanel.vue:1296` | `.body--dark .service-graph-edge-side-panel` | `html.dark .service-graph-edge-side-panel` | Component-level |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2041` | `:deep(.q-btn)` | Remove | File-level |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2517, :2773, :2848` | `body.body--dark`, `.body--dark` (3 blocks) | Replace with `html.dark` | Component-level |
| `web/src/plugins/traces/TraceDetailsSidebar.vue:2637, :2704` | `::v-deep { ... }` (2x — Vue 2 syntax) | Replace with `:deep(...)` Vue 3 syntax | File-level |
| `web/src/plugins/traces/metrics/TracesMetricsContextMenu.vue:187` | `body.body--dark` | `html.dark` | Component-level |
| `web/src/plugins/traces/IndexList.vue:665` | `:deep(.q-table__control)` | Remove (OTable has no `q-table__control`) | File-level |
| `web/src/plugins/traces/TraceEvaluationsView.vue:1098, :1109, :1122, :1232` | `body.body--dark` rules (4 blocks) | Replace with `html.dark`; remove `:deep` if no DOM match | Component-level |
| `web/src/plugins/traces/TraceEvaluationsView.vue:1130` | `:deep(.q-field__control)` | Remove | File-level |
| `web/src/plugins/traces/metrics/TracesMetricsDashboard.vue:771` | `body.body--dark { ... }` | `html.dark` | Component-level |
| `web/src/plugins/traces/metrics/TracesAnalysisDashboard.vue:1235` | `body.body--dark` | `html.dark` | Component-level |
| `web/src/plugins/traces/components/TraceErrorTab.vue:769` | `body.body--dark` | `html.dark` | Component-level |

### 5. Quasar SCSS Variables (in `<style scoped>`)

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/plugins/traces/SearchBar.vue:1098, :1124` | `$dark-page` (2 occurrences) | `var(--o2-dark-page)` | File-level |
| `web/src/plugins/traces/SearchBar.vue:1103` | `$light-text2` | `var(--o2-light-text2)` | File-level |

### 6. Quasar Directives

*(none found — no `v-close-popup`/`v-ripple`/`v-intersection` in traces)*

### 7. Icon Migration

| File:Line | Issue | Fix |
|-----------|-------|-----|
| `web/src/plugins/traces/TraceEvaluationsView.vue:361` | `OIcon ... :color="getDimColor(dim.dimension)"` (unsupported prop) | Wrap in `<span class="tw:text-...">` and drop `:color`; or set inline `style="color: ..."` |

### 8. Inline `style=` Hot Spots (to be promoted to scoped classes / shared partial)

| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `web/src/plugins/traces/Index.vue:21` (same root div as :19) | `style="min-height: auto"` (band-aid for broken Tailwind classes) | Remove once Index.vue:19 calc-whitespace bug is fixed |
| `web/src/plugins/traces/SpanBlock.vue:32` | `:class="[store.state.theme === 'dark' ? 'bg-dark' : 'bg-white']"` (color logic in template) | Move into a single class with `--o2-surface` token reacting to `html.dark` |

### 9. Duplicate Style Blocks (candidate for component-level partial)

| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| TraceDAG.vue, ServiceGraph.vue, TraceDetails.vue, TraceDetailsSidebar.vue, ServiceGraphEdgeSidePanel.vue, TracesMetricsContextMenu.vue, TraceEvaluationsView.vue, TracesMetricsDashboard.vue, TracesAnalysisDashboard.vue, TraceErrorTab.vue | `body.body--dark` / `.body--dark` blocks (~17 occurrences across 10 files) | `web/src/styles/themes/traces-dark.scss` partial using `html.dark` |
| SearchResult.vue, SessionsList.vue | `float-right paginator-section tw:mt-0!` | A single utility `.pagination-right` or `tw:float-right tw:mt-0!` directly |
| ServiceGraph.vue:165, :175, :195 | `tw:flex flex-center tw:h-full tw:text-center` | `.sg-center-state` partial (or migrate `flex-center` to `tw:items-center tw:justify-center` everywhere) |
| TraceHeader.vue, AddDashboard imports | `resize-btn bg-primary text-white ...` | A shared `.resize-btn` class in component-level partial |

### 10. Layer Summary

- **Global (`app.scss`)** changes needed: ~6 (introduce `--o2-negative`, `--o2-primary`, `--o2-border-color`, `--o2-hover-color`, `--o2-light-text2`, `--o2-dark-page` token aliases; `html.dark` parity with `body--dark`)
- **Component-level partials** new/changed: 3 (`traces-dark.scss` from `body.body--dark` consolidation, `.resize-btn` partial, `.sg-center-state` partial)
- **File-level scoped** changes: ~90 (calc-whitespace fix in `Index.vue:19`; ~10 `hover:tw:` reorderings in `SyntaxGuide.vue`, `TraceDetails.vue`, `LLMTrendPanel.vue`, `TraceDetailsSidebar.vue`, `FlameGraphView.vue`; ~8 `var(--q-*)` swaps; ~15 `body--dark` rewrites; bare class removals (`full-height`, `relative-position`, `position-relative`, `float-right col-auto`, `flex-center`, `column`, `text-primary`, `text-red-6`, `bg-primary`, `bg-dark`, `bg-white`); replace `::v-deep` with `:deep()` in `TraceDetailsSidebar.vue`)
