# Error Tracking Page — Quasar Removal Audit

## Summary

The RUM Error Tracking page has been migrated from Quasar Framework to OpenObserve's O* component library plus Tailwind `tw:` utility classes. The migration is largely functional, but contains:

- **1 layout-breaking bug** in `AppErrors.vue` (OSplitter orientation is inverted vs. Quasar `vertical`).
- **2 dead utility-class regressions** (`align-center`, `wrap`) that were left unmigrated.
- **Substantial dead CSS** (`.q-table`, `.q-splitter__after`, `.q-field__*`, `.q-btn__content`, `.q-icon`) that no longer matches the rendered DOM and will silently no-op.
- **All spec files for the page (except `ErrorViewer.spec.ts`) still `import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin"`** (helper no longer exports `installQuasar`) **and `import * as quasar from "quasar"`** (package uninstalled). Every error-tracking unit test in this scope will fail to load.
- **SourceMaps.spec.ts and AppErrors.spec.ts reference removed component APIs** (`expandedRow`, `toggleExpand`, `getRowKey`, `qTableRef`, `changePagination`, `resultTotal`, `perPageOptions`, `notifyMock`, `columns`, `handleTableEvent`) — these tests are guaranteed failures even before the import errors are addressed.
- **PrettyStackTrace renders correctly** when source maps exist, but contains many `console.log` statements left from debugging and `setTimeout` race patterns to wait for Monaco initialisation (line 332, 424, 487) — fragile but not broken.
- **SourceMaps filter dropdowns dropped `@filter` / `@new-value` callbacks** (`filterVersions`, `filterServices`, `filterEnvironments`, `addNewVersion`, `addNewService`, `addNewEnvironment` are still defined in `<script setup>` but never invoked from the template). Dead code; harmless but misleading.

## Files Audited

| File | Status |
| --- | --- |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/ErrorViewer.vue` | Migrated. Low risk. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue` | Migrated. Layout bug + dead CSS. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue` | Migrated. Dead filter callbacks + invalid CSS vars. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/UploadSourceMaps.vue` | Migrated. Invalid CSS vars (`var(--q-primary-rgb)` etc.). |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorDetail.vue` | Light migration. Stale `text-red-6` class. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.vue` | Orphan: not referenced anywhere outside its own spec. Migration done. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorHeader.vue` | Migrated. Stale `text-red-6` class. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTags.vue` | Migrated. `wrap` utility class left orphaned. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorStackTrace.vue` | Migrated. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEvents.vue` | Migrated. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorSessionReplay.vue` | Migrated. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEventDescription.vue` | Migrated. Stale `text-primary` class. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTag.vue` | Migrated. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTypeIcons.vue` | Unchanged. Pure asset switch. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/PrettyStackTrace.vue` | Migrated. Stale `:deep(.q-dark)`. Debug `console.log` left in. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/composables/useErrorTracking.ts` | Unchanged. No Quasar coupling. |

## Critical Issues

### 1. AppErrors splitter orientation inverted (sidebar collapses to top, table below)

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:62-67`

```vue
<OSplitter
  class="logs-horizontal-splitter tw:pl-[0.625rem]! tw:h-[calc(100%-8.125rem)]!"
  v-model="splitterModel"
  unit="px"
  :horizontal="true"
>
```

Originally in `main` the component was `<q-splitter ... vertical>`. In **Quasar**, the `vertical` prop produces a **vertical divider** (a column-resizer between left and right panes). In **OSplitter** (this repo, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/core/Splitter/OSplitter.vue:8-10`), `horizontal: true` triggers `tw:flex-col` and renders a **horizontal divider** (a row-resizer between top and bottom panes). The semantics are inverted between the two libraries, but the migration converted `vertical` → `:horizontal="true"`.

Effect: the `SearchFieldList` (rendered in `#before`) now stacks **above** the errors table instead of left of it. The `splitterModel` of `250` (px) — originally a left-pane width — now becomes a top-pane height, breaking the visible layout and the `:h-[calc(100%-8.125rem)]` height contract.

The same inversion exists in `AppSessions.vue:67` (out of scope but related).

Fix: drop the `:horizontal="true"` prop entirely (default is `false`, which matches Quasar `vertical`).

**Solution:**
```diff
  <OSplitter
    class="logs-horizontal-splitter tw:pl-[0.625rem]! tw:h-[calc(100%-8.125rem)]!"
    v-model="splitterModel"
    unit="px"
-   :horizontal="true"
+   :horizontal="false"
  >
```

### 2. All Error Tracking spec files (except `ErrorViewer.spec.ts`) fail to load

The Quasar package is uninstalled (`web/node_modules/quasar` is absent), but the following spec files still execute either `import * as quasar from "quasar"` or `import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin"`. The helper at `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/helpers/install-quasar-plugin.ts:27` only exports `tempQuasarPlugin` (with a TODO calling for rewrites), so the named import resolves to `undefined`.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.spec.ts:5,163`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.spec.ts` (imports `quasar`-style mocks for `q-table`, `q-tr`, `q-td`, `q-item*`, `QTablePagination` — none of these stubs are referenced by the new component).
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorDetail.spec.ts:18-28`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.spec.ts:18-31`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEventDescription.spec.ts:18-27`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEvents.spec.ts:18-28`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorHeader.spec.ts:18-28,50`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorSessionReplay.spec.ts:18-28`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorStackTrace.spec.ts:18-28`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTag.spec.ts:18-27`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTags.spec.ts:18-28`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTypeIcons.spec.ts:18-27`

Net effect: the Error Tracking page has **no working unit-test coverage** after this refactor.

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- import * as quasar from "quasar";
- installQuasar();
+ // Drop both imports. Use `qLayoutInjections()` from
+ // @/test/unit/helpers/install-quasar-plugin only when layout providers
+ // are needed; otherwise rely on global O* registration via setup file.
```

### 3. SourceMaps.spec.ts assertions reference deleted component APIs

The component lost the helpers and refs the test still inspects.

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.spec.ts:307,313,468-514,520-544` reference: `expandedRow`, `toggleExpand`, `getRowKey`, `qTableRef`, `changePagination`, `pagination.rowsPerPage`, `resultTotal`, `perPageOptions`, `setPagination`. None of these exist in the new component (`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue` — `grep -nE "expandedRow|toggleExpand|getRowKey|qTableRef|changePagination|resultTotal"` returns no matches).

Similarly, lines 649-688 assert `notifyMock` (`$q.notify`) calls with `type: "positive"`/`type: "negative"`, but the component now calls `toast({ variant: "success"/"error" })` from `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/feedback/Toast/useToast`.

**Solution:**
```diff
- expect(notifyMock).toHaveBeenCalledWith({ type: "positive", ... });
- expect(wrapper.vm.expandedRow).toBeNull();
- expect(wrapper.vm.qTableRef).toBeDefined();
+ import { toast } from "@/lib/feedback/Toast/useToast";
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
+ expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
+ expect(wrapper.vm.expandedIds).toEqual([]);
```

### 4. AppErrors.spec.ts also references deleted APIs

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.spec.ts:235-251,366-377,386-401` reference `columns` (now `tableColumns`/`tableErrors`), `handleTableEvent` (removed in favour of `handleRowClick`), and stub `app-table`, `field-list`, `q-splitter`, `q-btn`, `query-editor` — only `query-editor` and (renamed) `date-time`/`syntax-guide` are still rendered, and the active table is `OTable`, the sidebar is `SearchFieldList`, the splitter is `OSplitter`.

**Solution:**
```diff
- expect(wrapper.vm.columns).toBeDefined();
- expect(wrapper.vm.handleTableEvent).toBeTypeOf("function");
- stubs: { "app-table": true, "field-list": true, "q-splitter": true, "q-btn": true }
+ expect(wrapper.vm.tableColumns).toBeDefined();
+ expect(wrapper.vm.handleRowClick).toBeTypeOf("function");
+ stubs: { OTable: true, SearchFieldList: true, OSplitter: true, OButton: true }
```

## Logical Issues

### Stack trace defensive guard already exists but is fragile

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/ErrorViewer.vue:163-172`

```js
errorDetails.value = { ...res.data.hits[0] };
errorDetails.value["category"] = [];
const errorStack =
  errorDetails.value.error_stack ||
  errorDetails.value.error_handling_stack;
errorDetails.value.error_stack = errorStack.split("\n");
```

If both `error_stack` and `error_handling_stack` are absent (e.g. legacy event or an event arrived via a different schema), `errorStack` is `undefined` and `errorStack.split("\n")` throws. This behaviour is **unchanged from `main`** — not a regression introduced by the migration — but worth flagging as the only code-path that would crash the page during normal usage.

**Solution:**
```diff
- const errorStack = errorDetails.value.error_stack || errorDetails.value.error_handling_stack;
- errorDetails.value.error_stack = errorStack.split("\n");
+ const errorStack = errorDetails.value.error_stack || errorDetails.value.error_handling_stack || "";
+ errorDetails.value.error_stack = errorStack ? errorStack.split("\n") : [];
```

### `tableErrors` may oscillate between array and object

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:430-433`

```js
const runQuery = () => {
  errorTrackingState.data.resultGrid.currentPage = 0;
  errorTrackingState.data.errors = {};
  getErrorLogs();
};
```

`runQuery()` resets `errors` to `{}` (an object) while the API response replaces it with an array (`errorTrackingState.data.errors = res.data.hits`). `tableErrors` (lines 176-183) guards with `Array.isArray(errors)` and returns `[]` for non-arrays, so this no longer blanks the table during the brief refetch — OK. Just inconsistent typing across the codepath.

**Solution:**
```diff
  const runQuery = () => {
    errorTrackingState.data.resultGrid.currentPage = 0;
-   errorTrackingState.data.errors = {};
+   errorTrackingState.data.errors = [];
    getErrorLogs();
  };
```

### SourceMaps still defines six unused helpers

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:259-316` define `filterVersions`, `filterServices`, `filterEnvironments`, `addNewVersion`, `addNewService`, `addNewEnvironment`. None are wired into the OSelect template — OSelect handles its own searching when `searchable` is set, and creating new values relies on the `creatable` prop. The functions plus the `filteredVersionOptions`/`filteredServiceOptions`/`filteredEnvironmentOptions` refs are dead. They still appear in the (broken) spec, which would suggest there was an intent to wire them up.

**Solution:**
```diff
- const filterVersions = (val, update) => { ... };
- const addNewVersion = (val, done) => { ... };
- const filteredVersionOptions = ref([]);
- // Repeat for services + environments
+ // Delete unused helpers; use OSelect's built-in `searchable` and `creatable` props
+ <OSelect v-model="version" :options="versionOptions" searchable creatable />
```

### `addNewVersion` semantics drifted: OSelect does not call `done(val)`

If the helpers ever get re-wired, they must adapt to OSelect's API — OSelect emits a different event signature than Quasar's `@new-value="(val, done) => …"`. Currently calling them is a no-op anyway.

### Toast variant missing on AppErrors error path

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:404-411`

```js
toast({
  message:
    err.response?.data?.message || "Error while fetching error events",
  position: "bottom-center",
  timeout: 4000,
});
```

Original Quasar code set `color: "negative"`. The new call omits `variant: "error"`, so the failure toast renders with the **default** variant — neutral grey instead of red. Recommend adding `variant: "error"`.

**Solution:**
```diff
  toast({
+   variant: "error",
    message: err.response?.data?.message || "Error while fetching error events",
    position: "bottom-center",
    timeout: 4000,
  });
```

### Debug `console.log` left in `PrettyStackTrace.vue`

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/PrettyStackTrace.vue:377,450,451,459,472,475-482,495,498-500`

Roughly a dozen `console.log` / `console.error` calls that look like leftover instrumentation (logging payload, response, every frame), not user-facing logging. They'll pollute production consoles whenever a user opens the Pretty tab.

**Solution:**
```diff
- console.log("Stack frame:", frame);
- console.log("Source map response:", response);
- console.error("Failed:", err);
+ // Remove debug logging - keep only legitimate console.warn for missing editor (line 360)
```

## CSS / Layout Issues

### Quasar utility classes left orphaned

These will no longer apply because `quasar/src/css/index.sass` is no longer loaded:

| File / Line | Class | Was used for |
| --- | --- | --- |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:22,25` | `align-center` | Vertical centring of the toolbar contents — visible regression. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorTags.vue:57` | `wrap` | Allow tag-block row to wrap. Tags will overflow horizontally on narrow viewports. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorDetail.vue:34` | `text-red-6` | Red colour on the unhandled badge. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorHeader.vue:57` | `text-red-6` | Same. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEventDescription.vue:27,39` | `text-primary` | Primary colour on the `from/to` labels and resource URL. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.vue:31` | `bg-primary text-white` | Background + colour on the splitter drag-grip. |

Recommend swapping for `tw:items-center`, `tw:flex-wrap`, `tw:text-red-500`/`tw:text-red-600`, `tw:text-[var(--o2-primary-btn-bg)]`, and `tw:bg-[var(--o2-primary-btn-bg)] tw:text-white` respectively (or equivalent design-system tokens).

**Solution:**
```diff
- <div class="align-center">
- <div class="wrap">
- <span class="text-red-6">
- <span class="text-primary">
- <div class="bg-primary text-white">
+ <div class="tw:items-center">
+ <div class="tw:flex-wrap">
+ <span class="tw:text-red-600">
+ <span class="tw:text-[var(--o2-primary)]">
+ <div class="tw:bg-[var(--o2-primary)] tw:text-white">
```

### Invalid `var(--q-*)` references that are not defined

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/_variables.scss` only redefines `--q-primary`. The following are referenced but **never declared anywhere in `web/src/styles` or `web/src/css`**:

- `--q-background` — `SourceMaps.vue:524,548`, `UploadSourceMaps.vue:306,336`
- `--q-border-color` — `SourceMaps.vue:549`, `UploadSourceMaps.vue:311,326,330`
- `--q-positive` — `UploadSourceMaps.vue:353`
- `--q-primary-rgb` — `UploadSourceMaps.vue:340,345,376,380`
- `--q-positive-rgb` — `UploadSourceMaps.vue:354,384`

Where a fallback is supplied (`var(--q-border-color, #e0e0e0)`) the colour still appears, but where no fallback is given (`background-color: var(--q-background)`) the property resolves to `unset`/initial and the panel inherits or shows transparent. `rgba(var(--q-primary-rgb), 0.02)` evaluates to `rgba(, 0.02)` which is invalid CSS — the entire declaration is **dropped** by the browser, so the hover/drag-over visual feedback on the file drop area is gone.

**Solution:**
```diff
- background-color: var(--q-background);
- border: 1px solid var(--q-border-color);
- background-color: rgba(var(--q-primary-rgb), 0.02);
- color: var(--q-positive);
+ background-color: var(--o2-bg-primary);
+ border: 1px solid var(--o2-border-color);
+ background-color: color-mix(in srgb, var(--o2-primary) 2%, transparent);
+ color: var(--o2-positive);
```

### Dead Quasar selectors in scoped/unscoped styles

These rules are now no-ops because the rendered DOM lacks the matched elements:

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:494-552` — `.q-field__native`, `.q-field__input`, `.q-table tbody td`, `.q-splitter__after`, `.q-table__top`, `.q-table__control`, `.q-field__control-container`, `.q-btn__content`, `.q-icon`. Even the `.q-icon` selector inside `.search-button` was rewritten to `.OIcon` but the surrounding `.q-btn__content` block never resolves.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.vue:122-163` — same set; ErrorsList itself is orphan code but the styles are nevertheless wasted.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:541-545` — `:deep(.q-dark) { ... }`. The active dark-mode body class is `dark-theme` (per `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/App.vue`), not `q-dark`. Dark-mode hover colours never apply.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/UploadSourceMaps.vue:371-387` — same dead `:deep(.q-dark)` block.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/PrettyStackTrace.vue:598-610` — same dead `:deep(.q-dark)` block; covers the service/version badge colours.

**Solution:**
```diff
- :deep(.q-field__native), :deep(.q-field__input) { padding: 0 8px; }
- :deep(.q-table tbody td) { height: 32px; }
- :deep(.q-dark) { .row-hover:hover { background: #2a2a2a; } }
+ // Drop dead :deep(.q-*) rules; for dark mode use :global(html.dark)
+ :global(html.dark) { .row-hover:hover { background: var(--o2-hover-accent); } }
```

### `o2-custom-select-dashboard` and `o2-quasar-table*` legacy hooks

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:33,45,57` continues to apply `class="o2-custom-select-dashboard"` to OSelect, but the rules in `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/app.scss:1494-1514` target `.q-field__control`/`.q-field__native`/`.q-field__input`/`.q-field__append` — OSelect does not produce those elements, so the heights and paddings have no effect.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:112` keeps `class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"`. The generic `th/td/tr` selectors in `app.scss:581-619` still apply (so row borders & heights come through), but `.q-table__card`, `.q-table tbody .q-tr` and the `actions-column` rules at lines 599-608 require classes the new OTable never emits. The visible "sticky header" hook (`o2-quasar-table-header-sticky thead { position: sticky; ... }`) works because it targets `thead`.

### Hard-coded border colours bypass theme

Several inline `style` attributes hard-code light-mode greys without considering dark-mode:

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorStackTrace.vue:46,102-110` — `#e0e0e0` borders inside `.error_stack`. PrettyStackTrace went to the trouble of computing `borderColor` from theme; the Raw tab did not.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEvents.vue:120` — `border: 1px solid #e0e0e0` for the level cell.
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/errorTracking/view/ErrorEventDescription.vue:93` — `background-color: #ececec` for the navigation `<pre>` block.

**Solution:**
```diff
- border: 1px solid #e0e0e0;
- background-color: #ececec;
+ border: 1px solid var(--o2-border-color);
+ background-color: var(--o2-bg-secondary);
```

### `--navbar-height` assumed to exist

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/ErrorViewer.vue:184`, `SourceMaps.vue:519`, `UploadSourceMaps.vue:303` all compute heights from `var(--navbar-height)`. Worth confirming this token is defined globally; if not, the heights collapse to `calc(100vh - 1rem)` and overflow.

**Solution:**
```diff
- height: calc(100vh - var(--navbar-height) - 1rem);
+ height: calc(100vh - var(--navbar-height, 56px) - 1rem);
```

## Component Migration Issues

### `OSelect` API mismatch (label placement, no `borderless`/`dense`/`input-debounce`)

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:24-57` migrates three Quasar `<q-select>` blocks. Quasar's `borderless`, `dense`, `use-input`, `input-debounce`, and the `<template #no-option>` fallback have been dropped. OSelect's `label` becomes an outside floating label (above the trigger) per `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/forms/Select/OSelect.types.ts:103-105`, which changes the vertical alignment of the filter row.

### `OTable` `accessorKey` does not match a real row property

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppErrors.vue:184-191` defines column `id: "error"` with `accessorKey: "error"`. The hits returned by `searchService.search` have `error_message`, `error_type`, `error_handling`, etc., but no `error` field. The `#cell-error` slot (lines 111-113) renders the whole row via `ErrorDetail`, so the cell content is correct — but the `accessorKey` is meaningless and any client-side sort on the "error" column will compare `undefined === undefined`. Same pattern (a dummy accessor with a custom cell slot) on the "events" column.

The same is true in `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.vue:79-86` (orphan).

**Solution:**
```diff
- { id: "error", accessorKey: "error", header: "Error", sortable: true }
+ { id: "error", accessorKey: "error_message", header: "Error",
+   sortable: false /* custom slot renders entire row */ }
```

### `OSplitter` `vertical` slot semantics confused (Critical Issue 1)

Documented above.

### File-input click triggers native picker

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/UploadSourceMaps.vue:84-99` — the drop zone wraps a hidden `<input type="file">` and triggers `fileInputRef.value?.click()`. This is correct and survives the migration; just noting that an accessibility regression introduced earlier (no `aria-label`/role) persists.

### `data-test` removed on Cancel/OK buttons

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SourceMaps.vue:173-184` — the old dialog had `data-test="cancel-button"` and `data-test="confirm-button"` on the buttons; the new ODialog drives them via props `secondary-button-label` / `primary-button-label`, so those test ids are gone. Existing Playwright tests selecting those buttons will fail.

**Solution:**
Add `data-test` attributes to ODialog props or to the action buttons via slot override:
```diff
  <ODialog
    v-model:open="showDeleteDialog"
    primary-button-label="Delete"
    secondary-button-label="Cancel"
+   primary-button-data-test="confirm-button"
+   secondary-button-data-test="cancel-button"
  />
```
(Requires extending ODialog API to forward `data-test` to action buttons.)

### `OTable` row keying drops sort callback

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ErrorsList.vue:96` switches from a custom sort comparator (`(a, b, rowA, rowB) => parseInt(rowA.time_spent) - parseInt(rowB.time_spent)`) to a plain `accessorFn`. OTable sorts by the formatted-duration **string** ("123 ms", "2 s") not by numeric duration. Sort order will be lexicographic instead of numeric. (Orphan component — low priority.)

### `OSpinner` `variant="dots"` only in PrettyStackTrace

Cosmetic — most places use the default ring. Worth noting for consistency.

## Test File Issues

Test scope summary:

| Spec | `import * as quasar from "quasar"` | `installQuasar` (missing export) | References deleted state |
| --- | :---: | :---: | :---: |
| `ErrorViewer.spec.ts` | no | yes | no |
| `AppErrors.spec.ts` | no | yes | yes (`columns`, `handleTableEvent`, stubs `app-table`/`field-list`/`q-splitter`) |
| `SourceMaps.spec.ts` | no | no, but uses `$q.notify`/`useQuasar` stubs and Quasar component stubs | yes (`expandedRow`, `toggleExpand`, `getRowKey`, `qTableRef`, `changePagination`, `pagination`, `resultTotal`, `perPageOptions`, `notifyMock`) |
| `ErrorDetail.spec.ts` | yes | yes | n/a (component is mostly stable) |
| `ErrorsList.spec.ts` | yes | yes | likely (slot signature changed from `error_details` to `cell-error`, stub uses old slot) |
| `errorTracking/view/ErrorEventDescription.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorEvents.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorHeader.spec.ts` | yes | yes | useQuasar mock at line 50 |
| `errorTracking/view/ErrorSessionReplay.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorStackTrace.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorTag.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorTags.spec.ts` | yes | yes | – |
| `errorTracking/view/ErrorTypeIcons.spec.ts` | yes | yes | – |

All `quasar`-importing tests will fail at module load (the package is uninstalled). `installQuasar` is also unresolved (only `tempQuasarPlugin` is exported — see `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/helpers/install-quasar-plugin.ts:27` and the TODO at line 16-20).

The helper file's TODO explicitly says these specs need to be rewritten.

## Recommendations

Ordered by impact:

1. **Fix the OSplitter orientation in `AppErrors.vue:67` and `AppSessions.vue:67`** — drop `:horizontal="true"`. Without this fix the page layout is visibly broken (sidebar on top, table below).

2. **Replace the leftover Quasar utility classes** with `tw:` equivalents to restore expected styling:
   - `align-center` → `tw:items-center` (AppErrors.vue:22,25)
   - `wrap` → `tw:flex-wrap` (ErrorTags.vue:57)
   - `text-red-6` → `tw:text-red-600` (ErrorDetail.vue:34, ErrorHeader.vue:57)
   - `text-primary` → `tw:text-[var(--o2-primary-btn-bg)]` (ErrorEventDescription.vue:27,39)
   - `bg-primary text-white` → `tw:bg-[var(--o2-primary-btn-bg)] tw:text-white` (ErrorsList.vue:31)

3. **Replace invalid `var(--q-…)` references** in `UploadSourceMaps.vue` and `SourceMaps.vue` with the established design tokens (`var(--o2-bg-color)`, `var(--o2-border-color)`, `var(--o2-success-color)`, `var(--o2-primary-btn-bg)` — or, where alpha overlays are needed, hard-coded RGB pairs that match the existing theme). The `rgba(var(--q-primary-rgb), …)` calls in particular silently disable the hover/drag-over feedback on the source-map drop zone.

4. **Strip dead `:deep(.q-dark)` blocks** and replace with `.dark-theme &` (or whichever convention `App.vue` uses) inside `SourceMaps.vue`, `UploadSourceMaps.vue`, `PrettyStackTrace.vue`.

5. **Either wire up or delete the dead filter callbacks** in `SourceMaps.vue:259-316` (`filterVersions/filterServices/filterEnvironments/addNewVersion/addNewService/addNewEnvironment`).

6. **Add `variant: "error"`** to the `toast` call in `AppErrors.vue:404-411` to preserve the failure-state styling.

7. **Remove debug `console.log` / `console.error` calls** from `PrettyStackTrace.vue:377,450-501` (the legitimate `console.warn` for missing editor at line 360 can stay).

8. **Rewrite the Error Tracking spec files** following the TODO in `install-quasar-plugin.ts`: drop the `import * as quasar from "quasar"` / `installQuasar(...)` lines, switch to `qLayoutInjections()` only where layout providers are needed, and update assertions against the renamed APIs (`tableErrors`/`tableColumns`/`handleRowClick`, `expandedIds`, `groupedSourceMaps`, `toast`, `ODialog`, `OTable`, `OSplitter`, `SearchFieldList`).

9. **Drop the `o2-custom-select-dashboard` class** from the three `<OSelect>` instances in `SourceMaps.vue:33,45,57` since the rule targets Quasar `.q-field__*` and now does nothing. If a fixed height is desired, add a Tailwind utility (`tw:h-[2.7rem]`) on each OSelect.

10. **Audit `data-test` ids consumed by Playwright tests** — the source-map delete dialog lost `data-test="cancel-button"` / `data-test="confirm-button"` when the bespoke `q-card-actions` block was replaced by ODialog's primary/secondary slots.

11. **Consider theme-aware borders/backgrounds** in `ErrorStackTrace.vue`, `ErrorEvents.vue`, `ErrorEventDescription.vue` (hard-coded `#e0e0e0`, `#ececec`).

12. **Delete `web/src/components/rum/ErrorsList.vue` and `ErrorsList.spec.ts`** if no router or parent references it (a grep across the codebase confirms it has no callers); the migration churn on a dead file added 99 lines of net diff with zero user-visible value.

13. **Document `--navbar-height`** as a required global CSS variable, or fall back inline (`calc(100vh - var(--navbar-height, 56px) - 1rem)`).

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
| --- | --- | --- | --- |
| `AppErrors.vue:22,25` | `align-center` | `tw:items-center` | File |
| `AppErrors.vue:495-496` | `.q-field__native`, `.q-field__input` (scoped block) | Remove — `OInput` does not emit `.q-field*` | File |
| `AppErrors.vue:523` | `.q-table__top` (scoped) | Remove — `OTable` has no `.q-table__top` | File |
| `AppErrors.vue:527` | `.q-table__control` (scoped) | Remove | File |
| `AppErrors.vue:531` | `.q-field__control-container` (scoped) | Remove | File |
| `AppErrors.vue:543` | `.q-btn__content` (scoped) | Remove — `OButton` has no `.q-btn__content` | File |
| `ErrorsList.vue:124-160` | `.q-field__native`, `.q-field__input`, `.q-table__top`, `.q-table__control`, `.q-field__control-container` (scoped) | Remove — orphan file, no longer reachable | File |
| `ErrorsList.vue:21` | `full-height` | `tw:h-full` | File |
| `ErrorsList.vue:31` | `bg-primary` | `tw:bg-[var(--o2-primary)]` | File |
| `ErrorTags.vue` | `wrap` (Quasar utility) | `tw:flex-wrap` | File |
| `ErrorEventDescription.vue:26,27,39` | `text-primary` | `tw:text-[var(--o2-primary)]` | File |
| `ErrorDetail.vue:34` | `text-red-6` | `tw:text-red-600` | File |
| `ErrorHeader.vue:57` | `text-red-6` | `tw:text-red-600` | File |
| `UploadSourceMaps.vue:37,49,61,73,83,112` | `text-weight-medium` | `tw:font-medium` (redundant alongside `tw:font-medium`) | File |
| `SourceMaps.vue:112` | `o2-quasar-table o2-row-md o2-quasar-table-header-sticky` | Rename to `o2-table*` (drop `quasar` token) | Global + File |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
| --- | --- | --- | --- |
| `ErrorHeader.vue:23` | `hover:tw:text-[var(--o2-primary-btn-bg)]` | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |
| `ErrorHeader.vue:44` | `hover:tw:text-[var(--o2-primary-btn-bg)]` | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `UploadSourceMaps.vue:306,336` | `var(--q-background)` | `var(--o2-bg-primary)` | File |
| `UploadSourceMaps.vue:311,326,330` | `var(--q-border-color, #e0e0e0)` | `var(--o2-border-color, #e0e0e0)` | File |
| `UploadSourceMaps.vue:339,344` | `var(--q-primary)` | `var(--o2-primary)` | File |
| `UploadSourceMaps.vue:340,345,376,380` | `var(--q-primary-rgb)` | Define `--o2-primary-rgb` or use `color-mix()` | Global + File |
| `UploadSourceMaps.vue:353` | `var(--q-positive)` | `var(--o2-success)` (or `--o2-positive`) | File |
| `UploadSourceMaps.vue:354,384` | `var(--q-positive-rgb)` | Define `--o2-success-rgb` or use `color-mix()` | Global + File |
| `SourceMaps.vue:524,548` | `var(--q-background)` | `var(--o2-bg-primary)` | File |
| `SourceMaps.vue:549` | `var(--q-border-color, #e0e0e0)` | `var(--o2-border-color, #e0e0e0)` | File |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `SourceMaps.vue:541` | `:deep(.q-dark)` | Remove — `html.dark` is the new selector | File |
| `UploadSourceMaps.vue:371` | `:deep(.q-dark)` | Remove — replace child rules with `html.dark` blocks | File |
| `PrettyStackTrace.vue:598` | `:deep(.q-dark)` | Remove — replace with `html.dark` | File |
| `AppErrors.vue:495-543` | scoped `.q-field*`/`.q-table*`/`.q-btn*` block (no `:deep`, but inert) | Remove entire block | File |
| `ErrorsList.vue:124-160` | scoped `.q-field*`/`.q-table*` block (no `:deep`, but inert) | Remove entire block (file is orphan) | File |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `AppErrors.vue:544` | `$secondary` | `var(--o2-secondary)` | File |
| `ErrorDetail.vue:76` | `$info` | `var(--o2-info)` | File |

### 6. Quasar Directives
| File:Line | Directive | Action |
| --- | --- | --- |
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
| --- | --- | --- |
| *(none found in source — all OIcon names use hyphens)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
| --- | --- | --- |
| `SourceMaps.vue:31,43,55` | `width: 200px` on 3 OSelect filters | Replace with `tw:w-[200px]` |
| `SourceMaps.vue:113` | `width: 100%; height: calc(100vh - 200px)` | Move to scoped `.source-maps-table` rule |
| `SourceMaps.vue:122` | `max-height: 400px; overflow-y: auto` | Move to scoped `.source-maps-expansion` rule |
| `UploadSourceMaps.vue:43` | `height: calc(100vh - 192px); overflow: auto` | Move to scoped `.form-content-area` (it already exists) |
| `UploadSourceMaps.vue:96` | `display: none` (file input) | Replace with `tw:hidden` |
| `UploadSourceMaps.vue:131` | `position: sticky; z-index: 2` | Move to scoped `.action-bar` (it already exists) |
| `PrettyStackTrace.vue:22,25,33,36,132,217` | `font-size: 14px / 12px / 13px`, `font-weight: 500`, `height: 200px`, `max-width: 500px; margin: 0 auto` | Move to scoped `.pretty-stack-trace` rules; replace with `tw:text-[12px]` / `tw:font-medium` / `tw:h-[200px]` / `tw:max-w-[500px] tw:mx-auto` |
| `PrettyStackTrace.vue:103,114,125,154,173,178,190,201,210` (×9) | `:style="{ color/background-color/border-color/border-top: ... }"` (dynamic theme-aware) | Keep — JS-driven theming; OK |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
| --- | --- | --- |
| `AppErrors.vue:495-543` + `ErrorsList.vue:124-160` | Dead `.q-field*`/`.q-table*` scoped block | Delete in both |
| `SourceMaps.vue:541` + `UploadSourceMaps.vue:371` + `PrettyStackTrace.vue:598` | `:deep(.q-dark) { … }` block | Migrate to a single `html.dark .source-maps-card { … }` partial in `web/src/styles/_source-maps.scss` |
| `UploadSourceMaps.vue` + `SourceMaps.vue` | `var(--q-background)`/`var(--q-border-color)` styling repeated | Move into a `_source-maps.scss` shared partial |

### 10. Layer Summary
- Global (`app.scss` / `_variables.scss`) changes needed: **3** (declare `--o2-primary-rgb` and `--o2-success-rgb`; rename `o2-quasar-table*` classes to drop the `quasar` token in the global table layer)
- Component-level partial changes: **1** (extract `_source-maps.scss` to share upload + list styles and centralize `html.dark` rules)
- File-level scoped changes: **12** (remove dead `.q-*` scoped blocks in `AppErrors`/`ErrorsList`; fix `hover:tw:` order in `ErrorHeader`; replace `var(--q-*)` with `var(--o2-*)` in `UploadSourceMaps`/`SourceMaps`; replace `$secondary`/`$info` SCSS vars; convert `align-center`/`text-red-6`/`text-primary`/`full-height`/`wrap`/`bg-primary` to `tw:*` equivalents)
