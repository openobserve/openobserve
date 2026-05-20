# Common Components — Quasar Removal Audit

Audited branch: `feat/ux-revamp-main` (HEAD) vs `main`.
Working directory: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp`.

## Summary

The shared / common component family has been mostly migrated from Quasar (`q-*`) to the new O* component family with Tailwind v4 (`tw:` prefix). However the migration is incomplete:

- **Three critical Tailwind/logic bugs** were introduced by what looks like an automated find-and-replace of `relative` → `tw:relative` that also rewrote runtime string literals — DateTime / DateTimePicker tab-state comparison strings are now broken; the "currently selected relative date" highlight never lights up.
- **One Quasar runtime directive (`v-close-popup`) is still in `BaseImport.vue`** but Quasar is no longer installed (no plugin in `main.ts`, no `package.json` dep). Vue will emit a runtime warning ("Failed resolving directive: close-popup") and the click will only run the explicit handler; not a crash but dead/no-op markup.
- **~25 dead Quasar `:deep(.q-*)` selectors** survive across DateTime / DateTimePicker / CustomDateTimePicker / FieldValuesPanel / FieldListPagination / JsonEditor / FolderList / QueryEditor / TenstackTable — they no longer match anything, which means the related UI is unstyled (look at `.q-field__control`, `.q-btn`, `.q-card__section`, `.q-date__*` declarations).
- **Three-layer CSS architecture is violated**: at least three components ship UNSCOPED `<style>` blocks that leak generic class names (`.date-time-button`, `.rich-text-input-wrapper`, `.tabContent`, …) into the global cascade. Some of these contain Quasar-specific selectors that also leak globally.
- **`hover:tw:…` ordering is wrong in 9 places** (Tailwind v4 with `prefix(tw)` expects `tw:hover:…`). These hover styles silently never apply.
- **Spec files import from `'quasar'`** (CopyContent, SearchFieldList, ShareButton) for stubs and `copyToClipboard` — but the components now use `@/utils/clipboard` and O* components. Tests do not test the real production paths.

## Files Audited

Primary common-components in scope and read:

- `web/src/components/common/BaseImport.vue` (624L)
- `web/src/components/common/FieldExpansion.vue` (303L)
- `web/src/components/common/FieldRow.vue` (163L)
- `web/src/components/common/FieldValuesPanel.vue` (~570L)
- `web/src/components/common/FieldListPagination.vue` (297L)
- `web/src/components/common/GroupedFieldList.vue` (191L)
- `web/src/components/common/JsonEditor.vue` (289L)
- `web/src/components/common/sidebar/FolderList.vue` (~430L)
- `web/src/components/common/sidebar/SearchFieldList.vue`
- `web/src/components/AutoRefreshInterval.vue` (409L)
- `web/src/components/AttributeValueCell.vue` (63L)
- `web/src/components/ConfirmDialog.vue` (80L)
- `web/src/components/ConfirmDialogProvider.vue` (27L)
- `web/src/components/CopyContent.vue` (130L)
- `web/src/components/JsonPreview.vue` (159L)
- `web/src/components/HighLight.vue` (115L)
- `web/src/components/SanitizedHtmlRenderer.vue` (42L)
- `web/src/components/RichTextInput.vue` (989L)
- `web/src/components/QueryEditor.vue` (688L)
- `web/src/components/CodeQueryEditor.vue` (1460L)
- `web/src/components/TenstackTable.vue` (2364L)
- `web/src/components/DateTime.vue` (1355L)
- `web/src/components/DateTimePicker.vue` (605L)
- `web/src/components/DateTimePickerDashboard.vue` (136L)
- `web/src/components/CustomDateTimePicker.vue` (466L)

Spec files spot-checked:

- `web/src/components/common/sidebar/SearchFieldList.spec.ts`
- `web/src/components/common/sidebar/FolderList.spec.ts`
- `web/src/components/common/ShareButton.spec.ts`
- `web/src/components/CopyContent.spec.ts`
- `web/src/components/ConfirmDialog.spec.ts`

## Critical Issues

### 1. Broken relative-date selection highlight (DateTime + DateTimePicker)

File: `web/src/components/DateTime.vue` line 95 and `web/src/components/DateTimePicker.vue` line 78.

```text
DateTime.vue:95            selectedType == 'tw:relative' &&
DateTimePicker.vue:78      data.selectedDate.tab == 'tw:relative' &&
```

Both compare a runtime tab value to the literal string `'tw:relative'`. The actual values are `'relative'` / `'absolute'` (set elsewhere, e.g. `setDateType('absolute')` at DateTime.vue:66, default `tab: "relative"` in DateTimePicker model, `setRelativeDate` in DateTimePicker.vue:255 sets `tab = "relative"`). The condition is therefore **always false**, so the `rp-selector-selected` highlight on the currently-selected relative date (e.g. "15 Minutes") never renders. The buttons all look unselected.

Root cause looks like a bulk `s/"relative"/"tw:relative"/` that ran across the file and also rewrote the string literals inside the JS expression — only the literal needs to be reverted to `'relative'` (the surrounding `tw:relative` class on the wrapper div is fine).

**Solution:**
```diff
 // DateTime.vue:95
-selectedType == 'tw:relative' &&
+selectedType == 'relative' &&

 // DateTimePicker.vue:78
-data.selectedDate.tab == 'tw:relative' &&
+data.selectedDate.tab == 'relative' &&
```

### 2. `v-close-popup` Quasar directive still on `OButton`

File: `web/src/components/common/BaseImport.vue` line 41.

```html
<OButton v-close-popup variant="outline" …>{{ t('function.cancel') }}</OButton>
```

`v-close-popup` was a Quasar global directive. `web/src/main.ts` has no Quasar import; nothing registers `ClosePopup`. Vue will log "Failed resolving directive" and the directive is a no-op. The button still fires `@click="handleCancel"` so cancel still works — but the visual contract (close the surrounding overlay) is broken in any context where a parent ODialog/ODrawer relied on that directive to close. Replace with explicit `@click` that emits the close event up to the dialog.

**Solution:**
```diff
-<OButton v-close-popup variant="outline" @click="handleCancel">{{ t('function.cancel') }}</OButton>
+<OButton variant="outline" @click="handleCancel">{{ t('function.cancel') }}</OButton>
```
Ensure `handleCancel` also emits `update:open` (or `cancel`) so parent overlays close.

### 3. Broken `hover:tw:` ordering (Tailwind v4 prefix bug)

Tailwind config: `web/src/styles/tailwind.css:1` — `@import "tailwindcss" prefix(tw);`. In v4 with a configured prefix, the order is `<prefix>:<variant>:<utility>` → `tw:hover:bg-…`. The reverse form `hover:tw:bg-…` is **not a valid class** and is silently dropped.

Confirmed broken uses in common-components scope:

- `web/src/components/common/FieldRow.vue:21` — `hover:tw:bg-[var(--o2-hover-accent)]`
- `web/src/components/common/FieldValuesPanel.vue:127` — `hover:tw:bg-muted/50`
- `web/src/components/common/DualListSelector.vue:31, 129` — `hover:tw:bg-muted/50`
- `web/src/components/Header.vue:99, 116` — `hover:tw:opacity-80`
- `web/src/components/O2AIChat.vue:180` — `hover:tw:bg-muted/50`
- `web/src/components/TenstackTable.vue:420, 611` — `hover:tw:bg-[var(--o2-hover-gray)]`

(Compare TenstackTable.vue:221 which correctly uses `tw:hover:bg-[var(--o2-border-color)]` — both forms coexist in the same file.)

User-visible impact: hover backgrounds on field rows, list items, the openobserve logo, and dashboard table rows do not respond to hover.

**Solution:** find/replace across the 9 files listed:
```diff
-hover:tw:bg-[var(--o2-hover-accent)]
+tw:hover:bg-[var(--o2-hover-accent)]
-hover:tw:bg-muted/50
+tw:hover:bg-muted/50
-hover:tw:opacity-80
+tw:hover:opacity-80
-hover:tw:bg-[var(--o2-hover-gray)]
+tw:hover:bg-[var(--o2-hover-gray)]
```

## Logical Issues

### 4. Dead `checkboxColor` function (FieldValuesPanel)

`web/src/components/common/FieldValuesPanel.vue:417-420`:

```ts
const checkboxColor = (key: string): string => {
  if (props.activeExcludeValues?.includes(key)) return "negative";
  return "primary";
};
```

Returns Quasar color tokens (`negative`, `primary`), is not exposed via `defineExpose`, and `grep` shows zero usages in the template. Dead code left behind by the QCheckbox → OCheckbox migration. (OCheckbox does not consume a `color` prop in this codebase.)

**Solution:**
```diff
-const checkboxColor = (key: string): string => {
-  if (props.activeExcludeValues?.includes(key)) return "negative";
-  return "primary";
-};
```
Delete the dead function.

### 5. JsonEditor: protected-field error messages not translated

`web/src/components/common/JsonEditor.vue:149-150, 168`:

```ts
…protectedFieldChanges.map(field =>
  `Cannot modify ${field} field directly , will be reverted to the original value`)
```

Hardcoded English string with a typo (`directly ,` with stray space), not routed through `t(...)`. Other strings in the same file (cancel/save buttons) use `t('common.cancel')` / `t('common.save')`. Inconsistent with the i18n contract elsewhere in this component.

**Solution:**
```diff
-…protectedFieldChanges.map(field =>
-  `Cannot modify ${field} field directly , will be reverted to the original value`)
+…protectedFieldChanges.map(field =>
+  t('jsonEditor.protectedFieldError', { field }))
```
Add the key `jsonEditor.protectedFieldError`: `"Cannot modify {field} field directly, will be reverted to the original value"` in the i18n bundle.

### 6. `OFile` slot bindings look Quasar-shaped (BaseImport)

`web/src/components/common/BaseImport.vue:134-153`: `OFile` is used with Quasar-era slot names and props — `bottom-slots`, `<template v-slot:prepend>`, `<template v-slot:append>`, `<template v-slot:hint>`. These were `QFile` conventions. Whether the new `OFile` component still supports them is in scope for the OFile audit, but the consumer here should be flagged: if `OFile` follows the rest of the O* lib (named slots like `#icon-left`/`#icon-right` and explicit hint props), these slots silently render nothing and `bottom-slots` is an unknown attr on the root.

**Solution:**
```diff
-<OFile v-model="file" bottom-slots>
-  <template v-slot:prepend><OIcon name="upload-file" /></template>
-  <template v-slot:append><OIcon name="close" @click="file=null" /></template>
-  <template v-slot:hint>{{ t('function.fileHint') }}</template>
-</OFile>
+<OFile
+  v-model="file"
+  :hint="t('function.fileHint')"
+>
+  <template #icon-left><OIcon name="upload-file" /></template>
+  <template #icon-right><OIcon name="close" @click="file=null" /></template>
+</OFile>
```
(Confirm against OFile API before applying.)

### 7. DateTimePicker absolute-tab still bound to a `tab` value the trigger no longer toggles

`web/src/components/DateTimePicker.vue:59`: `<OTabPanels v-model="data.selectedDate.tab" animated>` with `<OTabPanel name="relative">`/`<OTabPanel name="absolute">`. The trigger row above (lines 36–56) sets `data.selectedDate.tab = 'relative'` / `'absolute'` via two `OButton` clicks rather than tying into the `OTabPanels` model. The `OSeparator vertical` between the buttons (line 46) suggests this used to be a `q-btn-group`. The model still works, but tab indicator state and tab keyboard navigation now have two different sources of truth.

**Solution:**
```diff
-<OButton @click="data.selectedDate.tab = 'relative'">Relative</OButton>
-<OSeparator vertical />
-<OButton @click="data.selectedDate.tab = 'absolute'">Absolute</OButton>
+<OToggleGroup v-model="data.selectedDate.tab" type="single">
+  <OToggleGroupItem value="relative">Relative</OToggleGroupItem>
+  <OToggleGroupItem value="absolute">Absolute</OToggleGroupItem>
+</OToggleGroup>
```
Use a single source of truth for the active tab.

### 8. Unscoped non-null assignment / ref nullification on unmount (DateTimePickerDashboard)

`web/src/components/DateTimePickerDashboard.vue:118-120`:

```ts
if (dateTimePicker.value) {
  dateTimePicker.value = null;
}
```

Mutating a child template ref to `null` from the parent inside `onUnmounted` is unnecessary — Vue clears the ref automatically once the child unmounts. Not strictly a bug, but the surrounding comments imply the author was unsure what to clean up; if any timers/listeners exist inside `DateTime.vue` they're not cleaned by this hook.

**Solution:**
```diff
 onUnmounted(() => {
-  if (dateTimePicker.value) {
-    dateTimePicker.value = null;
-  }
+  // Vue auto-clears template refs; nothing to clean up here.
 });
```

## CSS / Layout Issues

### Three-Layer CSS Violations

The architecture says: global → `web/src/styles/app.scss`, component partials in `web/src/styles/*` & `lib/core/*`, file-level `<style scoped>`. Violations:

1. **`web/src/components/DateTime.vue`** has two `<style>` blocks — line 1117 `<style lang="scss" scoped>` and **line 1131 `<style lang="scss">` (UNSCOPED)**. The unscoped block defines generic globals: `.q-btn--rectangle`, `.date-time-button`, `.date-time-dialog`, `.date-time-table.relative`, `.absolute-calendar`, `.relative-period-name`, `.rp-selector`, `.tab-button`, `.notePara`, `.startEndTime`, `.drawer-footer`, `.timezone-select` (lines 1132–1354). Every page that mounts a `DateTime` permanently injects these names into the global cascade.

2. **`web/src/components/RichTextInput.vue:617`** — single `<style lang="scss">` (UNSCOPED). Leaks generic class names like `.rich-text-input-wrapper`, `.dark-mode`, `.light-mode`, `.reference-chip`, `.chip-meta`, `.chip-remove`, `.is-disabled`, `.is-empty`. The `.dark-mode` / `.light-mode` collision with any other component using the same names is the biggest risk.

3. **`web/src/components/CodeQueryEditor.vue:1438`** — `<style lang="scss">` UNSCOPED. Defines `.logs-query-editor`, `.highlight-error`, and broad `.monaco-editor` overrides. Two scoped/unscoped blocks coexist.

4. **`web/src/components/TenstackTable.vue:2252`** — `<style>` (no lang, no scoped) with only `@import "@/assets/styles/log-highlighting.css";`. That import is then global rather than scoped to this table.

5. **`web/src/components/CustomDateTimePicker.vue`** has two `<style scoped>` blocks (lines 230 and 250). Both are scoped but each defines almost-identical class names (`.date-time-button`, `.date-time-table`, …) — duplication that fights itself in specificity.

**Solution:**
```diff
 <style lang="scss" scoped>
 .date-time-button { /* merge content from both blocks */ }
 .date-time-table { ... }
 </style>
-<style lang="scss" scoped>
-.date-time-button { /* duplicate */ }
-.date-time-table { /* duplicate */ }
-</style>
```
Or extract shared rules to `web/src/styles/date-picker.scss` and `@use` from both date-picker components.

### Hardcoded design tokens

- `web/src/components/TenstackTable.vue:2325` — `background-color: var(--q-color-grey-2, #f5f5f5);` — references a Quasar CSS var that no longer exists. The fallback `#f5f5f5` will always be used.
- `web/src/components/TenstackTable.vue:2339` — `color: var(--q-primary);` — same Quasar token, no fallback. Pivot sort-active icon will render in whatever the browser inherits, not the brand primary.
- `web/src/components/QueryEditor.vue:657` — `color: var(--q-primary);` for `.ai-bar-streaming` text.
- `web/src/components/HighLight.vue:113` — `background-color: rgb(255, 213, 0);` — hardcoded keyword highlight color, not pulled from `--o2-…` tokens.
- `web/src/components/CustomDateTimePicker.vue:257` — `background: rgba(89, 96, 178, 0.2) !important;` — hardcoded RGB.
- `web/src/components/CustomDateTimePicker.vue:345` — `background: rgba(0, 0, 0, 0.07);`.
- `web/src/components/CustomDateTimePicker.vue:301` — `border-bottom: 1px solid $border-color;` — references SCSS variable that may or may not still resolve. Same in DateTime.vue:1192.
- `web/src/components/CustomDateTimePicker.vue:404` — `color: $dark-page;` (SCSS variable). Same in DateTime.vue:1301.
- `web/src/components/JsonEditor.vue:268` — `background-color: $dark-page;` and selector `.dark-mode` inside `.common-json-editor` (uses an SCSS var that may not exist anymore).

**Solution:**
```diff
-background-color: var(--q-color-grey-2, #f5f5f5);
+background-color: var(--o2-bg-muted);
-color: var(--q-primary);
+color: var(--o2-primary);
-background-color: rgb(255, 213, 0);
+background-color: var(--o2-highlight-color);
-background: rgba(89, 96, 178, 0.2) !important;
+background: var(--o2-primary-soft-bg) !important;
-border-bottom: 1px solid $border-color;
+border-bottom: 1px solid var(--o2-border-color);
-color: $dark-page;
+color: var(--o2-text-primary);
```

### Dead Quasar `:deep(.q-*)` selectors

The following blocks no longer style anything because the underlying Quasar element is gone, leaving the new O* component without the intended overrides:

- `web/src/components/common/FieldListPagination.vue:292` — `:deep(.q-btn)` inside `.schema-field-toggle`.
- `web/src/components/common/FieldValuesPanel.vue:479-507` — five `&:deep(.q-field__*)` selectors against `.value-search-input-wrap`, including `.q-field__control`, `.q-field__prepend`, `.q-field__append`, `.q-field__native`. The wrapping `OInput` is `OInput`, not `QInput`.
- `web/src/components/common/JsonEditor.vue:275` — `:deep(.q-card__section)`.
- `web/src/components/common/sidebar/FolderList.vue:388, 423-424` — `.q-btn` inside `.hover-actions`; `:deep(.q-table th)`/`(.q-table td)` inside `.dashboards-list-page`.
- `web/src/components/CustomDateTimePicker.vue` — heavy concentration: `.q-btn` (239, 280, 376, 427, 439), `.q-btn__content` (266, 287), `.q-field` (306, 409, 418), `.q-select__dropdown-icon` (314), `.q-btn-group` (422), `.q-btn-item` (423), `.q-date__*` (326, 329, 363, 367, 381, 385, 391).
- `web/src/components/DateTime.vue` — same suite as CustomDateTimePicker (1132–1354).
- `web/src/components/DateTimePicker.vue:378, 410, 417, 437, 448, 516, 562, 573, 577, 578, 582, 595` — `.q-btn`, `.q-btn__content`, `.q-field`, `.q-field__control`, `.q-select__dropdown-icon`, `.q-btn-group`, `.q-btn-item`.
- `web/src/components/QueryEditor.vue:635-676` — eight `:deep(.q-field__*)` selectors targeting the `.ai-input-field` (now an OInput).
- `web/src/components/CodeQueryEditor.vue:1229` — `.q-dark .ai-icon-img` (the `.q-dark` class was Quasar's dark-mode root class; this rule never matches now).

**Solution:** delete dead selectors and rewrite to the O* equivalents:
```diff
-:deep(.q-btn) { ... }
-:deep(.q-field__control) { ... }
-:deep(.q-card__section) { ... }
-:deep(.q-table th), :deep(.q-table td) { ... }
-.q-dark .ai-icon-img { ... }
+:deep(.o-button) { ... }
+:deep(.o-input__control) { ... }
+:deep(.o-card-section) { ... }
+:deep(.o-table__header-cell), :deep(.o-table__cell) { ... }
+html.dark .ai-icon-img { ... }
```
Verify the exact O* class names in the corresponding component source.

### Inconsistent border-color tokens

`FieldExpansion.vue`, `FieldValuesPanel.vue`, `FolderList.vue`, etc. use `var(--o2-border-color)` (good). But `LoadingProgress.vue:12`, `GroupedFieldList.vue:23`, `JsonEditor.vue:24` and `DualListSelector.vue:69, 143` still use raw Tailwind greys (`tw:bg-gray-200`, `tw:text-gray-400`, `tw:bg-gray-700`, `tw:text-red-500`). Should pull from `--o2-…` for dark/light parity.

**Solution:**
```diff
-class="tw:bg-gray-200 tw:text-gray-400 tw:bg-gray-700 tw:text-red-500"
+class="tw:bg-[var(--o2-bg-muted)] tw:text-[var(--o2-text-muted)] tw:text-[var(--o2-error)]"
```

## Component Migration Issues

- **TenstackTable replaces QTable but spec coverage hasn't been updated.** `web/src/components/common/sidebar/SearchFieldList.spec.ts` still imports `QTable, QBtn, QInput, QExpansionItem, QCard, QCardSection, QList, QItem, QIcon` from `"quasar"` (lines 3–13), registers them as components (lines 226–235), then asserts on `wrapper.findComponent(QTable)` and reads props that only existed on `QTable` (`visibleColumns`, `hideHeader`, `hideBottom`). The source `SearchFieldList.vue` renders `OFieldList`, never `QTable`. These assertions are testing a stub, not real behavior — both the rendering tests (line 248–282) and the prop tests are misleading green.

**Solution:**
```diff
-import { QTable, QBtn, QInput, QExpansionItem, QCard, QCardSection, QList, QItem, QIcon } from "quasar";
+import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
 // ...
-expect(wrapper.findComponent(QTable).exists()).toBe(true);
+expect(wrapper.findComponent(OFieldList).exists()).toBe(true);
```

- **`ShareButton.spec.ts`** (lines 103, 123, 159, 199, 229, 271, 292, 331) stubs `QBtn` even though the component itself was migrated to `OButton`. Tests run against a stub of the wrong element name; assertions on the rendered HTML now miss the real button.

**Solution:**
```diff
 stubs: {
-  QBtn: true,
+  OButton: true,
 },
```

- **CopyContent.spec.ts:3** imports `copyToClipboard` from `'quasar'`, then mocks the `'quasar'` module. The current `CopyContent.vue` imports `copyToClipboard` from `'@/utils/clipboard'` (line 42). The test's mock never intercepts the real call path.

**Solution:**
```diff
-import { copyToClipboard } from 'quasar';
-vi.mock('quasar', () => ({ copyToClipboard: vi.fn() }));
+import { copyToClipboard } from '@/utils/clipboard';
+vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn() }));
```

- **`ConfirmDialog.spec.ts:178-188`** asserts banner classes `tw:bg-gray-800/60`, `tw:border-yellow-600/70`, `tw:bg-orange-50`, `tw:border-orange-400` on the rendered banner. The new `ConfirmDialog.vue:30-32` no longer applies any of those classes — it just renders `<OBanner variant="warning" icon="warning" :content="warningMessage" />`, delegating all styling to OBanner internally. These assertions will fail unless OBanner happens to ship the same class names (it does not — its styles use CSS in `lib/feedback/Banner/OBanner.vue`).

**Solution:**
```diff
-expect(banner.classes()).toContain('tw:bg-orange-50');
-expect(banner.classes()).toContain('tw:border-orange-400');
+const banner = wrapper.findComponent(OBanner);
+expect(banner.props('variant')).toBe('warning');
+expect(banner.props('icon')).toBe('warning');
```

- **`ConfirmDialog.spec.ts:78-87`** still uses stubs named `QBannerStub` / `QIconStub` even though the production component is `OBanner` / `OIcon`. The stubs are mapped to `"OIcon"`/`"q-banner"` in `stubs` (line 100-102), but the `"q-banner"` key won't match anything in the new template.

**Solution:**
```diff
 stubs: {
-  "q-banner": QBannerStub,
-  "q-icon": QIconStub,
+  OBanner: true,
+  OIcon: true,
 },
```

- **`ConfirmDialogProvider.vue`** depends on `useConfirmDialog` composable; not exercised by any spec under `web/src/components` (no `ConfirmDialogProvider.spec.ts`). New shared API surface with no test coverage.

- **`OFile` slot API mismatch** (see Logical Issue #6 above) — `BaseImport.vue` is still using Quasar-style slot names.

## Test File Issues

| Spec | Problem |
|---|---|
| `common/sidebar/SearchFieldList.spec.ts` | Imports QTable/QBtn/QInput/etc from `quasar`; tests stubs not real OFieldList. |
| `common/ShareButton.spec.ts` | Stubs `QBtn` (7 occurrences) — production renders `OButton`. |
| `common/JsonEditor.spec.ts` | Calls `installQuasar()` (line 24) even though the source no longer needs Quasar. |
| `common/BaseImport.spec.ts` | Calls `installQuasar()` (line 23). |
| `common/AppTabs.spec.ts`, `common/DualListSelector.spec.ts`, `common/FieldValuesPanel.spec.ts`, `common/sidebar/AddFolder.spec.ts`, `common/sidebar/FolderList.spec.ts`, `common/sidebar/InlineSelectFolderDropdown.spec.ts` | All still call `installQuasar()` — a dependency the production tree no longer has. |
| `CopyContent.spec.ts` | Imports `copyToClipboard` from `quasar`; mocks `quasar`. Production uses `@/utils/clipboard`. |
| `ConfirmDialog.spec.ts` | Asserts on Tailwind classes (`tw:bg-orange-50`, etc.) that the new wrapper component does not emit; stubs `QBanner`/`QIcon` instead of `OBanner`/`OIcon`. |
| `Header.spec.ts` | Mixes `QBtn: true`/`false` toggle stubs with comments about removed QSelect (line 1140). |
| `PredefinedThemes.spec.ts` | Stubs `QCard`, `QCardSection`, `QBtn`, `QIcon` (lines 132, 135, 153, 180). |
| Several specs (`AttributeValueCell.spec.ts`, `JsonPreview.spec.ts`, `CodeQueryEditor.spec.ts`, etc.) | Still depend on `installQuasar()` for plugin install; not strictly wrong but the production code paths no longer touch Quasar. |

These tests will:
- Either no-op (`installQuasar` is harmless when Quasar isn't installed in the build but still present in `node_modules` via dev deps),
- Or test wrong code paths (stubs of QXX where production renders OXX),
- Or assert classes that are no longer emitted (ConfirmDialog).

Recommend a sweep: remove `installQuasar()` calls from common-components specs, replace `Q*` stubs with `O*` stubs, and align assertions with the OBanner/OFieldList/OButton output.

**Solution (broad sweep):**
```diff
-import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
-installQuasar();
+// drop installQuasar entirely — Quasar is no longer required for these specs
 // ...
 stubs: {
-  QTable: true, QBtn: true, QInput: true, QBanner: true, QIcon: true,
+  OTable: true, OButton: true, OInput: true, OBanner: true, OIcon: true,
 },
```

## Validations

- **`JsonEditor.vue`**: `JSON.parse` is wrapped in `try/catch`, sets `validationErrors = ['Invalid JSON format']` — OK. Hardcoded string (not i18n) flagged separately above.
- **`BaseImport.vue`**: URL import flow uses axios; no client-side schema validation of the imported JSON in this component — caller is expected to validate.
- **`HighLight.vue:53-67`**: `getKeywords` regex is restricted to `match_all(...)` / `fuzzy_match_all(...)`; never matches `match_all_raw_ignore_case` etc. Out of scope but worth noting if more match operators land.
- **`SanitizedHtmlRenderer.vue:18-21`**: directly does `v-html="DOMPurify.sanitize(htmlContent)"`. No config passed to DOMPurify, so the default policy applies. That's reasonable but the default also strips `target` and certain inline event-handler attributes — consumers expecting links to retain `target="_blank"` may be surprised. Worth documenting.
- **`CodeQueryEditor.vue:1136`** sets monaco markers under owner `"dq-validation"` — likely a typo (looks like it should be `"sql-validation"` or `"oo-validation"`). Searching the codebase for other monaco marker owners would confirm.

**Solution:**
```diff
-monaco.editor.setModelMarkers(model, "dq-validation", markers);
+monaco.editor.setModelMarkers(model, "sql-validation", markers);
```
(Verify the intended owner by searching for `setModelMarkers` elsewhere.)

## Accessibility

- **`JsonPreview.vue:18, 70`**: literal `{` and `}` characters are rendered as raw text inside `<div>`s. Screen readers will read them as braces — fine for a JSON preview but the surrounding `<pre>`-style semantics are missing. The component is not wrapped in any role/aria-label.
- **`SanitizedHtmlRenderer.vue`**: uses `v-html`. No `role` or `aria-label`. If consumers feed user-supplied HTML, the rendered region has no accessible name distinguishable from arbitrary site chrome.
- **`HighLight.vue:113`**: highlight uses background `rgb(255, 213, 0)` with no foreground contrast pairing — fails WCAG AA on dark mode where the surrounding text colour is white.

**Solution:**
```diff
-background-color: rgb(255, 213, 0);
+background-color: var(--o2-highlight-bg);
+color: var(--o2-highlight-fg);  /* dark text on yellow in light, dark yellow on dark in dark */
```
- **`ConfirmDialog.vue`** and **`ConfirmDialogProvider.vue`**: rely on ODialog. They don't pass `aria-describedby` or any explicit `aria-labelledby` — assumed ODialog handles it via its `title` prop. Worth verifying in the ODialog audit.
- **`AttributeValueCell.vue:13`** and **`JsonPreview.vue:38`**: `aria-label="Add icon"` on a button used for "expand/collapse" — the label is wrong (it's a chevron/expand control, not an add button). Will mis-announce in screen readers.

**Solution:**
```diff
-<button aria-label="Add icon" @click="toggle">
+<button :aria-label="expanded ? 'Collapse' : 'Expand'" :aria-expanded="expanded" @click="toggle">
   <OIcon :name="expanded ? 'expand-less' : 'expand-more'" />
 </button>
```
- **`FieldRow.vue:36-47`** and **`FieldExpansion.vue:36-39`**: the field-type chevron is an `OIcon`, not a button. Keyboard users cannot toggle expansion via this icon. Expansion only happens through the wrapping `OCollapsible` row in `FieldExpansion`, and not at all in `FieldRow` (which intentionally has no expand state). For `FieldExpansion` this is OK; for `FieldRow` ensure consumers add a sibling expand affordance.
- **`AutoRefreshInterval.vue`**: nested `OButton` inside dropdown menu lacks explicit `role="menuitem"`. ODropdown may handle this; worth verifying.

## Recommendations

1. **Fix the runtime logic bugs first** (Critical 1, 2, 3) — they are user-visible and trivial:
   - `'tw:relative'` → `'relative'` in DateTime.vue:95 and DateTimePicker.vue:78.
   - Remove `v-close-popup` from BaseImport.vue:41 (handler already exists).
   - Find/replace all `hover:tw:` → `tw:hover:` (9 occurrences listed).
2. **Tear out the dead Quasar `:deep(.q-*)` selectors** in the date pickers (`DateTime.vue`, `DateTimePicker.vue`, `CustomDateTimePicker.vue`) — they're polluting the source with confusing dead code and the actual O* selectors are needed in their place to restore the intended look-and-feel.
3. **Promote duplicated date-picker styles to a shared partial** (e.g. `web/src/styles/date-picker.scss`). DateTime, DateTimePicker, CustomDateTimePicker all carry near-identical `.date-time-button`/`.date-time-table`/`.rp-selector` blocks. This is the strongest case for layer-2 promotion.
4. **Scope or move the unscoped `<style>` blocks** in DateTime.vue, RichTextInput.vue, CodeQueryEditor.vue, TenstackTable.vue. If genuinely shared, move into `web/src/styles/*.scss` (component layer). If component-private, mark `scoped`.
5. **Replace remaining Quasar CSS variables** (`--q-color-grey-2`, `--q-primary`) with `--o2-*` equivalents (TenstackTable.vue:2325, 2339; QueryEditor.vue:657; CodeQueryEditor.vue:1229).
6. **Spec-file sweep**: drop `installQuasar()` from common-components specs, retire `Q*` stubs, fix `CopyContent.spec.ts` to mock `@/utils/clipboard`, and align `ConfirmDialog.spec.ts` assertions with the actual `OBanner` props rather than expected class names.
7. **Delete dead code** — `checkboxColor` in FieldValuesPanel.vue, the redundant ref-nulling in DateTimePickerDashboard.vue:118-120.
8. **i18n the JsonEditor error message** at JsonEditor.vue:150 (and fix the `directly ,` whitespace typo).
9. **Fix `aria-label="Add icon"`** on the expand/collapse buttons in `AttributeValueCell.vue:13` and `JsonPreview.vue:38` — should be e.g. `aria-label="Expand"` / `aria-label="Collapse"` mirroring the icon state.
10. **OFile slot contract check** — confirm `OFile` accepts `bottom-slots` / `v-slot:prepend|append|hint`; if not, update `BaseImport.vue:134-153` to the new API (or back-fill the slot names in OFile).


## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| `web/src/components/DateTimePicker.vue:378-595` | `.q-btn--rectangle`, `.q-btn`, `.q-btn__content`, `.q-field`, `.q-field__control`, `.q-select__dropdown-icon`, `.q-date__header`, `.q-date__view`, `.q-date__arrow`, `.q-btn-group`, `.q-btn-item` (scoped style) | Drop / retarget to `OButton`/`OSelect`/Date primitive selectors | File-scoped |
| `web/src/components/DateTimePicker.vue:501-516` | `.q-date`, `.q-date__arrow`, `.q-btn .block` (unscoped global) | Drop | Global cleanup |
| `web/src/components/CustomDateTimePicker.vue:239-439` | `.q-btn`, `.q-btn__content`, `.q-field`, `.q-select__dropdown-icon`, `.q-date__*`, `.q-btn-group`, `.q-btn-item` (scoped) | Drop / retarget | File-scoped |
| `web/src/components/CustomDateTimePicker.vue:362-376` | `.q-date`, `.q-date__arrow` (unscoped global) | Drop | Global cleanup |
| `web/src/components/DateTime.vue:1131+` | `.q-btn--rectangle`, `.q-btn`, `.q-btn__content` etc. (unscoped) | Drop / retarget `OButton` | File-scoped |
| `web/src/components/CodeQueryEditor.vue:1229` | `.q-dark .ai-icon-img` | `html.dark .ai-icon-img` | File-scoped |
| `web/src/components/common/JsonEditor.vue:275` | `:deep(.q-card__section)` | `OCardSection` slot via class | File-scoped |
| `web/src/components/common/sidebar/FolderList.vue:423-424` | `:deep(.q-table th)`, `:deep(.q-table td)` | Target `OTable` `th`/`td` selectors | File-scoped |
| `web/src/components/common/FieldListPagination.vue:292` | `:deep(.q-btn)` | Target `OButton` class | File-scoped |
| `web/src/components/common/FieldValuesPanel.vue:480-505` | `:deep(.q-field__control)`, `:deep(.q-field__prepend)`, `:deep(.q-field__append)`, `:deep(.q-field__native)`, `:deep(.q-field__append .OIcon)` (5 sites) | Target `OInput` slot selectors | File-scoped |
| `web/src/components/QueryEditor.vue:635-680` | `.ai-input-field :deep(.q-field__control/__native/__prepend)` & dark variants (~8 sites) | Target `OInput` selectors | File-scoped |
| `web/src/components/common/FieldExpansion.vue:43` | `float-right` | `tw:float-right` | File-scoped |
| `web/src/components/common/FieldRow.vue:34` | `float-right` | `tw:float-right` | File-scoped |
| `web/src/components/TenstackTable.vue:314,334,347` | `text-weight-bold` | `tw:font-bold` | File-scoped |
| `web/src/components/common/BaseImport.vue:206` | `name="full-width-content"` (slot name string only, OK) | n/a (identifier, not class) | — |

### 2. Bare Quasar Utility Classes
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| `web/src/components/common/FieldExpansion.vue:43` | `float-right` | `tw:float-right` | File-scoped |
| `web/src/components/common/FieldRow.vue:34` | `float-right` | `tw:float-right` | File-scoped |
| `web/src/components/TenstackTable.vue:314` | `text-weight-bold` | `tw:font-bold` (already has `tw:font-medium` — remove dup) | File-scoped |
| `web/src/components/TenstackTable.vue:334` | `text-weight-bold` | `tw:font-bold` | File-scoped |
| `web/src/components/TenstackTable.vue:347` | `text-weight-bold` | `tw:font-bold` | File-scoped |

### 3. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| `web/src/components/TenstackTable.vue:420` | `hover:tw:bg-[var(--o2-hover-gray)]` | `tw:hover:bg-[var(--o2-hover-gray)]` | File-scoped |
| `web/src/components/TenstackTable.vue:611` | `hover:tw:bg-[var(--o2-hover-gray)]` | `tw:hover:bg-[var(--o2-hover-gray)]` | File-scoped |
| `web/src/components/common/FieldRow.vue:21` | `hover:tw:bg-[var(--o2-hover-accent)]` | `tw:hover:bg-[var(--o2-hover-accent)]` | File-scoped |
| `web/src/components/common/FieldValuesPanel.vue:127` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `web/src/components/common/DualListSelector.vue:31` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `web/src/components/common/DualListSelector.vue:129` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `web/src/components/DateTime.vue:95` | `'tw:relative'` (string literal in JS) | `'relative'` (see Critical #1) | File-scoped |
| `web/src/components/DateTimePicker.vue:78` | `'tw:relative'` (string literal in JS) | `'relative'` (see Critical #1) | File-scoped |

### 4. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| `web/src/components/TenstackTable.vue:2325` | `var(--q-color-grey-2, #f5f5f5)` | `var(--o2-bg-secondary, #f5f5f5)` | File-scoped |
| `web/src/components/TenstackTable.vue:2339` | `var(--q-primary)` | `var(--o2-primary)` | File-scoped |
| `web/src/components/QueryEditor.vue:657` | `var(--q-primary)` | `var(--o2-primary)` | File-scoped |

### 5. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| `web/src/components/QueryEditor.vue:635,643,644,648` | `.ai-input-field :deep(.q-field__control/::before/::after/__prepend)` | Retarget to `OInput`'s wrapper class | File-scoped |
| `web/src/components/QueryEditor.vue:665,670,675` | `.ai-input-field--dark :deep(.q-field__control/__native/::placeholder)` | Move to `html.dark .ai-input-field` + `OInput` selectors | File-scoped |
| `web/src/components/common/FieldValuesPanel.vue:480,490,491,498,505` | `:deep(.q-field__control/__prepend/__append/__native/__append .OIcon)` | Retarget to `OInput` slots | File-scoped |
| `web/src/components/common/FieldListPagination.vue:292` | `:deep(.q-btn)` | Drop / retarget `OButton` | File-scoped |
| `web/src/components/common/JsonEditor.vue:275` | `:deep(.q-card__section)` | Drop / `OCardSection` slot class | File-scoped |
| `web/src/components/common/sidebar/FolderList.vue:423,424` | `:deep(.q-table th)`, `:deep(.q-table td)` | Drop / `OTable` selectors | File-scoped |
| `web/src/components/CodeQueryEditor.vue:1229` | `.q-dark .ai-icon-img` | `html.dark .ai-icon-img` | File-scoped |

### 6. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| `web/src/components/DateTime.vue:1192` | `$border-color` | `var(--o2-border-input)` | File-scoped |
| `web/src/components/DateTime.vue:1235` | `$secondary` (commented) | Remove dead comment | File-scoped |
| `web/src/components/DateTime.vue:1301,1348` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |
| `web/src/components/CustomDateTimePicker.vue:301` | `$border-color` | `var(--o2-border-input)` | File-scoped |
| `web/src/components/CustomDateTimePicker.vue:344` | `$secondary` (commented) | Remove dead comment | File-scoped |
| `web/src/components/CustomDateTimePicker.vue:404,445` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |
| `web/src/components/DateTimePicker.vue:431` | `$border-color` | `var(--o2-border-input)` | File-scoped |
| `web/src/components/DateTimePicker.vue:481` | `$secondary` (commented) | Remove dead comment | File-scoped |
| `web/src/components/DateTimePicker.vue:518,551,601` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |
| `web/src/components/common/JsonEditor.vue:268` | `$dark-page` | `var(--o2-bg-secondary)` | File-scoped |

### 7. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| `web/src/components/common/BaseImport.vue:41` | `v-close-popup` on `OButton` | Remove — `@click="handleCancel"` already wired (see Critical #2) |

### 8. Icon Migration
*(none found — no underscored OIcon names, no `:color` prop in audited common components)*

### 9. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| (broad usage across DateTime / DateTimePicker / CustomDateTimePicker / TenstackTable for cell sizing, padding, z-index) | Many small `:style="{ width: ... }"` / `style="font-weight: 700"` | Token-driven scoped classes (move to date-picker partial — see Recommendation 3) |
| `web/src/lib/core/Table/sub-components/OTablePagination.vue:59` | `style="font-weight: 700"` | `tw:font-bold` |

### 10. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|---|---|---|
| `DateTime.vue:1117+`, `DateTimePicker.vue:377+`, `CustomDateTimePicker.vue:230+` | `.date-time-button`, `.date-time-table`, `.rp-selector`, `.q-btn` overrides, `.q-field` overrides, `.q-date__*` overrides | `web/src/styles/date-picker.scss` (matches Recommendation 3) |
| `FieldExpansion.vue:43`, `FieldRow.vue:34` | `float-right` inside `<span>` | `tw:float-right` inline (no partial needed) |
| `TenstackTable.vue:314,334,347` | `text-weight-bold tw:font-medium` repeated | A single header class `.o2-table-header-label` |
| `FieldValuesPanel.vue:480-505`, `QueryEditor.vue:635-680` | `:deep(.q-field*)` overrides on input wrappers | `_search-input-overrides.scss` partial (or kill once `OInput` exposes proper slot classes) |

### 11. Layer Summary
- Global (`app.scss`) changes needed: 2 (define `--o2-primary` alias if missing; consolidate `body--dark`→`html.dark` rewrite policy)
- Component-level partial changes: 2 (date-picker partial, search-input-overrides partial)
- File-level scoped changes: ~50 (Quasar `.q-*` deletions in date-picker style blocks, `hover:tw:` → `tw:hover:` corrections in 6 files, `var(--q-*)` → `var(--o2-*)`, SCSS `$var` → CSS-var replacements, `float-right` / `text-weight-bold` → `tw:` utilities)

