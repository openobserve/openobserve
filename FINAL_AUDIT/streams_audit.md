# Streams Page — Quasar Removal Audit

Audit branch: `feat/ux-revamp-main`   Compared against: `main`
Working dir: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp`

## Summary

The Streams pages have been ported off Quasar onto the new O*/Tailwind component system. The Streams list (`LogStream.vue`), the Stream Explorer (`StreamExplorer.vue`), the heavyweight Schema drawer (`logstream/schema.vue`, ~3k lines), and several supporting components were rewritten. The `explore/StreamDataTable.vue` virtual-scroll table was deleted; its 25-row virtualized presentation was replaced by an inline `OTable` instance directly in `StreamExplorer.vue` (server pagination). The component renames are largely correct (q-input → OInput, q-select → OSelect, q-table → OTable, q-dialog → ODialog, q-card → OCard, q-form → div, q-page → div). However the migration carries one production-blocking bug, several broken/dead code-paths, mass-broken unit specs (every spec file in scope imports a symbol that the helper no longer exports), residual Quasar SCSS selectors that target classes that no longer render, and a handful of UX/logic regressions (drawer always renders, dead pagination handlers, stranded form `@submit`).

## Files Audited

Vue / TS files in scope (all paths are absolute):

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue` (855 LOC, 673-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.vue` (251 LOC, 456-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/schema.vue` (3032 LOC, ~2360-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/Schema.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AddStream.vue` (417 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AddStream.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/StreamFieldInputs.vue` (341 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/StreamFieldInputs.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AssociatedRegexPatterns.vue` (1245 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AssociatedRegexPatterns.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/LlmEvaluationSettings.vue` (743 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/LlmEvaluationSettings.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/PerformanceFieldsDialog.vue` (153 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/PerformanceFieldsDialog.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/SearchBar.vue` (387 LOC)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/SearchBar.spec.ts`

Deleted:

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/StreamDataTable.vue` (193 LOC, was a q-virtual-scroll based table)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/StreamDataTable.spec.ts` (397 LOC)

Replacement: `StreamExplorer.vue` now embeds an `OTable` directly at lines 14–35. The replacement is functionally complete (renders rows, supports server pagination, has empty-state slot), but it loses the virtual-scrolling behavior the deleted file provided. For very wide schemas / large pages this is a perf regression worth flagging.

## Critical Issues

### C1. Add Field / Delete Field buttons in `StreamFieldInputs.vue` have NO click handlers — schema field management is completely broken
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/StreamFieldInputs.vue`
- Lines: 119–138
- Both `OButton` elements (the trailing "+" Add button and the per-row "trash" Delete button) lost their `@click` bindings during migration. On `main` they read `@click="addApiHeader()"` and `@click="deleteApiHeader(field, index)"`. In the current branch the entire `@click=` line is gone, but the handler methods `addApiHeader` / `deleteApiHeader` are still defined further down and `defineExpose`'d.
- Impact: In the inline pipeline form and in the Schema drawer's "Add Field(s)" card, users cannot add more than one field and cannot remove any added field after the first. This blocks the "Add Stream with custom schema" flow and the in-drawer "Add Field(s)" UDS workflow for streams.
- Note: The OUTER "Add Field" button at lines 7–16 (`@click="addApiHeader"`) is fine — it only renders when `fields.length === 0` (i.e. seeding the first field).

**Solution:**
```diff
- <OButton icon-left="add" />
+ <OButton icon-left="add" @click="addApiHeader" />
...
- <OButton icon-left="delete" />
+ <OButton icon-left="delete" @click="deleteApiHeader(field, index)" />
```

### C2. Every Streams spec file imports a symbol that no longer exists — entire spec suite is unimportable
- Files affected (all import `installQuasar` from `@/test/unit/helpers/install-quasar-plugin`):
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.spec.ts:18`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.spec.ts:5`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/Schema.spec.ts:18`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AddStream.spec.ts:19`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/StreamFieldInputs.spec.ts:18-19`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AssociatedRegexPatterns.spec.ts:5`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/LlmEvaluationSettings.spec.ts:19`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/PerformanceFieldsDialog.spec.ts:19`
  - `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/SearchBar.spec.ts:18`
- The helper file (`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/helpers/install-quasar-plugin.ts`) exports only `tempQuasarPlugin` (the file itself carries a `TODO: REMOVE THIS FILE when unit tests are rewritten.` comment at line 16).
- Verified with `grep -rn "export.*installQuasar" /Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/` — zero matches.
- Impact: Every spec listed above fails at module-resolution / import time with `TypeError: installQuasar is not a function` (or, if Vitest hoists, an import error). CI Streams coverage is dark.
- Additional offence: `StreamFieldInputs.spec.ts:18` also still does `import { QBtn, QInput, QSelect } from 'quasar';` — and `quasar` is no longer a dependency (`web/package.json` has no quasar entry). This file fails to resolve the package itself.

**Solution:** Add a shim export in `install-quasar-plugin.ts`:
```diff
- export const tempQuasarPlugin = () => { /* ... */ };
+ export const tempQuasarPlugin = () => { /* ... */ };
+ export const installQuasar = tempQuasarPlugin; // back-compat alias
```
In `StreamFieldInputs.spec.ts`:
```diff
- import { QBtn, QInput, QSelect } from 'quasar';
+ // remove this line entirely; use real OButton/OInput/OSelect
```

### C3. `<q-form @submit.prevent="onSubmit">` was replaced with `<div @submit.prevent="onSubmit">` in the Schema drawer
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/schema.vue:95`
- A `<div>` does not emit a `submit` event, so this handler never fires. Enter-key submit inside any input field in the Schema drawer (Data Retention, Max Query Range, Flatten Level, …) now does nothing.
- Mitigating: The explicit "Update Settings" button at line 1015–1023 still wires `@click="onSubmit"`, so the save itself works via mouse click. But keyboard ergonomics break, and any code path that reaches the `<form>` ref (`updateSettingsForm` is still declared on line 1187 and returned on 2731) is broken.
- Recommended fix: replace the `<div>` at line 95 with `<form ref="updateSettingsForm" @submit.prevent="onSubmit">` to restore form semantics.

**Solution:**
```diff
- <div @submit.prevent="onSubmit">
+ <form ref="updateSettingsForm" @submit.prevent="onSubmit">
   ...
- </div>
+ </form>
```

## Logical Issues

### L1. Dead pagination / sort handlers in `LogStream.vue`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:789-800`
- `onPaginationChange` and `onSortChange` are defined and `return`ed from `setup()`, but the `<OTable>` template does not bind `@pagination-change` or `@sort-change`. Pagination/sort fire through `v-model:current-page` + `v-model:page-size` + `v-model:sort-by` + `v-model:sort-order` combined with the `watch([currentPage, pageSize, sortBy, sortOrder], …)` at line 671. The dead handlers introduce confusion and a small risk of double-fire if someone later wires them up. Safe to delete.

**Solution:**
```diff
- const onPaginationChange = (...) => { ... };
- const onSortChange = (...) => { ... };
  return {
-   onPaginationChange,
-   onSortChange,
    ...
  };
```

### L2. `LogStream.vue` `onBeforeMount` redirect drops route query parameters
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:426-434`
- When the user lands on `name: "streamExplorer"` the view force-pushes back to `streamExplorer` with only `org_identifier`, stripping `stream_name`/`stream_type` from the query. `StreamExplorer.vue:93,97` then reads `params.stream_name` (undefined), produces `SELECT * FROM "undefined"`, and the schema call fails. This block exists on `main` too (verified via `git show main:`), so it is pre-existing, but the migration left it untouched and it now lives inside the redesigned page. Worth flagging because the StreamExplorer rewrite is otherwise the time to fix it.

**Solution:**
```diff
- router.push({ name: "streamExplorer", query: { org_identifier: org } });
+ router.push({
+   name: "streamExplorer",
+   query: { ...route.query, org_identifier: org },
+ });
```

### L3. `StreamExplorer.vue` error handler dereferences `err.response` after detecting it is undefined
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.vue:165-177`
- Line 167 branches on `err.response != undefined`; the `else` branch (line 170) just assigns `err.message`; then line 172 unconditionally calls `logsErrorMessage(err.response.data.code)` — throws when `err.response` was undefined. Pre-existing on `main` (verified) but worth fixing.

**Solution:**
```diff
  if (err.response != undefined) {
    message = err.response.data.message;
+   logsErrorMessage(err.response.data.code);
  } else {
    message = err.message;
  }
- logsErrorMessage(err.response.data.code);
```

### L4. `StreamExplorer.vue` `ErrorException(message)` is unreachable
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.vue:124-131`
- Function defined inside `<script setup>` but never invoked. The only previous caller `buildSearch()` has the call commented out at line 229. Dead code.

**Solution:**
```diff
- function ErrorException(message) { ... }
```
Delete the entire `ErrorException` function definition.

### L5. `StreamExplorer.vue` columns built from `field.name` will mis-render dotted field paths
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.vue:103-108`
- Mapping `accessorKey: field.name` to TanStack's `accessorKey` treats `"a.b.c"` as a nested-object accessor. Schemas that include dotted JSON-flattened field names (which OpenObserve produces routinely) will display blanks in those cells. Compare with `main` where the column used `field: (row) => JSON.stringify(row)` and `prop:`. The migration also dropped the original `type: field.type` metadata. Use `accessorFn: (row) => row[field.name]` instead (or quote the path) to preserve the previous behavior.

**Solution:**
```diff
  columns.value = fields.map((field) => ({
    id: field.name,
-   accessorKey: field.name,
+   accessorFn: (row) => row[field.name],
    header: field.name,
+   meta: { type: field.type },
  }));
```

### L6. `LogStream.vue` `OTable` always-rendered drawers/dialogs
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:189-242`
- `AddStream`, `ODialog` (delete), `ODialog` (batch delete) are rendered unconditionally — only `SchemaIndex` is gated by `v-if="showIndexSchemaDialog"`. On `main` they were wrapped in `q-dialog` which mounted lazily. With ODialog this is intentional in the new design (`v-model:open` controls visibility), but every page-load now eagerly mounts the AddStream form including its `StreamFieldInputs` even when the user never opens it. Minor perf footprint, plus it means errors in those components show on first render of every Streams page visit.

**Solution:**
```diff
- <AddStream v-model:open="showAddStreamDialog" />
+ <AddStream v-if="showAddStreamDialog" v-model:open="showAddStreamDialog" />
- <ODialog v-model:open="showDeleteDialog" ... />
+ <ODialog v-if="showDeleteDialog" v-model:open="showDeleteDialog" ... />
```

### L7. `schema.vue` always mounts the drawer body even when there's no `indexData.schema`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/schema.vue:18-93,1033-1035`
- The `<ODrawer>` is always rendered (no `v-if`). The body has `v-if="indexData.schema"` with `v-else <h5>Wait while loading…</h5>`. On `main` the entire `<q-card>` was guarded by `v-if="indexData.schema"`. As a result when the drawer is closed but the parent (`LogStream.vue:187`) gates `v-if="showIndexSchemaDialog"` the side effect is fine; but when the drawer is opened and `indexData.schema` is empty (e.g. failed schema fetch) the user sees the literal "Wait while loading…" placeholder.

**Solution:**
```diff
- <div v-else><h5>Wait while loading…</h5></div>
+ <div v-else class="tw:flex tw:items-center tw:justify-center tw:p-8">
+   <OSpinner /> <span class="tw:ml-2">{{ t('common.loading') }}</span>
+ </div>
```

### L8. `LogStream.vue` uses `OToggleGroup` without `clearable`/no-value protection
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:34-63`
- `filterLogStreamByTab` casts the model value to string and calls `onChangeStreamFilter(tab)`. If the toggle group emits an `undefined`/empty value on a future click (the new OToggleGroup may allow deselection), the request will fetch `selectedStreamType.value = ""` which is then OR'd with `""` in `getPaginatedStreams("…")`. Behavior of empty stream type filter is server-side dependent; consider clamping with `if (!tab) return;`.

**Solution:**
```diff
  const filterLogStreamByTab = (tab) => {
+   if (!tab) return;
    onChangeStreamFilter(String(tab));
  };
```

## CSS / Layout Issues

### S1. Hard-coded class strings still mix Tailwind `tw:`, Quasar utilities, and stale Quasar component classes
- `LogStream.vue:27` — `class="q-table__title tw:font-[600]"` — `q-table__title` no longer styles anything (q-table is gone) but is still applied to the page header.
- `LogStream.vue:68,427` and `schema.vue:429` — `class="…no-border o2-search-input…"` — `no-border` was a Quasar utility for `q-input`'s control element.
- `AddStream.vue:51,101` — `class="showLabelOnTop no-case"` — `no-case` was a Quasar typography utility.
- `SearchBar.vue:34,49` — `class="float-left"` and `class="search-time tw:pl-2 float-left tw:mr-2"` — `float-left` is a Quasar layout utility (not Tailwind's `float-left` which would need the `tw:` prefix in this repo's config).

**Solution:**
```diff
- class="q-table__title tw:font-[600]"
+ class="tw:font-[600]"
- class="…no-border o2-search-input…"
+ class="…o2-search-input…"
- class="showLabelOnTop no-case"
+ class=""
- class="float-left"
+ class="tw:float-left"
```

### S2. Large blocks of dead SCSS targeting Quasar classes that no longer render
- `LogStream.vue:895-906` — `.checkbox-delete-associated-alerts-pipelines .q-checkbox__inner / .q-checkbox__bg` styles. The checkbox is now `OCheckbox`; these selectors never match.
- `schema.vue:2850,2941-2949,2960-2997,3004-3019,…` — extensive `.q-card__section--vert`, `.q-list`, `.q-item`, `.q-item__section--avatar`, `.q-field__inner`, `.q-field__control`, `.q-field__native`, `.q-field__control-container` rules. All inert.
- `AssociatedRegexPatterns.vue:1181-1184,1213-1226` — `.q-table__card`, `.q-field__control` rules. Inert.
- `StreamFieldInputs.vue:334-340` — `.alerts-condition-action .q-btn` rules. Inert.
- `AddStream.vue:408-415` — `.q-field__label` rules. Inert (OInput renders different DOM).
- `SearchBar.vue:240-339` — large block of `.q-field--standard`, `.q-field__control`, `.q-field__input`, `.q-field__native`, `.q-field__marginal`, `.q-btn-group`, `.q-btn-dropdown__arrow-container`, `.q-toggle__inner`, `.q-toggle__label` rules. None of these elements exist in the new template.
- Impact: not a functional bug, but ~hundreds of lines of dead styles. Carries risk that a future tweak assumes a Quasar visual still applies.

**Solution:**
```diff
- .checkbox-delete-associated-alerts-pipelines .q-checkbox__inner { ... }
- .q-card__section--vert, .q-list, .q-item, .q-item__section--avatar { ... }
- .q-field, .q-field__control, .q-field__native { ... }
- .q-table__card, .q-btn-group, .q-toggle__inner { ... }
```
Delete all such `q-*` SCSS blocks; if equivalent styling is still needed, target the O*-rendered classes (e.g. `.o-checkbox`, `.o-input`, `.o-table`).

### S3. Schema drawer header has a literal `?` separator between timestamps
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/schema.vue:83-84`
- Renders as `{{ doc_time_min }} ? {{ doc_time_max }}` — the `?` is a literal ASCII question mark and was already present on `main` (line 71). Looks like a fall-back glyph for a character that did not survive a copy/paste (likely an arrow or "→"). Not a regression but still wrong, and the drawer rewrite did not fix it.

**Solution:**
```diff
- {{ doc_time_min }} ? {{ doc_time_max }}
+ {{ doc_time_min }} &rarr; {{ doc_time_max }}
```

### S4. `LogStream.vue` table height computed from `100vh - var(--navbar-height) - 77px`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:120-124`
- `--navbar-height` is a CSS custom property defined globally. Confirm it is still set by the new layout; previously Quasar's `q-layout` injected it. If `OLayout` (or whatever replaces it) does not set this var, the table collapses to `calc(100vh - 77px)`, which is fine, but on tiny viewports gives negative heights silently.

**Solution:**
```diff
- height: calc(100vh - var(--navbar-height) - 77px);
+ height: calc(100vh - var(--navbar-height, 56px) - 77px);
+ min-height: 200px;
```

## Component Migration Issues

### M1. `OTable` columns: `settings` column declared without a `header`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/schema.vue:2087-2092`
- ```ts
  { id: "settings", accessorFn: (row) => (row.isUserDefined ? 0 : 1), sortable: true, meta: { align: "left" } }
  ```
- No `header` field, so the column heading is blank. The `#cell-settings` slot at lines 559–564 renders OIcons. Either intentional (icon-only column) or an oversight — the slot does have icons but lacks a tooltip explaining what the column represents. Consider `header: ""` for clarity (avoids relying on `undefined` rendering).

**Solution:**
```diff
- { id: "settings", accessorFn: (row) => (row.isUserDefined ? 0 : 1), sortable: true, meta: { align: "left" } }
+ { id: "settings", header: "", accessorFn: (row) => (row.isUserDefined ? 0 : 1), sortable: true, meta: { align: "left" } }
```

### M2. Stream Explorer table is no longer virtualized
- Old: `q-virtual-scroll` slicing 150-item windows (`StreamDataTable.vue` removed)
- New: `OTable` with server pagination at `pageSize=150`
- Plain table at 150 rows of arbitrary-width columns can be slow when schemas have many fields (10s of columns is common). The previous design tolerated very wide schemas because `q-virtual-scroll` rendered only visible rows. Worth load-testing.

**Solution:** Either accept the trade-off, or add a virtualized variant prop to `OTable` (e.g. `virtual` + `:row-height="36"`) backed by `@tanstack/vue-virtual`. Document the chosen path.

### M3. Inline `OTable` lost `dense` semantics correctly but `bordered`/`sticky-header` are passed as boolean props
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/StreamExplorer.vue:25-29`
- Make sure `OTable.types.ts` recognizes `sticky-header` and `bordered` and `dense` boolean props; the OTable component code uses kebab-case attributes — verified columns work, but if any of these are not defined the attribute silently lands as a DOM attribute and styles nothing.

**Solution:** Confirm against `web/src/lib/data/Table/OTable.types.ts` that `stickyHeader`, `bordered`, and `dense` are declared as boolean props. If not, declare them, or drop the attributes.

### M4. `AddStream.vue` uses `OInput type="number"` but stores `streamInputs.dataRetentionDays` initially as integer `14`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AddStream.vue:194-199, 237`
- `OInput` with `type="number"` typically emits string values. The validator at line 237 then does `streamInputs.value.dataRetentionDays > 0` — this works for both `"14"` and `14`. But `Number(streamInputs.value.dataRetentionDays)` at line 338 protects the API payload. Functional, but the model is now mixed-type. Consider an explicit numeric `v-model.number`.

**Solution:**
```diff
- <OInput type="number" v-model="streamInputs.dataRetentionDays" />
+ <OInput type="number" v-model.number="streamInputs.dataRetentionDays" />
```

### M5. `SearchBar.vue` uses `defineAsyncComponent` without importing it
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/explore/SearchBar.vue:80,115`
- Imports `{ defineComponent, ref, onMounted, onBeforeMount } from "vue"` — `defineAsyncComponent` missing. The file is annotated `// @ts-nocheck` at line 79, so the compiler does not catch this. At runtime in browsers without the global polyfill this throws `ReferenceError: defineAsyncComponent is not defined`. Pre-existing on `main`, but never fixed during the migration. The unit test (`SearchBar.spec.ts:25-40`) actively monkey-patches `globalThis.defineAsyncComponent` — proof that this symbol needs a real import. Add `defineAsyncComponent` to the Vue import.

**Solution:**
```diff
- import { defineComponent, ref, onMounted, onBeforeMount } from "vue";
+ import { defineComponent, defineAsyncComponent, ref, onMounted, onBeforeMount } from "vue";
```

### M6. `OSelect` in `StreamFieldInputs.vue` still passes obsolete Quasar props
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/StreamFieldInputs.vue:62-91, 93-117`
- Both `OSelect` instances still pass `stack-label`, `borderless`, `dense`, `use-input`, `fill-input`, `emit-value` — those were `q-select` props. If `OSelect` ignores them this is just noise; if it warns at runtime they'll spam the console. The visual output (`width: 250px` etc.) suggests the new component does basic layout work via Tailwind only. Compare also to `popup-content-style` (Quasar dropdown styling prop) on lines 70 — likely a no-op now.

**Solution:**
```diff
- <OSelect stack-label borderless dense use-input fill-input emit-value popup-content-style="..." />
+ <OSelect searchable />
```

### M7. `LogStream.vue` OTable `selection="multiple"` plus `selectedIds` keyed off `_rowKey`
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/LogStream.vue:106-115, 503-504`
- `_rowKey = "${data.name}-${data.stream_type}"` works as long as no stream name contains the literal `-`+a known stream-type suffix that creates a collision. Unlikely but worth noting if stream names allow hyphens. Selected IDs are correctly mapped back to rows at line 332–334.

**Solution:**
```diff
- _rowKey: `${data.name}-${data.stream_type}`,
+ _rowKey: `${data.name}|${data.stream_type}`,
```
Use a non-name character (`|`) to avoid collisions with hyphens in stream names.

### M8. AssociatedRegexPatterns uses `OCollapsible` wrapping `OTable` — height interactions
- Path: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/logstream/AssociatedRegexPatterns.vue:59-105, 109-157`
- `OTable` with `style="height: 100%; overflow-y: auto"` inside a collapsible whose parent has `calc(100vh - 130px)` works only if `OCollapsible` propagates `height: 100%` to its panel slot. Verify in the running app — a common migration pitfall.

**Solution:** Add to OCollapsible's panel slot wrapper:
```diff
- <div class="o-collapsible__panel">
+ <div class="o-collapsible__panel tw:flex tw:flex-col tw:h-full">
   <slot />
 </div>
```

## Test File Issues

In addition to **C2** above (every spec imports `installQuasar` which does not exist):

- `StreamFieldInputs.spec.ts:18` — `import { QBtn, QInput, QSelect } from 'quasar';` — the `quasar` package is no longer a dependency, so module resolution fails before any test runs.
- `StreamFieldInputs.spec.ts:88-90` — `components: { QBtn, QInput, QSelect }` registers Quasar components that no longer exist; even if the import were stubbed, the test would not exercise the real `OButton` / `OInput` / `OSelect` rendered by the component. Selectors like `wrapper.findAll('[data-test="add-stream-field-name-input"] .q-input')` at line 425 will never match the new DOM (`q-input` class is gone).
- `AssociatedRegexPatterns.spec.ts:618` — comment reads `// Quasar plugin is installed globally via installQuasar()`. Stale comment + broken call.
- `Schema.spec.ts` — uses an `ODrawerStub` (lines 31–83) — that part is well done. But its `installQuasar();` call at line 25 still breaks the import.
- `StreamExplorer.spec.ts:17` — `installQuasar({ plugins: [] });` — same issue. The mocked `OTable` (line 52–57) is a `<div>OTable</div>` stub, so the rendering assertions are loose, but the file cannot even load.

**Solution:** Add an alias export in `install-quasar-plugin.ts` and remove Quasar component imports:
```diff
+ export { tempQuasarPlugin as installQuasar };
- import { QBtn, QInput, QSelect } from 'quasar';
- components: { QBtn, QInput, QSelect },
- wrapper.findAll('[data-test="..."] .q-input')
+ wrapper.findAll('[data-test="..."]').findComponent({ name: 'OInput' })
```

Recommended fix path: replace `installQuasar()` with `tempQuasarPlugin()` (the symbol that DOES exist), and either:
1. Provide a shim `export { tempQuasarPlugin as installQuasar }` in the helper, or
2. Rename the calls in every spec.

## Validations

- Stream name validation: `AddStream.vue:227-242` — checks non-empty and stream_type non-empty; no character / length validation, no uniqueness check (relies on `getStream(name, type)` lookup at line 248). Matches `main` behavior.
- Data Retention validation: `AddStream.vue:237-240, 328-335` — must be ≥1 day, also re-validated in `getStreamPayload()`. The `schema.vue:680-689` retention input shows an error span but does **not** block the "Update Settings" button — only `formDirtyFlag` gates it. A user can save `dataRetentionDays = 0`. Check: the API may reject, but the UI does not.
- Max Query Range / Flatten Level: numeric `min` attributes only; no error display block. Free-form negative input is not blocked.

**Solution:**
```diff
- :disabled="!formDirtyFlag"
+ :disabled="!formDirtyFlag || dataRetentionDays < 1 || flattenLevel < 0"
```
Add proper `:error` / `:error-message` on each OInput and consolidate via a validator object.

## Accessibility

- `AddStream.vue` drawer's primary `Save` button via `@click:primary` (line 28). `OInput` labels are passed as `:label` prop — assume `OInput` wires `for`/`id` correctly; otherwise screen readers see unlabelled inputs.
- `LogStream.vue:208-216` and `229-241` — the OCheckbox is rendered as a sibling of a `<span class="delete-associated-alerts-pipelines-text">` rather than with a proper `<label>`/`for`. Clicking the text will not toggle the checkbox. Compare `main` which had `q-checkbox` with `label` slot or `class` — review the OCheckbox API and wrap with `<label>` or pass the text as the checkbox's `label` prop.
- `StreamFieldInputs.vue` — Add/Delete icon buttons rely on `:title` for tooltips. Once C1 is fixed, also add `aria-label` to those buttons; `title` alone is not enough for screen readers.
- `PerformanceFieldsDialog.vue:38-46, 65-73` — explicit `aria-label` on the remove `<button>` is correct.
- `schema.vue` schema drawer header (line 27–91): the chip showing `{{ doc_time_min }} ? {{ doc_time_max }}` has no `aria-label`; a screen reader will literally announce "question mark" between two long numbers.

**Solution:**
```diff
- <OCheckbox v-model="deleteAlerts" />
- <span class="delete-associated-alerts-pipelines-text">Delete alerts</span>
+ <OCheckbox v-model="deleteAlerts" :label="t('common.deleteAlerts')" />
- <OButton icon-left="add" :title="t('common.add')" />
+ <OButton icon-left="add" :aria-label="t('common.add')" />
- <span>{{ doc_time_min }} ? {{ doc_time_max }}</span>
+ <span :aria-label="`From ${doc_time_min} to ${doc_time_max}`">{{ doc_time_min }} &rarr; {{ doc_time_max }}</span>
```

## Recommendations

Order by blast radius:

1. **Restore the `@click` bindings on `StreamFieldInputs.vue` add/delete buttons (C1).** This single change unblocks schema field management. Two lines.
2. **Fix the spec helper (C2).** Either alias-export `installQuasar` in `install-quasar-plugin.ts` (`export { tempQuasarPlugin as installQuasar }`) or do a one-off rename across the 9 spec files. Without this, no Streams unit test is running.
3. **Convert the `<div @submit.prevent>` in `schema.vue:95` back to a `<form ref="updateSettingsForm" @submit.prevent="onSubmit">` (C3).** Restores keyboard submit and revives the existing `updateSettingsForm` ref.
4. **Fix `StreamExplorer.vue` accessorKey handling (L5).** Switch to `accessorFn: (row) => row[field.name]` to support dotted field names which OpenObserve emits regularly.
5. **Decide the Stream Explorer virtualization story (M2).** Either accept the perf trade-off or replace `OTable` with a virtualizing variant; document the choice.
6. **Drop dead handlers and dead SCSS (L1, S2).** Removes ~200 lines of clutter and avoids future confusion.
7. **Pre-existing fixes that the migration would have been a good time to do (L2, L3, L4, S3, M5):** drop unreachable `ErrorException`, fix the `err.response.data.code` deref, fix the `?` literal in the schema header, import `defineAsyncComponent` properly, and stop force-redirecting away from `streamExplorer` while dropping query params.
8. **Tighten the AddStream / Schema validation (Validations section).** Block save instead of relying on backend rejection for `dataRetention < 1`, negative `flatten_level`, etc.
9. **Accessibility pass.** Wrap the delete-confirm OCheckbox + label in `<label>`, add `aria-label` to icon buttons, and make the timestamp chip in the Schema drawer screen-reader friendly.

Quasar runtime removal is essentially complete on these pages — no `<q-*>` elements, no `useQuasar()`, no `q.notify()` survive — but the migration left dead CSS, dead handlers, dead spec helpers, and the one C1 click-handler regression that is user-visible.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `views/LogStream.vue:27` | `q-table__title` | drop (dead CSS) | File-scoped |
| `components/logstream/schema.vue:99` | `q-w-md` | `tw:w-32` (Quasar `q-w-md` ≈ 192px → pick closest scale) | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:14` | `col-auto` | `tw:flex-none` (or drop empty div) | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:27` | `col-auto` | `tw:flex-none` | File-scoped |
| `components/logstream/PerformanceFieldsDialog.vue:25` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `components/logstream/PerformanceFieldsDialog.vue:52` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `components/logstream/explore/SearchBar.vue:20` | `col-auto` | `tw:flex-none` | File-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `components/logstream/schema.vue:641` | `dark:tw:bg-[#181A1B] dark:tw:border-gray-700` | `tw:dark:bg-[#181A1B] tw:dark:border-gray-700` | File-scoped |
| `components/logstream/PerformanceFieldsDialog.vue:41` | `tw:hover:opacity-70` (this order is correct) — but verify with `tw:hover` prefix-engine first | confirm OK | n/a |
| `components/logstream/PerformanceFieldsDialog.vue:68` | `tw:hover:opacity-70` | confirm OK | n/a |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
*(none found)*

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `components/logstream/schema.vue:2850` | `.q-card__section--vert` | Delete (OCard does not emit this) | File-scoped |
| `components/logstream/schema.vue:2900-2960` | `.q-list .q-item`, `.q-item` | Delete; OList/OItem use different class hooks | File-scoped |
| `components/logstream/schema.vue:2946` | `&.q-field` | Delete | File-scoped |
| `components/logstream/schema.vue:2990` | `.q-item__section--avatar` | Delete | File-scoped |
| `components/logstream/schema.vue:3004-3028` | `.q-field__inner/__control/__control-container/__native/__marginal/__append` | Delete (no OInput emits these) | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:1168` | `.q-field__native` | Delete | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:1181` | `.q-table__card` | Delete | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:1213` | `.dark-mode-regex-test-string-input .q-field__control` | Delete or rewrite for OInput | File-scoped |
| `components/logstream/AssociatedRegexPatterns.vue:1220` | `.light-mode-regex-test-string-input .q-field__control` | Delete or rewrite | File-scoped |
| `components/logstream/explore/SearchBar.vue:240-242` | `.q-field--standard .q-field__control:before / :focus:before / :hover:before` | Delete | File-scoped |
| `components/logstream/explore/SearchBar.vue:264-276` | `.q-field__input/__native/__control/__marginal` block | Delete | File-scoped |
| `components/logstream/explore/SearchBar.vue:296` | `.search-field .q-field` | Delete | File-scoped |
| `components/logstream/explore/SearchBar.vue:308-334` | `.q-btn-group`, `.q-btn`, `.q-btn-dropdown__arrow-container`, `* .q-btn` | Delete | File-scoped |
| `components/logstream/AddStream.vue:409` | `.q-field__label` | Delete | File-scoped |
| `components/logstream/StreamFieldInputs.vue:335` | `.q-btn` | Delete | File-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `views/LogStream.vue:880` | `$light-text` | `var(--o2-text-muted)` | File-scoped |
| `views/LogStream.vue:885` | `$light-text` | `var(--o2-text-muted)` | File-scoped |
| `components/logstream/schema.vue:2969` | `$primary` | `var(--o2-primary)` | File-scoped |
| `components/logstream/explore/SearchBar.vue:321` | `$dark-page` | `var(--o2-bg-dark)` | File-scoped |
| `components/logstream/explore/SearchBar.vue:327` | `$light-text2` | `var(--o2-text-muted-2)` (or use `var(--o2-text-secondary)`) | File-scoped |
| `components/logstream/explore/SearchBar.vue:350` | `$dark-page` | `var(--o2-bg-dark)` | File-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|-----------|-----------|--------|
| `components/logstream/schema.vue:925` | `v-close-popup="true"` | Replace with explicit `@click="popupRef?.close()"` |

### 7. Icon Migration
| File:Line | Issue | Fix |
|-----------|-------|-----|
*(none found — no underscored OIcon names, no `:color` props in Streams files)*

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `components/logstream/schema.vue:413` | `style="color: #f5a623; cursor: pointer"` | scoped `.schema-warning-icon { color: #f5a623; cursor: pointer; }` (or use design-token color) |
| `components/logstream/AssociatedRegexPatterns.vue:3` | `style="width: 60vw; height: calc(100vh - 59px)"` | scoped `.regex-pattern-dialog` |
| `components/logstream/AssociatedRegexPatterns.vue:57` | `style="height: calc(100vh - 130px); overflow-y: auto"` | scoped class |
| `components/logstream/AssociatedRegexPatterns.vue:67,117` | `style="height: 100%; overflow-y: auto"` (x2) | scoped class |
| `components/logstream/explore/SearchBar.vue:63` | `style="border-top: 1px solid #dbdbdb; height: 100px"` | scoped `.search-bar-footer { border-top: 1px solid var(--o2-border); height: 100px; }` |
| `components/logstream/StreamFieldInputs.vue:38` | `:style="isInSchema ? { width: '40vw' } : { width: '250px' }"` | extract to `:class` toggle with two scoped classes |

### 9. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| `components/logstream/schema.vue:119-287` (4 tile blocks lines 119, 164, 211, 258) | `.tile-content tw:rounded-lg tw:p-3 tw:text-center tw:border tw:shadow-sm tw:h-20 tw:flex tw:flex-col tw:justify-between` + child `.tile-header` + `.tile-value` | Promote to `<SchemaStatTile>` partial component with `label`, `value`, `icon` slots |
| `components/logstream/AssociatedRegexPatterns.vue:1168-1230` | mode-specific `.dark-mode-regex-test-string-input` / `.light-mode-regex-test-string-input` blocks | Consolidate using `html.dark` parent selector |
| `components/logstream/explore/SearchBar.vue:240-334` | many `.q-field__*` / `.q-btn*` rules (dead) | Delete entirely (one of the largest dead-CSS surfaces in Streams) |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 1 (`SchemaStatTile`)
- File-level scoped changes: ~30 (largest dead-CSS pocket is in `schema.vue` and `SearchBar.vue`)
