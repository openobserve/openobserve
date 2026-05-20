# Enrichment Tables Page — Quasar Removal Audit

## Summary

The Enrichment Tables page (mounted via the `enrichmentTables` route at `composables/shared/router.ts:325`) was migrated to O\* components + Tailwind utilities. The view files render, but the migration left behind a number of real defects: a guaranteed wrong success toast on every URL update (variable spread happens before the message is read), an `OInput` template that uses a slot name (`hint`) that does not exist on the new component, multiple Quasar leftovers in markup and SCSS, an `app.scss`-leaking unscoped `<style lang="scss">` block, and three spec files that still target the Quasar API surface (`pagination`, `perPageOptions`, `qTable.setPagination`, `column.field/.sort`, `.q-file`, `.text-h6`, plus the `{row}` props.row wrapper that no longer exists). Tests are effectively broken end-to-end; production code mostly works but contains regressions and dead UI hint copy.

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/EnrichmentTableList.vue` (958 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/AddEnrichmentTable.vue` (563 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/EnrichmentSchema.vue` (293 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/EnrichmentTableList.spec.js` (761 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/AddEnrichmentTable.spec.ts` (718 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/functions/EnrichmentSchema.spec.ts` (517 lines)

Router entry: `web/src/composables/shared/router.ts:52-53, 325-326`. View wrapper: `web/src/views/Functions.vue:86-101, 188`.

## Critical Issues

### 1. URL update success toast is always "reload started…" — `AddEnrichmentTable.vue:391-400`
```vue
.then(() => {
  formData.value = { ...defaultValue() };   // <-- resets updateMode to "reload"
  emit("update:list");
  dismiss();
  toast({
    variant: "success",
    message: formData.value.updateMode === 'reload'
      ? "Enrichment table reload started. Processing in background..."
      : "Enrichment table job started. Processing in background...",
  });
})
```
`defaultValue()` sets `updateMode: "reload"`. The form is reset before the ternary is evaluated, so the "reload" branch is taken even when the user picked `append` / `replace` / `replace_failed`. The user always sees the reload message.

Fix: capture `formData.value.updateMode` into a local before the spread, or move the toast call ahead of the reset.

**Solution:**
```diff
  .then(() => {
+   const wasReload = formData.value.updateMode === 'reload';
    formData.value = { ...defaultValue() };
    emit("update:list");
    dismiss();
    toast({
      variant: "success",
-     message: formData.value.updateMode === 'reload'
+     message: wasReload
        ? "Enrichment table reload started. Processing in background..."
        : "Enrichment table job started. Processing in background...",
    });
  })
```

### 2. OInput `hint` slot does not exist — `AddEnrichmentTable.vue:159-168, 183-187`
The helper hints under both URL inputs are written as:
```vue
<template v-slot:hint>
  <div class="tw:text-xs">…</div>
</template>
```
`OInput`'s declared slots (`web/src/lib/forms/Input/OInput.types.ts:93-107` and `OInput.vue:222-352`) are `icon-left`, `icon-right`, `prefix`, `suffix`, `tooltip`, `append`. There is no `hint` slot — these `<template>` blocks are silently dropped. The hint copy "Must be a publicly accessible CSV file", "Enter a new URL to add…", "Enter a URL to replace…" never renders.

Fix: use the `helpText` prop on `OInput` (rendered at `OInput.vue:368-373`), e.g. `:help-text="'Must be a publicly accessible CSV file'"`.

**Solution:**
```diff
- <OInput v-model="formData.url" ...>
-   <template v-slot:hint>
-     <div class="tw:text-xs">Must be a publicly accessible CSV file</div>
-   </template>
- </OInput>
+ <OInput v-model="formData.url" help-text="Must be a publicly accessible CSV file" ... />
```

### 3. `OFile` initialized with empty string instead of `null` — `AddEnrichmentTable.vue:234-243`
`defaultValue()` sets `file: ""`. `OFile.types.ts` declares `FileValue = File | File[] | null`. `OFile.vue:33-37` does `Array.isArray(v) ? v : [v]` for any truthy value, so a stray `""` is wrapped into `[""]` and treated as a "file" by downstream logic until the user picks one. Use `file: null`.

**Solution:**
```diff
  const defaultValue = () => ({
    name: "",
-   file: "",
+   file: null,
    /* ... */
  });
```

### 4. `q-page` removed, top-level wrapper has no min-height — `EnrichmentTableList.vue:20`
`<q-page>` was replaced by a `<div class="tw:rounded-md">`. The page no longer pulls in Quasar's `min-height: calc(100vh - …)` rule; combined with `tw:h-[calc(100vh-127px)]` inside the card-container (line 59), the layout becomes brittle when nested inside `Functions.vue`'s flex wrapper. (Cosmetic in the current view, but worth a visual pass.)

**Solution:**
```diff
- <div class="tw:rounded-md">
+ <div class="tw:rounded-md tw:min-h-[calc(100vh-var(--navbar-height))]">
```

### 5. Watcher targets the wrong route — `EnrichmentTableList.vue:917-931`
```ts
watch: {
  selectedOrg(newVal, oldVal) {
    if (
      (newVal != oldVal || this.jsTransforms.value == undefined) &&
      this.router.currentRoute.value.name == "pipeline"
    ) { … }
  }
}
```
This page is mounted on route `name: "enrichmentTables"` (router.ts:325), not `"pipeline"`. The reload-on-org-switch never fires. This was already present on `main` but is still a real bug worth flagging.

**Solution:**
```diff
  selectedOrg(newVal, oldVal) {
    if (
      (newVal != oldVal || this.jsTransforms.value == undefined) &&
-     this.router.currentRoute.value.name == "pipeline"
+     this.router.currentRoute.value.name == "enrichmentTables"
    ) { /* ... */ }
  }
```

## Logical Issues

### 1. `getSchemaData` does not run on initial open — `EnrichmentSchema.vue:213-218`
```ts
watch(() => props.open, async (isOpen) => { if (isOpen) await getSchemaData(); });
```
`watch` defaults to `immediate: false`. If the drawer is mounted with `open: true`, no fetch is triggered and the user sees the default empty schema (`stats.doc_num: 0`, `schema: []`). Add `{ immediate: true }` or call `getSchemaData()` from `onMounted` when `props.open`.

**Solution:**
```diff
- watch(() => props.open, async (isOpen) => { if (isOpen) await getSchemaData(); });
+ watch(() => props.open, async (isOpen) => { if (isOpen) await getSchemaData(); }, { immediate: true });
```

### 2. Status icons no longer carry a tooltip — `EnrichmentTableList.vue:93-159`
On `main` each `<q-icon>` wrapped a `<q-tooltip>` child; the icon itself was the trigger. After migration each `<span>` contains a sibling `<OIcon>` and `<OTooltip>`. `OTooltip` in "child mode" (no default slot) attaches to its **parent element** — which is the `<span>`, not the icon. The tooltip will appear when hovering anywhere on the wrapping span (still works, but the trigger area is now the full text + icon row, not the icon alone). For the `failed` status row this means hovering the warning icon and hovering "Url ( N )" both show the same tooltip.

**Solution:**
```diff
- <span>
-   ...
-   <OIcon name="warning" />
-   <OTooltip :content="..." />
- </span>
+ <span>
+   ...
+   <OIcon name="warning">
+     <OTooltip :content="..." />
+   </OIcon>
+ </span>
```

### 3. URL-jobs drawer markup has mis-indented closing tags — `EnrichmentTableList.vue:274-299`
The closing `</ul>`, `</div>` (line 294-295) for the `v-if` branch and the `<div v-else>` (296) work in Vue, but the indentation is off and the empty-state `<div v-else>` is closed at line 298, *outside* of the surrounding container indentation. Cosmetic, but will trip up future edits — verify the v-if/v-else pair compiles by running it.

**Solution:** Run `prettier --write` on the file or manually re-indent the v-if/v-else block to align with surrounding container.

### 4. `selectedDelete.value.ingest` typo — `EnrichmentTableList.vue:682`
`is_ingest_func: selectedDelete.value.ingest` — the row object never has an `ingest` field, so this analytic event always sends `undefined`. Pre-existing on main, surfaced again by the migration.

**Solution:**
```diff
- is_ingest_func: selectedDelete.value.ingest,
+ is_ingest_func: selectedDelete.value.is_ingest_func ?? false,
```

### 5. Dead utility import — `EnrichmentTableList.vue:331-333`
`OCheckbox` is imported and registered in `components`, but is never used (selection checkboxes are rendered internally by `OTable`). Drop the import.

**Solution:**
```diff
- import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
- components: { ..., OCheckbox, ... }
```

### 6. Dead `editorUpdate` / `editorRef` / `editorobj` — `AddEnrichmentTable.vue:271-272, 306-308`
Leftover from the previous editor-based form. There is no `<editor>` element in the template, but `editorUpdate` is still exposed and tested. Safe to remove.

**Solution:**
```diff
- const editorUpdate = () => { /* ... */ };
- const editorRef = ref();
- const editorobj = ref();
- // and remove from setup() return
```

### 7. `compilationErr` is never cleared on the next submit — `AddEnrichmentTable.vue`
After an error, `<pre v-if="compilationErr">` shows. Nothing resets `compilationErr` when the user retries. `onSubmit` clears `nameError/fileError/urlError` but not `compilationErr`. (Pre-existing, but exposed because the error block is now styled with bold red text.)

**Solution:**
```diff
  const onSubmit = () => {
    nameError.value = "";
    fileError.value = "";
    urlError.value = "";
+   compilationErr.value = "";
    // ...
  };
```

## CSS / Layout Issues

### 1. Unscoped `<style lang="scss">` block leaks globally — `EnrichmentTableList.vue:936-958`
```scss
.search-en-table-input {
  .q-field__inner { width: 250px; }
}
.rotate-animation { animation: rotate 1s linear infinite; }
@keyframes rotate { ... }
/* No custom styles needed - using Quasar components */
```
- The `.search-en-table-input` rule targets `.q-field__inner`, a Quasar internal class that no longer exists.
- The whole block is **not** `scoped`, so `.rotate-animation` and `@keyframes rotate` get registered globally. `AddEnrichmentTable.vue` (also un-scoped, lines 529-540) defines another `.rotate-animation` with a **different duration (2s vs 1s)** and the same keyframe name — last-loaded wins.
- The trailing `"/* No custom styles needed - using Quasar components */"` comment is wrong.

**Solution:**
```diff
- <style lang="scss">
- .search-en-table-input { .q-field__inner { width: 250px; } }
- .rotate-animation { animation: rotate 1s linear infinite; }
- @keyframes rotate { /* ... */ }
- /* No custom styles needed - using Quasar components */
- </style>
+ <style lang="scss" scoped>
+ .search-en-table-input { width: 250px; }
+ /* Promote .rotate-animation/@keyframes rotate to a shared partial under
+    web/src/styles/animations/_rotate.scss */
+ </style>
```

### 2. Quasar utility classes used in templates
- `EnrichmentTableList.vue:25` — `class="q-table__title …"`
- `EnrichmentTableList.vue:217` — `class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md"` — `tw:mr-md` is not a Tailwind utility (no such width token); it was meant to be Quasar's `q-mr-md`.
- `AddEnrichmentTable.vue:101` — `class="tw:flex tw:items-center q-gutter-x-xs"` — Quasar gutter still referenced.
- `AddEnrichmentTable.vue:102-105` — `class="col-auto"` (Quasar grid).
- `AddEnrichmentTable.vue:103` — `class="text-weight-medium tw:text-gray-400"` — Quasar text-weight utility.
- `EnrichmentSchema.vue:31` — `class="tw:pt-3 tw:text-center q-w-md tw:mx-4 tw:flex tw:justify-center"` — Quasar `q-w-md` left in.

**Solution:**
```diff
- class="q-table__title …"
+ class="tw:text-base tw:font-semibold …"
- class="… tw:mr-md"
+ class="… tw:mr-4"
- class="… q-gutter-x-xs"
+ class="… tw:gap-1"
- class="col-auto text-weight-medium"
+ class="tw:flex-none tw:font-medium"
- class="… q-w-md …"
+ class="… tw:w-48 …"
```

### 3. Quasar icon `color` prop passed to OIcon — `AddEnrichmentTable.vue:108`
```vue
<OIcon
  :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : ..."
  size="sm"
/>
```
`OIcon` has no `color` prop with these Quasar-named values; the attribute is forwarded as `color="positive"` on the underlying SVG and produces no useful styling.

**Solution:**
```diff
  <OIcon
-   :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : ..."
+   :class="job.status === 'completed' ? 'tw:text-green-500' : job.status === 'failed' ? 'tw:text-red-500' : 'tw:text-gray-500'"
    size="sm"
  />
```

### 4. Hardcoded inline colors / sizes
- `AddEnrichmentTable.vue:99` — `style="background-color: #fafafa;"` (hardcoded — should be `var(--o2-surface-muted)` or similar token).
- `AddEnrichmentTable.vue:98, 100, 103, 113` — repeated `style="font-size: 12px / 13px"` instead of using Tailwind text utilities or design tokens.
- `EnrichmentSchema.vue:100, 116` — `style="margin-bottom: 30px"` and `<br /><br /><br />`. The triple `<br>` is a layout hack inside an `ODrawer` body.

**Solution:**
```diff
- style="background-color: #fafafa;"
+ class="tw:bg-[var(--o2-surface-muted)]"
- style="margin-bottom: 30px"
+ class="tw:mb-8"
- <br /><br /><br />
+ <div class="tw:h-8"></div>
- style="font-size: 12px"
+ class="tw:text-xs"
```

### 5. Inline `style="max-width: 300px; … font-size: 0.85em;"` in tooltip content
`EnrichmentTableList.vue:100, 117, 135, 151` — every tooltip content block uses inline `style="max-width: 300px"`. Should use the `OTooltip` `maxWidth` prop (defaults to `320px`; see `OTooltip.vue:13-21`).

**Solution:**
```diff
- <OTooltip>
-   <div style="max-width: 300px">...</div>
- </OTooltip>
+ <OTooltip :max-width="300">
+   <div>...</div>
+ </OTooltip>
```

### Three-Layer CSS Violations

| Layer | Violation | Where |
|---|---|---|
| Global pollution | Unscoped `<style lang="scss">` registers `.rotate-animation` and `@keyframes rotate` into the global stylesheet. | `EnrichmentTableList.vue:936-958`, `AddEnrichmentTable.vue:542-562` (additional unscoped block with `.no-case .q-field__native span`, `.lookup-table-file-uploader .q-field__label`, `.lookup-table-append-toggle .q-toggle__inner` — every selector targets removed Quasar internals). |
| Tokens hardcoded at file level | `background-color: #fafafa`, `#00000005`, `font-size: 12px/13px/0.85em`, `style="font-size: 18px"`, `style="color: white"` | `AddEnrichmentTable.vue:99,103,113`, `EnrichmentSchema.vue:266,284`. |
| Tokens hardcoded at file level (SCSS) | `EnrichmentSchema.vue:266` uses `background-color: #00000005`, `border: 1px solid $input-field-border-color`. `EnrichmentSchema.vue:283` `background-color: $primary` and `color: white`. These should be `var(--o2-border-subtle)`, `var(--o2-color-primary)`, etc. — both `$primary` and `$input-field-border-color` are explicitly legacy Quasar shims (`web/src/styles/_quasar-variables.scss:1-6, 36`). | `EnrichmentSchema.vue:252-288`. |
| Duplicated file-level styles | Identical `.rotate-animation` keyframe defined in two `.vue` files with different durations. Should be promoted to a component-layer partial (e.g. `web/src/styles/animations/_rotate.scss`) or a Tailwind plugin. | `EnrichmentTableList.vue:944-955`, `AddEnrichmentTable.vue:529-540`. |
| Tailwind/component-level conflict | `class="no-border o2-search-input"` on `OInput` (`EnrichmentTableList.vue:40`) — `o2-search-input` is defined globally in `app.scss:850`, but `OInput` already owns its border styling; the global rule fights the component's own classes. | `EnrichmentTableList.vue:37-46`. |

### 6. Dark-theme class names rely on Quasar `.q-table` chain — `EnrichmentSchema.vue:96-99`
```vue
<div :class="store.state.theme === 'dark' ? 'dark-theme-table' : 'light-theme-table'">
```
The matching `.dark-theme-table` / `.light-theme-table` rules (if they exist in `app.scss`) were designed around `<q-table>` internals (`.q-table thead`, `.q-table__bottom`, etc.). With `OTable` they will not match anything useful. Run a smoke test in dark mode.

**Solution:**
```diff
- <div :class="store.state.theme === 'dark' ? 'dark-theme-table' : 'light-theme-table'">
+ <div :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-card-bg)] tw:text-[var(--o2-text-primary)]' : ''">
```

## Component Migration Issues

| From (main) | To (HEAD) | Status |
|---|---|---|
| `<q-page>` | `<div class="tw:rounded-md">` | Loses min-height context; verify layout. |
| `<q-input borderless dense flat>` | `<OInput>` with `#icon-left` slot | OK but old `class="no-border o2-search-input"` is now redundant. |
| `<q-table>` | `<OTable>` with `selected-ids` model + `OTableColumnDef[]` columns | OK — but column accessors changed from `name/field/sort` to `id/accessorKey/accessorFn`, breaking all column-based unit tests. |
| `<q-td :props="props">` body cells | `#cell-<col>="{ row }"` named slots | OK in code, but **all callers were updated to pass `row` directly** while `selectedDelete`/segment analytics in spec still call with `{ row: testRow }` (see Test File Issues). |
| `<q-dialog position="right" full-height maximized>` | `<ODrawer v-model:open="…" size="lg">` | OK. |
| `<q-card>` URL list | `<ul><li>` | OK. |
| `<q-list separator>` + `<q-item>` | `<ul class="tw:divide-y tw:divide-border">` + `<li>` | OK. |
| `<q-badge :color="…">` | `<OBadge :variant="…">` | OK, mapping `positive→success`, `negative→error`. |
| `<q-icon name="check_circle" color="positive">` | `<OIcon name="check-circle" size="sm" />` + sibling `<OTooltip>` | Tooltip behavior changed — see Logical Issue 2. Color prop ignored. |
| `<q-checkbox>` row selection | `selected-ids` model on `OTable` | OK. |
| `<q-file>` | `<OFile>` | Migrated but `file: ""` init still leaks (see Critical 3). |
| `<q-option-group>` | `<OOptionGroup>` | OK. |
| `<q-toggle>` | `<OSwitch>` | OK; but template still has a leftover `lookup-table-append-toggle` class that styles `.q-toggle__inner` (file-level SCSS at `AddEnrichmentTable.vue:553-562`). |
| `<q-separator>` | `<OSeparator>` | OK. |
| `useQuasar()` / `$q.notify` | `useToast()` from `@/lib/feedback/Toast/useToast` | Migrated in `.vue` files; specs still mock `useQuasar`. |
| `QTablePagination` shared component | Pagination handled internally by `OTable` (`pagination="client"`, `page-size-options`) | OK in code; tests still assume the old `qTable.setPagination` instance method. |

## Test File Issues

### `EnrichmentTableList.spec.js`

- **`installQuasar()` still called** (line 88). Test bootstrap still pulls in `@/test/unit/helpers` which installs the Quasar plugin.
- **Stubs reference removed components** (lines 164-197): `QTable, QBtn, QInput, QDialog, QTd, QTooltip, QIcon, QTablePagination`. None of these are rendered any more, so the stubs are dead.
- **Click handlers receive wrong payload shape**:
  - Spec calls `wrapper.vm.showDeleteDialogFn({ row: testRow })` (lines 290, 451) and expects `selectedDelete` to equal the row — but `showDeleteDialogFn(row)` now stores the argument as-is (`EnrichmentTableList.vue:749-752`). The downstream `selectedDelete.value.name` access (line 681) will read `undefined`.
  - Same pattern for `listSchema({ row })` (line 406) and `exploreEnrichmentTable({ row: testRow })` (lines 470, 488). The implementation now expects `row.name` / `row.stream_type` directly.
- **`changePagination` API removed** (lines 321-352): `wrapper.vm.qTable.setPagination`, `wrapper.vm.pagination.rowsPerPage`, and `wrapper.vm.perPageOptions` no longer exist on the component. Implementation only exposes `selectedPerPage`, `perPageOptionsList`, and a (now no-op) `changePagination` function.
- **Column shape changed** (lines 422-443, 697-703): `wrapper.vm.columns.find(c => c.name === 'doc_num')` always returns `undefined` because columns use `id` not `name`. Subsequent `column.field(...)`, `column.sort(...)` calls throw.
- **`getLookupTables()` mock data shape mismatch** (lines 511-599): assertions check `wrapper.vm.jsTransforms[0].doc_num === ''` but the implementation also adds `urlJobs: []` and `aggregateStatus: null`. Tests using `expect.objectContaining` will still pass, but the equality tests at lines 524-531 will not.
- **`pagination` route name mismatch** (lines 658-693): tests force `mockRouter.currentRoute.value.name = 'pipeline'` to trigger the org-change watcher — that's the same broken route name the component uses. The tests "pass" only because the implementation bug matches the test assumption.

### `AddEnrichmentTable.spec.ts`

- **`installQuasar({})` + `useQuasar` mock** (lines 5-36) — both irrelevant now (component uses `useToast`, not `useQuasar`).
- **Stubs reference removed Quasar components** `q-form, q-input, q-file, q-toggle, q-btn, q-separator` (lines 95-119). None are rendered.
- **`.text-h6` assertion broken** (lines 145, 159) — the title element now has `class="tw:text-xl tw:font-semibold"`.
- **`.q-file` finder broken** (line 188) — element is now `<OFile>`.
- **Tests assert old toast shape** (lines 329-338): expect `{ spinner: true, message: 'Please wait...', timeout: 2000 }` and `{ type: 'positive', message: ... }`. New API in `AddEnrichmentTable.vue:335-338, 444-447` passes `{ variant: "loading"/"success", message }`.
- **`disableColor` assertions** (lines 217, 649): kept in the spec although the value is dead state.

### `EnrichmentSchema.spec.ts`

- **`installQuasar()` still called** (line 113).
- **`filterFieldFn` / `changePagination` / `perPageOptions` / `pagination` / `qTable` / `resultTotal`** — none of these are returned from `setup()` in the new `EnrichmentSchema.vue` (only `t, store, columns, loadingState, schemaData, selectedEnrichmentTable, getStream, formatSizeFromMB, isCloud, filterField` are exposed). Every test in the "Pagination Coverage", "filterFieldFn Comprehensive Coverage", and "Result Total and Field Count Coverage" suites (lines 376-484) throws on undefined.
- **`.q-mt-lg` finder broken** (lines 266, 285) — class no longer applied.
- **`changePagination` test asserts `qTable = null` not to throw** (line 411) — function does not exist; the test passes for the wrong reason (vacuous truthiness on a non-throwing no-op).

## Validations

- Required-field validation works (`AddEnrichmentTable.vue:312-333`) — name, file (file source), URL (url source for non-reload updates), and the `http://`/`https://` prefix check.
- BUT errors are only cleared on `@update:model-value` (one-shot) — if the user clears the URL, the error reappears immediately when they type a single char then delete it; once cleared by typing, it remains cleared until the next submit. Acceptable UX, but worth confirming with the design lead.
- `compilationErr` is **never cleared** between submits; sticky error bar persists when a fresh submit succeeds.
- The "Replace failed URL" branch (`replace_failed`) is not unit-tested at all.

## Accessibility

- `<OIcon @click="showUrlJobsDialog(row)">` (line 131) — clickable icon with no `role`, `tabindex`, or keyboard handler. Should be wrapped in an `OButton` or have `role="button"` + `tabindex="0"` + `@keydown.enter`.
- The status badge column uses red/green hue alone to convey state (`OBadge :variant`); the icon next to it provides shape redundancy but the icon is in the same row, not adjacent to the badge. Consider colour-blind testing.
- Tooltips with rich HTML body (multiple `<br/>`, `<strong>`, `<em>`) are not announced as a single accessible label; screen readers may read them character-by-character.
- The bulk-delete button label "Delete" (line 229) has no aria-label disambiguating "delete which?". When 3 enrichment tables are selected, the screen reader announces just "Delete".
- `<pre>` is used for both the `function` cell tooltip (line 209) and `<pre>` for `compilationErr` (`AddEnrichmentTable.vue:192-194`). Make sure `aria-live="polite"` is applied if you want errors announced.

## Recommendations

1. **Fix the URL update toast** (`AddEnrichmentTable.vue:391-400`) — read `updateMode` into a local before resetting `formData`. Single-line change, but user-visible.
2. **Replace `<template v-slot:hint>` with the `helpText` prop on `OInput`** for the URL inputs (`AddEnrichmentTable.vue:159-168, 183-187`). The dead slot drops hint copy silently.
3. **Initialize `file: null`** instead of `""` in `defaultValue()` so `OFile`'s computed `files` list isn't seeded with an empty string entry.
4. **Either delete the unscoped `<style lang="scss">` blocks or rewrite them.** Quasar selectors are dead weight. Move `.rotate-animation` and `@keyframes rotate` to a single shared partial under `web/src/styles/animations/` (component-level layer).
5. **Migrate `EnrichmentSchema.vue` scoped SCSS to design tokens** — replace `$primary`, `$input-field-border-color`, `#00000005`, `color: white` with `var(--o2-*)` equivalents.
6. **Fix the org-change watch route name** from `"pipeline"` to `"enrichmentTables"` (`EnrichmentTableList.vue:925`).
7. **Add `{ immediate: true }`** to the `props.open` watch in `EnrichmentSchema.vue:213-218` so the schema loads on first render.
8. **Strip all `q-*` class names** still present in templates (search "q-table__title", "q-gutter-x-xs", "col-auto", "text-weight-medium", "q-w-md").
9. **Rewrite all three spec files** end-to-end — they assume the Quasar component surface (column.name/field/sort, qTable.setPagination, $q.notify, q-file/q-form/q-input stubs, `{row: …}` wrapper). At minimum:
   - Replace `installQuasar` import with the `O*` test helpers.
   - Update column lookups to `c.id ===` and use `accessorKey` / `accessorFn`.
   - Pass the row object directly to `showDeleteDialogFn`, `exploreEnrichmentTable`, `listSchema`.
   - Mock `useToast` from `@/lib/feedback/Toast/useToast` instead of `useQuasar`.
   - Drop the `.text-h6`/`.q-file`/`.q-mt-lg` DOM assertions.
10. **Tooltip placement** — for the status icons in the type column, place the `<OTooltip>` *inside* the `<OIcon>` (as a default slot) so the tooltip anchors on the icon, not the whole row span.
11. **Remove the unused `OCheckbox` import** from `EnrichmentTableList.vue:332` and the dead `editorRef`/`editorobj`/`editorUpdate` from `AddEnrichmentTable.vue`.
12. **Replace inline status colors and font-sizes** with tokens — `style="font-size: 0.85em"` and `style="background-color: #fafafa"` are the kind of file-layer leakage the three-layer architecture is supposed to prevent.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| EnrichmentSchema.vue:31 | `q-w-md` | scoped class or `tw:w-[400px]` | file-scoped |
| EnrichmentSchema.vue:253 | `.q-card__section--vert` | remove dead selector | file-scoped |
| EnrichmentSchema.vue:272 | `.q-table` selector | remove dead | file-scoped |
| EnrichmentTableList.vue:25 | `q-table__title` | `tw:text-base tw:font-semibold` | file-scoped |
| EnrichmentTableList.vue:88 | `text-primary` | `tw:text-[var(--o2-primary)]` | file-scoped |
| EnrichmentTableList.vue:217 | `tw:mr-md` | `tw:mr-4` | file-scoped |
| EnrichmentTableList.vue:939 | `.q-field__inner` selector | remove dead | file-scoped |
| AddEnrichmentTable.vue:101 | `q-gutter-x-xs` | `tw:gap-x-1` | file-scoped |
| AddEnrichmentTable.vue:103 | `text-weight-medium` | `tw:font-medium` | file-scoped |
| AddEnrichmentTable.vue:543 | `.q-field__native` | remove dead | file-scoped |
| AddEnrichmentTable.vue:548 | `.q-field__label` | remove dead | file-scoped |
| AddEnrichmentTable.vue:554 | `.q-toggle__inner` | remove dead | file-scoped |
| AddEnrichmentTable.vue:559 | `.q-toggle__thumb:before` | remove dead | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| EnrichmentTableList.vue:217 | `tw:mr-md` | `tw:mr-4` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| EnrichmentSchema.vue:253 | `.q-card__section--vert` | remove | file-scoped |
| EnrichmentSchema.vue:272 | `.q-table` | remove | file-scoped |
| EnrichmentTableList.vue:939 | `.q-field__inner` | remove | file-scoped |
| AddEnrichmentTable.vue:543 | `.q-field__native span` | remove | file-scoped |
| AddEnrichmentTable.vue:548-559 | `.q-field__label`, `.q-toggle__*` | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| EnrichmentSchema.vue:283 | `$primary` | `var(--o2-primary)` | file-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| EnrichmentSchema.vue:32 | `max-width:450px` | `tw:max-w-[450px]` |
| EnrichmentSchema.vue:36 | `height:100vh` | `tw:h-screen` |
| EnrichmentSchema.vue:100 | `margin-bottom:30px` | scoped class |
| AddEnrichmentTable.vue:98 | `font-size:13px` | `tw:text-[13px]` |
| AddEnrichmentTable.vue:99 | `background-color:#fafafa` | scoped `.urls-card` class (theme-aware) |
| AddEnrichmentTable.vue:103 | `font-size:12px` | `tw:text-xs` |
| AddEnrichmentTable.vue:113 | `font-size:13px; word-break:break-all` | scoped class |
| EnrichmentTableList.vue:100/117/135/151 | `max-width:300px;` / `max-width:350px` | extract `.tooltip-cell` class |
| EnrichmentTableList.vue:104/121/155 | `font-size:0.85em` | scoped class |
| EnrichmentTableList.vue:211 | `white-space:break-spaces` | scoped class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| EnrichmentTableList.vue:100/117/135/151 | repeated `max-width:300px` tooltip cells | extract `.tooltip-cell` class |
| EnrichmentTableList.vue:104/121/155 | repeated `<em style="font-size:0.85em">` notes | extract `.tooltip-note` class |
| AddEnrichmentTable.vue:543-559 | dead `.q-field__*` / `.q-toggle__*` block | delete |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (`.tooltip-cell`, `.tooltip-note` in EnrichmentTableList)
- File-level scoped changes: ~26 (13 q-* class/selectors, 1 SCSS var, 1 tw:mr-md, 11 inline styles)
