# Logs Page — Quasar Removal Audit

## Summary
The Logs page migration is wide but rushed: ~4900 lines deleted / 4200 added across 53 files. Several auto-replacement scripts ran across both **code and strings/comments**, corrupting the copyright header, console messages, comments, and even `return {}` object keys in `setup()`. Multiple components in templates are referenced but never imported (one would render blank). Many `q-pagination`/`q-select`/`q-table` props are silently dropped because the O\* components don't accept them, while >20 test files still import directly from `"quasar"` (now uninstalled) so the spec suite cannot even parse. There is a clear class of regressions where `flex` → `tw:flex tw:flex-col tw:flex` flipped horizontal toolbars into vertical layouts, and CSS rules and CSS variables produced by the migration are not actually consumed anywhere.

## Files Audited
- `web/src/views/Logs.vue`, `web/src/views/Search.vue`, `web/src/views/DetailTable.vue`
- `web/src/plugins/logs/Index.vue`
- `web/src/plugins/logs/SearchBar.vue`
- `web/src/plugins/logs/IndexList.vue`
- `web/src/plugins/logs/SearchResult.vue`
- `web/src/plugins/logs/DetailTable.vue`
- `web/src/plugins/logs/SearchHistory.vue`
- `web/src/plugins/logs/SearchSchedulersList.vue`
- `web/src/plugins/logs/SearchJobInspector.vue`
- `web/src/plugins/logs/SyntaxGuide.vue`
- `web/src/plugins/logs/FunctionSelector.vue`
- `web/src/plugins/logs/TransformSelector.vue`
- `web/src/plugins/logs/VisualizeLogsQuery.vue`
- `web/src/plugins/logs/BuildQueryPage.vue`
- `web/src/plugins/logs/JsonPreview.vue`
- `web/src/plugins/logs/TenstackTable.vue`
- `web/src/plugins/logs/patterns/PatternCard.vue`, `PatternDetailsDialog.vue`, `PatternList.vue`, `PatternStatistics.vue`, `WildcardValuePopover.vue`
- `web/src/components/logs/ChunkedContent.vue`, `LogsHighLighting.vue`
- `web/src/composables/useLogs.ts`, `web/src/composables/useLogs/logsUtils.ts`, `web/src/composables/useLogs/useSearchBar.ts`
- All `*.spec.ts` siblings for the above

## Critical Issues

| # | File:Line | Problem |
|---|---|---|
| 1 | `web/src/plugins/logs/IndexList.vue:132` | Template references `<GroupedFieldListPagination>` which is **not registered** in `components: {}` (only `FieldListPagination` is at line 239) and **does not exist anywhere in the codebase**. The pagination/footer of the field-list will render as a literal unknown element. |

**Solution:**
```diff
- <GroupedFieldListPagination />
+ <FieldListPagination />
```
Rename the tag to match the registered component.

| 2 | `web/src/plugins/logs/IndexList.vue:1875-1877` | Auto-replacement script broke the `setup()` `return { ... }` object: `"add": "add", "visibility-off": "visibility-off", "visibility": "visibility",` — replaced the original variable references (`outlinedAdd, outlinedVisibilityOff, outlinedVisibility`). Not a syntax error but pollutes the exposed surface with literal kebab-case keys and removes the original icon references from the template binding (none currently use them, so likely harmless but it should be deleted). |

**Solution:**
```diff
-      "add": "add",
-      "visibility-off": "visibility-off",
-      "visibility": "visibility",
```
Delete the three lines from the `setup()` return — the OIcon `name="add"` / `name="visibility"` strings are used inline in the template.

| 3 | `web/src/plugins/logs/SearchJobInspector.vue:1` | License header corrupted by sed-style replacement: `<!-- right 2026 OpenObserve Inc.` instead of `<!-- Copyright 2026 OpenObserve Inc.`. Same script likely deleted "Copy". |

**Solution:**
```diff
-<!-- right 2026 OpenObserve Inc.
+<!-- Copyright 2026 OpenObserve Inc.
```

| 4 | `web/src/plugins/logs/SearchResult.vue:1182` | `console.error("[SearchResult] Could not find tw:flex index for correlation", ...)` — auto-replacement turned the word `row` into `tw:flex` **inside a runtime log message**. The message is misleading and ugly in production logs. |

**Solution:**
```diff
-console.error("[SearchResult] Could not find tw:flex index for correlation", ...)
+console.error("[SearchResult] Could not find row index for correlation", ...)
```

| 5 | `web/src/plugins/logs/SearchResult.vue:492, :1318` | HTML comment and source comment contain `tw:inline` (was `inline`). Cosmetic but indicates the rewrite script was un-targeted. |

**Solution:**
```diff
- <!-- ... tw:inline ... -->
+ <!-- ... inline ... -->
```
Replace `tw:inline` with `inline` inside comments at lines 492 and 1318.

| 6 | `web/src/plugins/logs/Index.vue:2533, :3503` & `web/src/plugins/logs/IndexList.vue:1658` | Comments contain auto-replaced `tw:block` / `tw:hidden` — the script replaced English words inside comments. |

**Solution:**
```diff
- // ... tw:block ... or // ... tw:hidden ...
+ // ... block ... or // ... hidden ...
```
Revert the comment text in the three locations.

| 7 | `web/src/plugins/logs/patterns/PatternCard.spec.ts:25`, `PatternList.spec.ts:25`, `PatternStatistics.spec.ts:24`, `WildcardValuePopover.spec.ts:24` | `plugins: [quasar.],` — **syntax error** (trailing dot, then comma). These four spec files will fail to parse. |

**Solution:**
```diff
- installQuasar({ plugins: [quasar.], });
+ installQuasar({ plugins: [] });
```
Drop the `quasar.` placeholder. `installQuasar` is now a no-op shim — `plugins: []` is fine.

| 8 | `web/src/plugins/logs/SearchBar.vue:25`, `web/src/plugins/logs/DetailTable.vue:24`, `web/src/plugins/logs/DetailTable.vue:355` | `class="float-right tw:flex tw:flex-col tw:flex tw:items-center ..."` — auto-replacement added `tw:flex-col` in addition to `tw:flex`. The original Quasar `col flex` was horizontal flex; now the **logs toolbar and the detail dialog tabs are rendered vertically** instead of horizontally. Duplicate `tw:flex` also present. |

**Solution:**
```diff
- class="float-right tw:flex tw:flex-col tw:flex tw:items-center ..."
+ class="tw:flex tw:items-center tw:justify-end ..."
```
Drop `tw:flex-col`, the duplicate `tw:flex`, and the `float-right` Quasar utility (use `tw:justify-end` instead).

| 9 | `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:29-208`, `web/src/components/logs/ChunkedContent.vue:47-58` | Many classes use the **wrong separator**: `tw-mb-[1rem]`, `tw-rounded`, `tw-border-solid`, `tw-flex`, `tw-items-baseline`, `tw-text-sm`, `tw-mt-2`, `tw-gap-3`, `tw-whitespace-pre`, etc. The Tailwind v4 config (`web/src/styles/tailwind.css:1`) uses `prefix(tw)` which requires `tw:` colon, not `tw-` hyphen. **All `tw-*` classes are dead — these elements lose every intended Tailwind utility (spacing, borders, layout).** ChunkedContent's load-more banner and the entire PatternDetailsDialog will render unstyled. |

**Solution:**
```diff
- class="tw-mb-[1rem] tw-rounded tw-border-solid tw-flex tw-items-baseline tw-text-sm tw-mt-2 tw-gap-3 tw-whitespace-pre"
+ class="tw:mb-[1rem] tw:rounded tw:border-solid tw:flex tw:items-baseline tw:text-sm tw:mt-2 tw:gap-3 tw:whitespace-pre"
```
Run a regex replace `\btw-([a-z])` → `tw:$1` across both files.

| 10 | `web/src/plugins/logs/SearchHistory.vue` | The `sortMethod` function (~80 lines, custom numeric sort on `duration`, `took`, `scan_records`, `scan_size`, `cached_ratio`, `start_time`, `end_time`, `executed_time`) is **deleted entirely**. Sorting now defaults to string-based on the rendered field — numerical columns will sort incorrectly. |

**Solution:**
```ts
// Re-add a sort callback and pass it via OTable's @sort-change or :sort-method prop
const customSort = (rows, sortBy, descending) => {
  const data = [...rows];
  const num = (v) => Number(v ?? 0);
  data.sort((a, b) => {
    const x = num(a[sortBy]), y = num(b[sortBy]);
    return descending ? y - x : x - y;
  });
  return data;
};
```
Bind `:sort-method="customSort"` (or equivalent OTable prop) on the `<OTable>` and pre-sort the underlying rows array.

| 11 | `web/src/plugins/logs/SearchHistory.vue:73-225` & `SearchSchedulersList.vue:43-238` | `changePagination` + `QTablePagination` + per-page selector were removed from `#bottom`. Users cannot change rows-per-page from the footer; the value is hardcoded to 100. The `q-separator` between the result count and pagination controls is also gone. |

**Solution:**
```vue
<template #bottom>
  <div class="tw:flex tw:items-center tw:justify-between tw:w-full">
    <span>{{ totalRows }} rows</span>
    <OSeparator vertical />
    <OSelect v-model="rowsPerPage" :options="[25, 50, 100, 250]" dense />
    <OPagination v-model="page" :max="maxPages" />
  </div>
</template>
```
Restore a rows-per-page `<OSelect>`, an `<OSeparator vertical>`, and an `<OPagination>` in the OTable `#bottom` slot.

| 12 | 8 spec files import directly from `"quasar"` | Quasar has been removed from `web/package.json`. Affected: `web/src/plugins/logs/DetailTable.spec.ts:19`, `SyntaxGuide.spec.ts:19`, `SearchHistory.spec.js:3`, `patterns/PatternCard.spec.ts:19`, `patterns/PatternList.spec.ts:19`, `patterns/PatternDetailsDialog.spec.ts:19`, `patterns/PatternStatistics.spec.ts:19`, `patterns/WildcardValuePopover.spec.ts:19`. They cannot resolve the module and will error before running. |

**Solution:**
```diff
- import { copyToClipboard } from "quasar";
+ import { copyToClipboard } from "@/utils/clipboard";

- import { QBtn, QMenu, QCard, QCardSection, QSeparator, QTooltip } from "quasar";
+ // Components are auto-registered globally for tests; remove import

- import { useQuasar } from "quasar";
+ // Drop — components no longer call useQuasar (use `toast` from `@/utils/toast`)

- import * as quasar from "quasar";
+ // Drop — installQuasar is a no-op shim
```
Remove all direct `quasar` imports; substitute with project utils or delete.

## Logical Issues

| File:Line | Issue |
|---|---|
| `web/src/plugins/logs/SearchBar.vue:216, :333` | `v-close-popup` directive (Quasar) is still on dropdown items. Without Quasar, this directive is undefined — the dropdown will not auto-close when user picks a saved view. Also at `web/src/views/DetailTable.vue:27` (`OButton` with `v-close-popup`). |

**Solution:**
```diff
- <ODropdownItem v-close-popup @click="selectSavedView(view)">
+ <ODropdownItem @click="selectSavedView(view); savedViewOpen = false">
```
Drop `v-close-popup` and flip the controlling ref (`v-model:open="savedViewOpen"` on `<ODropdown>`) to false inside the handler.

| `web/src/plugins/logs/IndexList.vue:252-254` | `this.$refs.streamSelect.updateInputValue("")` — `OSelect` does not expose `updateInputValue` (or `hidePopup`, `scrollTo`). The whole `handleMultiStreamSelection` body is a silent no-op; stream search filter is no longer cleared after selecting streams. |

**Solution:**
```diff
- this.$refs.streamSelect.updateInputValue("");
- this.$refs.streamSelect.hidePopup();
+ this.streamSearchValue = "";
+ this.streamSelectOpen = false;
```
OSelect surfaces no imperative input API — control the search text and open state with refs bound via `v-model:search` / `v-model:open`.

| `web/src/plugins/logs/IndexList.vue:1890-1900` | The `streamFieldsRows` computed lost the call to `applyCollapseFilter(source, expandGroupRows, filterField)`. The grouped field collapse/expand logic and the field-name search filter inside the computed are both dropped. Group state held in `searchObj.data.stream.expandGroupRows` no longer affects the list. |

**Solution:**
```diff
  const streamFieldsRows = computed(() => {
-   return source;
+   return applyCollapseFilter(
+     source,
+     searchObj.data.stream.expandGroupRows,
+     searchObj.data.stream.filterField,
+   );
  });
```
Restore the previous call so group state and field-name filter feed the rendered list.

| `web/src/plugins/logs/IndexList.vue:666, :701, :1859, :1867` | `filterStreamFn` and `filterFieldFn` are still defined and exported in `setup()` but **not bound to any event in the template** (old `@filter="filterStreamFn"`/`:filter-field-fn` are gone). Dead code. |

**Solution:** Delete the function definitions (lines 666 and 701) and remove `filterStreamFn` / `filterFieldFn` from the `setup()` return at lines 1859 and 1867. They are no longer reachable.

| `web/src/plugins/logs/IndexList.vue:1831-1847, :1885` | `onPaginationUpdate` is still defined and exported but no template binding exists (`@update:pagination` removed). The "preserve current page during loadingStream" logic is unreachable. |

**Solution:** Delete `onPaginationUpdate` (1831-1847) and its entry in the setup return (1885). If pagination preservation is still desired, wire the new OTable pagination event back to a watcher on `searchObj.data.stream.loading`.

| `web/src/plugins/logs/IndexList.vue:1476-1480, :1889` | `toggleFieldGroup` is still defined / exported but the template no longer emits `@toggle-group` to call it. Per-group expand/collapse interaction effectively dead. |

**Solution:** Either re-bind on the row template (`@click="toggleFieldGroup(group)"`) or delete the function (1476-1480) and its export at line 1889.

| `web/src/plugins/logs/SearchResult.vue:120-170` | `OPagination` (per `web/src/lib/navigation/Pagination/OPagination.types.ts`) supports only `modelValue, max, disable, maxPages`. The migration passes `:input=false`, `direction-links`, `:boundary-numbers=false`, `:ellipses=false`, `icon-first/icon-last/icon-prev/icon-next`, `rowsPerPageLabel`, `:rows-per-page-options`, `:rows-per-page` — **all silently ignored**. Skip-first/last buttons, ellipses and the rows-per-page selector are gone from the pagination UI. |

**Solution:**
```diff
- <OPagination v-model="page" :max="totalPages" :input="false" direction-links
-   :boundary-numbers="false" :ellipses="false"
-   icon-first="skip_previous" icon-last="skip_next"
-   icon-prev="fast_rewind" icon-next="fast_forward"
-   :rows-per-page-options="[10,25,50,100]" :rows-per-page="rowsPerPage"
-   :rowsPerPageLabel="'Rows per page'" />
+ <OPagination v-model="page" :max="totalPages" :max-pages="5" :disable="loading" />
+ <OSelect v-model="rowsPerPage" :options="[10,25,50,100]" dense class="tw:w-24" />
```
Use the supported `max-pages`/`disable` props and add a separate `<OSelect>` for rows-per-page (or extend `OPagination.types.ts` with the missing props).

| `web/src/plugins/logs/SearchResult.vue:149` | `OSelect` for rows-per-page lost `dense` and `borderless`. May appear with default chrome (border, padding). |

**Solution:**
```diff
- <OSelect v-model="rowsPerPage" ...></OSelect>
+ <OSelect v-model="rowsPerPage" dense class="tw:border-0 tw:shadow-none" ...></OSelect>
```
OSelect supports `dense`; emulate `borderless` with utility classes.

| `web/src/plugins/logs/SearchBar.vue:4186, :2942, :2944` | `showDownloadMenu` ref is still declared and set to `false` in two catch/finally branches, but it is no longer bound in the template (replaced by `showDownloadSubmenu`). Dead state. |

**Solution:** Delete `const showDownloadMenu = ref(false)` (line 4186) and the two `showDownloadMenu.value = false` assignments at 2942 and 2944.

| `web/src/plugins/logs/DetailTable.vue:18-22` | Lost prop `:style="{ borderTop: \`4px solid ${statusColor}\`}"` on `<q-card>`. The colored status stripe at the top of the row-detail dialog (OK/warn/error) is gone. |

**Solution:**
```diff
- <ODrawer ...>
+ <ODrawer ... :style="{ borderTop: `4px solid ${statusColor}` }">
```
Forward the original border-top style to the new `<ODrawer>` root.

| `web/src/plugins/logs/DetailTable.vue:75` | `class="tab-panels-container tw:h-screen tw:overflow-y-auto ..."` — was `tw:flex-1 tw:min-h-0 tw:overflow-y-auto`. Replacing `flex-1`/`min-h-0` with `h-screen` makes the tab area always full viewport regardless of drawer container, causing layout overflow inside the row-detail drawer. |

**Solution:**
```diff
- class="tab-panels-container tw:h-screen tw:overflow-y-auto ..."
+ class="tab-panels-container tw:flex-1 tw:min-h-0 tw:overflow-y-auto ..."
```

| `web/src/plugins/logs/DetailTable.vue:367` | `<div class="tw:w-1/12 tw:items-end" style="display: contents;">` — `display: contents` removes the wrapper from layout but the wrapper still has `w-1/12`. Either the column-grid layout is broken or those classes do nothing. |

**Solution:**
```diff
- <div class="tw:w-1/12 tw:items-end" style="display: contents;">
+ <div class="tw:items-end" style="display: contents;">
```
Drop `tw:w-1/12` — with `display:contents` it has no effect; if the column width is needed, remove the inline `display:contents` instead.

| `web/src/plugins/logs/SearchJobInspector.vue` | Removed `q-dialog` for SQL/TraceID was replaced by `ODrawer` + `ODialog`. The `Copy SQL` tooltip in `<OTooltip :content="copiedSql ? 'Copied!' : 'SQL'" />` lost the word "Copy" — was previously `'Copy SQL'` per the old `q-tooltip`. Minor copy regression. |

**Solution:**
```diff
- <OTooltip :content="copiedSql ? 'Copied!' : 'SQL'" />
+ <OTooltip :content="copiedSql ? 'Copied!' : 'Copy SQL'" />
```

| `web/src/composables/useLogs.ts:158-172` | Toast for "Job Added Successfully" lost `color: "white"` on action button. Toast for "Live mode is enabled..." changed position from `top` to `top-center`. Verify the new toast helper supports these arguments — `actions: [{ label, handler }]` should still map. |

**Solution:**
```diff
- toast({ message: "Live mode is enabled...", position: "top-center", ... })
+ toast({ message: "Live mode is enabled...", position: "top", variant: "info", ... })
```
Match the prior position and add `variant` to preserve the colored accent.

| `web/src/plugins/logs/IndexList.vue:42` | `<OSelect ref="streamSelect" multiple>` — the original `q-select` had `use-input`, `behavior="menu"`, `input-debounce="0"`, `emit-value`, `map-options`, and a custom `<template #option>` per row with a per-item toggle (line-by-line single-stream toggle vs check toggle). The new OSelect uses a generic multi-select; the per-row click that immediately switches to single-stream selection is **removed**. |

**Solution:**
```vue
<OSelect ref="streamSelect" multiple v-model="selectedStreams" :options="streamOptions">
  <template #item="{ option }">
    <div class="tw:flex tw:items-center tw:justify-between">
      <span @click.stop="setSingleStream(option)">{{ option.label }}</span>
      <OCheckbox :model-value="isSelected(option)" @click.stop="toggleStream(option)" />
    </div>
  </template>
</OSelect>
```
Use the OSelect `#item` slot (see `OSelect.types.ts`) to restore the per-row click vs toggle UX.

| `web/src/plugins/logs/SearchBar.vue:25` | The `float-right` class is meaningless inside a `tw:flex` parent, and the new layout forces `tw:flex-col` so the SQL/Histogram toggles, ButtonGroup, etc. stack vertically. |

**Solution:**
```diff
- class="float-right tw:flex tw:flex-col tw:flex tw:items-center ..."
+ class="tw:flex tw:items-center tw:justify-end ..."
```
Same fix as Critical #8.

## CSS / Layout Issues

| File:Line | Issue |
|---|---|
| `web/src/plugins/logs/Index.vue:324, :340` | `:style="{ '--splitter-width': ... vw }"` — old code set `--splitter-height` in `vh`. Neither variable is consumed anywhere in CSS (`grep var(--splitter-` returns nothing). Dead binding with changed semantics. |

**Solution:** Either delete the `:style="{ '--splitter-width': ... }"` binding entirely on lines 324 and 340, OR wire it up by adding `height: var(--splitter-height, 100%)` to `.visualize-container` / `.build-container` in scoped CSS.

| `web/src/plugins/logs/SearchJobInspector.vue:43, :88, :125, :162, :202` | `tw:font-small` is **not a valid Tailwind utility** — produces no CSS. Used 5 times in the Inspector stat tiles. |

**Solution:**
```diff
- class="... tw:font-small ..."
+ class="... tw:text-sm ..."
```
Replace all 5 occurrences.

| `web/src/plugins/logs/JsonPreview.vue:6` | `tw:text-[]` with empty arbitrary value — invalid Tailwind class. |

**Solution:**
```diff
- class="... tw:text-[] ..."
+ class="... tw:text-sm ..."
```
Or remove the empty class entirely.

| `web/src/plugins/logs/JsonPreview.vue:38` (`tw:w-[auto]`) | Should be `tw:w-auto`; still resolves in v4 but inconsistent. |

**Solution:**
```diff
- tw:w-[auto]
+ tw:w-auto
```

| `web/src/plugins/logs/Index.vue:3481, :3485, :3489, :3493` | Scoped CSS still selects `.q-table`, `.q-table__top`, `.q-table__control`, `.q-field__native`, `.q-field__input`, `.q-field__control-container`. These selectors target Quasar DOM that no longer exists — rules are dead. |

**Solution:** Delete the dead selectors. The OTable / OInput components ship their own styles; if you need overrides, target the new internal classes (`.o-table__top`, `.o-input__inner`, etc.) or pass `class` props.

| `web/src/plugins/logs/IndexList.vue:1978` | `.OIcon { ... }` selector — `OIcon` is a component, not a CSS class, so this style does nothing. The old `.q-icon` rule applied real styling to icon roots. Icons in IndexList lose their per-component margin/sizing override. |

**Solution:**
```diff
- .OIcon { margin-right: 4px; ... }
+ :deep(svg[data-o-icon]) { margin-right: 4px; ... }
```
OIcon renders an inline-flex `<svg>`. Target the SVG (or pass `class` to OIcon).

| `web/src/plugins/logs/IndexList.vue:1988, :1993` | Selectors `.q-toggle__inner` and `.q-toggle__thumb:before` still in scoped CSS — Quasar DOM doesn't exist; the OSwitch will not pick up these overrides. |

**Solution:** Delete `.q-toggle__inner` / `.q-toggle__thumb:before` blocks. OSwitch styling lives in its own component; override via OSwitch props or `--o2-*` tokens.

| `web/src/plugins/logs/SearchBar.vue:5400, :5405, :5445, :5460, :5472, :5572` | `.q-dark .q-btn`, `:deep(.q-btn)`, `.q-btn__content`, `:deep(.q-splitter__separator)` rules in scoped CSS. OButton/OSplitter do not render the same internal class names — rules dead. |

**Solution:** Delete all the `:deep(.q-*)` blocks at the listed lines. `.q-dark` is now `html.dark`. If hover/dark styles are required, use the OButton variant props (`variant="ghost"` etc.) or design tokens.

| `web/src/plugins/logs/SyntaxGuide.vue:266` | `:deep(.q-btn__content)` — dead selector. |

**Solution:** Delete the `:deep(.q-btn__content)` block at line 266.

| `web/src/plugins/logs/SearchJobInspector.vue:759` | `color: var(--q-primary)` — refers to a Quasar CSS variable. If `--q-primary` is no longer defined globally, this falls through to inherited or initial color (potentially black). |

**Solution:**
```diff
- color: var(--q-primary);
+ color: var(--o2-primary);
```

| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:116, :135`, `web/src/components/logs/ChunkedContent.vue:58` | Use `var(--q-primary)` inline or in arbitrary class — same risk as above. |

**Solution:**
```diff
- var(--q-primary)
+ var(--o2-primary)
```
Replace in all 3 locations.

| `web/src/plugins/logs/Index.vue:24, :27, :57, :67, :286`, `SearchResult.vue:21, :30`, `SearchHistory.vue:221`, `SearchSchedulersList.vue:221`, `DetailTable.vue:74` (`full-height-panels`), `SearchBar.vue:1645, :1773` | `full-height`, `full-width`, `column` are Quasar utility classes. They may or may not be defined in current global CSS (Quasar bundle removed). Spot-check confirms they're referenced ~10× per file and probably broken. |

**Solution:**
```diff
- class="full-height full-width column"
+ class="tw:h-full tw:w-full tw:flex tw:flex-col"
```
Replace each occurrence across the listed files.

| `web/src/plugins/logs/Index.vue:139, etc.`, `SearchResult.vue:218, :233, :260, :282` | `tw:text-center tw:m-0` + `h5`/`h6` with no `tw:` font-size class — relies on browser h5/h6 defaults; previously Quasar had global `<h5>` styles tied to typography tokens. Possible regression on empty-state text size. |

**Solution:**
```diff
- <h5 class="tw:text-center tw:m-0">No data</h5>
+ <h5 class="tw:text-center tw:m-0 tw:text-xl tw:font-medium">No data</h5>
```
Add explicit `tw:text-xl` (h5) or `tw:text-lg` (h6) to restore the prior visual weight.

| `web/src/plugins/logs/SearchBar.vue:209, :327` | `class="... saved-view-item tw:hover:bg-[var(--o2-hover-accent)]"` — Tailwind v4 syntax is correct, but `--o2-hover-accent` must exist as a CSS variable — verify in tokens/semantic.css. |

**Solution:**
```diff
- tw:hover:bg-[var(--o2-hover-accent)]
+ tw:hover:bg-[var(--o2-bg-accent)]
```
If `--o2-hover-accent` is missing, swap to the defined `--o2-bg-accent` (or whatever the semantic-tokens file exposes for hover background).

| `web/src/plugins/logs/SearchBar.vue:521`, `web/src/plugins/logs/SearchBar.vue:705, :728`, `web/src/plugins/logs/SearchResult.vue:136, :149, :162`, `FunctionSelector.vue:19`, `TransformSelector.vue:20`, `web/src/plugins/logs/DetailTable.vue:60` | Quasar `float-right`/`float-left`/`col-auto` survive but are conceptually wrong inside the new `tw:flex` parents. Mostly cosmetic (`float-right` has no effect inside a flex container), but `col-auto` references the Quasar grid which is gone. |

**Solution:**
```diff
- class="float-right ..."   →   class="tw:ml-auto ..."
- class="float-left ..."    →   class="tw:mr-auto ..."
- class="col-auto ..."      →   class="tw:flex-none ..."
```
Apply across all the cited lines.

| `web/src/plugins/logs/SearchHistory.vue:10, :22`, `SearchSchedulersList.vue:22` | `tw:font-semibold tw:font-[600]` — duplicate font-weight utilities. Last wins, but redundant. |

**Solution:**
```diff
- class="... tw:font-semibold tw:font-[600] ..."
+ class="... tw:font-semibold ..."
```

| `web/src/plugins/logs/IndexList.vue:156, :187`, `SearchBar.vue:187, :1666`, `TenstackTable.vue:153, :166, :184`, `PatternCard.vue:76`, `PatternDetailsDialog.vue:30, :50, :73, :91, :112, :131, :168, :180, :208` | `text-weight-bold` / `text-weight-medium` are leftover Quasar typography classes. Without Quasar's global CSS they have no effect; `tw:font-medium`/`tw:font-bold` is the actual style — leftovers should be removed. |

**Solution:**
```diff
- class="text-weight-bold ..."
+ class="tw:font-bold ..."

- class="text-weight-medium ..."
+ class="tw:font-medium ..."
```

| `web/src/styles/app.scss:105-107` | `.element-box-shadow` rule is **commented out**, but the class is used **14× in `web/src/plugins/logs/`** (SearchBar, FunctionSelector, TransformSelector, etc.). Toolbar elements lose their drop shadow. |

**Solution:**
```diff
- // .element-box-shadow { box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
+ .element-box-shadow { box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
```
Un-comment the rule in `web/src/styles/app.scss:105-107` (or delete the class from all 14 templates).

| `web/src/styles/app.scss:581-666` | `.o2-quasar-table` rules target `th, td` — `OTable`'s DOM may differ. Spot-check `SearchHistory.vue`, `SearchSchedulersList.vue`, `DetailTable.vue` which all kept the `o2-quasar-table` class on the new `OTable`. |

**Solution:** Rename `.o2-quasar-table` → `.o2-table-classic` (or similar) and re-target `th`, `td` via OTable's slot DOM (`.o-table__head th`, `.o-table__row td`). Verify against OTable's rendered structure.

| `web/src/plugins/logs/SearchJobInspector.vue:347` | `<table class="o2-quasar-table o2-row-md ...">` is now used on `OTable`, but the class still depends on Quasar's `<table><thead><tbody>` selector chain. |

**Solution:**
```diff
- <OTable class="o2-quasar-table o2-row-md ..." ...>
+ <OTable class="o2-row-md ..." ...>
```
Drop `o2-quasar-table` (and re-apply via the renamed selector once the SCSS in `app.scss:581-666` targets OTable).

## Component Migration Issues

| Old → New | File:Line | Problem |
|---|---|---|
| `q-select` → `OSelect` (stream picker) | `IndexList.vue:42-66` | Lost: `behavior="menu"`, `use-input`, `input-debounce="0"`, `emit-value`, `map-options`, custom `<template v-slot:option>` with per-option `q-toggle`, ref method `updateInputValue`, `hidePopup`, `scrollTo`. The custom row template that let you click a row vs toggle (single vs multi pick) is **gone**. |

**Solution:** See Logical Issues "IndexList.vue:42" above — use OSelect's `#item` slot to rebuild the per-row click vs toggle UX.

| `q-table` → `OTable` (saved views) | `SearchBar.vue:170-300` | Replaced with manual rendering using `paginatedSavedViews`. The Quasar inline-edit/sort, `wrap-cells`, `:hide-bottom`, and the q-input within `top-right` slot are all reconstructed by hand. Loses Quasar's keyboard nav and accessibility. |

**Solution:**
```vue
<OTable :rows="savedViews" :columns="cols" :wrap-cells="true" :hide-bottom="true">
  <template #top-right><OInput v-model="search" placeholder="Search views" /></template>
</OTable>
```
Replace the hand-rolled `paginatedSavedViews` loop with a single OTable; rely on its slots for top-right input and built-in keyboard nav.

| `q-table` → `OTable` (SearchHistory) | `SearchHistory.vue:69-235` | Lost `sort-method`, `pagination.sync`, `rows-per-page-options`, `wrap-cells`. `expansion="single"` + `expand-on-row-click=true` is a UX change (was a click on dedicated expand button). |

**Solution:** Add `:sort-method="customSort"` (see Critical #10), `v-model:pagination="pagination"`, `:rows-per-page-options="[25,50,100]"`, and `:wrap-cells="true"` on `<OTable>`. Use `expand-on-icon-click` (not row-click) to restore the previous expand UX.

| `q-table` → `OTable` (SearchSchedulersList) | `SearchSchedulersList.vue:43-235` | Lost `sortMethod`, custom `<template v-slot:header>`, expand button, pagination footer rows-per-page selector. |

**Solution:** Mirror the SearchHistory fix — add `:sort-method`, `v-model:pagination`, `:rows-per-page-options`, restore `<template #header>` and the explicit expand-icon button column.

| `q-tooltip` (sibling child of host) → `<OTooltip />` (sibling, no slot) | Many files | OTooltip child-mode looks at `parentElement`. Works as long as the OTooltip is the **direct DOM child** of the desired anchor. When OTooltip is placed inside a Vue slot that re-wraps (e.g. inside `OButton`), `parentElement` may be a Reka-UI wrapper rather than the visible button — verify per-component. Suspicious uses: `SearchBar.vue:49, :89, :105, :127, :149, :397, :548, :1044, :1550, :2046+`. |

**Solution:**
```vue
<OButton>
  <OTooltip :content="..." />
  <OIcon name="search" />
</OButton>
```
Where the slot wraps the OTooltip in an additional Reka-UI element, wrap the trigger in a single `<span>` and put `OTooltip` as a sibling of the visible element inside that span.

| `q-banner` → `OBanner` | `SearchJobInspector.vue:259` | `OBanner` now takes `:content` prop; the original used `<template v-slot:avatar>`. Verify OBanner supports the same icon slot. |

**Solution:**
```vue
<OBanner>
  <template #icon><OIcon name="info" /></template>
  Job inspector banner content
</OBanner>
```
Use OBanner's `#icon` slot in place of the old `#avatar` slot.

| `q-dialog position="right" full-height maximized` → `ODrawer` | `SearchResult.vue:414`, `SearchJobInspector.vue:320`, `BuildQueryPage.vue:34`, `VisualizeLogsQuery.vue:40` | `@escap.stop="reDrawChart"` was a Quasar event (likely typo for `@escape`). Migration converted to `@update:open="(v) => !v && reDrawChart()"`. Verify Escape key still closes the drawer. |

**Solution:**
```vue
<ODrawer
  v-model:open="drawerOpen"
  @update:open="(v) => !v && reDrawChart()"
  :close-on-escape="true"
/>
```
Explicitly pass `:close-on-escape="true"` (default true but make it visible) so Escape closes the drawer and triggers the re-draw.

| `q-pagination` → `OPagination` | `SearchResult.vue:120` | See Logical Issues — many props silently ignored. |

**Solution:** See Logical Issues `SearchResult.vue:120-170` — collapse props down to the supported `modelValue/max/maxPages/disable` set, and move the rows-per-page picker to a separate `<OSelect>`.

| `q-toggle` (with slot icons) → `OSwitch` | `SearchBar.vue:82-129`, `DetailTable.vue:60-71`, `FunctionSelector.vue:22-30`, `SearchHistory.vue:31-42` | OSwitch label slot signature differs. SQL/Histogram toggles previously rendered icon+text via children; now they use `<template #label><OIcon/><OTooltip/></template>`. Ensure `OSwitch` supports a `label` slot (otherwise the icon/tooltip will not appear). |

**Solution:**
```vue
<OSwitch v-model="enabled">
  <template #label>
    <OIcon name="data-table" /> SQL
  </template>
</OSwitch>
```
If OSwitch lacks a `#label` slot, render the icon and label as siblings inside the wrapping toolbar container instead.

| `q-spinner-hourglass` → `OSpinner` | Many places | Lost the distinctive hourglass spinner; replaced with a generic spinner. Cosmetic but visual regression of "search-spinner". |

**Solution:**
```diff
- <OSpinner />
+ <OSpinner variant="hourglass" />
```
If OSpinner has no `hourglass` variant, accept the cosmetic regression or extend OSpinner with the variant — purely cosmetic.

| `q-icon name="snake_case"` → `OIcon name="kebab-case"` | All files | Migration of `q-icon` names: `arrow_back_ios_new` → `arrow-back-ios-new`, `content_copy` → `content-copy`, `wrap_text` → `wrap-text`, `expand_more` → `expand-more`, etc. Verify each icon name exists in the new OIcon library — otherwise icons render blank. Spot examples: `IndexList.vue:381-384`, `SearchHistory.vue:18`, `DetailTable.vue:113, :350, :386`. |

**Solution:** Verified `arrow-back-ios-new`, `content-copy`, `wrap-text`, `expand-more`, `info-outline` exist in `web/src/lib/core/Icon/OIcon.icons.ts`. For any missing name, add a registry entry:
```ts
import MyIcon from "~icons/material-symbols/my-icon-outline";
// in iconRegistry:
"my-icon": MyIcon,
```

| `q-chip` → `OBadge` | `PatternCard.vue:62-68` | `OBadge size="sm"` — verify it has the same wildcard chip styling expectations (`wildcard-chip` CSS class still references it). |

**Solution:**
```vue
<OBadge size="sm" class="wildcard-chip">{{ wildcard }}</OBadge>
```
Confirm the SCSS for `.wildcard-chip` no longer targets `.q-chip__content`. Re-scope to the OBadge root.

| `q-menu` → `ODropdown` (SyntaxGuide) | `SyntaxGuide.vue:18-180` | `q-card flat` containers replaced with plain `<div>` and a hand-rolled `tw:border-t tw:my-1 tw:border-dropdown-separator` for the separator. The padding scheme is different — verify visual parity. |

**Solution:**
```vue
<ODropdown>
  <template #content>
    <div class="tw:p-4">...</div>
    <OSeparator class="tw:my-2" />
    <div class="tw:p-4">...</div>
  </template>
</ODropdown>
```
Use the `<OSeparator>` component instead of the hand-rolled `tw:border-t tw:my-1` divs.

| `copyToClipboard` import | `SearchResult.vue:524`, `SearchHistory.vue`, `SearchSchedulersList.vue`, `DetailTable.vue` | Migrated from `import { copyToClipboard } from "quasar"` → `import { copyToClipboard } from "@/utils/clipboard"`. New signature uses options object `{ successMessage, timeout }` — verify the call sites pass the new shape (most do, but SearchResult line 524 still calls `copyToClipboard(...)` from inside the old call pattern). |

**Solution:**
```diff
- copyToClipboard(text);
+ copyToClipboard(text, { successMessage: "Copied!", timeout: 2000 });
```
Update SearchResult.vue:524 to pass the options object.

## Test File Issues

| File | Issue |
|---|---|
| `web/src/plugins/logs/DetailTable.spec.ts:19` | `import { copyToClipboard } from "quasar";` — module not installed. |
| `web/src/plugins/logs/SyntaxGuide.spec.ts:19` | `import { QBtn, QMenu, QCard, QCardSection, QSeparator, QTooltip } from "quasar";` — fails to resolve. |
| `web/src/plugins/logs/SearchHistory.spec.js:3` | `import { useQuasar } from "quasar";` — fails to resolve. |
| `web/src/plugins/logs/patterns/PatternCard.spec.ts:19, :25` | `import * as quasar from "quasar"` + `plugins: [quasar.],` (**syntax error**). |
| `web/src/plugins/logs/patterns/PatternList.spec.ts:19, :25` | Same as above. |
| `web/src/plugins/logs/patterns/PatternStatistics.spec.ts:19, :24` | Same syntax error. |
| `web/src/plugins/logs/patterns/WildcardValuePopover.spec.ts:19, :24` | Same syntax error. |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.spec.ts:19` | `import * as quasar from "quasar"` — resolves to nothing; tests that reference `quasar.X` will throw. |
| `web/src/plugins/logs/SearchSchedulersList.spec.ts:60-579`, `SearchSchedulersList.spec.js:6` | Mocks Quasar via `mockQuasar = { ... notify: ... }`; old tests check `expect(mockQuasar.notify).toHaveBeenCalledWith(...)`. Component now calls `toast()` not `$q.notify()`; assertions fail. |
| `web/src/plugins/logs/SyntaxGuide.spec.ts:297-350` | Asserts `button.classes()` contains `q-ml-xs` and `q-pa-xs` — but the migration replaced `q-ml-xs` with `tw:ml-1` and removed `q-pa-xs`. Tests will fail. |
| `web/src/plugins/logs/DetailTable.spec.ts:140-220` | Registers `q-card`, `q-card-section`, `q-separator`, `q-btn`, `q-tabs`, `q-tab`, `q-tab-panels`, `q-tab-panel`, `q-toggle`, `q-list`, `q-item`, `q-item-section`, `q-item-label`, `q-btn-dropdown`, `q-select` as stubbed components. Components no longer in template (`OCard`, `OCardSection`, `OTabs`, etc. are used instead) — stubs are dead and tests miss the new tree. |
| `web/src/plugins/logs/SearchSchedulersList.spec.ts:119-129` | Stubs `q-table`, `q-btn`, `q-toggle`, `q-tabs`, `q-tab`, `q-tab-panels`, `q-tab-panel`, `q-select`. Template now uses `OTable`/`OButton`/etc.; the assertions on rendered q-\* nodes won't match. |
| `web/src/plugins/logs/VisualizeLogsQuery.spec.ts:208-625` | Stubs `q-splitter`, `q-splitter-panel`, asserts `wrapper.find(".q-dialog").exists()` — comments in the spec acknowledge the migration but the migration-coverage assertions only check absence, not new positive coverage. Mostly OK but ignore the q-\* stubs. |
| `web/src/plugins/logs/IndexList.spec.ts:49` | Mocks `@/composables/useLogs` but the `LogsPluginFieldList`/`GroupedFieldList` swap is not reflected. May test the wrong component. |
| `web/src/composables/useLogs/logsUtils.spec.ts:81` | Mocks `useQuasar` even though `logsUtils.ts` no longer calls it. Dead mock. |
| `web/src/composables/useLogs.spec.ts` | Likely mocks `useQuasar` similarly. |

**Solutions for the Test File Issues table above:**

```diff
// DetailTable.spec.ts:19
- import { copyToClipboard } from "quasar";
+ import { copyToClipboard } from "@/utils/clipboard";

// SyntaxGuide.spec.ts:19
- import { QBtn, QMenu, QCard, QCardSection, QSeparator, QTooltip } from "quasar";
+ // O* components are auto-registered; remove the import.

// SearchHistory.spec.js:3
- import { useQuasar } from "quasar";
+ // Component no longer uses $q; assert against toast() from @/composables/useToast

// PatternCard.spec.ts, PatternList.spec.ts, PatternStatistics.spec.ts,
// WildcardValuePopover.spec.ts, PatternDetailsDialog.spec.ts
- import * as quasar from "quasar";
- installQuasar({ plugins: [quasar.], });
+ installQuasar({ plugins: [] });

// SearchSchedulersList.spec.ts/.js — replace Quasar notify mock with toast
- const mockQuasar = { notify: vi.fn() };
- vi.mock("quasar", () => ({ useQuasar: () => mockQuasar }));
- expect(mockQuasar.notify).toHaveBeenCalledWith(...);
+ const toast = vi.fn();
+ vi.mock("@/composables/useToast", () => ({ useToast: () => ({ toast }) }));
+ expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "..." }));

// SyntaxGuide.spec.ts:297-350
- expect(button.classes()).toContain("q-ml-xs");
- expect(button.classes()).toContain("q-pa-xs");
+ expect(button.classes()).toContain("tw:ml-1");
+ expect(button.classes()).toContain("tw:p-1");

// DetailTable.spec.ts & SearchSchedulersList.spec.ts — swap stub keys to O*
- stubs: { "q-card": true, "q-btn": true, "q-table": true, "q-toggle": true, ... }
+ stubs: { OCard: true, OButton: true, OTable: true, OSwitch: true, OTabs: true,
+          OTab: true, OTabPanels: true, OTabPanel: true, OSelect: true,
+          OSeparator: true, ODropdown: true }

// VisualizeLogsQuery.spec.ts:208-625
- stubs: { "q-splitter": true, "q-splitter-panel": true }
- expect(wrapper.find(".q-dialog").exists()).toBe(false);
+ stubs: { OSplitter: true, OSplitterPanel: true }
+ expect(wrapper.findComponent({ name: "ODrawer" }).exists()).toBe(true);

// IndexList.spec.ts:49 — also stub new field-list children
+ const wrapper = mount(IndexList, {
+   global: { stubs: { GroupedFieldList: true, FieldListPagination: true } },
+ });

// logsUtils.spec.ts:81 and useLogs.spec.ts
- vi.mock("quasar", () => ({ useQuasar: () => ({ notify: vi.fn() }) }));
+ // Delete — composable no longer touches Quasar.
```

## Recommendations

1. **Fix the GroupedFieldListPagination reference.** Either create the component or rename the template tag to `FieldListPagination` to match the registered component in `IndexList.vue`. Without this, the pagination/footer of the field list will fail to render. (`web/src/plugins/logs/IndexList.vue:132`)
2. **Restore the Copyright header in `SearchJobInspector.vue:1`** and run a grep across the repo for any other `right 2026 OpenObserve` (so far only this file).
3. **Remove the auto-replacement bug `tw:flex tw:flex-col tw:flex`** at `SearchBar.vue:25`, `DetailTable.vue:24`, `DetailTable.vue:355`. The intended class was `tw:flex tw:items-center` (horizontal). The duplicate `tw:flex` is also harmless to remove.
4. **Re-run sed to fix the `tw-*` → `tw:*` regression** in `PatternDetailsDialog.vue` and `ChunkedContent.vue`. These files render unstyled today.
5. **Sanitize the auto-replacement typos inside strings and comments**: `"tw:flex"` in `SearchResult.vue:1182`, `tw:inline` in `SearchResult.vue:492 / :1318`, `tw:block` in `Index.vue:2533 / :3503` and `IndexList.vue:1658`, the `"add": "add"` setup return at `IndexList.vue:1875-1877`.
6. **Decide on test-suite remediation.** Either (a) shim a `quasar` module that re-exports OSelect/OButton-like stubs to keep old specs compiling, or (b) prioritize rewriting the affected `spec.ts` files (~20). At minimum, fix the 4 `plugins: [quasar.],` syntax errors so the spec files parse.
7. **Restore lost functionality on `SearchHistory.vue` and `SearchSchedulersList.vue`**: the custom `sortMethod` and the `changePagination` footer. Without them, sorting on `duration`, `scan_records`, etc. is lexical instead of numeric, and rows-per-page is locked at 100.
8. **Audit `OPagination` props.** Either extend `OPagination` to support `direction-links`, `boundary-numbers`, `ellipses`, `icon-*`, `rows-per-page-options`/`rows-per-page`/`rowsPerPageLabel`, or remove those bindings from `SearchResult.vue:115-160`.
9. **Restore the status-color border on the DetailTable plugin** (`web/src/plugins/logs/DetailTable.vue:18`) and rethink `tw:h-screen` vs `tw:flex-1 tw:min-h-0` at line 75.
10. **Replace `v-close-popup` usages with explicit `@click="dropdownOpenRef = false"`** (or whatever mechanism `ODropdown`/`ODialog` exposes) in `SearchBar.vue:216 / :333` and `views/DetailTable.vue:27`.
11. **Remove the dead refs and setup exports** in `IndexList.vue`: `filterStreamFn`, `filterFieldFn`, `onPaginationUpdate`, `toggleFieldGroup`, and the literal-key `"add"`/`"visibility-off"`/`"visibility"` entries. Same for `showDownloadMenu` in `SearchBar.vue:4186 / :2942 / :2944`.
12. **Restore (or formally drop) the `applyCollapseFilter` logic** in `IndexList.vue:1890+`. Today the filter chip in the field list and the per-group expand state both do nothing.
13. **Replace `var(--q-primary)`** in `SearchJobInspector.vue:759`, `PatternDetailsDialog.vue:116 / :135`, `ChunkedContent.vue:58` with `var(--color-brand-primary)` (or the new semantic token) so theming survives.
14. **Re-enable `.element-box-shadow`** in `web/src/styles/app.scss:105` (or remove the class from all templates). 14 toolbar elements lose their shadow today.
15. **Verify icon name mapping**: all `OIcon name="..."` strings that came from a sed `_` → `-` rename. A handful of likely failures: `arrow-drop-up`, `arrow-drop-down`, `expand-more`, `expand-less`, `keyboard-arrow-right`, `account-tree`, `bar-chart`, `table-view`, `wrap-text`, `navigate-before`, `navigate-next`, `arrow-back-ios-new`, `info-outline`, `saved-search`, `content-copy`. Confirm each exists in the new icon set.
16. **Remove orphan scoped CSS selectors** targeting `.q-table`, `.q-table__top`, `.q-table__control`, `.q-field__*`, `.q-toggle__*`, `.q-btn__content`, `.q-splitter__separator`, `.q-spinner`, etc., in `Index.vue:3479+`, `IndexList.vue:1978+`, `SearchBar.vue:5400+`, `SyntaxGuide.vue:266`.
17. **Audit OTooltip parent-anchoring** in cases where OTooltip is dropped into a slot wrapped by Reka-UI primitives (e.g. inside `OButton`, `OToggleGroupItem`, `OBadge`). If the tooltip attaches to a wrapper rather than the visible element, hover may not fire — manual smoke test required on `SearchBar.vue:49, :89, :105, :127, :149, :397, :548, :1044, :1550`.
18. **Decide what the Logs view's `splitter-width` CSS variable is for** — currently `Index.vue:324 / :340` set a variable that nothing consumes; the original `splitter-height` was also unused. Either delete or wire it up in `.visualize-container` / `.build-container` CSS.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers (silent no-ops)

| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `web/src/plugins/logs/Index.vue:24` | `full-height` | `tw:h-full` | File-level |
| `web/src/plugins/logs/Index.vue:27` | `full-height` | `tw:h-full` | File-level |
| `web/src/plugins/logs/Index.vue:286` | `full-height card-container` | `tw:h-full card-container` | File-level |
| `web/src/plugins/logs/SearchBar.vue:1645` | `saved-view-table full-height o2-table-hide-header` | `... tw:h-full ...` | File-level |
| `web/src/plugins/logs/SearchBar.vue:1773` | `saved-view-table full-height o2-table-hide-header` | `... tw:h-full ...` | File-level |
| `web/src/plugins/logs/SearchBar.vue:25` | `float-right` | `tw:float-right` (or remove + use `tw:ml-auto`) | File-level |
| `web/src/plugins/logs/SearchBar.vue:185` | `float-left` (`tw:w-full float-left tw:p-1`) | `tw:float-left` | File-level |
| `web/src/plugins/logs/SearchBar.vue:187` | `text-weight-bold float-left` | `tw:font-bold tw:float-left` | File-level |
| `web/src/plugins/logs/SearchBar.vue:521` | `float-right col-auto` | `tw:float-right tw:flex-none` | File-level |
| `web/src/plugins/logs/SearchBar.vue:705` | `float-left` | `tw:float-left` | File-level |
| `web/src/plugins/logs/SearchBar.vue:728` | `search-time float-left` | `search-time tw:float-left` | File-level |
| `web/src/plugins/logs/SearchBar.vue:1666` | `text-weight-bold` | `tw:font-bold` | File-level |
| `web/src/plugins/logs/SearchResult.vue:36` | `text-white` (mixed w/ tw classes) | `tw:text-white` | File-level |
| `web/src/plugins/logs/SearchResult.vue:136` | `float-right paginator-section` | `tw:float-right paginator-section` | File-level |
| `web/src/plugins/logs/SearchResult.vue:149` | `float-right select-pagination` | `tw:float-right select-pagination` | File-level |
| `web/src/plugins/logs/SearchResult.vue:162` | `wrap-content-btn float-right` | `wrap-content-btn tw:float-right` | File-level |
| `web/src/plugins/logs/SyntaxGuide.vue:104` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-level |
| `web/src/plugins/logs/SyntaxGuide.vue:206` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-level |
| `web/src/plugins/logs/TenstackTable.vue:130` | `close-icon tw:cursor-pointer` (note `tw:m-0` present) | OK (cursor-pointer already prefixed); remove bare leftover if any | File-level |
| `web/src/plugins/logs/TenstackTable.vue:132` | `text-white` (in ternary) | `tw:text-white` | File-level |
| `web/src/plugins/logs/TenstackTable.vue:153, 166, 184` | `text-weight-bold` | `tw:font-bold` | File-level |
| `web/src/plugins/logs/IndexList.vue:19` | `column logs-index-menu` | `tw:flex tw:flex-col logs-index-menu` | File-level |
| `web/src/plugins/logs/IndexList.vue:156` | `text-weight-bold` | `tw:font-bold` | File-level |
| `web/src/plugins/logs/DetailTable.vue:19` | `column tw:flex-nowrap searchdetaildialog` | `tw:flex tw:flex-col tw:flex-nowrap searchdetaildialog` | File-level |
| `web/src/plugins/logs/DetailTable.vue:60` | `col-auto ... align-center tw:pr-3` | `tw:flex-none ... tw:items-center tw:pr-3` | File-level |
| `web/src/plugins/logs/FunctionSelector.vue:19` | `float-left` (in `... float-left tw:mr-1 ...`) | `tw:float-left` | File-level |
| `web/src/plugins/logs/patterns/PatternCard.vue:76` | `text-weight-bold` | `tw:font-bold` | File-level |
| `web/src/plugins/logs/patterns/PatternList.vue:32, :44` | `text-white` (in dark-theme branch) | `tw:text-white` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:50, :73` | `text-weight-bold text-primary` | `tw:font-bold tw:text-[var(--o2-primary)]` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:87` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:91, :180, :208` | `text-weight-bold` / `text-weight-medium` | `tw:font-bold` / `tw:font-medium` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:234, :246, :251` | `col-auto` | `tw:flex-none` | File-level |
| `web/src/views/DetailTable.vue:26` | `col-auto` | `tw:flex-none` | File-level |

### 2. Tailwind v4 Misuse

| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `web/src/plugins/logs/SyntaxGuide.vue:104` | `hover:tw:underline` | `tw:hover:underline` | File-level |
| `web/src/plugins/logs/SyntaxGuide.vue:206` | `hover:tw:underline` | `tw:hover:underline` | File-level |
| `web/src/plugins/logs/TenstackTable.vue:241` | `hover:tw:bg-[var(--o2-hover-gray)]` | `tw:hover:bg-[var(--o2-hover-gray)]` | File-level |
| `web/src/plugins/logs/SearchJobInspector.vue:235` | `hover:tw:border-primary hover:tw:shadow-lg` | `tw:hover:border-primary tw:hover:shadow-lg` | File-level |
| `web/src/plugins/logs/TransformSelector.vue:88` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/plugins/logs/patterns/PatternCard.vue:19` | `hover:tw:bg-[var(--o2-hover-gray)]` | `tw:hover:bg-[var(--o2-hover-gray)]` | File-level |
| `web/src/plugins/logs/SearchBar.vue:209, :327` | `tw:hover:bg-[var(--o2-hover-accent)]` (already correct order, kept) | OK | — |
| `web/src/plugins/logs/SearchHistory.vue:210` | `tw:mr-md` | `tw:mr-4` | File-level |
| `web/src/plugins/logs/SearchSchedulersList.vue:209` | `tw:mr-md` | `tw:mr-4` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:29-208` | `tw-mb-[1rem]`, `tw-rounded`, `tw-border`, `tw-px-3`, `tw-py-2`, `tw-flex`, `tw-gap-3`, `tw-items-start`, `tw-mt-[2px]`, `tw-flex-shrink-0`, `tw-px-[0.625rem]`, `tw-py-[0.375rem]`, `tw-text-[0.8125rem]`, `tw-leading-[1.6]`, `tw-border-l-[0.25rem]`, `tw-border-solid`, `tw-break-all`, `tw-flex-wrap`, `tw-items-baseline`, `tw-gap-x-[2px]`, `tw-gap-y-[2px]`, `tw-whitespace-pre` | Replace `tw-` with `tw:` prefix throughout | File-level |
| `web/src/components/logs/ChunkedContent.vue:47` | `load-more-container tw-mt-2 tw-flex tw-items-center tw-gap-3` | `... tw:mt-2 tw:flex tw:items-center tw:gap-3` | File-level |
| `web/src/components/logs/ChunkedContent.vue:58` | `tw-text-sm tw-font-medium` | `tw:text-sm tw:font-medium` | File-level |
| +25 more `tw-`-prefix occurrences in `PatternDetailsDialog.vue` | — | — | — |

### 3. Quasar CSS Variables (var(--q-*))

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/plugins/logs/SearchJobInspector.vue:739` | `var(--q-background)` | `var(--o2-background)` (define if missing) | Token (global) |
| `web/src/plugins/logs/SearchJobInspector.vue:759` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/plugins/logs/SearchResult.vue:1809` | `var(--q-background, #ffffff)` | `var(--o2-background, #ffffff)` | Token (global) |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:116` | `tw:border-l-[var(--q-primary)]` | `tw:border-l-[var(--o2-primary)]` | File-level |
| `web/src/plugins/logs/patterns/PatternDetailsDialog.vue:135` | `tw-border-l-[var(--q-primary)]` | `tw:border-l-[var(--o2-primary)]` (also fix prefix) | File-level |
| `web/src/components/logs/ChunkedContent.vue:58` | `style="color: var(--q-primary)"` | `style="color: var(--o2-primary)"` (or class `tw:text-[var(--o2-primary)]`) | File-level |

### 4. Dead `:deep(.q-*)` Selectors & `body.body--dark`

| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `web/src/plugins/logs/Index.vue:3479-3481` | `.q-field__native, .q-field__input, .q-table tbody td` | Remove — OInput/OTable render different DOM | File-level |
| `web/src/plugins/logs/Index.vue:3485` | `.q-table__top` | Remove | File-level |
| `web/src/plugins/logs/Index.vue:3489` | `.q-table__control` | Remove | File-level |
| `web/src/plugins/logs/Index.vue:3493` | `.logsPageMainSection > .q-field__control-container` | Remove | File-level |
| `web/src/plugins/logs/SyntaxGuide.vue:266` | `:deep(.q-btn__content)` | Remove — OButton has no `.q-btn__content` | File-level |
| `web/src/plugins/logs/SearchBar.vue:5400` | `.q-dark .q-btn` | Remove or rewrite to `.dark .o-button` | File-level |
| `web/src/plugins/logs/SearchBar.vue:5405` | `.q-dark .file-type .q-btn` | Remove or rewrite | File-level |
| `web/src/plugins/logs/SearchBar.vue:5330, :5355, :5380` | `body.body--dark &` (3x) | Replace with `html.dark &` or theme-class wrapper | Component-level |
| `web/src/plugins/logs/SearchBar.vue:5445` | `:deep(.q-btn)` | Remove | File-level |
| `web/src/plugins/logs/SearchBar.vue:5460` | `:deep(.q-btn)` | Remove | File-level |
| `web/src/plugins/logs/SearchBar.vue:5472` | `.q-btn__content` | Remove | File-level |
| `web/src/plugins/logs/SearchBar.vue:5572` | `:deep(.q-splitter__separator)` | Remove — OSplitter handles its own separator | File-level |
| `web/src/plugins/logs/IndexList.vue:1962` | `.q-field__control` | Remove | File-level |
| `web/src/plugins/logs/IndexList.vue:1970` | `.q-field__prepend` | Remove | File-level |
| `web/src/plugins/logs/IndexList.vue:1974` | `.q-field__append` | Remove | File-level |
| `web/src/plugins/logs/IndexList.vue:1988` | `.q-toggle__inner` | Remove — OToggle has different DOM | File-level |
| `web/src/plugins/logs/IndexList.vue:1993` | `.q-toggle__thumb:before` | Remove | File-level |
| `web/src/plugins/logs/SearchJobInspector.vue:24` | `class="q-table__title"` (used in template, NOT scoped CSS) | Replace with `tw:font-[600]` or a local class | File-level |
| `web/src/plugins/logs/components/FieldListPagination.vue:284` | `:deep(.q-btn)` | Remove | File-level |

### 5. Quasar SCSS Variables (in `<style scoped>`)

*(none found — Quasar `$primary`, `$dark-page`, `$grey-*`, etc. are not used in logs scope)*

### 6. Quasar Directives

| File:Line | Directive | Action |
|-----------|-----------|--------|
| `web/src/plugins/logs/SearchBar.vue:216` | `v-close-popup` | Remove; rely on explicit `@click="open=false"` or ODropdown API |
| `web/src/plugins/logs/SearchBar.vue:333` | `v-close-popup` | Remove; same as above |
| `web/src/views/DetailTable.vue:27` | `v-close-popup` | Remove; bind close handler explicitly |

### 7. Icon Migration

*(no underscore icon names or `:color=` props found in current diff; already reported broader icon rename verification in Recommendations #15)*

### 8. Inline `style=` Hot Spots (to be promoted to scoped classes / shared partial)

| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `web/src/plugins/logs/SearchBar.vue:169` | `style="box-sizing: border-box; width: 100%; padding: 0 8px"` | `.saved-view-popup-padding` (file-level scoped) |
| `web/src/plugins/logs/SearchBar.vue:195, :321` | `style="max-height: 320px; overflow-y: auto; overflow-x: hidden"` | `.saved-view-scroll` (file-level scoped) |
| `web/src/plugins/logs/SearchBar.vue:208, :326` | `style="display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 2px"` | `.saved-view-row-grid` (file-level scoped) |
| `web/src/plugins/logs/SearchBar.vue:310` | `style="width: 40%; padding: 0; margin-left: 0px; justify-content: flex-start; align-self: flex-start"` | `.saved-view-tab-trigger` (file-level scoped) |
| `web/src/plugins/logs/SearchBar.vue:420, :438, :456` | `style="width: 28px; display: flex; align-items: center; margin-right: 12px"` | `.toolbar-icon-button` (component-level partial — repeats) |
| `web/src/plugins/logs/Index.vue:324, :340` | `:style="{ '--splitter-width': ... }"` | Either delete (unused) or wire via scoped CSS var |

### 9. Duplicate Style Blocks (candidate for component-level partial)

| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| `SearchHistory.vue`, `SearchSchedulersList.vue` | `.o2-table-footer-title ... tw:mr-md` (also same `tw:flex tw:items-center tw:w-[100px]`) | `web/src/styles/forms/o2-table-footer.scss` |
| `SearchBar.vue` (3x), `Index.vue` (4x) | `body.body--dark &` rules | promote to a `theme-mixin.scss` or use `html.dark` selector once |
| `Index.vue`, `IndexList.vue`, `SearchBar.vue`, `SyntaxGuide.vue`, `FieldListPagination.vue` | `.q-field__*` / `.q-btn` / `.q-table__*` `:deep` blocks | All should be deleted, not consolidated |

### 10. Layer Summary

- **Global (`app.scss`)** changes needed: ~6 (introduce `--o2-background`, `--o2-primary` aliases or confirm existing; restore `.element-box-shadow`; ensure `html.dark` parity with `body--dark`)
- **Component-level partials** new/changed: 2 (`o2-table-footer.scss`, `theme-dark.scss` mixin)
- **File-level scoped** changes: ~110 (class swaps across 13 Vue files: Index.vue, IndexList.vue, SearchBar.vue, SearchResult.vue, SyntaxGuide.vue, TenstackTable.vue, SearchJobInspector.vue, TransformSelector.vue, FunctionSelector.vue, DetailTable.vue, FieldListPagination.vue, PatternCard.vue, PatternList.vue, PatternDetailsDialog.vue, ChunkedContent.vue, views/DetailTable.vue)
