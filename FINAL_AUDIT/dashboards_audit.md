# Dashboards Page — Quasar Removal Audit

## Summary

Audit performed on branch `feat/ux-revamp-main` (HEAD `06febada85`) vs `main`. ~177 files changed in dashboards scope (`web/src/components/dashboards/**`, `web/src/views/Dashboards/**`, `web/src/composables/dashboard/**`) totaling ~14,900 ins / 14,900 del lines.

The migration largely converts Quasar components (`q-input`, `q-select`, `q-btn`, `q-icon`, `q-tooltip`, `q-dialog`, `q-card`, `q-page`, `q-form`, `q-bar`, `q-separator`, `q-spinner-dots`, etc.) to in-house `O*` components (`OInput`, `OSelect`, `OButton`, `OIcon`, `OTooltip`, `ODrawer`, `OSeparator`, `OSpinner`, `OForm`, `OFormInput`, `OTable`, `TenstackTable`) and Tailwind v4 prefixed (`tw:`) classes. The bulk transformation is functionally correct but leaves a long tail of orphan CSS, stale spec files, broken CSS variables, dead `:deep(.q-*)` selectors, and one invalid object literal.

Production rendering will work for the common path but specific UX surfaces (warning icons, tooltips that depended on `var(--q-warning)`, sticky offsets on multi-column pivot tables, hover styles, dark mode text, virtual-scroll padding) are visually degraded. Test coverage for migrated components is largely obsolete — many specs still assert against `QSelect` / `QInput` / `QIcon` stub names and one composable spec imports `exportFile` from `"quasar"` (no longer a dependency).

## Files Audited

Browsed via `find` + `git diff main..HEAD` in:
- `web/src/views/Dashboards/` (16 Vue files, 10 specs)
- `web/src/components/dashboards/` (75+ Vue files)
- `web/src/composables/dashboard/` (~20 ts files + specs)

Spot-read with file content / diff:
- `web/src/components/dashboards/PanelSchemaRenderer.vue`
- `web/src/components/dashboards/PanelContainer.vue`
- `web/src/components/dashboards/PanelErrorButtons.vue`
- `web/src/components/dashboards/AddDashboard.vue`
- `web/src/components/dashboards/VariablesValueSelector.vue`
- `web/src/components/dashboards/panels/TableRenderer.vue`
- `web/src/components/dashboards/panels/PromQLTableChart.vue`
- `web/src/components/dashboards/addPanel/ChartSelection.vue`
- `web/src/components/dashboards/addPanel/CommonAutoComplete.vue`
- `web/src/components/dashboards/addPanel/ColorBySeriesPopUp.vue`
- `web/src/components/dashboards/viewPanel/ViewPanel.vue`
- `web/src/views/Dashboards/Dashboards.vue`
- `web/src/views/Dashboards/ViewDashboard.vue`
- `web/src/views/Dashboards/addPanel/AddPanel.vue`
- `web/src/views/Dashboards/PanelLayoutSettings.vue`
- `web/src/composables/dashboard/usePanelActions.ts` (+ spec)
- `web/src/styles/tailwind.css` (to confirm `prefix(tw)` config)

## Critical Issues

### 1. Invalid object literal pollution in ViewPanel.vue setup() return
File: `web/src/components/dashboards/viewPanel/ViewPanel.vue:890`

```js
"warning": "warning",
```

Sits between `errorMessage` and `currentTabId` in the `setup()` return. The original `outlinedWarning` / `symOutlinedDataInfoAlert` imports from `@quasar/extras` were stripped, but the find/replace also rewrote the export entries to a meaningless string-keyed pair. Since template no longer reads `outlinedWarning`/`symOutlinedDataInfoAlert`, this is harmless at runtime but reflects a botched mass-edit and should be deleted.

**Solution:**
```diff
-      "warning": "warning",
```
Delete the line from the `setup()` return.

### 2. ChartSelection icon images depend on `img:` prefix sanitization
File: `web/src/components/dashboards/addPanel/ChartSelection.vue:44`

```vue
<img :src="item.image.replace('img:', '')" ... />
```

`item.image` is built as `"img:" + getImageURL("images/dashboard/charts/area.png")`. The replace works, but `OIcon` is imported and registered in `components: { OIcon, OTooltip }` (lines 70, 237) yet **never used in template**. Dead import. Low-impact.

**Solution:**
```diff
- import OIcon from "@/lib/core/Icon/OIcon.vue";
- ...
- components: { OIcon, OTooltip },
+ components: { OTooltip },
```
Drop the unused `OIcon` import and registration.

### 3. AddDashboard form no longer has its own submit/cancel buttons
File: `web/src/components/dashboards/AddDashboard.vue:17-51`

The template lost the inline submit/cancel buttons. Submission is now driven externally via `addDashboardRef?.submit()` from the parent `ODrawer` (`web/src/views/Dashboards/Dashboards.vue:385`). This is intentional — the component now exposes `submit()` (line 209). **Not broken**, but the component is no longer usable standalone (any direct importer expecting in-form buttons will break). Documented in case anyone else mounts `AddDashboard` without a hosting drawer.

**Solution:**
```ts
// AddDashboard.vue setup() — already exposes submit()
defineExpose({ submit });

// Add a prop so the component can render its own buttons when not embedded in a drawer
const props = withDefaults(defineProps<{ standalone?: boolean }>(), { standalone: false });
```
```vue
<template v-if="standalone">
  <OButton variant="primary" @click="submit">Save</OButton>
  <OButton variant="ghost" @click="$emit('cancel')">Cancel</OButton>
</template>
```
Adds a `standalone` mode for direct importers without a hosting drawer.

## Logical Issues

### 1. `usePanelActions.spec.ts` imports from a missing dependency
File: `web/src/composables/dashboard/usePanelActions.spec.ts:22`

```ts
import { exportFile } from "quasar";
```

`quasar` is no longer in `web/package.json` `dependencies`. The spec also mocks the module (line 24), so Vitest may resolve via the mock — but the static `import` against a missing package may still error at test resolution depending on Vitest config. Production code uses `downloadFile` from `@/utils/dom` (line 17 in `usePanelActions.ts`), so the spec is testing the wrong API.

**Solution:**
```diff
- import { exportFile } from "quasar";
- vi.mock("quasar", () => ({ exportFile: vi.fn() }));
+ import { downloadFile } from "@/utils/dom";
+ vi.mock("@/utils/dom", () => ({ downloadFile: vi.fn() }));
```
Mock the actual util the production code calls.

### 2. Many spec files still assert against Quasar component class names
Affected files (sampling):
- `web/src/components/dashboards/VariablesValueSelector.spec.ts:237` — `name: "QInput"`
- `web/src/components/dashboards/QueryInspector.spec.ts:183-189` — `QInput`, `QIcon` stubs
- `web/src/components/dashboards/settings/VariableCustomValueSelector.spec.ts:50-87,115-540` — `QSelect`, `QItem`, `QItemSection`, `QItemLabel`, `QCheckbox`, `QSeparator` references throughout, plus `findComponent({ name: "QSelect" })`
- `web/src/components/dashboards/settings/VariableQueryValueSelector.spec.ts:83-126` — same pattern

These tests register Q* components as stubs and then query them — but the production components are now `OSelect`/`OCheckbox`/etc., so the asserts target ghosts. Tests likely still pass (stubs render) but don't verify real behaviour. Flagged in the existing `install-quasar-plugin.ts` TODO at lines 16-21 of `web/src/test/unit/helpers/install-quasar-plugin.ts`.

**Solution:**
```diff
- wrapper.findComponent({ name: "QInput" })
+ wrapper.findComponent({ name: "OInput" })

- wrapper.findComponent({ name: "QSelect" })
+ wrapper.findComponent({ name: "OSelect" })

- stubs: { QInput, QIcon, QSelect, QItem, QItemSection, QItemLabel, QCheckbox, QSeparator }
+ stubs: { OInput: true, OIcon: true, OSelect: true, OSelectItem: true, OCheckbox: true, OSeparator: true }
```
Update all four specs to query/stub the O* counterparts.

### 3. Variant attribute "warning" on OButton
File: `web/src/components/dashboards/viewPanel/ViewPanel.vue:75`

```vue
:variant="isVariablesChanged ? 'outline' : 'warning'"
```

Need to confirm `OButton` supports `warning` as a variant (PanelErrorButtons.vue uses `ghost-warning`). If only `ghost-warning` exists, this falls through to default styling silently. Out of scope to verify here; flagged for QA.

**Solution:**
```diff
- :variant="isVariablesChanged ? 'outline' : 'warning'"
+ :variant="isVariablesChanged ? 'outline' : 'ghost-warning'"
```
Use the variant already used in `PanelErrorButtons.vue`. If `warning` is in fact a valid variant, leave as-is; otherwise this normalization is safe.

## CSS / Layout Issues

### 1. Broken Quasar CSS variables (17 occurrences across 11 files)
Quasar provided `--q-primary`, `--q-warning`, `--q-secondary`, `--q-background`, `--q-primary-rgb`. None are defined under Tailwind v4 token system (`web/src/lib/styles/tokens/*.css`). These `var(...)` calls fall through to their fallback (most have no fallback), producing transparent/black text or invisible borders.

- `web/src/components/dashboards/PanelContainer.vue:1008` — `color: var(--q-warning);` (`.warning` class)
- `web/src/components/dashboards/PanelErrorButtons.vue:148` — `color: var(--q-warning);`
- `web/src/components/dashboards/settings/TabsSettings.vue:450` — `border: 1px solid var(--q-primary);`
- `web/src/components/dashboards/settings/TabsSettings.vue:457` — `border-color: var(--q-secondary);`
- `web/src/components/dashboards/addPanel/SortByBtnGrp.vue:79` — `background-color: var(--q-primary) !important;`
- `web/src/components/dashboards/addPanel/ShowLegendsPopup.vue:281` — `background-color: var(--q-background);`
- `web/src/components/dashboards/addPanel/DrilldownPopUp.vue:808` — `background-color: var(--q-primary) !important;`
- `web/src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue:345` — `border-color: var(--q-primary);`
- `web/src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue:369,391,392` — `background-color: var(--q-primary)`, `border`, `box-shadow rgba(var(--q-primary-rgb), 0.3)`
- `web/src/components/dashboards/viewPanel/ViewPanel.vue:914` — `color: var(--q-warning);`
- `web/src/components/dashboards/PanelEditor/PanelEditor.vue:1300,1305` — `color: var(--q-warning);`, `color: var(--q-secondary);`
- `web/src/views/Dashboards/addPanel/AddJoinPopUp.vue:614,624,646` — `color: var(--q-primary);`

**Solution:**
```diff
- color: var(--q-primary);
+ color: var(--o2-primary);

- color: var(--q-warning);
+ color: var(--o2-warning);

- color: var(--q-secondary);
+ color: var(--o2-secondary);

- background-color: var(--q-background);
+ background-color: var(--o2-bg-base);

- box-shadow: 0 0 8px rgba(var(--q-primary-rgb), 0.3);
+ box-shadow: 0 0 8px color-mix(in srgb, var(--o2-primary) 30%, transparent);
```
Apply to all 17 occurrences across the 11 listed files.

### 2. Invalid Tailwind class `tw:mr-md`
File: `web/src/views/Dashboards/Dashboards.vue:333`

```vue
class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-md"
```

Tailwind v4 does not recognize the `md` token for spacing utilities (it uses numbers like `tw:mr-3` or `tw:mr-[12px]`). This class is silently dropped — no right margin applied.

**Solution:**
```diff
- class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-md"
+ class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-4"
```

### 3. Wrong variant prefix order for Tailwind v4 (with `prefix(tw)` config)
Per `web/src/styles/tailwind.css:1` (`@import "tailwindcss" prefix(tw);`), variants must come **after** the prefix: `tw:hover:bg-muted/50`, not `hover:tw:bg-muted/50`. The following are silently broken (no hover/dark style applied):

- `web/src/components/dashboards/AddDashboardFromGitHub.vue` — both `tw:bg-primary/5 ... tw:border-primary` selected style and `hover:tw:bg-gray-50` fallback
- `web/src/components/dashboards/addPanel/AddAnnotation.vue` — `hover:tw:bg-muted/50`
- `web/src/components/dashboards/addPanel/StreamFieldSelect.vue` — `hover:tw:bg-muted/50`
- `web/src/components/dashboards/addPanel/PromQLChartConfig.vue` — four occurrences of `hover:tw:bg-muted/50`
- `web/src/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue` — `dark:tw:text-gray-400`
- `web/src/views/Dashboards/addPanel/AddCondition.vue` — `hover:tw:bg-muted/50`

**Solution:**
```diff
- hover:tw:bg-muted/50
+ tw:hover:bg-muted/50

- hover:tw:bg-gray-50
+ tw:hover:bg-gray-50

- dark:tw:text-gray-400
+ tw:dark:text-gray-400
```
Apply across the 7 listed files (regex replace: `(hover|dark|focus|active|disabled):tw:` → `tw:$1:`).

### 4. Dead `:deep(.q-*)` selectors (41 occurrences)
Selectors target elements that no longer exist (Quasar internals: `.q-virtual-scroll`, `.q-virtual-scroll__padding`, `.q-virtual-scroll__content`, `.q-btn`, `.q-btn-dropdown`, `.q-btn__content`, `.q-btn--rectangle`, `.q-btn--outline`, `.q-btn--flat`, `.q-btn:before`, `.q-select`, `.q-select__dropdown-icon`, `.q-field--dense`, `.q-field--labeled`, `.q-field__before`, `.q-field__prepend`, `.q-field__label`, `.q-field__control`, `.q-field__marginal`, `.q-field--with-bottom`). Files include:

**Solution:** Delete each `:deep(.q-*)` block. For the few that imparted real visual customisation, re-target the new O* internals or pass classes via component props:
```diff
- :deep(.q-btn) { padding: 4px 8px; }
+ // Use OButton size prop: <OButton size="sm" />

- :deep(.q-field__control) { border-color: var(--o2-primary); }
+ // Use OInput input-class prop: <OInput input-class="tw:border-primary" />

- :deep(.q-virtual-scroll__padding) { padding: 0 !important; }
+ // Override via OTable's :body-style / :virtual-scroll-slice-size props
```
- `web/src/views/Dashboards/RenderDashboardCharts.vue:1752`
- `web/src/views/Dashboards/ViewDashboard.vue:1952-2012` (multiple)
- `web/src/views/Dashboards/ImportDashboard.vue:970`
- `web/src/views/Dashboards/addPanel/AddCondition.vue:337`
- `web/src/components/dashboards/viewPanel/ViewPanel.vue:930-935`
- `web/src/components/dashboards/settings/VariableSettings.vue:538` (`.q-btn {}`)
- `web/src/components/dashboards/settings/TabsSettings.vue:466`
- `web/src/components/dashboards/settings/AddSettingVariable.vue:1695` (`.q-field--with-bottom`)
- `web/src/components/dashboards/panels/PromQLTableChart.vue:296`
- `web/src/components/dashboards/addPanel/SortByBtnGrp.vue:95`
- `web/src/components/dashboards/addPanel/PanelFieldList.vue:1026-1047`
- `web/src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue:728-827`
- `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue:586-685`
- `web/src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue:713-812`
- `web/src/components/dashboards/addPanel/TablePaginationControls.vue:197`
- `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue:1541-1565`

Visual side effects: dropdown icon misalignment in `TablePaginationControls`, custom hover/active border colour on axis-field buttons in chart builders, virtual scroll padding hacks, custom `q-btn--outline::before` separators on the refresh dropdown group in `ViewDashboard.vue` — all silently no-ops.

### 5. Leftover Quasar utility classes
- `web/src/components/dashboards/PanelSchemaRenderer.vue:181` — `class="tw:flex tw:items-center q-gutter-x-xs"` — `q-gutter-x-xs` class is undefined, no gap applied between icon buttons in the cursor-over-panel toolbar.
- `web/src/components/dashboards/viewPanel/ViewPanel.vue:20`, `web/src/views/Dashboards/Dashboards.vue:33`, `web/src/views/Dashboards/ViewDashboard.vue:61,72,76`, `web/src/views/Dashboards/addPanel/AddPanel.vue:30` — `q-table__title` class persists. Defined by Quasar's q-table; now undefined. Folder/dashboard breadcrumb font sizing and weight may lose intended styling.
- `web/src/components/dashboards/addPanel/AddAnnotation.vue:26` — `showLabelOnTop` class persists.
- `web/src/components/dashboards/settings/AddSettingVariable.vue:83` — `class="showLabelOnTop"`.
- `web/src/components/dashboards/addPanel/ColorBySeriesPopUp.vue:62-63` — passes Quasar-only props `stack-label`, `borderless`, `label-slot` to `CommonAutoComplete`, which forwards them as `$attrs` to `OInput`. These are ignored.

**Solution:**
```diff
- class="tw:flex tw:items-center q-gutter-x-xs"
+ class="tw:flex tw:items-center tw:gap-x-1"

- class="q-table__title"
+ class="tw:text-lg tw:font-semibold"

- class="showLabelOnTop"
+ // Delete — OInput handles labels via :label prop with built-in placement

- <CommonAutoComplete stack-label borderless label-slot ... />
+ <CommonAutoComplete ... />
```

### 6. Reference to undefined `bg-white` / `dark-mode` classes
Multiple views still toggle `bg-white` (e.g., `DashboardJsonEditor.vue:14`, `ScheduledDashboards.vue:56`, `DashboardSettings.vue:26`, `PanelLayoutSettings.vue:30`). `bg-white` was a Quasar utility; in Tailwind v4 with `prefix(tw)` you need `tw:bg-white`. Light-mode background may now render transparent on these pages, exposing whatever lies underneath. `dark-mode` is project-defined elsewhere so it's likely fine, but worth verifying.

**Solution:**
```diff
- :class="store.state.theme === 'dark' ? 'dark-mode' : 'bg-white'"
+ :class="store.state.theme === 'dark' ? 'dark-mode' : 'tw:bg-white'"
```
Add the `tw:` prefix to the four toggles. If `card-container` already paints the background, remove `bg-white` entirely.

## Component Migration Issues

### 1. `q-table` → `OTable` / `TenstackTable` migration looks functionally complete
- `web/src/components/dashboards/panels/TableRenderer.vue:19-67` wraps `TenstackTable` with the dashboard's `#bottom` pagination slot. Sorting (`@sort-change`, `local-sort-by`/`local-sort-order`), cell copy (`enable-cell-copy`), virtual scroll (`use-virtual-scroll="false"`), pivot headers, sticky totals, dashboard pagination all preserved.
- `web/src/views/Dashboards/Dashboards.vue:249-374` uses `OTable` with multi-selection (`selection="multiple"`, `v-model:selected-ids`), row-click, paging, footer slot, cell slots, `#empty` slot. Looks good.

### 2. `q-select` → `OSelect` looks complete
- `web/src/components/dashboards/panels/PromQLTableChart.vue:43-49` correctly converts the legend filter `q-select` to `OSelect` with `template #icon-left` slot and `OIcon name="filter-list"`.

### 3. `q-input` → `OInput` lost some attributes
Many call sites previously used `dense`, `borderless`, `hide-bottom-space`, `stack-label`, `:rules="[...]"`. The new `OInput` validators flow through `OFormInput`/`OForm` (TanStack-based). For non-form contexts that previously relied on Quasar's per-field `:rules` (e.g., `web/src/views/Dashboards/PanelLayoutSettings.vue` height validation), behaviour is now hand-rolled via `heightError` ref + `submitForm()` — functional but more verbose.

**Solution:** Standardize on `<OForm>` + `<OFormInput :validators="...">` for any field with rules. The manual `heightError` ref pattern in `PanelLayoutSettings.vue` is fine as a transitional implementation, but the long-term shape is:
```vue
<OForm @submit="onSubmit">
  <OFormInput name="height" :validators="[v => +v > 0 || 'Must be positive']" />
</OForm>
```

### 4. `q-dialog` → custom drawer/modal migrations
- `ViewPanel.vue` ShowLegendsPopup is now a flat component with `v-model:open` (line 178-181). OK.
- `AddPanel.vue:165-170` Query Inspector dialog now flat with `v-model:open`. OK.
- `Dashboards.vue:377-393` Add Dashboard uses `ODrawer` with `primary-button-label`/`secondary-button-label` and ref-driven submit. OK.

### 5. Sticky column CSS variable usage in `TableRenderer.vue` / `PromQLTableChart.vue`
File: `web/src/components/dashboards/panels/PromQLTableChart.vue:317,323`

Per user memory note ("I already fixed one in PromQLTableChart.vue"), the previously-broken `--sticky-tw:w-1/12-width` identifiers have been restored to `--sticky-col-1-width` / `--sticky-col-2-width`. Verified current state is clean (`grep -n "sticky" PromQLTableChart.vue` returns only `sticky-col-*` names). No other files contained the corrupted identifier.

## Test File Issues

### Cross-cutting
- `usePanelActions.spec.ts:22` imports `exportFile` from `"quasar"` (removed dependency). Will fail unless mocked module fully shadows the import resolution.
- Spec files still reference Quasar Q* component names in stubs / `findComponent` queries (see Logical Issues §2). These tests pass but verify nothing about the new `O*` components.
- `web/src/test/unit/helpers/install-quasar-plugin.ts` is now a no-op shim (just `qLayoutInjections()`); explicit TODO at lines 16-21 to rewrite specs.

### Heavy spec churn (regenerated/migrated)
Significant rewrites: `Dashboards.spec.ts` (757 lines changed), `RenderDashboardCharts.spec.ts`, `ScheduledDashboards.spec.ts`, `viewDashboard.spec.ts`, `PanelLayoutSettings.spec.ts`, `DashboardJsonEditor.spec.ts`, `DashboardSettings.spec.ts`, `ImportDashboard.spec.ts`, `AddPanel.spec.ts`, `addPanel/AddJoinPopUp.spec.ts`, `addPanel/AddCondition.spec.ts`, `addPanel/Group.spec.ts`, `addPanel/DashboardJoinsOption.spec.ts`, `tabs/TabList.spec.ts`, `tabs/AddTab.spec.ts`, `viewPanel/ViewPanel.spec.ts`, plus settings/*.spec.ts (~10 files), addPanel/*.spec.ts (~30+ files).

These weren't audited line-by-line — they need a separate test-runner verification pass to confirm they still execute and assert meaningful behaviour.

### `vi.mock("quasar", ...)` still present
- `web/src/components/dashboards/PanelSchemaRenderer.spec.ts:22`
- `web/src/components/dashboards/panels/TableRenderer.spec.ts:40`
- `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.spec.ts:78`
- `web/src/components/dashboards/addPanel/QueryTypeSelector.spec.ts:27`
- `web/src/components/dashboards/addPanel/ShowLegendsPopup.spec.ts:9`
- `web/src/views/Dashboards/viewDashboard.spec.ts:181`
- `web/src/composables/dashboard/usePanelActions.spec.ts:24`

If `"quasar"` is no longer a resolvable module path, `vi.mock` of a non-existent module is typically a soft fail in Vitest — but for the file at `usePanelActions.spec.ts` that also imports from it, this may produce a hard error.

## Recommendations

Priority order, scoped to the dashboards surface:

1. **High — visual regressions blocking UX revamp ship**:
   - Replace the 17 `var(--q-primary|warning|secondary|background|primary-rgb)` usages with semantic tokens from `web/src/lib/styles/tokens/semantic.css` (probably `var(--primary)`, `var(--warning)` per existing token naming).
   - Fix `tw:mr-md` → `tw:mr-3` in `Dashboards.vue:333`.
   - Fix wrong-order Tailwind variants — change `hover:tw:bg-muted/50` → `tw:hover:bg-muted/50` and `dark:tw:text-gray-400` → `tw:dark:text-gray-400` in the 7 listed files.
   - Add Tailwind prefix to `bg-white` toggles in JSON editor / settings / scheduled dashboards (or remove if `card-container` already handles background).

2. **High — clean up broken/leftover styles**:
   - Delete or rewrite the 41 `:deep(.q-*)` selectors. Most can be deleted; the ones that targeted visual customisation (refresh-btn-group dropdown separators in `ViewDashboard.vue:1990-2012`, axis-field buttons in chart builders, virtual-scroll padding in `RenderDashboardCharts.vue` and `PromQLTableChart.vue`) need rewriting against the new `O*` internals.
   - Remove leftover `q-gutter-x-xs`, `q-table__title`, `showLabelOnTop`, `stack-label`, `borderless`, `label-slot` strings/attrs.

3. **Medium — code hygiene**:
   - Remove the meaningless `"warning": "warning"` literal in `ViewPanel.vue:890` and the `outlinedRunningWithErrors`, `outlinedReportProblem`, `outlinedDashboardCustomize`, `outlinedFileDownload` aliases in `PanelContainer.vue:890-893` (and `PanelErrorButtons.vue:140`). The OIcon names are inlined now — these aliases are dead.
   - Remove unused `OIcon` import in `ChartSelection.vue`.

4. **Medium — test rewrite plan**:
   - Replace `import { exportFile } from "quasar"` in `usePanelActions.spec.ts:22` with a mock of `@/utils/dom`'s `downloadFile`.
   - Audit each spec calling `installQuasar()` and `vi.mock("quasar", ...)` to either remove the Quasar references and re-target O* components, or leave them as smoke tests with a clear TODO.
   - Per the existing TODO in `install-quasar-plugin.ts`, schedule a dedicated test-rewrite sweep.

5. **Low — verify variant naming**:
   - Confirm `OButton` `:variant="'warning'"` (used in `ViewPanel.vue:75`) is a supported variant or normalise to `ghost-warning` / `outline-warning` etc.
   - Verify `OButton` supports a `loading` prop (used in `ViewDashboard.vue` refresh button) consistently with Quasar's behaviour.

6. **Low — runtime smoke check**:
   - Open the dashboards page in dev, create/edit/delete a dashboard, add each panel type (line/area/bar/table/PromQL table/geomap/markdown/HTML/custom chart/sankey), exercise the drilldown popup, show-legends popup, view-panel fullscreen, refresh, export-CSV/JSON, query inspector — confirm no console warnings about unknown classes or undefined CSS variables.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers (silent no-ops)

| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `web/src/components/dashboards/PanelSchemaRenderer.vue:181` | `q-gutter-x-xs` | `tw:gap-x-1` | File-level |
| `web/src/components/dashboards/PanelSchemaRenderer.vue:71` | `column` (in `tw:flex tw:flex-col column`) | Remove `column` (duplicate of `tw:flex-col`) | File-level |
| `web/src/components/dashboards/PanelSchemaRenderer.vue:85` | `column` | Remove (same) | File-level |
| `web/src/components/dashboards/PanelSchemaRenderer.vue:290` | `bg-dark` / `bg-white` | `tw:bg-[var(--o2-surface-dark)]` / `tw:bg-white` | File-level |
| `web/src/components/dashboards/settings/TabsSettings.vue:21` | `column full-height` | `tw:flex tw:flex-col tw:h-full` | File-level |
| `web/src/components/dashboards/settings/AddSettingVariable.vue:19` | `column full-height` | `tw:flex tw:flex-col tw:h-full` | File-level |
| `web/src/components/dashboards/settings/VariableSettings.vue:18, :27` | `column full-height` | `tw:flex tw:flex-col tw:h-full` | File-level |
| `web/src/components/dashboards/settings/GeneralSettings.vue:18` | `column full-height` | `tw:flex tw:flex-col tw:h-full` | File-level |
| `web/src/views/Dashboards/Dashboards.vue:333` | `tw:mr-md` (invalid token) | `tw:mr-4` | File-level |
| `web/src/views/Dashboards/addPanel/AddCondition.vue:61` | `tw:flex column` | `tw:flex tw:flex-col` | File-level |
| `web/src/components/dashboards/settings/common/DashboardHeader.vue:20, :35` | `col-auto` | `tw:flex-none` | File-level |
| `web/src/components/dashboards/addPanel/DashboardQueryEditor.vue:18, :243` | `col-auto` | `tw:flex-none` | File-level |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:83, :84, :461, :462` | `col-auto`, `text-weight-bold` | `tw:flex-none`, `tw:font-bold` | File-level |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:82, :342, :377, :458, :295, :316, :616, :619, :639` | `column`, `col-auto` | `tw:flex tw:flex-col`, `tw:flex-none` | File-level |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:563` | `bg-primary text-white` | `tw:bg-[var(--o2-primary)] tw:text-white` | File-level |
| `web/src/components/dashboards/addPanel/CustomHTMLEditor.vue:41` | `bg-primary text-white` | `tw:bg-[var(--o2-primary)] tw:text-white` | File-level |
| `web/src/components/dashboards/addPanel/CustomMarkdownEditor.vue:44` | `bg-primary text-white` | `tw:bg-[var(--o2-primary)] tw:text-white` | File-level |
| `web/src/components/dashboards/addPanel/PanelFieldList.vue:5` | `column index-menu` | `tw:flex tw:flex-col index-menu` | File-level |
| `web/src/views/Dashboards/addPanel/AddJoinPopUp.vue:101` | `text-primary` | `tw:text-[var(--o2-primary)]` | File-level |
| `web/src/views/Dashboards/DashboardJsonEditor.vue:14` | `bg-white` (in ternary) | `tw:bg-white` | File-level |
| `web/src/views/Dashboards/ScheduledDashboards.vue:56` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/views/Dashboards/DashboardSettings.vue:26` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/views/Dashboards/PanelLayoutSettings.vue:30` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/components/dashboards/settings/VariableSettings.vue:185` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/components/dashboards/addPanel/DrilldownPopUp.vue:118` | `bg-white` | `tw:bg-white` | File-level |
| `web/src/components/dashboards/addPanel/dynamicFunction/RawQueryBuilder.vue:20` | `bg-white` | `tw:bg-white` | File-level |
| +6 more `bg-white` in dark-mode ternaries across DashboardSettings family |

### 2. Tailwind v4 Misuse

| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `web/src/views/Dashboards/addPanel/AddCondition.vue:119` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/dashboards/AddDashboardFromGitHub.vue:85` | `hover:tw:bg-gray-50` | `tw:hover:bg-gray-50` | File-level |
| `web/src/components/dashboards/addPanel/AddAnnotation.vue:40` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/dashboards/addPanel/PromQLChartConfig.vue:188, :258, :313, :406` | `hover:tw:bg-muted/50` (4 occurrences) | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/dashboards/addPanel/StreamFieldSelect.vue:27` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue:39` | `dark:tw:text-gray-400` | `tw:dark:text-gray-400` | File-level |
| `web/src/views/Dashboards/Dashboards.vue:333` | `tw:mr-md` (invalid Quasar-style token) | `tw:mr-4` | File-level |

### 3. Quasar CSS Variables (var(--q-*))

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/views/Dashboards/ViewDashboard.vue:1928` | `var(--q-color-page-background, #ffffff)` | `var(--o2-background, #ffffff)` | Token (global) |
| `web/src/views/Dashboards/addPanel/AddJoinPopUp.vue:614, :624, :646` | `var(--q-primary)` (3x) | `var(--o2-primary)` | Token (global) |
| `web/src/components/dashboards/PanelContainer.vue:1008` | `var(--q-warning)` | `var(--o2-warning)` | Token (global) |
| `web/src/components/dashboards/PanelErrorButtons.vue:148` | `var(--q-warning)` | `var(--o2-warning)` | Token (global) |
| `web/src/components/dashboards/settings/TabsSettings.vue:450, :457` | `var(--q-primary)`, `var(--q-secondary)` | `var(--o2-primary)`, `var(--o2-secondary)` | Token (global) |
| `web/src/components/dashboards/addPanel/SortByBtnGrp.vue:79` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/components/dashboards/addPanel/ShowLegendsPopup.vue:281` | `var(--q-background)` | `var(--o2-background)` | Token (global) |
| `web/src/components/dashboards/addPanel/DrilldownPopUp.vue:808` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue:345` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue:369, :391, :392` | `var(--q-primary)`, `rgba(var(--q-primary-rgb), 0.3)` | `var(--o2-primary)`, `rgba(var(--o2-primary-rgb), 0.3)` | Token (global) |
| `web/src/components/dashboards/viewPanel/ViewPanel.vue:914` | `var(--q-warning)` | `var(--o2-warning)` | Token (global) |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:1300, :1305` | `var(--q-warning)`, `var(--q-secondary)` | `var(--o2-warning)`, `var(--o2-secondary)` | Token (global) |

### 4. Dead `:deep(.q-*)` Selectors & `body.body--dark`

| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `web/src/views/Dashboards/ScheduledDashboards.vue:407` | `:deep(.q-table__top)` | Remove (OTable has no `q-table__top`) | File-level |
| `web/src/views/Dashboards/RenderDashboardCharts.vue:1752` | `:deep(.q-virtual-scroll__padding)` | Remove or retarget to OVirtualScroll/Tenstack | File-level |
| `web/src/views/Dashboards/ViewDashboard.vue:1952` | `:deep(.q-btn-dropdown)` | Remove — uses ODropdownMenu now | File-level |
| `web/src/views/Dashboards/ImportDashboard.vue:964, :980` | `:deep(.q-field--labeled.showLabelOnTop)`, `:deep(.q-field)` | Remove (OFormInput has different DOM) | File-level |
| `web/src/views/Dashboards/addPanel/AddCondition.vue:337, :367` | `:deep(.q-virtual-scroll__content)`, `:deep(.q-panel)` | Remove | File-level |
| `web/src/components/dashboards/AddDashboardFromGitHub.vue:600, :608, :612` | `.body--dark &`, `:deep(.q-field__control)`, `:deep(.q-field__native)` | Replace dark; remove field deep selectors | Component-level |
| `web/src/components/dashboards/AlertContextMenu.vue:184` | `body.body--dark { ... }` | Replace with `html.dark` | Component-level |
| `web/src/components/dashboards/settings/VariableCustomValueSelector.vue:76` | `:deep(.q-field__native)` | Remove | File-level |
| `web/src/components/dashboards/settings/VariableQueryValueSelector.vue:399` | `:deep(.q-field__native)` | Remove | File-level |
| `web/src/components/dashboards/panels/PromQLTableChart.vue:273, :274, :329, :330` | `:deep(.q-table__top)`, `:deep(.q-table__bottom)` (2 pairs) | Remove | File-level |
| `web/src/components/dashboards/panels/PromQLTableChart.vue:296` | `:deep(.q-virtual-scroll)` | Remove | File-level |
| `web/src/components/dashboards/panels/TableRenderer.vue:286, :378` | `.body--dark :deep(.pivot-total-row)`, `.body--dark .my-sticky-virtscroll-table` | Replace `body--dark` with `html.dark` | Component-level |
| `web/src/components/dashboards/addPanel/ColumnOrderPopUp.vue:273` | `.body--dark {...}` | Replace with `html.dark` | Component-level |
| `web/src/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue:803` | `:deep(.q-virtual-scroll__content)` | Remove | File-level |
| `web/src/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue:661` | `:deep(.q-virtual-scroll__content)` | Remove | File-level |
| `web/src/components/dashboards/addPanel/TablePaginationControls.vue:178-197` | `:deep(.q-field__inner/__control/__native/__append/__marginal/__label)`, `:deep(.q-select__dropdown-icon)` | Remove all (~7 selectors) — retarget to OSelect's actual classes | File-level |
| `web/src/components/dashboards/addPanel/TablePaginationControls.vue:162-163` | `.q-gutter-sm` (override) | Remove (no longer exists) | File-level |
| `web/src/components/dashboards/addPanel/ConfigPanel.vue:2665, :2672` | `:deep(.q-field__label)` (2x) | Remove | File-level |
| `web/src/components/dashboards/addPanel/DashboardGeoMapsQueryBuilder.vue:788` | `:deep(.q-virtual-scroll__content)` | Remove | File-level |
| `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue:1541` | `:deep(.q-virtual-scroll__content)` | Remove | File-level |
| `web/src/components/dashboards/addPanel/PromQLChartConfig.vue:943, :949` | `:deep(.q-field__label)`, `:deep(.q-field__native > :first-child)` | Remove | File-level |
| `web/src/components/dashboards/viewPanel/ViewPanel.vue:930` | `:deep(.q-btn-dropdown)` | Remove | File-level |
| `web/src/components/dashboards/addPanel/dynamicFunction/SelectFunction.vue:540, :547, :548` | `:deep(.q-field__control)`, `:deep(.q-field__control):before/:after` | Remove | File-level |
| +13 more `.q-*` deep selectors across addPanel files | — | — | — |

### 5. Quasar SCSS Variables (in `<style scoped>`)

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/views/Dashboards/ScheduledDashboards.vue:382` | `$dark-page` | `var(--o2-dark-page)` | File-level |
| `web/src/views/Dashboards/DashboardJsonEditor.vue:183` | `$dark-page` | `var(--o2-dark-page)` | File-level |
| `web/src/views/Dashboards/RenderDashboardCharts.vue:1643` | `$border-color` | `var(--o2-border-color)` | File-level |
| `web/src/views/Dashboards/ViewDashboard.vue:1896, :1995, :2006, :2019, :2020` | `$border-color` (5x) | `var(--o2-border-color)` | File-level |
| `web/src/views/Dashboards/ViewDashboard.vue:1902` | `$dark-page` | `var(--o2-dark-page)` | File-level |
| `web/src/views/Dashboards/ViewDashboard.vue:1906` | `$white` | `var(--o2-surface, #fff)` | File-level |
| `web/src/views/Dashboards/DashboardSettings.vue:148, :152, :188` | `$dark-page`, `$border-color` | `var(--o2-dark-page)`, `var(--o2-border-color)` | File-level |
| `web/src/views/Dashboards/PanelLayoutSettings.vue:144` | `$dark-page` | `var(--o2-dark-page)` | File-level |
| `web/src/views/Dashboards/addPanel/Group.vue:192` | `$grey-2` | `var(--o2-border-color)` | File-level |
| `web/src/components/dashboards/tabs/TabList.vue:159` | `$accent` | `var(--o2-accent)` | File-level |
| `web/src/components/dashboards/panels/PromQLTableChart.vue:333, :339` | `$dark-page` (2x) | `var(--o2-dark-page)` | File-level |

### 6. Quasar Directives

| File:Line | Directive | Action |
|-----------|-----------|--------|
| `web/src/views/Dashboards/ImportDashboard.vue:40` | `v-close-popup` | Remove; rely on explicit close handler |

### 7. Icon Migration

*(no `OIcon name="snake_case"` or `OIcon :color="..."` found — already migrated)*

### 8. Inline `style=` Hot Spots (to be promoted to scoped classes / shared partial)

| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `web/src/components/dashboards/PanelSchemaRenderer.vue:19, :25, :72, :76, :86, :90, :101` | `style="width: 100%; height: 100%; ..."` (7 instances) | File-level scoped `.panel-fill` |
| `web/src/components/dashboards/PanelSchemaRenderer.vue:151` | `style="height: 80%; width: 100%"` | `.panel-error-area` |
| `web/src/views/Dashboards/ViewDashboard.vue:108` | `style="padding-top: 5px"` | `.dashboard-header-pad` |
| `web/src/views/Dashboards/ViewDashboard.vue:133` | `style="padding-left: 0px; padding-right: 0px"` | Remove (use Tailwind `tw:px-0`) |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue:82, :616` | `style="height: 100%"`, `style="flex-shrink: 0"` | `tw:h-full`, `tw:shrink-0` (utility) |

### 9. Duplicate Style Blocks (candidate for component-level partial)

| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| DashboardJsonEditor.vue, ScheduledDashboards.vue, DashboardSettings.vue, PanelLayoutSettings.vue, VariableSettings.vue, DrilldownPopUp.vue, RawQueryBuilder.vue | `:class="store.state.theme === 'dark' ? 'dark-mode' : 'bg-white'"` (7+ files) | A `dashboard-surface-class.ts` composable that returns the right token-based class |
| TablePaginationControls.vue, ConfigPanel.vue, PromQLChartConfig.vue, dynamicFunction/SelectFunction.vue, VariableCustomValueSelector.vue, VariableQueryValueSelector.vue, AddDashboardFromGitHub.vue, ImportDashboard.vue | `:deep(.q-field__*)` blocks (~15 selectors) | None — delete entirely (DOM no longer matches) |
| AddSettingVariable.vue, VariableSettings.vue (2x), GeneralSettings.vue, TabsSettings.vue | `class="column full-height"` wrapper | `web/src/styles/forms/settings-pane.scss` `.settings-pane` partial |
| PromQLTableChart.vue, TableRenderer.vue, RenderDashboardCharts.vue | `.body--dark` + sticky-table CSS | `web/src/styles/dashboards/table-dark.scss` partial |

### 10. Layer Summary

- **Global (`app.scss`)** changes needed: ~7 (`--o2-primary`, `--o2-secondary`, `--o2-warning`, `--o2-dark-page`, `--o2-border-color`, `--o2-accent`, `--o2-background` aliases or confirmation of existing tokens; restore `--o2-primary-rgb` for shadow alpha)
- **Component-level partials** new/changed: 4 (`dashboard-surface-class.ts`, `settings-pane.scss`, `table-dark.scss`, theme-`body--dark`→`html.dark` mixin)
- **File-level scoped** changes: ~120 (deep selector removals, `bg-white`/`text-primary`/`column`/`col-auto`/`full-height` swaps across ~40 Vue files in `views/Dashboards/**` and `components/dashboards/**`)
