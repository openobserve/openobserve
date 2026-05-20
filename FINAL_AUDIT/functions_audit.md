# Functions Page — Quasar Removal Audit

## Summary

Audited the OpenObserve **Functions** page after the Quasar-removal refactor (`feat/ux-revamp-main` vs `main`). The migration to O*/Tailwind components is mostly complete, but several files still contain residual Quasar markup, dead Quasar attributes, broken handlers, mistyped Tailwind classes, and **all 14 spec files in this slice still mount the components against Quasar**. The most user-impacting bug is in `AssociatedStreamFunction.vue`: the per-row delete button lost its `@click` handler during the migration, so deleting a function from a stream silently does nothing.

Severity tiers used below:
- **Critical** — page is functionally broken (missing handler, runtime warning, dead button).
- **Major** — logic/validation gaps, broken styles, unused dead code paths.
- **Minor** — Quasar-CSS leftovers in `<style>` blocks, mistyped TW classes, copy-paste.

---

## Files Audited

| File | Diff size (lines) | Status |
|------|-------------------|--------|
| `web/src/views/Functions.vue` | 74 | Migrated; minor stale CSS |
| `web/src/components/functions/AddFunction.vue` | 51 | Migrated; major dead code + stale CSS + 1 typo class |
| `web/src/components/functions/FunctionsToolbar.vue` | 180 | Migrated; **critical** zombie Quasar `<q-btn>` attrs on `<div>`, dead `v-close-popup`, stale CSS |
| `web/src/components/functions/TestFunction.vue` | 195 | Migrated; stale `:deep(.q-field…)` CSS |
| `web/src/components/functions/FunctionList.vue` | 363 | Migrated; minor `q-table__title` orphan class |
| `web/src/components/functions/AssociatedStreamFunction.vue` | 687 | Migrated; **critical** missing `@click` on row delete |
| `web/src/components/functions/FullViewContainer.vue` | 7 | Clean |
| `web/src/components/functions/AddEnrichmentTable.vue` | 250 | Migrated; major dead `:color` prop, Quasar grid classes |
| `web/src/components/functions/EnrichmentTableList.vue` | 568 | Migrated; minor q-table__title orphan + stale `.q-field__inner` |
| `web/src/components/functions/EnrichmentSchema.vue` | 198 | Migrated; minor stale `.q-card__section--vert` / `.q-table` CSS |
| `web/src/components/functions/StreamRouting.vue` | 91 | Migrated; clean templates |
| `web/src/components/functions/RetryJobDialog.vue` | 14 | Clean, hand-written modal (no Quasar) |
| All 14 `*.spec.{ts,js}` files for this slice | — | **All still import `installQuasar` / `@quasar/extras` / `useQuasar`** |

---

## Critical Issues

### C1. AssociatedStreamFunction.vue — per-row "delete associated function" button has no handler
**File:** `web/src/components/functions/AssociatedStreamFunction.vue` lines 155–164

```vue
<OButton
  v-if="!row._isAddRow"
  data-test="stream-association-delete-function-btn"
  :title="t('function.deleteAssociatedFunction')"
  class="tw:ml-1"
  variant="ghost-destructive"
  size="icon-sm"
  icon-left="delete"
/>
```

The button has no `@click`. In `main` it was wired with `@click.stop="deleteFunctionFromStream(props.row.name)"` (see `git show main:web/src/components/functions/AssociatedStreamFunction.vue` line 135). The handler `deleteFunctionFromStream` is still defined (line 557) and still returned from `setup()` (line 668), so the migration just dropped the binding. **Result: clicking the trash icon does nothing.**

Fix: add `@click.stop="deleteFunctionFromStream(row.name)"`.

**Solution:**
```diff
  <OButton
    v-if="!row._isAddRow"
    data-test="stream-association-delete-function-btn"
    :title="t('function.deleteAssociatedFunction')"
    class="tw:ml-1"
    variant="ghost-destructive"
    size="icon-sm"
    icon-left="delete"
+   @click.stop="deleteFunctionFromStream(row.name)"
  />
```

### C2. FunctionsToolbar.vue — `<div>` carries Quasar `<q-btn>` props that no longer do anything
**File:** `web/src/components/functions/FunctionsToolbar.vue` lines 7–18

```vue
<div
  data-test="add-function-back-btn"
  no-caps
  padding="xs"
  outline
  icon="arrow_back_ios_new"
  class="el-border tw:w-6 tw:h-6 …"
  title="Go Back"
  @click="redirectToFunctions"
>
  <OIcon name="arrow-back-ios-new" size="xs" />
</div>
```

The element was a `<q-btn>` on `main` and was rewritten as `<div>`, but its Quasar props (`no-caps`, `padding`, `outline`, `icon`) survived. They are now invalid HTML attributes; Vue passes them through to the DOM. The OIcon child renders correctly, but:
- The icon attribute `icon="arrow_back_ios_new"` is now meaningless.
- An anchor button should be an `<OButton variant="ghost" size="icon-sm">` so it gets focus styling, ARIA role, and keyboard handling — currently it's a clickable div with `title=` only (no `role="button"`, no `tabindex`).

**Solution:**
```diff
- <div
-   data-test="add-function-back-btn"
-   no-caps padding="xs" outline icon="arrow_back_ios_new"
-   class="el-border tw:w-6 tw:h-6 ..."
-   title="Go Back"
-   @click="redirectToFunctions"
- >
-   <OIcon name="arrow-back-ios-new" size="xs" />
- </div>
+ <OButton
+   data-test="add-function-back-btn"
+   variant="ghost" size="icon-sm"
+   icon-left="arrow-back-ios-new"
+   :title="t('common.goBack')" :aria-label="t('common.goBack')"
+   @click="redirectToFunctions"
+ />
```

### C3. FunctionsToolbar.vue — `v-close-popup="true"` on Fullscreen `OButton`
**File:** `web/src/components/functions/FunctionsToolbar.vue` line 99

```vue
<OButton
  data-test="add-function-fullscreen-btn"
  v-close-popup="true"
  variant="outline"
  …
```

`v-close-popup` is a Quasar directive. It is no longer registered globally after the Quasar removal, so Vue emits a `[Vue warn]: Failed to resolve directive: close-popup` at runtime (and the binding is meaningless on a non-popup button anyway). Remove the directive.

**Solution:**
```diff
  <OButton
    data-test="add-function-fullscreen-btn"
-   v-close-popup="true"
    variant="outline"
    ...
```

---

## Logical Issues

### L1. AddFunction.vue — empty function body passes validation
**File:** `web/src/components/functions/AddFunction.vue` lines 361–369; validator at `FunctionsToolbar.vue` lines 248–254

`onSubmit` only consults `functionsToolbarRef.value.addFunctionForm.validate()`, which only checks the **name** (`!!functionName.value && isValidMethodName() === true`). There is no check that `formData.value.function` is non-empty. On `main`, the old `<q-form>` plus the `unified-query-editor`'s own required validation surfaced this; with the Quasar form gone, a user can press Save with an empty editor and the request will go through (or fail server-side with no UI hint other than a toast).

**Solution:**
```diff
  const onSubmit = async () => {
    const valid = await functionsToolbarRef.value.addFunctionForm.validate();
-   if (!valid) return;
+   if (!valid || !formData.value.function?.trim()) {
+     toast({ variant: "error", message: t("function.bodyRequired") });
+     return;
+   }
    // ...
```

### L2. AddFunction.vue — dead validators / form helpers still exported
**File:** `web/src/components/functions/AddFunction.vue` lines 335–345, 357–359

`isValidParam`, `isValidMethodName`, `isValidFnName`, `editorUpdate`, `updateEditorContent`, `prefixCode`, `suffixCode` are all returned from `setup()` but no longer referenced anywhere in the template (the form moved to `FunctionsToolbar.vue` and the editor moved to `UnifiedQueryEditor`). Pure dead code now — at minimum confusing, and `isValidMethodName` here uses a slightly different regex (`/^[$A-Z_][0-9A-Z_$]*$/i`) than the one in `FunctionsToolbar.vue` (`/^[A-Z_][A-Z0-9_]*$/i`). The latter is what actually runs.

**Solution:**
```diff
- const isValidParam = ...
- const isValidMethodName = ...
- const isValidFnName = ...
- const editorUpdate = ...
- const updateEditorContent = ...
- const prefixCode = ...
- const suffixCode = ...
- // and remove them from the setup() return object
```

### L3. AddFunction.vue — `addJSTransformForm` declaration concatenated with `disableColor`
**File:** `web/src/components/functions/AddFunction.vue` line 217

```ts
const addJSTransformForm: any = ref(null);    const disableColor: any = ref("");
```

Two declarations were collapsed onto a single line during the diff. Not a runtime bug, but a code-style regression worth a quick fix.

**Solution:**
```diff
- const addJSTransformForm: any = ref(null);    const disableColor: any = ref("");
+ const addJSTransformForm: any = ref(null);
+ const disableColor: any = ref("");
```

### L4. Functions.vue — stale comment block in template hints at lost props
**File:** `web/src/views/Functions.vue` lines 142–145

```vue
<!-- :templates="templates"
  :functionAssociatedStreams="functionAssociatedStreams"
  @get:functionAssociatedStreams="getFunctionAssociatedStreams"
  @get:templates="getTemplates" -->
```

`templates` and `functionAssociatedStreams` refs are still created and returned from `setup()` (lines 194–195, 294, 296) even though nothing consumes them and the bindings are commented out. Either restore the props or delete the refs.

**Solution:**
```diff
- <!-- :templates="templates"
-   :functionAssociatedStreams="functionAssociatedStreams"
-   @get:functionAssociatedStreams="getFunctionAssociatedStreams"
-   @get:templates="getTemplates" -->
- const templates = ref([]);
- const functionAssociatedStreams = ref([]);
- // and corresponding getTemplates / getFunctionAssociatedStreams helpers
```

---

## CSS / Layout Issues

### S1. FunctionsToolbar.vue — `<style>` still selects `.q-btn`, `.q-field__bottom`
**File:** `web/src/components/functions/FunctionsToolbar.vue` lines 257–281

```scss
.functions-toolbar {
  :deep(.q-field__bottom) { display: none; }
  .add-function-actions {
    :deep(.q-btn) { padding-top: 4px !important; … }
    :deep(.q-btn .OIcon) { margin-right: 2px !important; }
    :deep(.block) { font-weight: lighter; }
    :deep(.cancel-btn)::before {
      border: 1px solid var(--q-negative) !important;
    }
  }
}
```

None of these classes exist in the rendered tree anymore (`.q-field__bottom`, `.q-btn`, `.cancel-btn`). Plus `var(--q-negative)` is undefined — the new theme uses tokens like `var(--o2-destructive)`. The whole block is dead and the `var(--q-negative)` reference becomes the literal `1px solid` (browser falls back to `initial`).

**Solution:**
```diff
- .functions-toolbar {
-   :deep(.q-field__bottom) { display: none; }
-   .add-function-actions {
-     :deep(.q-btn) { padding-top: 4px !important; ... }
-     :deep(.q-btn .OIcon) { margin-right: 2px !important; }
-     :deep(.block) { font-weight: lighter; }
-     :deep(.cancel-btn)::before { border: 1px solid var(--q-negative) !important; }
-   }
- }
```

### S2. AddFunction.vue — same pattern, big `:deep(.q-field…)` block on a `<style scoped>` that no longer matches anything
**File:** `web/src/components/functions/AddFunction.vue` lines 638–694

Roughly 50 lines of CSS targeting `.q-field--dense .q-field__control`, `.q-field__native`, `.q-field__marginal`, `.q-field__bottom`, etc. These no longer exist (now we render OInput → reka-ui internals).

**Solution:**
```diff
- :deep(.q-field--dense .q-field__control) { /* ... */ }
- :deep(.q-field__native) { /* ... */ }
- :deep(.q-field__marginal) { /* ... */ }
- :deep(.q-field__bottom) { /* ... */ }
- // Delete all dead Quasar internal selectors
```

### S3. TestFunction.vue — three more `.q-field` / `.q-btn` orphan blocks
**File:** `web/src/components/functions/TestFunction.vue` lines 743–798

`.test-function-option-tabs :deep(.rum-tab)`, `.test-function-query-container :deep(.test-function-run-query-btn)`, `.function-stream-select-input :deep(.q-field…)`, `.functions-duration-input :deep(.date-time-button) .OIcon.on-right` — also a strange `.OIcon.on-right` selector that probably never resolved (Quasar used `.q-icon.on-right`).

**Solution:**
```diff
- .function-stream-select-input :deep(.q-field__control) { /* ... */ }
- .functions-duration-input :deep(.date-time-button) .OIcon.on-right { /* ... */ }
- // Delete dead Quasar internal selectors; if styling still required, target O* internals instead.
```

### S4. AssociatedStreamFunction.vue — `.q-table__title` orphan + `.q-btn` style block
**File:** `web/src/components/functions/AssociatedStreamFunction.vue` lines 711–714, 738–740

```scss
:deep(.q-table__title) { font-size: 15px; font-weight: 600; }
…
.confirmActions {
  …
  .q-btn { font-size: 0.75rem; … }
}
```

The first one accidentally still applies because the templates kept the literal class `class="q-table__title"` on plain `<div>`s (see I1 below) — but the rule lives only here. The `.q-btn` block under `.confirmActions` is dead (no `.confirmActions` element rendered anywhere in the new template).

**Solution:**
```diff
- :deep(.q-table__title) { font-size: 15px; font-weight: 600; }
+ .table-title { font-size: 15px; font-weight: 600; }
  // and replace literal class="q-table__title" with class="table-title" in templates
- .confirmActions { .q-btn { font-size: 0.75rem; ... } }
```

### S5. EnrichmentSchema.vue — `.q-card__section--vert` & `.q-table` selectors
**File:** `web/src/components/functions/EnrichmentSchema.vue` lines 253–272

Dead — there are no longer any `q-card` or `q-table` elements rendered.

**Solution:**
```diff
- .q-card__section--vert { /* ... */ }
- .q-table { /* ... */ }
- // Delete dead Quasar selectors entirely.
```

### S6. EnrichmentTableList.vue — `.q-field__inner` orphan
**File:** `web/src/components/functions/EnrichmentTableList.vue` line 939

Dead selector.

**Solution:**
```diff
- .search-en-table-input {
-   .q-field__inner { width: 250px; }
- }
+ .search-en-table-input { width: 250px; }
```

### S7. AddEnrichmentTable.vue — `.q-field__label`, `.q-toggle__inner`, `.q-toggle__thumb` orphan
**File:** `web/src/components/functions/AddEnrichmentTable.vue` lines 543–561

Same pattern: leftover Quasar selectors after switch to OFile/OSwitch.

**Solution:**
```diff
- .lookup-table-file-uploader .q-field__label { /* ... */ }
- .lookup-table-append-toggle .q-toggle__inner { /* ... */ }
- .lookup-table-append-toggle .q-toggle__thumb { /* ... */ }
- // Delete dead Quasar selectors entirely.
```

### S8. Functions.vue — `:deep(.q-splitter__before)`, `.q-table__top`, references undefined SCSS var `$border-color`
**File:** `web/src/views/Functions.vue` lines 309–318

```scss
:deep(.q-splitter__before) { overflow: visible; }
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
```

OSplitter does not produce `.q-splitter__before` — so this rule never matches. `$border-color` is a Quasar SCSS variable; if not still globally injected the build will warn. Either drop it or replace with `var(--o2-border)`.

**Solution:**
```diff
- :deep(.q-splitter__before) { overflow: visible; }
- .q-table { &__top { border-bottom: 1px solid $border-color; ... } }
+ .table-top { border-bottom: 1px solid var(--o2-border-color); justify-content: flex-end; }
```

### S9. AddFunction.vue / FunctionsToolbar.vue / TestFunction.vue / EnrichmentTableList.vue — orphan literal classes in templates
- `FunctionList.vue:25`, `EnrichmentTableList.vue:25`, `AssociatedStreamFunction.vue:44, 104` use `class="q-table__title"` on plain `<div>`s. Cosmetically still styled by S4's `:deep(.q-table__title)` rule in `AssociatedStreamFunction.vue`, but the same class on `FunctionList.vue` / `EnrichmentTableList.vue` has no `:deep` rule applying in those files. They probably look OK only because other global rules pick it up — should be replaced with intentional Tailwind/utility classes.
- `AddEnrichmentTable.vue:101` uses `q-gutter-x-xs`, lines 102 & 105 use `col-auto`, line 103 uses `text-weight-medium`, line 192 uses `text-h7` — all Quasar utility classes, all now no-ops.

**Solution:**
```diff
- <div class="q-table__title">{{ title }}</div>
+ <div class="tw:text-base tw:font-semibold">{{ title }}</div>
- <div class="tw:flex tw:items-center q-gutter-x-xs">
+ <div class="tw:flex tw:items-center tw:gap-1">
- class="col-auto text-weight-medium tw:text-gray-400"
+ class="tw:flex-none tw:font-medium tw:text-gray-400"
- class="text-h7"
+ class="tw:text-base tw:font-semibold"
```

### S10. AddFunction.vue — typo Tailwind class `tw-mt-1`
**File:** `web/src/components/functions/AddFunction.vue` line 60

```vue
<FullViewContainer
  …
  class="tw-mt-1"
/>
```

This codebase's Tailwind prefix is `tw:` (with colon), so the class `tw-mt-1` (with hyphen) is silently ignored. Should be `tw:mt-1`.

**Solution:**
```diff
- <FullViewContainer class="tw-mt-1" />
+ <FullViewContainer class="tw:mt-1" />
```

---

## Component Migration Issues

### M1. AddEnrichmentTable.vue — `:color` prop on OIcon does nothing
**File:** `web/src/components/functions/AddEnrichmentTable.vue` lines 106–111

```vue
<OIcon
  :name="job.status === 'completed' ? 'check-circle' : …"
  :color="job.status === 'completed' ? 'positive' : 'negative' : 'primary' : 'grey'"
  size="sm"
  …
/>
```

`OIcon` (see `web/src/lib/core/Icon/OIcon.types.ts`) defines only `name`, `size`, `label`. There is **no `color` prop** — Quasar's color tokens (`positive`, `negative`, `primary`, `grey`) won't be honored. All four status states will render in the default icon color. Either use `class="…"` to set color, or apply Tailwind color classes via a computed binding.

**Solution:**
```diff
  <OIcon
    :name="job.status === 'completed' ? 'check-circle' : ..."
-   :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : ..."
+   :class="job.status === 'completed' ? 'tw:text-green-500' : job.status === 'failed' ? 'tw:text-red-500' : 'tw:text-gray-500'"
    size="sm"
  />
```

### M2. AddEnrichmentTable.vue — `OOptionGroup` `orientation="horizontal"` not in O2 props for some forms
The component is used at lines 46 and 89. Both pass `orientation="horizontal"`. Confirm OOptionGroup accepts this — if not it falls through to DOM and only renders in default direction.

**Solution:**
```diff
// In OOptionGroup.types.ts, ensure prop is supported:
+ orientation?: "horizontal" | "vertical"
// If not supported in OOptionGroup, replace with:
- <OOptionGroup orientation="horizontal" ... />
+ <OOptionGroup class="tw:flex tw:flex-row tw:gap-3" ... />
```

### M3. EnrichmentTableList.vue & elsewhere — orphan `<OTooltip>` siblings instead of wrappers
**File:** `web/src/components/functions/EnrichmentTableList.vue` lines 98–107, 115–124, 133–142, 149–158, 208–210
**File:** `web/src/components/functions/TestFunction.vue` lines 23–28, 175–180, 233–238
**File:** `web/src/components/functions/FunctionsToolbar.vue` lines 46–52, 73–78

Pattern is:

```vue
<OIcon name="info-outline" … />
<OTooltip side="right" align="center" :side-offset="2" :content="…" />
```

These work because `OTooltip`'s "child mode" (see `OTooltip.vue` lines 28–50) attaches `mouseenter` / `mouseleave` to its **DOM parent**, but the parent here is the surrounding `<span>` / `<div>`, not the icon itself. As a result the tooltip can appear when hovering anywhere on the parent container, not just the icon — bigger hover hit-box than the user expects (and inconsistent with `q-tooltip` placement). Either wrap the icon (`<OTooltip><OIcon … /></OTooltip>`) or put the icon and OTooltip inside a tight wrapper.

**Solution:**
```diff
- <OIcon name="info-outline" ... />
- <OTooltip side="right" align="center" :side-offset="2" :content="..." />
+ <OIcon name="info-outline" ...>
+   <OTooltip side="right" align="center" :side-offset="2" :content="..." />
+ </OIcon>
```

### M4. FunctionsToolbar.vue line 73 — empty `<OTooltip>` body
**File:** `web/src/components/functions/FunctionsToolbar.vue` lines 73–78

```vue
<OTooltip>
  <template #content>…</template>
</OTooltip>
```

No default slot, no `content` prop — uses `#content` named slot only. Combined with the sibling pattern in M3 this works in child-mode, but you lose styling overrides like `bg-grey-8` that existed on the Quasar version.

**Solution:**
```diff
- <OTooltip>
-   <template #content>...</template>
- </OTooltip>
+ <OTooltip>
+   <template #content>
+     <div class="tw:bg-gray-800 tw:text-white tw:p-2 tw:rounded">...</div>
+   </template>
+ </OTooltip>
```

---

## Test File Issues

### T1. Every Functions spec still depends on Quasar
All 14 spec files in this scope:

```
web/src/views/Functions.spec.ts
web/src/components/functions/AddEnrichmentTable.spec.ts
web/src/components/functions/AddFunction.spec.js
web/src/components/functions/AddFunction.spec.ts
web/src/components/functions/AssociatedStreamFunction.spec.ts
web/src/components/functions/EnrichmentSchema.spec.ts
web/src/components/functions/EnrichmentTableList.spec.js
web/src/components/functions/FullViewContainer.spec.ts
web/src/components/functions/FunctionList.spec.ts
web/src/components/functions/FunctionsToolbar.spec.ts
web/src/components/functions/RetryJobDialog.spec.ts
web/src/components/functions/StreamRouting.spec.ts
web/src/components/functions/TestFunction.spec.js
web/src/components/functions/TestFunction.spec.ts
```

still `import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin"` (and sometimes `useQuasar` / `@quasar/extras`).

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar();
+ // For transitional compatibility, add to install-quasar-plugin.ts:
+ //   export const installQuasar = tempQuasarPlugin;
+ // OR rewrite spec to use the new test harness directly.
```

### T2. TestFunction.spec.js — direct Quasar imports
**File:** `web/src/components/functions/TestFunction.spec.js` lines 1–22

```js
import { installQuasar } from "@/test/unit/helpers";
import * as components from "@quasar/extras/material-icons";
vi.mock('quasar', async () => { … useQuasar: vi.fn(...) … });
…
installQuasar({ plugins: [], components, config: { … iconSet: { name: 'material-icons', … } } });
```

If `@quasar/extras` / `quasar` packages are removed from `package.json` (Quasar removal goal), this spec will fail to resolve imports.

**Solution:**
```diff
- import * as components from "@quasar/extras/material-icons";
- vi.mock('quasar', async () => { ... useQuasar: vi.fn(...) ... });
- installQuasar({ plugins: [], components, config: { iconSet: { ... } } });
+ // Drop entirely — the migrated component no longer uses Quasar at all.
```

### T3. Spec/template drift in TestFunction.spec.js
Same file (line 224–228) still asserts `streamTypes` only has the `{label, value}` shape — but the component now has `{label, value, icon}` (TestFunction.vue lines 381–385). Test will fail:

```js
expect(wrapper.vm.streamTypes).toMatchObject([
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" }
]);
```

`toMatchObject` ignores extra keys, so this still passes — but assert-list now drifts from the actual `icon: "description" / "bar-chart" / "activity"` values.

**Solution:**
```diff
  expect(wrapper.vm.streamTypes).toMatchObject([
-   { label: "Logs", value: "logs" },
-   { label: "Metrics", value: "metrics" },
-   { label: "Traces", value: "traces" }
+   { label: "Logs", value: "logs", icon: "description" },
+   { label: "Metrics", value: "metrics", icon: "bar-chart" },
+   { label: "Traces", value: "traces", icon: "activity" }
  ]);
```

---

## Recommendations

1. **Immediate (critical) fixes**
   - Wire `@click.stop="deleteFunctionFromStream(row.name)"` back onto the OButton in `AssociatedStreamFunction.vue` line 156.
   - Strip `v-close-popup="true"` from `FunctionsToolbar.vue` line 99.
   - Replace the back-button `<div>` (FunctionsToolbar.vue 7–18) with an `<OButton variant="ghost" size="icon-sm" @click="redirectToFunctions">` (or at minimum add `role="button"` and `tabindex="0"`), and drop the orphan `no-caps`, `padding="xs"`, `outline`, `icon="…"` attributes.

2. **Logic gaps**
   - Add `!formData.value.function?.trim()` check to AddFunction's `onSubmit` before calling the create/update service, and surface inline error on the editor wrapper.
   - Delete dead helpers (`isValidParam`, `isValidMethodName`, `isValidFnName`, `editorUpdate`, `updateEditorContent`, `prefixCode`, `suffixCode`) from AddFunction.vue, or move them next to where they're actually used.
   - Clean up `templates` / `functionAssociatedStreams` refs in `Functions.vue` (or restore their wiring).

3. **CSS cleanup pass** — remove `.q-*` selectors from `<style>` blocks in: Functions.vue, AddFunction.vue, FunctionsToolbar.vue, TestFunction.vue, AssociatedStreamFunction.vue, EnrichmentSchema.vue, EnrichmentTableList.vue, AddEnrichmentTable.vue. Replace `var(--q-negative)` / `$border-color` references with the new design tokens (`var(--o2-destructive)`, `var(--o2-border)`).

4. **Template hygiene**
   - Replace literal `class="q-table__title"` on `<div>`s (FunctionList.vue:25, EnrichmentTableList.vue:25, AssociatedStreamFunction.vue:44 & 104) with an intentional Tailwind class.
   - Replace Quasar utility classes in AddEnrichmentTable.vue (`q-gutter-x-xs`, `col-auto`, `text-weight-medium`, `text-h7`) with Tailwind equivalents.
   - Fix `tw-mt-1` → `tw:mt-1` in AddFunction.vue:60.
   - Drop `:color="…"` on the OIcon in AddEnrichmentTable.vue:108 and convert to a class-based color binding.

5. **OTooltip placement** — wrap the trigger icon in OTooltip rather than sibling-placing it, in EnrichmentTableList.vue (5 occurrences), TestFunction.vue (3 occurrences), and FunctionsToolbar.vue (2 occurrences). This restores per-icon hover behavior and matches the Quasar precedent.

6. **Spec migration** — port every spec under `web/src/components/functions/` and `web/src/views/Functions.spec.ts` off `installQuasar`/`useQuasar`/`@quasar/extras` to whatever the project's new test harness is. `TestFunction.spec.js` and `AddFunction.spec.js` are the highest priority (use both `installQuasar()` *and* direct `quasar` mocks).

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| Functions.vue:313 | `.q-table` selector | remove dead selector | file-scoped |
| Functions.vue:309 | `:deep(.q-splitter__before)` | remove | file-scoped |
| FunctionList.vue:25 | `q-table__title` | use `tw:text-base tw:font-semibold` | file-scoped |
| AssociatedStreamFunction.vue:44 | `q-table__title` | drop | file-scoped |
| AssociatedStreamFunction.vue:104 | `q-table__title` | drop | file-scoped |
| AssociatedStreamFunction.vue:711 | `:deep(.q-table__title)` | remove | file-scoped |
| AssociatedStreamFunction.vue:738 | `.q-btn` selector | remove | file-scoped |
| AddFunction.vue:639-678 | `.q-field--*` / `.q-field__*` deep selectors | remove dead Quasar field selectors | file-scoped |
| AddFunction.vue:692 | `.q-field__native` | remove | file-scoped |
| FunctionsToolbar.vue:259-269 | `:deep(.q-field__bottom)`, `:deep(.q-btn)` | remove | file-scoped |
| TestFunction.vue:770-783 | `.q-field--auto-height`/`.q-field__*` selectors | remove | file-scoped |
| StreamRouting.vue:2 | `full-height` | `tw:h-full` | file-scoped |
| StreamRouting.vue:2 | `bg-white` | `tw:bg-white` or theme token | file-scoped |
| TestFunction.vue:162,219 | `text-weight-bold` | `tw:font-bold` | file-scoped |
| FunctionList.vue:102 | `tw:mr-md` | `tw:mr-4` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| FunctionList.vue:102 | `tw:mr-md` | `tw:mr-4` | file-scoped |
| FunctionList.vue:161 | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | file-scoped |
| AddFunction.vue:60 | `tw-mt-1` (dash) | `tw:mt-1` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| FunctionsToolbar.vue:278 | `var(--q-negative)` | `var(--o2-danger)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| Functions.vue:309 | `:deep(.q-splitter__before)` | remove | file-scoped |
| AddFunction.vue:639 | `:deep(.q-field--dense ...)` | remove | file-scoped |
| AddFunction.vue:658 | `:deep(.q-field__bottom)` | remove | file-scoped |
| AddFunction.vue:665 | `:deep(.q-field--auto-height ...)` | remove | file-scoped |
| FunctionsToolbar.vue:259 | `:deep(.q-field__bottom)` | remove | file-scoped |
| FunctionsToolbar.vue:264 | `:deep(.q-btn)` | remove | file-scoped |
| FunctionsToolbar.vue:269 | `:deep(.q-btn .OIcon)` | remove | file-scoped |
| TestFunction.vue:770 | `:deep(.q-field--auto-height ...)` | remove | file-scoped |
| AssociatedStreamFunction.vue:711 | `:deep(.q-table__title)` | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| Functions.vue:315 | `$border-color` | `var(--o2-border)` | file-scoped |
| FunctionList.vue:726 | `$border-color` | `var(--o2-border)` | file-scoped |
| AssociatedStreamFunction.vue:725 | `$dark-page` | `var(--o2-bg-page)` | file-scoped |
| AssociatedStreamFunction.vue:729 | `$light-text` | `var(--o2-text-secondary)` | file-scoped |
| TestFunction.vue:752 | `$primary` | `var(--o2-primary)` | file-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| FunctionsToolbar.vue:99 | `v-close-popup="true"` | remove, replace with `@click="menuRef?.close()"` or model binding |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found — no underscored names or `color` props)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| StreamRouting.vue:18 | `padding-top:12px` | `tw:pt-3` |
| StreamRouting.vue:29 | `width:480px` | `tw:w-[480px]` |
| StreamRouting.vue:34 | `padding-top:0px` | drop |
| StreamRouting.vue:38,56 | `padding-top:0` | drop |
| StreamRouting.vue:48 | `min-width:220px` | `tw:min-w-[220px]` |
| StreamRouting.vue:69 | `min-width:250px !important; width:250px !important` | scoped class |
| TestFunction.vue:68 | `width:100px` | `tw:w-[100px]` |
| TestFunction.vue:87 | `min-width:120px` | `tw:min-w-[120px]` |
| TestFunction.vue:189 | `width:32px !important;...` (icon button sizing) | scoped `.test-icon-btn` class |
| TestFunction.vue:203,272 | `height: calc(...)` (dynamic) | acceptable |
| AddFunction.vue:105 | `white-space:pre-wrap; font-family:Courier New; font-size:13px` | scoped `.error-pre` class |
| AddFunction.vue:127 | `width:25%; max-width:100%; min-width:75px;` | scoped `.ai-chat-pane` class |
| AssociatedStreamFunction.vue:20 | `min-height:inherit` | drop or scoped class |
| AssociatedStreamFunction.vue:75 | `height:60px` | `tw:h-[60px]` |
| AssociatedStreamFunction.vue:170 | `width:100%; text-align:center` | `tw:w-full tw:text-center` |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| AddFunction.vue:639-688 / TestFunction.vue:770-790 | identical `.q-field--dense .q-field__control` / `.q-field--auto-height` deep blocks | extract into deletion (dead selectors) |
| TestFunction.vue:162,219 | repeated `text-weight-bold tw:flex tw:items-center tw:text-gray-500 tw:ml-2 tw:text-[13px]` heading | extract `.test-section-label` class |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (test-section-label, .ai-chat-pane reused across AddFunction & TestFunction-style panels)
- File-level scoped changes: ~50 (12+ q-* deep blocks removable, 5 SCSS vars, 1 directive, 14 inline styles, 3 tw misuse, 1 q-negative var)
