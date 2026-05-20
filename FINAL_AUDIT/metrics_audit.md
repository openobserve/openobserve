# Metrics Page — Quasar Removal Audit

## Summary

The Metrics page was migrated from Quasar (`q-*`) components and classes to custom `O*` components plus `tw:`-prefixed Tailwind utilities. The migration is **incomplete and contains several runtime-breaking bugs**, primarily because the new components were dropped in without honoring their actual API.

Highlights:
- **`MetricList.vue` throws on mount** — `setup()` returns an undefined `quasar` variable (`ReferenceError`).
- **`MetricSelector.vue` throws on API error** — references a deleted `filteredMetrics` ref in the catch block.
- **All OSelect usages are broken** — Quasar API (`use-input`, `fill-input`, `hide-selected`, `input-debounce`, `behavior`, `@filter`, `v-slot:option`, `v-slot:no-option`, `v-slot:prepend`, `v-slot:hint`, `:loading`, `input-class`) is passed to a component (`OSelect`) that does not implement any of it. Type filtering, value autocomplete, custom option rendering, and label icons are all silently dead.
- **Metric icon mappings drift** — `MetricLegends.vue` still maps to `bar_chart`/`pin` (non-existent in OIcon registry), so Histogram/Counter rows render with no icon. `MetricList.vue` uses the correct `bar-chart`/`tag` names; the two files disagree.
- **Toast variant misuse** — `AddToDashboard.vue` calls `toast({ type: "ongoing" })` and `toast({ type: "negative" })`; the new API expects `variant` (typed as `"loading" | "error" | ...`).
- **Header flex direction inverted** — Index.vue now stacks header items vertically because Quasar's `col` flex-child class was migrated to `tw:flex-col` (flex-direction column).
- Many `q-*` SCSS selectors, `:deep()` paths, and `q-pl-/q-mr-/q-py-` style hooks are left over and no longer match any DOM.
- Several spec files still import Quasar, mock `useQuasar`, and assert against `q-mr-sm` / `q-input` / `q-btn` / `filteredMetrics` — they will fail to compile or fail at runtime against the migrated components.

## Files Audited

In scope, with diff vs `main`:

- `web/src/views/AppMetrics.vue` (unchanged)
- `web/src/plugins/metrics/Index.vue` (+18 / −24)
- `web/src/plugins/metrics/MetricList.vue` (+231 / −312)
- `web/src/plugins/metrics/MetricLegends.vue` (+24 / −41)
- `web/src/plugins/metrics/SyntaxGuideMetrics.vue` (+29 / −38)
- `web/src/plugins/metrics/AddToDashboard.vue` (+74 / −104)
- `web/src/components/promql/components/MetricSelector.vue` (+11 / −62)
- `web/src/components/promql/components/LabelFilterEditor.vue` (+57 / −57)
- `web/src/components/promql/components/OperationsList.vue` (+101 / −107)
- `web/src/components/promql/components/PromQLBuilderOptions.vue` (+47 / −75)
- Spec files: `*.spec.ts` for each of the above
- `web/src/components/promql/operations/*`, `web/src/components/promql/types/*`, composables under `web/src/composables/` (unchanged on this branch)

## Critical Issues

### 1. `MetricList.vue` returns undefined `quasar` from `setup()`
- File: `web/src/plugins/metrics/MetricList.vue` lines 512–513.
- The `import { useQuasar } from "quasar"` and `const quasar = useQuasar()` calls were removed (diff lines `-import { useQuasar } ...`, `-const quasar = useQuasar();`), but the return block still exposes `quasar`:
  ```ts
  return {
    quasar,              // <-- ReferenceError: quasar is not defined
    t,
    store,
    ...
  };
  ```
- Effect: the component will throw at mount time and the entire metrics sidebar fails to render. (The `MetricList.spec.ts` mock at line 28 hides this from the test suite.)

**Solution:**
```diff
  return {
-   quasar,
    t,
    store,
    ...
  };
```

### 2. `MetricSelector.vue` references a removed `filteredMetrics` ref
- File: `web/src/components/promql/components/MetricSelector.vue` line 72.
- `filteredMetrics` was deleted from the script (diff `-const filteredMetrics = ref<string[]>([]);`) but the `catch (error)` branch in `loadMetrics()` still does `filteredMetrics.value = []`. Any failure of `streamService.nameList` will produce a `ReferenceError`.
- The old `filterMetrics()` function (which performed server-side metric autocomplete via `streamService.nameList`) is also gone — the new component has no autocomplete behavior at all.

**Solution:**
```diff
  } catch (error) {
-   filteredMetrics.value = [];
+   metrics.value = [];
    console.error("Error loading metrics:", error);
  }
```
Also re-declare `filterMetrics` and wire `@search="filterMetrics"` on the `<OSelect>` to restore autocomplete.

### 3. `AddToDashboard.vue` calls toast with the wrong key/variants
- File: `web/src/plugins/metrics/AddToDashboard.vue` lines 134–138 and 150–155.
- New `useToast` API requires `variant` (`"success" | "error" | "warning" | "info" | "loading" | "default"`), see `web/src/lib/feedback/Toast/OToast.types.ts:1`.
- The code passes `type: "ongoing"` (line 137) and earlier code in the same file passes `variant: "success"`. `type` is ignored, `"ongoing"` is not a valid variant — the "Please wait..." toast renders with the default style and the dismiss handle never picks up the loading state.
- The `dismiss = toast({...})` pattern also expects the function to return a `DismissFn`; review whether the API contract is honoured when invalid options are supplied.

**Solution:**
```diff
- const dismiss = toast({
-   message: "Please wait while we are loading dashboards...",
-   type: "ongoing",
- });
+ const dismiss = toast({
+   message: "Please wait while we are loading dashboards...",
+   variant: "loading",
+ });
```

### 4. OSelect API mismatch breaks the metric picker, label picker, and value picker
OSelect (`web/src/lib/forms/Select/OSelect.vue`, types at `OSelect.types.ts:111`) emits only `update:modelValue | clear | search | create | open | close | blur | change | keydown`. It has slots `default | trigger | chip | empty | before-options | icon-left | icon-right | tooltip` and props `searchable | searchDebounce | hideSelected | labelKey | valueKey | clearable | disabled | size | ...`.

Migrated usages still pass Quasar contracts that silently no-op:

- `MetricList.vue` 22–74:
  - `behavior="menu"`, `use-input`, `hide-selected`, `fill-input`, `@filter`, slots `v-slot:prepend`, `v-slot:option`, `#no-option` — none exist on OSelect. The metric icon next to the selected metric will never render, the typeahead filter does not run, the custom option row with the type icon does not render.
- `LabelFilterEditor.vue` 32–120:
  - Same `use-input`, `fill-input`, `hide-selected`, `input-debounce`, `input-class`, `@filter`, `:loading`, `:disable`, slots `no-option`, `option`, `hint` — none of these are honored. The label/value autocomplete is dead.
  - `:disable="!label.label"` should be `:disabled` (Quasar→Vue/standard prop name).
- `MetricSelector.vue` 7–19:
  - Loses `use-input`, `input-debounce`, `loading`, `stack-label`, `hide-bottom-space`, `borderless`, `dense` from the old version. The server-driven metric search disappeared with `filterMetrics` (see #2). Users now have to select a metric by scrolling without any incremental search.
- `OperationsList.vue` 85–98:
  - The multi-select for labels uses `searchable` correctly, but its custom `filterOperationLabels` is unbound (no `@search` listener wired through OSelect), and `filteredLabels` is referenced from script but never used in template.
- `PromQLBuilderOptions.vue` 85–108:
  - Uses `<template v-slot:append>` on OSelect — there is no `append` slot. The "info" tooltip on the Query Type select will not appear. Use `#icon-right` instead.

**Solution:**
```diff
- <OSelect use-input fill-input hide-selected behavior="menu"
-   input-debounce="300" @filter="filterMetrics"
-   :disable="!available" :loading="isLoading">
-   <template v-slot:option="scope">...</template>
-   <template v-slot:no-option>...</template>
-   <template v-slot:prepend>...</template>
- </OSelect>
+ <OSelect searchable :search-debounce="300" hide-selected
+   :disabled="!available" @search="filterMetrics">
+   <template #empty>...</template>
+   <template #icon-left>...</template>
+ </OSelect>
```

### 5. Tooltip elements rendered as siblings of their anchors
- File: `web/src/components/promql/components/PromQLBuilderOptions.vue` lines 32–44, 62–78, 97–106.
- `<OIcon>` followed by `<OTooltip ...>` at the same DOM level — `OTooltip` expects to wrap its trigger (or be used inside `OTooltip`'s `#trigger` slot). As written, the tooltip has no anchor and will not appear on hover of the info icon.

**Solution:**
```diff
- <OIcon name="info" size="sm" />
- <OTooltip side="top" max-width="250px" content="..." />
+ <OTooltip side="top" max-width="250px">
+   <template #trigger><OIcon name="info" size="sm" /></template>
+   <template #content>...</template>
+ </OTooltip>
```

### 6. Index.vue header switches to vertical layout
- File: `web/src/plugins/metrics/Index.vue` lines 25 and 36.
- Diff:
  - Before: `class="flex items-center col"` (Quasar `col` = flex-child).
  - After: `class="tw:flex tw:items-center tw:flex tw:flex-col"`.
- Adding `tw:flex-col` flips the container to a column. The page title, "Syntax Guide", and "Legends" buttons will stack vertically inside the 48px header; the right-side cluster (date picker, refresh, run button) is also flipped.

**Solution:**
```diff
- <div class="tw:flex tw:items-center tw:flex tw:flex-col">
+ <div class="tw:flex tw:items-center tw:flex-1">
```

### 7. Inline dialog wrapper removed without migration of "cancel" event
- File: `web/src/plugins/metrics/Index.vue` lines 112–117 (was a `<q-dialog>` wrapper with `@cancel`).
- New `AddToDashboard.vue` exposes `update:open`, `save`, but the previous template's `@cancel="showAddToDashboardDialog = false"` is gone and not replaced — closing the drawer relies on `@update:open` being emitted on user close. `AddToDashboard.spec.ts` line 141 explicitly emits only `["update:open", "click:primary", "click:secondary", "click:neutral"]`, so this works in tests, but verify the actual `ODrawer` emits `update:open` on backdrop click / Esc — otherwise the drawer cannot be dismissed.

**Solution:**
```diff
- <AddToDashboard :open="showAddToDashboardDialog" />
+ <AddToDashboard
+   :open="showAddToDashboardDialog"
+   @update:open="(v) => (showAddToDashboardDialog = v)"
+   @click:secondary="showAddToDashboardDialog = false"
+ />
```

## Logical Issues

### `MetricList.vue`
- Lines 100–105: `OCollapsible` is opened via `update:model-value` and `openFilterCreator` is also called inside the same handler. Original used Quasar's `@before-show` so the API call only fired the first time. The new code calls `openFilterCreator(null, row)` every time `v` becomes truthy — fine — but inside `openFilterCreator` line 477, `metricLabelValues.value[name] = { isLoading: true, values: [] }` is unconditionally re-set on every open, wiping previously fetched values for that label. Combined with re-fetching on every reopen, this regresses prior behavior where values were cached.

**Solution:**
```diff
- metricLabelValues.value[name] = { isLoading: true, values: [] };
+ if (metricLabelValues.value[name]?.values?.length) return; // cached
+ metricLabelValues.value[name] = { isLoading: true, values: [] };
```
- Lines 367–383: `visibleMetricLabels` computed now filters when there is a search term — but `filterMetricLabels` returns `[]` for empty terms (`if (terms != "") { ... } return filtered;`), so with a non-empty search the function executes properly, but the previous Quasar table's built-in `:filter`/`:filter-method` removal means there is no debouncing/throttling, and the table re-renders on every keystroke (`debounce` was previously set to `1` on the q-input).

**Solution:**
```diff
- <OInput v-model="searchTerm" ... />
+ <OInput v-model="searchTerm" :debounce="300" ... />
```
Wrap `filterMetricLabels` in `useDebounceFn` from `@vueuse/core` if debouncing on input is not supported.
- Line 532: `"add": "add"` is an invented entry in the return object, looks like dead leftover from the removed `outlinedAdd` import. Harmless but confusing.

**Solution:**
```diff
  return {
    ...
-   "add": "add",
    t,
    store,
  };
```

### `OperationsList.vue`
- Lines 287–309: `filterOperationLabels` defined and `filteredLabels` ref updated, but nothing in the template references either. Dead code.
- Lines 16–17: `<template v-for="(element, index) in props.operations">` has no `:key` attribute. Vue 3 will emit a warning and may re-mount inner elements unexpectedly on reorder.
- Drag-and-drop key: `getItemKey` is passed to the `draggable` wrapper, but the top-level `<template v-for>` does not use it.

**Solution:**
```diff
- <template v-for="(element, index) in props.operations">
+ <template v-for="(element, index) in props.operations" :key="getItemKey(element, index)">
```
Delete the unused `filterOperationLabels` function and `filteredLabels` ref.

### `LabelFilterEditor.vue`
- Lines 197 and 199–204: `availableLabelOptions` is a `ref` initialized empty, then synced inside `filterLabelOptions()` which is called from the watcher. The intent is to re-derive a filtered set when `props.labels` changes — but the original Quasar `q-select :options="filteredLabelOptions" @filter="filterLabels"` flow is broken (see #4), so `filteredLabelOptions` is effectively the static "everything except already chosen" list. Typeahead does not narrow further.
- Lines 306–324: `filterLabelValues` is meant to return options through the `update` callback, but `update` is OSelect-ignored; the function still calls `update(() => { ... return allOptions; })` and the return value is discarded.
- Line 86: `:disable` should be `:disabled` (Quasar→standard).

**Solution:**
```diff
- <OSelect :disable="!label.label" use-input input-debounce="0" @filter="filterLabels" ... />
+ <OSelect :disabled="!label.label" searchable :search-debounce="0" @search="filterLabels" ... />
```
Refactor `filterLabelValues(val, update)` to accept only `val` and assign directly to a ref.

### `PromQLBuilderOptions.vue`
- Lines 22–30: `CommonAutoComplete` receives `color="input-border"`, `bg-color="input-bg"`, `stack-label`, `borderless` — these are Quasar-era props; verify whether the migrated `CommonAutoComplete` still consumes them, otherwise styling is gone.
- Lines 199–212: `selectPromQlNameOption` has a logic bug independent of the migration but worth flagging — when `openingBraceIndex === -1`, it builds `"{" + inputValue.slice(0, -1 + 1) + option + "}"` which equals `"{" + "" + option + "}"`, discarding the previous user input completely. Pre-existing issue.

**Solution:**
```diff
  if (openingBraceIndex === -1) {
-   newValue = "{" + inputValue.slice(0, -1 + 1) + option + "}";
+   newValue = inputValue + "{" + option + "}";
  }
```
Remove the Quasar-only props (`color`, `bg-color`, `stack-label`, `borderless`) from `CommonAutoComplete` usage.

### `AddToDashboard.vue`
- Line 96 comment: references the old `q-dialog` mount behavior — still relevant because the new `ODrawer` may keep the component mounted even when closed (unlike `q-dialog`). The `if (isOpen) await getFoldersList(...)` branch is fine, but the `else` branch is the only place state resets — if `ODrawer` does not emit `update:open=false` on Esc/backdrop click, the form keeps stale values.

**Solution:**
```diff
  watch(() => props.open, async (isOpen) => {
    if (isOpen) {
      await getFoldersList(...);
    } else {
+     // reset form state when drawer closes
+     resetForm();
    }
  });
```

## CSS / Layout Issues

### Dead `q-*` SCSS selectors (no DOM to match)
- `web/src/plugins/metrics/Index.vue` lines 635–652 — the `.dashboards-auto-refresh-interval .q-btn { ... }` block targets `q-btn`, which no longer exists. The inner `.OIcon { font-size: ...rem }` also will not size SVG icons (OIcon uses the `size` prop, not font-size).
- `web/src/plugins/metrics/MetricList.vue`:
  - Lines 569–586: `.q-field--dense .q-field__before` etc. — dead.
  - Lines 593–607: `.q-field { __control, __native }` — dead.
  - Lines 634–637: `:deep(.q-table__control), label.q-field { ... }` — `.q-table__control` no longer exists; `label.q-field` no longer exists.
  - Lines 707–725: duplicate `q-field--dense` block — dead.
- `web/src/plugins/metrics/MetricLegends.vue` line 80: `.q-btn:before { border: 0 ... }` — dead.
- `web/src/plugins/metrics/SyntaxGuideMetrics.vue` line 166: same dead selector.
- `web/src/plugins/metrics/Index.vue` line 27: `q-table__title` class is still in the template — does nothing because there is no Quasar table providing the style; the inline `tw:font-semibold tw:text-xl` carries the look, so it's only dead weight.

**Solution:**
```diff
- .dashboards-auto-refresh-interval .q-btn { ... }
- .q-field--dense .q-field__before { ... }
- :deep(.q-table__control), label.q-field { ... }
- .q-btn:before { border: 0 ...; }
```
Delete all `q-*` SCSS blocks. Replace `q-table__title` class on the template heading with nothing (Tailwind classes carry the styles).

### Non-`tw:` color/utility leftovers
- `web/src/plugins/metrics/MetricList.vue`:
  - Line 50: `'text-white'` (no `tw:` prefix) — will not be applied. Original was Quasar's `text-white`. Same on lines 189 and 190 (`text-black`).
  - Line 109: `tw:flex content-center tw:truncate` — `content-center` (Quasar `justify-content: center`) has no effect.
  - Line 162: `tw:flex tw:flex wrap tw:justify-between` — typo: `tw:flex wrap` should be `tw:flex-wrap`.
  - Line 186: `tw:flex tw:flex` — duplicate `tw:flex`, intended `tw:flex-row` is missing.
  - Lines 165–167: `tw:text-gray-300 / tw:text-gray-500` — these are arbitrary tailwind colors; the rest of the design system uses semantic token classes. Cosmetic but inconsistent with `OToast`/`OButton` etc.
- `web/src/plugins/metrics/SyntaxGuideMetrics.vue` line 113: `class="hover:tw:underline text-primary"` — the prefix order is wrong (the project tailwind config uses `prefix(tw)`, so `tw:hover:underline` is the canonical form; `hover:tw:underline` is not valid). `text-primary` lacks `tw:` prefix and will not apply.
- `web/src/plugins/metrics/MetricList.vue` lines 46 and 160 (and `LabelFilterEditor.vue` line 103): `hover:tw:bg-muted/50` — same prefix-order bug. Other files in the new lib use `tw:hover:bg-...` (see `web/src/lib/forms/DateTimeRange/ODateRangeCalendar.vue`).
- `web/src/components/promql/components/OperationsList.vue` line 50: `class="text-weight-medium"` (Quasar). Should be `tw:font-medium`.
- `web/src/components/promql/components/OperationsList.vue` line 157: `tw:hover:bg-primary-background` — uses the correct prefix order, but mixes with the buggy `hover:tw:` in sibling files; pick one and fix.

**Solution:**
```diff
- 'text-white'           → 'tw:text-white'
- 'tw:flex content-center tw:truncate'    → 'tw:flex tw:justify-center tw:truncate'
- 'tw:flex tw:flex wrap tw:justify-between' → 'tw:flex tw:flex-wrap tw:justify-between'
- 'tw:flex tw:flex'      → 'tw:flex tw:flex-row'
- 'hover:tw:underline text-primary' → 'tw:hover:underline tw:text-[var(--o2-primary)]'
- 'hover:tw:bg-muted/50' → 'tw:hover:bg-muted/50'
- 'text-weight-medium'   → 'tw:font-medium'
```

### Broken `:deep()` selectors
- `web/src/components/promql/components/OperationsList.vue` lines 347–355:
  ```scss
  :deep(.operation-label-selector.q-field--labeled.showLabelOnTop.q-select
    .q-field__control-container
    .q-field__native > :first-child) { ... }
  ```
  OSelect does not render `.q-field--labeled`, `.q-select`, `.q-field__control-container`, or `.q-field__native`. The whole block is dead. Lower-case override for the multi-select label area is lost.
- `web/src/plugins/metrics/MetricList.vue` line 634: `:deep(.q-table__control)` — never matches.

**Solution:**
```diff
- :deep(.operation-label-selector.q-field--labeled.showLabelOnTop.q-select
-   .q-field__control-container
-   .q-field__native > :first-child) { ... }
- :deep(.q-table__control) { ... }
```
Delete the entire `:deep()` blocks. If similar overrides are needed, target the OSelect's wrapper class (e.g. `.o-select`) and the OTable equivalent class.

### Index.vue header (see Critical #6)
- `tw:flex-col` added to the inner header div breaks the horizontal alignment of title / Syntax Guide / Legend.
- `dashboard-icons` class kept (`.dashboard-icons { height: 32px }`) but it's now applied to `DateTimePickerDashboard` and a `<div>` wrapping the action buttons — the fixed height may clip the date picker dropdown caret on smaller resolutions.

**Solution:** See Critical #6 — replace `tw:flex-col` with `tw:flex-1`. Remove the `.dashboard-icons { height: 32px }` fixed-height rule or scope it only to icon buttons.

### CSS-token references that no longer resolve
- `web/src/plugins/metrics/MetricList.vue` lines 547–565: uses SCSS variables like `$dark-page`, `$selected-list-bg`, `$primary` inside the now-removed Quasar `.q-item` block (block was removed in diff, but other styles in the file still rely on Quasar SCSS variables; e.g., none are referenced in current text — verified). Safe but worth re-checking that no Quasar global SCSS is imported only for these styles.

**Solution:**
```diff
- background: $dark-page;
- color: $primary;
+ background: var(--o2-background);
+ color: var(--o2-primary);
```

### `OCard` / `OCardSection` / `OSeparator` unused imports
- `web/src/plugins/metrics/SyntaxGuideMetrics.vue` lines 134–136: imports `OSeparator`, `OCard`, `OCardSection`. None are registered (line 139 only registers `OButton, OIcon, ODropdown`) and none appear in the template.
- `web/src/plugins/metrics/MetricLegends.vue` lines 40–41: imports `OCard`, `OCardSection`. Unused. The old card-section wrapper was replaced by raw `<div>`s.

**Solution:**
```diff
- import { OSeparator, OCard, OCardSection } from "@/lib";
```
Delete the unused imports in both files.

## Component Migration Issues

### Icon mapping divergence
- `web/src/plugins/metrics/MetricList.vue` lines 310–315:
  ```ts
  const metricsIconMapping = {
    summary: "description", gauge: "speed",
    histogram: "bar-chart", counter: "tag",
  };
  ```
- `web/src/plugins/metrics/MetricLegends.vue` lines 52–57:
  ```ts
  const metricsIconMapping = {
    Summary: "description", Gauge: "speed",
    Histogram: "bar_chart", Counter: "pin",
  };
  ```
- The OIcon registry (`OIcon.icons.ts`) maps only `bar-chart` and `tag`, **not** `bar_chart` or `pin`. So:
  - The legend modal will render no icon for Histogram and Counter (OIcon falls back to empty / warns).
  - Capitalization also differs (`Histogram` vs `histogram`) — even if both used the same icon names, sharing this map between the two components would break.

**Solution:** in `MetricLegends.vue`:
```diff
  const metricsIconMapping = {
-   Summary: "description", Gauge: "speed",
-   Histogram: "bar_chart", Counter: "pin",
+   summary: "description", gauge: "speed",
+   histogram: "bar-chart", counter: "tag",
  };
```
Then normalize the lookup key (`mapping[type.toLowerCase()]`) and extract the constant to a shared module.

### Quasar-only props passed to `OButton`, `OInput`
- `web/src/plugins/metrics/MetricList.vue` line 239: `:debounce="1"` — OInput honors this. OK.
- `web/src/plugins/metrics/MetricList.vue` line 117: `icon-left="add"` — OButton supports this. OK.

### `OTable` usage
- `web/src/plugins/metrics/MetricList.vue` lines 80–87: switched from `q-table` to `OTable` with `pagination="none"`, `:show-global-filter="false"`. Verify `pagination="none"` is recognized — common pattern is `:pagination="false"`. The diff dropped `:pagination="{ rowsPerPage: 10000 }"`.
- Lines 88, 233: slot names `cell-name` and `top` — verify `OTable` exposes these.

**Solution:**
```diff
- <OTable pagination="none" :show-global-filter="false" ...>
+ <OTable :pagination="false" :show-global-filter="false" ...>
```
Confirm slot names in `OTable.vue` (use `#cell-<column-id>` and `#top` — both supported in current OTable API).

### `OCollapsible` model binding (MetricList.vue lines 101–106)
- `:model-value="openMetricRows[row.name] === true"` plus an inline `@update:model-value` that mutates the reactive map. Workable but relies on `openMetricRows[row.name]` being defined; first render reads `undefined === true → false`, which is fine, but reactivity for missing keys depends on `reactive<Record<string, boolean>>({})` proxy adding new keys on assignment — it does, but be aware. The Quasar `@before-show` semantics are gone.

**Solution:** Track `openedMetrics` (Set) so `openFilterCreator` only fires once:
```diff
+ const fetchedMetrics = new Set<string>();
  @update:model-value="(v) => {
    openMetricRows[row.name] = v;
-   if (v) openFilterCreator(null, row);
+   if (v && !fetchedMetrics.has(row.name)) {
+     fetchedMetrics.add(row.name);
+     openFilterCreator(null, row);
+   }
  }"
```

### `OSelect` prop misnamings
- `input-debounce`, `input-class`, `behavior`, `use-input`, `fill-input`, `hide-selected` — none are recognized. The closest equivalents are `searchable`, `searchDebounce`, `hideSelected`, and the input class is no longer customizable.

**Solution:**
```diff
- <OSelect use-input fill-input hide-selected input-debounce="0" behavior="menu" input-class="..." />
+ <OSelect searchable hide-selected :search-debounce="0" />
```

### `outlinedAdd` removed but nothing replaces it
- `MetricList.vue` previously imported `outlinedAdd` from `@quasar/extras/material-icons-outlined` and used it in the OButton's slot (`<Plus class="..." />`). The new code uses `icon-left="add"` on the OButton (lines 116–123). That maps to OIcon `add`, which is `material-symbols/add` (filled) — different visual style from `outlinedAdd` but acceptable as a uniform design system choice. Flag only for design QA.

**Solution:** If outlined style is desired, register an outlined add icon in `OIcon.icons.ts` (`"add-outlined": AddOutlined`) and use `icon-left="add-outlined"`. Otherwise leave as-is.

### `MetricList.vue` `OInput` `clearable` + `icon-left` slot
- Lines 234–246: clearable + a `#icon-left` slot with an OIcon. OInput supports both; works.

## Test File Issues

All metrics-related spec files still depend on Quasar:

- `web/src/plugins/metrics/MetricList.spec.ts` line 18: `import { installQuasar }`. Line 28: `vi.mock("quasar", ...)`. The mocked `useQuasar` is no longer used by the component (real reference was removed), but the test still wires it and references `q-select` / `q-input` / `q-btn` stub templates at lines 174, 194, 245.
- `web/src/plugins/metrics/AddToDashboard.spec.ts` line 25–35: mocks `useQuasar.notify`, but `AddToDashboard.vue` no longer calls it (uses `toast` from `useToast` and `useNotifications`). The mock counts will never fire — assertions depending on them will fail or are tautological.
- `web/src/plugins/metrics/MetricLegends.spec.ts`:
  - Line 565: `expect(categoryIcon.classes()).toContain('q-mr-sm');` — the new template uses `tw:mr-2`. Test will fail.
  - Lines 132–137: asserts `mapping.Histogram === "bar_chart"` and `mapping.Counter === "pin"`. These match the current source, but the icons do not exist in the registry — so the test is "green" while the UI is broken.
- `web/src/plugins/metrics/SyntaxGuideMetrics.spec.ts`, `web/src/components/promql/components/LabelFilterEditor.spec.ts`, `web/src/components/promql/components/PromQLBuilderOptions.spec.ts`, `web/src/components/promql/components/OperationsList.spec.ts`, `web/src/plugins/metrics/MetricList.spec.ts`: all still call `installQuasar()` — likely still required to register Quasar globally for some shared mocks, but should be removed once the component tests no longer need Quasar.
- `web/src/components/promql/components/MetricSelector.spec.ts`:
  - Line 93: `it("should render q-select component"...)` — there is no `q-select` in the migrated template.
  - Lines 139–386: 6+ assertions about `wrapper.vm.filteredMetrics` (e.g. `expect(wrapper.vm.filteredMetrics).toEqual(...)`). The ref no longer exists; these all fail.
- `web/src/plugins/metrics/MetricList.spec.ts` line 1197: comment "The catch block calls quasar notify..." — the catch block now calls `toast` (and only conditionally based on `try/catch` ordering, see #1 below).

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers";
- vi.mock("quasar", () => ({ useQuasar: () => ({ notify: vi.fn() }) }));
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
- expect(categoryIcon.classes()).toContain('q-mr-sm');
+ expect(categoryIcon.classes()).toContain('tw:mr-2');
- expect(mapping.Histogram).toBe("bar_chart");
+ expect(mapping.histogram).toBe("bar-chart");
- it("should render q-select component", () => wrapper.find('.q-select')...);
+ it("should render OSelect component", () => wrapper.findComponent({ name: 'OSelect' })...);
```

### Implicit test gap: critical bug #1 not covered
- The `ReferenceError: quasar is not defined` bug in `MetricList.vue` is masked because the test (line 28) mocks `useQuasar`. Add an integration-style assertion (mount without the mock) to surface this kind of regression.

**Solution:** Add a smoke test that mounts `MetricList.vue` without mocking `quasar`:
```ts
it("mounts without throwing", () => {
  expect(() => mount(MetricList, { global: { ... } })).not.toThrow();
});
```

## Validations & Error Handling

- `AddToDashboard.vue` lines 90–93: imports `showErrorNotification` and `showConfictErrorNotificationWithRefreshBtn` from `useNotifications` and uses them inside `addPanelToDashboard`. The "select a dashboard" / "select a tab" cases (lines 178–199) bypass `showErrorNotification` and instead call `toast({ variant: "error" })` directly. Inconsistent error UX between branches; pick one path.
- `MetricList.vue` lines 425–429 (catch outside the promise chain): unreachable — the chain in `getMetricsFieldValues` already has `.catch(...)`, and the outer try/catch can only catch the `stream.fieldValues(...)` constructor throwing synchronously, which it does not.
- `Index.vue` `runQuery` (line 419) and `addToDashboard` (line 577): both call `validatePanel(errors, ...)` and `showErrorNotification` from `useNotifications`, unchanged. OK.

**Solution:**
```diff
- toast({ message: "Please select a dashboard", variant: "error" });
+ showErrorNotification("Please select a dashboard");
```
In `MetricList.vue`, delete the unreachable outer `try { ... } catch (e) { ... }` wrapper around the promise chain.

## Accessibility

- `MetricList.vue` lines 159–225: `<ul>` wraps a single `<label>` which contains its `<input>`-less interaction. There is no actual `<input>` inside the label, so the `<label>` is not associated with any form control; replaces a Quasar `q-item tag="label"` that had a focus-helper. Keyboard focus is lost on these include/exclude rows.
- `MetricList.vue` line 75 (`OSelect` "select stream") lacks an explicit `aria-label` for the empty-state case (`label` is bound to empty string when a metric is chosen). Previously Quasar's floating label provided that semantics.
- `OperationsList.vue` line 26: drag handle uses `OIcon name="drag-indicator"` inside a button but no `aria-label` is provided (Tooltip content `Drag to reorder` is only a hover tooltip).
- `LabelFilterEditor.vue` add/remove buttons: `aria-label` is missing; only `data-test` is set.
- `SyntaxGuideMetrics.vue` external link line 110: `target="_blank"` without `rel="noopener noreferrer"`.

**Solution:**
```diff
- <li><label class="...">{{ value }}</label></li>
+ <li><label tabindex="0" class="..." @keydown.enter="toggle"><input type="checkbox" class="tw:sr-only" />{{ value }}</label></li>
- <OSelect :label="selectedMetric || ''" ... />
+ <OSelect :label="selectedMetric || ''" :aria-label="t('common.selectStream')" ... />
- <button><OIcon name="drag-indicator" /></button>
+ <button :aria-label="t('common.dragToReorder')"><OIcon name="drag-indicator" /></button>
- <a href="..." target="_blank">PromQL Docs</a>
+ <a href="..." target="_blank" rel="noopener noreferrer">PromQL Docs</a>
```

## Recommendations

1. **Critical hot fixes (block release):**
   - Remove `quasar` from `MetricList.vue`'s `setup()` return (line 513).
   - Remove or guard the stray `filteredMetrics.value = []` in `MetricSelector.vue` catch branch (line 72), and re-implement metric typeahead through `OSelect` `searchable` + `@search` listener.
   - Fix `AddToDashboard.vue` toast calls: replace `type: "ongoing"` with `variant: "loading"`; audit all `toast({...})` invocations in this file and `MetricList.vue`.
   - Revert the `tw:flex-col` in `Index.vue` lines 25 and 36 — original was a flex-child column (`col`), not a flex-direction column. The intended Tailwind class is `tw:flex-1`.
   - Drop unused `MetricLegends.vue` references to non-existent icons `bar_chart` / `pin`; reconcile with `MetricList.vue` (`bar-chart` / `tag`). Consider extracting a single shared `metricsIconMapping` constant.

2. **Rebuild the OSelect surface area:**
   - In `MetricList.vue`, `MetricSelector.vue`, `LabelFilterEditor.vue`, and `PromQLBuilderOptions.vue`, remove the Quasar-only attributes (`use-input`, `fill-input`, `hide-selected`, `input-debounce`, `behavior`, `input-class`, `:loading`, `:disable`, `borderless`, `dense`, `stack-label`, `hide-bottom-space`, `filled`, `emit-value`, `map-options`, `option-value`, `option-label`).
   - Replace with `searchable`, `searchDebounce`, `hideSelected`, `labelKey`, `valueKey`, `:disabled`. Use `@search` instead of `@filter`, and switch slot names to `default` (with `<OSelectItem>`s), `empty`, `icon-left`/`icon-right`.
   - Re-implement label icons on selected metric (was Quasar's `v-slot:prepend`) via the OSelect `iconKey` prop or a custom `#trigger` slot.

3. **Fix Tooltip anchoring** in `PromQLBuilderOptions.vue`: wrap the OIcon trigger inside `OTooltip` (or use the icon as the `#trigger` of OTooltip), e.g.:
   ```html
   <OTooltip side="top" max-width="250px">
     <template #trigger><OIcon name="info" size="sm" /></template>
     <template #content>...</template>
   </OTooltip>
   ```

4. **Sweep dead `q-*` SCSS** in:
   - `Index.vue` (`.q-btn`, `q-table__title`)
   - `MetricList.vue` (entire `.q-field--dense` blocks, `.q-table`, `:deep(.q-table__control)`, `label.q-field`)
   - `MetricLegends.vue` and `SyntaxGuideMetrics.vue` (`.q-btn:before`)
   - `OperationsList.vue` (`:deep(.operation-label-selector.q-field--labeled...)`)
   Replace with selectors that target the actual `O*` component classnames / `data-*` attributes, or delete if no longer needed.

5. **Fix Tailwind class typos and prefix order** across `MetricList.vue` (lines 162, 186), `SyntaxGuideMetrics.vue` line 113, `LabelFilterEditor.vue` line 103, and `MetricList.vue` lines 46/160. Standardise on `tw:hover:`-style prefix order to match `web/src/lib/`.

6. **Update / rewrite spec files:**
   - Drop `quasar` mocks where the component no longer touches Quasar.
   - Replace `q-select` / `q-btn` / `q-input` stub assertions with the migrated component names (`OSelect`, `OButton`, `OInput`).
   - Remove `filteredMetrics` assertions in `MetricSelector.spec.ts`.
   - Fix `MetricLegends.spec.ts` line 565 (`q-mr-sm` → `tw:mr-2`).
   - Add a non-mocked smoke test that mounts `MetricList.vue` to catch issues like the undefined `quasar` reference.

7. **Address accessibility gaps:** add `aria-label`s to icon buttons, restore label-input association in the values list, and ensure the external link in `SyntaxGuideMetrics.vue` has `rel="noopener noreferrer"`.

8. **Remove dead code:** unused `filteredLabels` ref and `filterOperationLabels` function in `OperationsList.vue`, unused imports `OSeparator`, `OCard`, `OCardSection` in `MetricLegends.vue` and `SyntaxGuideMetrics.vue`, and the dangling `"add": "add"` return in `MetricList.vue`.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `plugins/metrics/Index.vue:27` | `q-table__title` | drop (no associated CSS) or replace with `o2-table-title` | File-scoped |
| `plugins/metrics/MetricList.vue:19` | `column index-menu` | `tw:flex tw:flex-col index-menu` | File-scoped |
| `components/promql/components/OperationsList.vue:50` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `plugins/metrics/SyntaxGuideMetrics.vue:113` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `plugins/metrics/MetricList.vue:46` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `plugins/metrics/MetricList.vue:160` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `plugins/metrics/MetricList.vue:162` | `tw:flex tw:flex wrap tw:justify-between` (typo `flex wrap`) | `tw:flex tw:flex-wrap tw:justify-between` | File-scoped |
| `plugins/metrics/SyntaxGuideMetrics.vue:113` | `hover:tw:underline` | `tw:hover:underline` | File-scoped |
| `components/promql/components/LabelFilterEditor.vue:103` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `plugins/metrics/Index.vue:25` | `tw:flex tw:items-center tw:flex tw:flex-col` (duplicated `tw:flex`) | `tw:flex tw:flex-col tw:items-center` | File-scoped |
| `plugins/metrics/Index.vue:36` | `tw:flex tw:flex-col tw:flex tw:justify-end` (duplicated `tw:flex`) | `tw:flex tw:flex-col tw:justify-end` | File-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
*(none found)*

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `plugins/metrics/MetricList.vue:569-584` | `.q-field--dense .q-field__before/__prepend/__label/__control/__marginal`, `.q-field__native/__input` | Delete (Quasar field classes no longer rendered by OInput/OSelect) | File-scoped |
| `plugins/metrics/MetricList.vue:593` | `.q-field` (inside media query) | Delete | File-scoped |
| `plugins/metrics/MetricList.vue:634-635` | `:deep(.q-table__control), label.q-field` | Delete; OTable does not emit `.q-table__control` | File-scoped |
| `plugins/metrics/MetricList.vue:707-724` | duplicated `.q-field--*` block | Delete | File-scoped |
| `plugins/metrics/MetricLegends.vue:80` | `.q-btn:before` | Delete (no OButton emits `.q-btn`) | File-scoped |
| `plugins/metrics/SyntaxGuideMetrics.vue:166` | `.q-btn:before` | Delete | File-scoped |
| `plugins/metrics/Index.vue:637` | `.q-btn { ... }` | Delete | File-scoped |
| `components/promql/components/OperationsList.vue:348-350` | `.operation-label-selector.q-field--labeled.showLabelOnTop.q-select .q-field__control-container .q-field__native` | Delete or rewrite to target OSelect's class hooks | File-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `plugins/metrics/SyntaxGuideMetrics.vue:198` | `$primary` | `var(--o2-primary)` | File-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|-----------|-----------|--------|
*(none found)*

### 7. Icon Migration
| File:Line | Issue | Fix |
|-----------|-------|-----|
*(none found — OIcon names already use kebab-case; no `:color` props in these files)*

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `plugins/metrics/MetricList.vue:163` | `style="width: calc(100% - 46px)"` | scoped `.metric-name-wrapper { width: calc(100% - 46px); }` |
| `plugins/metrics/MetricList.vue:173` | `style="width: calc(100% - 50px)"` | scoped class |
| `plugins/metrics/Index.vue:22` | `style="height: 48px; overflow-y: auto"` | scoped `.metrics-header { height: 48px; overflow-y: auto; }` |
| `components/promql/components/PromQLBuilderOptions.vue:7` | `style="display: flex; flex-direction: row"` | replace with `tw:flex tw:flex-row` (drop inline) |
| `components/promql/components/LabelFilterEditor.vue:3` | `style="display: flex; flex-direction: row"` | replace with `tw:flex tw:flex-row` |
| `components/promql/components/MetricSelector.vue:3` | `style="display: flex; flex-direction: row"` | replace with `tw:flex tw:flex-row` |
| `components/promql/components/OperationsList.vue:3` | `style="display: flex; flex-direction: row"` | replace with `tw:flex tw:flex-row` |
| `components/promql/components/OperationsList.vue:144` | `style="max-height: 400px; overflow-y: auto"` | scoped `.operations-list-scroll { max-height: 400px; overflow-y: auto; }` |

### 9. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| `MetricList.vue:569-584` vs `MetricList.vue:707-724` | identical `.q-field--dense` rules inside the same file | Collapse to one block (or delete entirely — see Section 4) |
| `MetricLegends.vue:80` + `SyntaxGuideMetrics.vue:166` | `.q-btn:before` reset | Delete from both (no OButton emits `.q-btn`) |
| `LabelFilterEditor.vue:3` + `MetricSelector.vue:3` + `OperationsList.vue:3` + `PromQLBuilderOptions.vue:7` | `style="display: flex; flex-direction: row"` + `tw:pl-3` | Promote to a shared `<PromQLOption>` wrapper SFC partial |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 1 (PromQL option header wrapper)
- File-level scoped changes: ~22
