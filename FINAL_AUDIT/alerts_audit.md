# Alerts Page — Quasar Removal Audit

## Summary

The Alerts page has been refactored from Quasar Framework to OpenObserve's O* component library and Tailwind 4 (`tw:` prefix). The migration is **largely functional at the template level** (OTable, ODialog, OToggleGroup, OTabs/OTabPanel, OBadge, OInput etc.) but has left behind a substantial amount of broken or dead artifacts. Notable issues:

- A regression in `AlertHistory.vue` where an icon attribute (`name="block"`) was accidentally mass-replaced to `name="tw:block"`, breaking the deduplication "Suppressed" icon.
- ~30+ uses of the wrong Tailwind prefix (`tw-` instead of `tw:`) in `IncidentDetailDrawer.vue` and `IncidentServiceGraph.vue`, producing silently-broken layouts on the Logs/Metrics/Traces tabs of the incident drawer.
- Hundreds of `:deep(.q-field*)`, `:deep(.q-btn)`, `:deep(.q-tab*)`, `:deep(.q-toggle*)`, `:deep(.q-dialog__inner)`, `:deep(.q-drawer__*)` scoped selectors that target Quasar internals that no longer exist — error styling, input sizing, and toggle/tab visual states will silently fail.
- `v-close-popup` Quasar directives left on Cancel buttons in `AddDestination.vue`/`AddTemplate.vue`.
- Quasar SCSS variables (`$accent`, `$border-color`, `$white`) and CSS custom properties (`--q-primary`, `--q-card-background`, `--q-text-primary`, `--q-color-text-primary`, `--q-color-text-hint`, `--q-dark`) still referenced in 17 files.
- `document.querySelector('.q-dialog, .q-menu')` in `IncidentDetailDrawer.vue` and `AlertList.vue` will never match, so Escape-key and click-outside guards for nested dialogs/menus are broken.
- 50 spec files still rely on `installQuasar` from `@/test/unit/helpers/install-quasar-plugin` — the helper still exists, but its `plugins: []` parameter is no longer meaningful, and `AlertsDestinationList.spec.ts` directly imports `{ QTable } from "quasar"` (build/test failure surface).

## Files Audited

- `web/src/views/AppAlerts.vue`
- `web/src/views/AddAlertView.vue`
- `web/src/components/alerts/AddAlert.vue`
- `web/src/components/alerts/AlertList.vue`
- `web/src/components/alerts/AlertHistory.vue`
- `web/src/components/alerts/AlertHistoryDrawer.vue` (heavily modified in `1c38131b25`)
- `web/src/components/alerts/IncidentDetailDrawer.vue` (heavily modified in `1c38131b25`)
- `web/src/components/alerts/IncidentList.vue`
- `web/src/components/alerts/IncidentServiceGraph.vue`
- `web/src/components/alerts/IncidentRCAAnalysis.vue`
- `web/src/components/alerts/IncidentTimeline.vue`
- `web/src/components/alerts/IncidentAlertTriggersTable.vue`
- `web/src/components/alerts/IncidentTableOfContents.vue`
- `web/src/components/alerts/FilterCondition.vue`
- `web/src/components/alerts/FilterGroup.vue`
- `web/src/components/alerts/AddDestination.vue`
- `web/src/components/alerts/AddTemplate.vue`
- `web/src/components/alerts/PrebuiltDestinationForm.vue`
- `web/src/components/alerts/PrebuiltDestinationSelector.vue`
- `web/src/components/alerts/DestinationTestResult.vue`
- `web/src/components/alerts/TemplateList.vue`
- `web/src/components/alerts/AlertsDestinationList.vue`
- `web/src/components/alerts/PipelinesDestinationList.vue`
- `web/src/components/alerts/AlertInsights.vue`
- `web/src/components/alerts/TagInput.vue`
- `web/src/components/alerts/AlertSummary.vue`
- `web/src/components/alerts/ImportSemanticGroups.vue`
- `web/src/components/alerts/ImportSemanticGroupsDrawer.vue`
- `web/src/components/alerts/ImportAlert.vue`
- `web/src/components/alerts/ImportDestination.vue`
- `web/src/components/alerts/ImportTemplate.vue`
- `web/src/components/alerts/SemanticGroupItem.vue`
- `web/src/components/alerts/SemanticFieldGroupsConfig.vue`
- `web/src/components/alerts/QueryEditorDialog.vue`
- `web/src/components/alerts/steps/QueryConfig.vue`
- `web/src/components/alerts/steps/AlertSettings.vue`
- `web/src/components/alerts/steps/Advanced.vue`
- `web/src/components/alerts/steps/CompareWithPast.vue`
- `web/src/components/alerts/steps/Deduplication.vue`
- All `*.spec.ts` files for the above (50 files)

## Critical Issues

### 1. `AlertHistory.vue:190` — Broken icon name (mass-replace regression)
`<OIcon name="tw:block" size="sm" />` was supposed to be `<OIcon name="block" />` (Material Symbols "block" icon used to indicate a deduplication-suppressed history row). Compare with `main:web/src/components/alerts/AlertHistory.vue:231` which had `<q-icon name="block" size="sm" />`. A find/replace that prefixed Quasar utility classes with `tw:` swept this attribute value by mistake. Result: the dedup-suppressed row in Alert History will render no icon (or a "missing icon" glyph depending on the OIcon implementation).

**Solution:**
```diff
- <OIcon name="tw:block" size="sm" />
+ <OIcon name="block" size="sm" />
```
Confirmed `"block"` exists at `web/src/lib/core/Icon/OIcon.icons.ts:305`.

### 2. `IncidentDetailDrawer.vue` — Wrong Tailwind prefix (`tw-` instead of `tw:`)
30 occurrences inside the Logs/Metrics/Traces tab panels (lines 1005, 1012, 1032, 1053, 1055, 1057, 1061, 1081, 1098, 1100, 1101, 1111, 1113, 1117, 1137, and surrounding lines). With Tailwind 4 configured `prefix(tw)` in `web/src/styles/tailwind.css:1`, valid utility classes are `tw:flex`, `tw:flex-col`, etc. The `tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden` chains produce **no styling at all** — the column flexbox layout for the correlated Logs/Metrics/Traces tabs is broken, content will collapse instead of filling the drawer, and "Loading correlated metrics..." text on `IncidentDetailDrawer.vue:1057,1113` will be unstyled.

**Solution:**
```diff
- class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden"
+ class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden"
```
Run regex `\btw-([a-z])` → `tw:$1` across `IncidentDetailDrawer.vue` (covers all 30 occurrences).

### 3. `IncidentServiceGraph.vue` — Wrong Tailwind prefix (lines 53–69)
6 occurrences (`tw-flex`, `tw-items-center`, `tw-justify-center`, `tw-h-full`, `tw-bg-gray-900/50`, `tw-flex-col`, `tw-gap-3`, `tw-text-gray-600`, `tw-text-sm`, `tw-font-medium`, `tw-mt-1`, `tw-text-xs`). The "no service graph" empty state will not be centered.

**Solution:**
```diff
- class="tw-flex tw-items-center tw-justify-center tw-h-full tw-bg-gray-900/50 tw-flex-col tw-gap-3"
+ class="tw:flex tw:items-center tw:justify-center tw:h-full tw:bg-gray-900/50 tw:flex-col tw:gap-3"
```
Same regex `tw-` → `tw:` across `IncidentServiceGraph.vue` lines 53-69.

### 4. `IncidentDetailDrawer.vue:2051` — Broken Escape-key dialog guard
```ts
const hasOpenDialog = document.querySelector('.q-dialog, .q-menu');
if (hasOpenDialog) { return; }
close();
```
Since ODialog/ODropdown/OPopover do not produce `.q-dialog` or `.q-menu` elements, this branch never fires. Pressing Escape while a nested modal is open inside the incident drawer will close the drawer behind it, swallowing user input.

**Solution:**
```diff
- const hasOpenDialog = document.querySelector('.q-dialog, .q-menu');
+ const hasOpenDialog = document.querySelector(
+   '[data-o-dialog-open], [data-o-popover-open], [data-o-dropdown-open], [role="dialog"][data-state="open"], [role="menu"][data-state="open"]'
+ );
  if (hasOpenDialog) { return; }
```
O*/Reka-UI dialogs expose `data-state="open"` (and `role="dialog"`/`"menu"`) — match on those.

### 5. `AlertList.vue:891` — Broken click-outside drawer guard
```ts
if (
  target.classList.contains("q-drawer__backdrop") ||
  target.classList.contains("q-layout__shadow")
) { ... }
const drawerElement = document.querySelector(".alert-details-drawer .q-drawer__content");
```
The conditions and the `.q-drawer__content` query target Quasar-only DOM. After migration the drawer no longer produces those elements, so the backdrop/shadow detection is dead and the `drawerElement.contains(target)` fallback hits a `null` selector, meaning the drawer never closes via outside-click. (Subsequent `null && !drawerElement.contains` short-circuits to falsy.)

**Solution:**
```diff
- if (
-   target.classList.contains("q-drawer__backdrop") ||
-   target.classList.contains("q-layout__shadow")
- ) { close(); return; }
- const drawerElement = document.querySelector(".alert-details-drawer .q-drawer__content");
+ // ODrawer ships its own click-outside; rely on @interact-outside instead.
+ // In template: <ODrawer @interact-outside="close" />
+ // OR target the drawer body wrapper:
+ const drawerElement = document.querySelector('.alert-details-drawer [role="dialog"]');
+ if (drawerElement && !drawerElement.contains(target)) close();
```

### 6. `AddDestination.vue:484` and `AddTemplate.vue:121` — Stale `v-close-popup` directive
`v-close-popup="true"` (a Quasar directive) is left on the Cancel button. With Quasar removed, Vue should warn at runtime ("Failed to resolve directive: close-popup"). It does not break the page, but it is dead code that surfaces console warnings on every dialog open.

**Solution:**
```diff
- <OButton v-close-popup="true" @click="$emit('cancel:hideform')">Cancel</OButton>
+ <OButton @click="$emit('cancel:hideform')">Cancel</OButton>
```
The parent already listens for `cancel:hideform` to close the drawer.

### 7. `AlertsDestinationList.spec.ts:21` — Direct `quasar` import
```ts
import { QTable } from "quasar";
```
This will fail at test run after Quasar is dropped from `package.json` (and `1c38131b25` does drop it: `web/package.json | 3 -`). This spec will not compile.

**Solution:**
```diff
- import { QTable } from "quasar";
+ // OTable is globally registered for tests; remove the import.
```
Replace any `wrapper.findComponent(QTable)` with `wrapper.findComponent({ name: "OTable" })`.

## Logical Issues

### 1. `AddDestination.vue:936` — Destination URL existence check, no URL validation
`isValidDestination` (lines 936–946) only checks `formData.value.url` truthiness — there is no URL regex / `URL` constructor validation. The previous Quasar form had `:rules` that could include URL format validation; the new manual validation in `saveDestination` (lines 1080–1098) preserves only existence checks. A user can save a destination with `not-a-url` and the request will fail at the backend. Email validation has been preserved via regex (line 1090), but URL is not. This is a *regression vs. likely original `:rules`* — confirm against main if URL pattern validation existed.

**Solution:**
```ts
// In saveDestination(), after the existence check:
try {
  new URL(formData.value.url);
} catch {
  toast({ message: "Invalid URL", variant: "error" });
  return;
}
```
Or apply via OFormInput validator: `:validators="[v => /^https?:\/\//.test(v) || 'Invalid URL']"`.

### 2. `AppAlerts.vue:82–113` — Dead SCSS targeting deleted Quasar elements
After the template was reduced to `<div><RouterView/></div>`, the `<style scoped>` block still has `.q-table { ... }` and `.alerts-tabs .q-tabs--vertical { ... }` selectors that no longer apply to anything (lines 82–113). Uses `$border-color` and `$accent` SCSS variables that were Quasar-supplied. Compile-time error risk if `$accent` is no longer defined.

**Solution:** Delete the entire `<style scoped>` block (lines 82-113). Since the template is just `<div><RouterView/></div>`, no scoped styles are needed.

### 3. `IncidentDetailDrawer.vue:1012, 1061, 1117` — Mixed Quasar + Tailwind classes
```html
<div ... class="tw:w-full column flex-center tw:gap-2 tw:justify-center" ...>
```
`column` and `flex-center` were Quasar utility classes. With Quasar's `quasar.global.css` removed, these are no-ops. The "no correlated data" empty states will not center.

**Solution:**
```diff
- class="tw:w-full column flex-center tw:gap-2 tw:justify-center"
+ class="tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-2 tw:justify-center"
```

### 4. `AlertList.vue:2920` — Dead orphan CSS for `.all-folders-toggle` and `.alert-search-input`
The template was rewritten to use `<OSwitch>` and `<OInput>` without those class names (lines 66–89). The `:deep(.q-toggle__inner)`, `:deep(.q-field__control)`, `:deep(.q-field__prepend)`, etc. at lines 2904–2926 target nothing.

**Solution:** Delete the orphan SCSS blocks at lines 2904-2926. If specific size/color overrides are needed on OSwitch/OInput, use their `class` / `input-class` props or `--o2-*` token overrides.

### 5. `AddAlert.vue:605–681` — Dead `:deep(.q-field__*)` selectors
The `.alert-v3-field` and `.alert-v3-field.field-error` (lines 601–660) use 8 `:deep(.q-field__control|native|input|marginal|control-container|append)` selectors. With `OInput` not rendering Quasar internals, the entire compact 28px height topbar input styling and the red error border (`field-error` class) **do not apply**. Looking at template at line 83 (`:class="alertNameError ? 'field-error' : ''"`) the only visible error indicator for the alert-name input will be missing.

**Solution:**
```vue
<!-- Template (line 83): pass input-class so OInput propagates to its <input> -->
<OInput
  v-model="alertName"
  :input-class="['tw:h-7', alertNameError && 'tw:border-red-500']"
/>
```
Delete the `.alert-v3-field`/`.field-error` `:deep(.q-field__*)` blocks (601-681) and replace with the inline `:input-class` binding above.

### 6. `FilterCondition.vue:259` — `:has(.q-field--error)` selector
```scss
.condition-row:has(.q-field--error) { padding-bottom: 20px; }
```
`.q-field--error` does not exist on `OInput`/`OSelect`. Filter-condition row will not get the 20px bottom padding when errors are present, so the error message overlaps the next row.

**Solution:**
```diff
- .condition-row:has(.q-field--error) { padding-bottom: 20px; }
+ .condition-row:has([data-invalid="true"]) { padding-bottom: 20px; }
```
O*-input components apply `data-invalid="true"` (Reka-UI convention) when in error state.

### 7. `FilterGroup.vue:506–574` — ~70 lines of dead `q-tab*` styling
The template uses `<OToggleGroup>`/`<OToggleGroupItem>` (lines 31–47), but the `<style>` block still has `.q-tab`, `.q-tab__label`, `.q-tab--active`, `.q-tab--inactive`, `.q-tab__indicator`, plus `$border-color` and `$white` SCSS vars. None of this CSS applies.

**Solution:** Delete the entire `.q-tab*` SCSS block at lines 506-574. OToggleGroup ships its own selected/hover styles; if customisation is needed, override via `--o2-*` tokens or pass class props.

### 8. `AlertList.vue:2855–2897` — Dead `:deep(.rum-tab)` / `:deep(.rum-tabs)`
The "rum" tabs CSS targets a tab pattern that is no longer used (or never was after migration). Orphan.

**Solution:** Delete the `:deep(.rum-tab*)` blocks at lines 2855-2897.

### 9. `AlertHistory.vue:912–932` — Dead `:deep(.q-dialog__inner)` and invalid Tailwind class names in CSS
```scss
.alert-details-dialog { :deep(.q-dialog__inner) { padding: 24px; } ... }
.tw:bg-red-500-1 { background-color: rgba(255, 0, 0, 0.05); }
.tw:bg-green-500-1 { background-color: rgba(0, 128, 0, 0.05); }
```
`.q-dialog__inner` does not exist (drawer is no longer Quasar). The classes `.tw:bg-red-500-1` / `.tw:bg-green-500-1` were probably intended as `.bg-red-500/10`/`.bg-green-500/10` Tailwind opacity utilities; in CSS they need their colons escaped (`.tw\:bg-red-500-1`) and the `-1` suffix is meaningless. Nothing uses these rules.

**Solution:**
```diff
- .alert-details-dialog { :deep(.q-dialog__inner) { padding: 24px; } }
- .tw:bg-red-500-1 { background-color: rgba(255, 0, 0, 0.05); }
- .tw:bg-green-500-1 { background-color: rgba(0, 128, 0, 0.05); }
```
Delete all three rules. Use the Tailwind opacity utilities directly in the template:
```diff
- <div class="tw:bg-red-500-1">...</div>
+ <div class="tw:bg-red-500/10">...</div>
```

### 10. `AppAlerts.vue` — Loss of split-pane behavior
The original `AppAlerts.vue` rendered nested layout with a `q-splitter` model (`splitterModel = ref(160)`). In the new file, the `splitterModel` ref is still declared and returned (lines 45, 71) but never bound to anything, so it is dead state. Cleanup needed.

**Solution:**
```diff
- const splitterModel = ref(160);
- // ...
- return { splitterModel, ... };
+ // delete both the ref and its export
```

## CSS / Layout Issues

| File | Lines | Issue |
| --- | --- | --- |
| `AddAlert.vue` | 43, 46, 48, 54 | `class="q-table__title ..."` — `q-table__title` no longer styles anything; bold/size was supplied by Quasar. Replace with explicit Tailwind classes. |
| `AlertList.vue` | 35 | Same orphan `q-table__title` class. |
| `AlertHistory.vue` | 37 | Same orphan. |
| `AlertInsights.vue` | 35 | Same orphan. |
| `IncidentList.vue` | 23 | Same orphan. |
| `TemplateList.vue` | 23 | Same orphan. |
| `AlertsDestinationList.vue` | 26 | Same orphan. |
| `PipelinesDestinationList.vue` | 24 | Same orphan. |
| `AddDestination.vue` | 1296, 1302, 1305, 1306, 1354 | `var(--q-primary)` / `var(--q-text-primary)` — Quasar CSS vars; depending on whether `_quasar-variables.scss` still defines them (commit 1c38131b25 added 52 lines to that file) these may resolve, but they should be migrated to OpenObserve tokens (`--o2-*`). |
| `AlertSummary.vue` | 171–291 | Heavy use of `var(--q-primary)` (~30 occurrences). |
| `TagInput.vue` | 150, 153, 159, 201, 204 | `var(--q-primary)`, `var(--q-color-text-primary)`, `var(--q-color-text-hint)` — these are unlikely to exist; tag input focus highlight and placeholder color will fall back to inherited/default. |
| `DestinationTestResult.vue` | 379, 407, 437, 457, 502, 508 | `var(--q-text-secondary)` — same risk. |
| `SemanticGroupItem.vue` | 231 | `var(--q-color-text-secondary)`. |
| `PrebuiltDestinationSelector.vue` | 219, 226 | `var(--q-text-primary)`, `var(--q-text-secondary)`. |
| `QueryEditorDialog.vue`, `Advanced.vue`, `AlertSettings.vue`, `CompareWithPast.vue`, `Deduplication.vue`, `QueryConfig.vue`, `ImportSemanticGroups.vue`, `ImportSemanticGroupsDrawer.vue` | various | Additional `var(--q-*)` uses; grep `web/src/components/alerts -rn "var(--q-"` returns 96 occurrences across 16 files. |
| `ImportSemanticGroupsDrawer.vue` | 587 | `background: var(--q-dark);` |
| `AddTemplate.vue` | 118 | `tw:bg-[var(--q-card-background)]` — arbitrary-value Tailwind class will inline this var; same problem if undefined. |
| `IncidentDetailDrawer.vue` | 1012, 1061, 1117 | `column flex-center` Quasar layout classes. |
| `Deduplication.vue` | 310, 331, 350 | `.q-chip { ... }` SCSS selectors for components that are now OBadge/OChip. |
| `PrebuiltDestinationForm.vue` | 354 | `.q-banner pre { ... }`. |
| `FilterGroup.vue` | 506–574 | All `.q-tab*` selectors. |
| `AlertList.vue` | 2905–2926 | `:deep(.q-field__control|prepend|append)`, `:deep(.q-toggle__inner|label)` orphans. |
| `AlertHistory.vue` | 913 | `:deep(.q-dialog__inner)` orphan. |
| `AlertHistory.vue` | 926, 930 | Invalid CSS class names `.tw:bg-red-500-1`, `.tw:bg-green-500-1`. |
| `AddAlert.vue` | 605–680 | 12 `:deep(.q-field__*)` and 1 `:deep(.q-btn)` orphans; topbar 28px field height and error-border styling broken. |
| `AlertSettings.vue` | 1081–1135 | 6 `:deep(.q-field__control)` orphans (counted via grep). |
| `QueryConfig.vue` | 2628 | `:deep(.q-field__control)` orphan. |
| `IncidentTimeline.vue` | 658 | `:deep(.q-field__control)` orphan. |
| `ImportSemanticGroups.vue` | 599 | `:deep(.q-field__control)` orphan. |
| `FilterCondition.vue` | 259 | `:has(.q-field--error)` — selector targets nothing. |

**Solutions for the CSS / Layout Issues table:**

```diff
// q-table__title orphans (8 files: AddAlert/AlertList/AlertHistory/AlertInsights/IncidentList/TemplateList/AlertsDestinationList/PipelinesDestinationList)
- class="q-table__title ..."
+ class="tw:text-lg tw:font-semibold ..."

// var(--q-*) tokens (96 occurrences across 16 files)
- var(--q-primary)             → var(--o2-primary)
- var(--q-text-primary)        → var(--o2-text-primary)
- var(--q-color-text-primary)  → var(--o2-text-primary)
- var(--q-color-text-hint)     → var(--o2-text-muted)
- var(--q-text-secondary)      → var(--o2-text-secondary)
- var(--q-color-text-secondary)→ var(--o2-text-secondary)
- var(--q-dark)                → var(--o2-bg-base)
- var(--q-card-background)     → var(--o2-bg-card)

// IncidentDetailDrawer.vue:1012, 1061, 1117 — Quasar layout classes
- class="tw:w-full column flex-center tw:gap-2 tw:justify-center"
+ class="tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-2 tw:justify-center"

// Deduplication.vue:310/331/350 .q-chip → OBadge selector
- .q-chip { ... }
+ :deep(.o-badge__root) { ... }   // (or use OBadge :class prop)

// PrebuiltDestinationForm.vue:354 .q-banner pre
- .q-banner pre { ... }
+ :deep(.o-banner__content pre) { ... }

// FilterGroup.vue:506-574 .q-tab* — delete entire block, OToggleGroup ships its own styles

// AlertList.vue:2905-2926 :deep(.q-field__*|q-toggle__*) — delete; use OSwitch/OInput class props instead

// AlertHistory.vue:913, 926, 930
- :deep(.q-dialog__inner) { padding: 24px; }
- .tw:bg-red-500-1 { ... }
- .tw:bg-green-500-1 { ... }
+ // Delete all three; replace template usage with tw:bg-red-500/10 / tw:bg-green-500/10

// AddAlert.vue:605-680 12 :deep(.q-field__*) + 1 :deep(.q-btn)
- :deep(.q-field__control), :deep(.q-field__native), ... { height: 28px; ... }
+ // Pass <OInput :input-class="['tw:h-7']" /> in template, then delete the SCSS block

// AlertSettings.vue:1081-1135, QueryConfig.vue:2628, IncidentTimeline.vue:658,
// ImportSemanticGroups.vue:599 — :deep(.q-field__control) orphans → delete

// FilterCondition.vue:259
- .condition-row:has(.q-field--error) { padding-bottom: 20px; }
+ .condition-row:has([data-invalid="true"]) { padding-bottom: 20px; }
```

## Component Migration Issues

### 1. Stale templates still using `q-icon`/`q-input` in main file diff
Per the diff output of `AlertList.vue`, the new code uses `<OIcon name="format-list-bulleted" />` / `<OInput v-model="dynamicQueryModel" />`, but inspection of the current branch shows complete migration. However, no validation rules were re-implemented for the search input. Note: previous `q-input` had `borderless dense`; `OInput` defaults need verification.

**Solution:**
```diff
- <OInput v-model="dynamicQueryModel" />
+ <OInput v-model="dynamicQueryModel" dense :input-class="['tw:border-0','tw:shadow-none']" />
```
OInput supports `dense`; mimic `borderless` via `input-class`.

### 2. `AddAlert.vue:18` — Margin and width sizing
`<div class="tw:w-full tw:mx-4 tw:pt-1">` uses `mx-4` (horizontal margin) on a `w-full` block — this gives a width overflow of 32px on smaller viewports. Original Quasar used `q-pa-none` and CSS-side `padding`. Layout shift risk on narrow screens.

**Solution:**
```diff
- <div class="tw:w-full tw:mx-4 tw:pt-1">
+ <div class="tw:w-full tw:px-4 tw:pt-1">
```
Use horizontal padding instead of margin so the element doesn't overflow its parent's width.

### 3. `IncidentList.vue:53` — Ref name `qTableRef` is a misnomer
The ref now points to `OTable`, not Quasar's `QTable`. Code in `IncidentList.vue:207, 551` returns it. Not broken, but reading the code suggests legacy Quasar API and is confusing.

**Solution:**
```diff
- const qTableRef = ref(null);
+ const tableRef = ref(null);
```
Rename across all 3 sites (`:53, :207, :551`) and the template `ref="qTableRef"`.

### 4. `IncidentDetailDrawer.vue:1015, 1064, 1120` — `:color` prop on OIcon
```html
<OIcon :name="..." :color="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'negative') : 'grey-5'" .../>
```
`'warning'`, `'negative'`, `'grey-5'` are Quasar color tokens. Need to verify OIcon's color prop accepts these; if it expects raw CSS color or O2 tokens (`--o2-color-warning`), the icon color will not render correctly.

**Solution:**
```diff
- :color="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'negative') : 'grey-5'"
+ :class="correlationError ? (correlationError.includes('disambiguation fields') ? 'tw:text-[var(--o2-warning)]' : 'tw:text-[var(--o2-negative)]') : 'tw:text-gray-500'"
```
Drop the `:color` prop; use Tailwind `tw:text-*` classes mapped to O2 tokens.

### 5. `AlertList.vue:1503` — `searchAcrossFolders.value = false`
Side effect: when changing folders, the "all folders" toggle is force-reset. This works, but the new `OSwitch` does not document a two-way `v-model` reactivity guarantee on programmatic resets — needs verification.

**Solution:** OSwitch uses Reka-UI Switch primitive which honors `v-model:checked` two-way bindings; the existing `searchAcrossFolders.value = false` works. Verify with:
```ts
// quick check inside unit test
await wrapper.setProps({ ... });
searchAcrossFolders.value = false;
await nextTick();
expect(wrapper.findComponent({ name: "OSwitch" }).props("modelValue")).toBe(false);
```

### 6. `AddAlert.vue:196, 254, 298, 305` — Tab panels via `v-show` instead of `<OTabPanels>/<OTabPanel>`
```html
<div v-show="activeTab === 'condition'" ...>
<div v-show="activeTab === 'advanced'" ...>
<div v-show="activeTab === 'anomaly-config'" ...>
<div v-show="activeTab === 'anomaly-alerting'" ...>
```
This is inconsistent with `AlertHistoryDrawer.vue` (which uses `<OTabPanels>/<OTabPanel>`) and `IncidentDetailDrawer.vue` (which uses `<OTabs>`). Not necessarily broken, but it means children of inactive tabs are mounted, which negates the savings of conditional rendering and may cause unwanted side effects (timers, watchers).

**Solution:**
```vue
<OTabPanels v-model="activeTab">
  <OTabPanel name="condition"><!-- ... --></OTabPanel>
  <OTabPanel name="advanced"><!-- ... --></OTabPanel>
  <OTabPanel name="anomaly-config"><!-- ... --></OTabPanel>
  <OTabPanel name="anomaly-alerting"><!-- ... --></OTabPanel>
</OTabPanels>
```
OTabPanel default-unmounts inactive children, avoiding stray timers/watchers.

### 7. `IncidentDetailDrawer.vue:1008, 1056, 1112` — `<OSpinner size="lg">` inside flex columns
These spinner blocks live inside containers with broken `tw-flex tw-flex-col` (point 2 in Critical). With layout broken, the spinner may not be vertically centered.

**Solution:** Fix the parent class (see Critical #2: `tw-` → `tw:`). Once `tw:flex tw:flex-col tw:items-center tw:justify-center` is correct, the spinner centers automatically.

## Test File Issues

### 1. `AlertsDestinationList.spec.ts:21` — Hard dependency on Quasar package
```ts
import { QTable } from "quasar";
```
Will fail import once `quasar` package is removed.

**Solution:**
```diff
- import { QTable } from "quasar";
+ // Remove — OTable is auto-registered for tests.
- wrapper.findComponent(QTable)
+ wrapper.findComponent({ name: "OTable" })
```

### 2. Spec files calling `useQuasar()` mock from `quasar`
- `ImportDestination.spec.ts:109–110` — `const { useQuasar } = await import('quasar');`
- `ImportTemplate.spec.ts:110–111` — same.
- `AlertsDestinationList.spec.ts:31` — defines local mock for `useQuasar`.
- `PipelinesDestinationList.spec.ts:32`, `ImportAlert.spec.ts:29`, `ImportDestination.spec.ts:34`, `ImportTemplate.spec.ts:46` — all `useQuasar: vi.fn(...)` mocks.

If `vi.mock('quasar', ...)` is set up, these will still resolve. If `quasar` is removed from `node_modules`, the dynamic `await import('quasar')` in `ImportDestination.spec.ts:109` and `ImportTemplate.spec.ts:110` will throw at runtime.

**Solution:**
```diff
- const { useQuasar } = await import('quasar');
- const $q = useQuasar();
- expect($q.notify).toHaveBeenCalled();
+ // Component now uses toast() from @/composables/useToast
+ const toast = vi.fn();
+ vi.mock("@/composables/useToast", () => ({ useToast: () => ({ toast }) }));
+ expect(toast).toHaveBeenCalled();
```
Apply to all 7 listed spec files.

### 3. All 50 spec files still call `installQuasar(...)`
Listed in the grep output above. The helper file at `web/src/test/unit/helpers/install-quasar-plugin.ts` still exists, but if its body has been gutted (likely as part of the Quasar removal), these specs may run but with no Quasar functionality. Should be reviewed and possibly removed/replaced with O*-component setup helpers.

**Solution:** `installQuasar` is now a no-op shim. Drop the call from each spec entirely (or leave as a temporary smoke since the helper is harmless):
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar({ plugins: [] });
+ // Helper is a no-op since Quasar removal — delete or keep as transitional.
```

### 4. Spec files reference old `q-input`/`q-dialog` selectors
- `AddAlert.spec.ts:2871–2872` — comments refer to the `q-dialog -> ODrawer` migration but the spec assertions may still target `.q-dialog`.
- `QueryEditorDialog.spec.ts:538, 541, 542` — explicitly asserts `w.find(".q-dialog").exists()).toBe(false)` (this one is correct — confirms migration).
- `AlertHistoryDrawer.spec.ts:184` — comment about Quasar teleported components throwing during unmount in jsdom; if jsdom no longer sees those components, the workaround may now be unnecessary.

## Validation Issues

### 1. Destination URL validation regression
`AddDestination.vue:936–946, 1080–1098` validates that URL is non-empty but **does not validate URL format**. Previously, Quasar `:rules` may have included a URL regex (need to confirm against main; the prevalent Quasar pattern is `[(v) => !!v || 'required', (v) => /^https?:\/\//.test(v) || 'invalid URL']`). Email validation regex at line 1090 was preserved, but URL was not.

### 2. Filter condition validation
`FilterCondition.vue:173–189` correctly preserves per-field validation via `validateColumn`, `validateOperator`, `validateValue` and `defineExpose({ validate })`. This is a clean migration from `:rules`. ✓

### 3. Alert name validation
`AddAlert.vue:83` uses `:class="alertNameError ? 'field-error' : ''"`. The `.field-error` class targets `:deep(.q-field__control)` (line 650) which **doesn't exist** post-migration. So when the alert name is empty and the user attempts save, the red border highlight will not appear. Recommend changing to a Tailwind class on OInput directly (`tw:border-red-500`).

### 4. Form-level validation
`AddAlert.vue` no longer wraps inputs in a `<q-form ref="formRef">`. Previously a single `formRef.value.validate()` ran all rules. The migration must rely on each O-component exposing its own `validate()`. Spot-check shows `FilterCondition.vue` correctly exposes `validate`, but a full audit of `AddDestination.vue`, `AddTemplate.vue`, `AlertSettings.vue`, `Deduplication.vue`, `Advanced.vue`, `QueryConfig.vue` etc. is recommended to confirm all required-field validation paths still run.

## Accessibility / Other

1. `AlertList.vue:35` and similar elements use `<div>` for headings instead of `<h1>`/`<h2>`. The class `tw:font-[600]` provides bold weight but no semantic. (Pre-existing in main; not a migration regression.)
2. `AddAlert.vue:75` — `<span class="tw:text-red-500">*</span>` for required indicator is not accessible (no `aria-label="required"`). Pre-existing.
3. `IncidentDetailDrawer.vue:1015, 1064, 1120` — Color tokens `'warning'`, `'negative'`, `'grey-5'` may render as transparent if not recognized; users may see no icon at all in error states.
4. ESC key handler in IncidentDetailDrawer fires before checking nested OPopover/ODropdown menus (broken `.q-menu` selector — see Critical #4). User loses inner-popover dismissal flow.

## Recommendations

### Must fix (P0)
1. `AlertHistory.vue:190` — change `name="tw:block"` to `name="block"`.
2. `IncidentDetailDrawer.vue` lines 1005, 1012, 1032, 1053, 1055, 1057, 1061, 1081, 1098, 1100, 1101, 1111, 1113, 1117, 1137 — replace every `tw-…` Tailwind class with `tw:…`. Same for `IncidentServiceGraph.vue` lines 53, 54, 62, 64, 66, 69.
3. `IncidentDetailDrawer.vue:2051` — replace `'.q-dialog, .q-menu'` with the O-equivalent open-dialog/menu detection (likely a Pinia/Vuex state flag, a focus trap stack, or matching against `[data-o-dialog-open], [data-o-menu-open]` if these data attributes exist on O* components).
4. `AlertList.vue:891–905` — re-implement click-outside guard for the alert details drawer using the new ODrawer's API.
5. `AlertsDestinationList.spec.ts:21` — remove the `import { QTable } from "quasar"` line.
6. `AddDestination.vue:484`, `AddTemplate.vue:121` — remove `v-close-popup` directives; rely on the explicit `@click="$emit('cancel:hideform')"`.

### Should fix (P1)
1. Replace all `var(--q-*)` references with `--o2-*` design tokens (16 files, ~96 occurrences). Inventory the `_quasar-variables.scss` shim and decide whether to keep it as a compatibility bridge or migrate fully.
2. Replace all dead `:deep(.q-*)` SCSS selectors. Many can be replaced by passing class props (`input-class`, `field-class`) to the O-components, or by relying on the design system rather than overriding.
3. Replace `class="q-table__title ..."` orphans with semantic Tailwind classes (`tw:text-lg tw:font-semibold`) on all 8 list/insights/history/destination components.
4. `AddAlert.vue:18` — drop `tw:mx-4` or change to padding to avoid w-full overflow.
5. Add URL pattern validation in `AddDestination.vue` save handler — mirror the email validation logic.
6. `AddAlert.vue:605–680` — re-implement the 28px compact input style and the error-border using OInput-supported props/classes, not `:deep(.q-field__*)`.
7. Replace `<OIcon :color="'warning'|'negative'|'grey-5'">` with O2 tokens or hex values.

### Nice to have (P2)
1. Migrate the 4 `v-show` tab panels in `AddAlert.vue` to a consistent `<OTabPanels>/<OTabPanel>` pattern.
2. Audit and remove dead orphan CSS blocks: `.alert-search-input`, `.all-folders-toggle`, `:deep(.rum-tab*)` in `AlertList.vue`; `.q-tab*` block in `FilterGroup.vue`; `.q-table`/`.q-tabs--vertical` in `AppAlerts.vue`; `.q-chip` blocks in `Deduplication.vue`; `.q-banner pre` in `PrebuiltDestinationForm.vue`; `.q-dialog__inner` block in `AlertHistory.vue`.
3. Rename `qTableRef` → `tableRef` in `IncidentList.vue`.
4. Remove dead `splitterModel` ref in `AppAlerts.vue`.
5. Audit `install-quasar-plugin.ts` helper. If Quasar is fully gone, this should be renamed to `install-test-plugins.ts` and contain only the actually-needed test setup (Pinia/Vuex/i18n/router).

## Class-Level Styling Audit

### 1. Quasar Class Leftovers (silent no-ops)

| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `web/src/components/alerts/AlertList.vue:402` | `tw:flex column tw:justify-center` | `tw:flex tw:flex-col tw:justify-center` | File-level |
| `web/src/components/alerts/AlertsDestinationList.vue:89` | `tw:flex column tw:justify-center` | `tw:flex tw:flex-col tw:justify-center` | File-level |
| `web/src/components/alerts/IncidentDetailDrawer.vue:1012, :1061, :1117` | `column flex-center` | `tw:flex tw:flex-col tw:items-center tw:justify-center` | File-level |
| `web/src/components/alerts/ImportSemanticGroups.vue:99` | `float-right` | `tw:float-right` (or `tw:ml-auto`) | File-level |
| `web/src/components/alerts/ImportSemanticGroupsDrawer.vue:56, :62, :68, :229, :238` | `col-auto` (5 instances) | `tw:flex-none` | File-level |
| `web/src/components/alerts/ImportSemanticGroups.vue:81, :87, :93` | `col-auto` (3 instances) | `tw:flex-none` | File-level |
| `web/src/components/alerts/AlertHistoryDrawer.vue:115` | `col-auto` | `tw:flex-none` | File-level |
| `web/src/components/alerts/FilterCondition.vue:2` | `tw:flex-no-wrap` (invalid v4 form) | `tw:flex-nowrap` | File-level |
| `web/src/components/alerts/ImportDestination.vue:275` | `section-title text-primary` | `section-title tw:text-[var(--o2-primary)]` | File-level |
| `web/src/components/alerts/ImportTemplate.vue:163` | `section-title text-primary` | `section-title tw:text-[var(--o2-primary)]` | File-level |
| `web/src/components/alerts/ImportAlert.vue:267` | `section-title text-primary` | `section-title tw:text-[var(--o2-primary)]` | File-level |
| `web/src/components/alerts/AlertHistory.vue:200` | `text-primary tw:flex ...` | `tw:text-[var(--o2-primary)] tw:flex ...` | File-level |
| `web/src/components/alerts/AlertHistory.vue:37` | `q-table__title tw:font-[600] tw:ml-2` | Drop `q-table__title` | File-level |
| `web/src/components/alerts/AlertList.vue:35` | `q-table__title tw:font-[600]` | `tw:font-[600]` | File-level |
| `web/src/components/alerts/AlertInsights.vue:35` | `q-table__title tw:font-[600] tw:ml-2` | `tw:font-[600] tw:ml-2` | File-level |
| `web/src/components/alerts/AddAlert.vue:43, :46, :48, :54` | `q-table__title ...` (4 instances) | Remove `q-table__title` token | File-level |
| `web/src/components/alerts/steps/AlertSettings.vue:83, :136, :196, :254, :317` | `text-red-8 tw:pt-1` (Quasar palette step) | `tw:text-red-700 tw:pt-1` | File-level |
| `web/src/components/alerts/DeduplicationConfig.vue:59, :99` | `input-box-bg-dark`, `input-box-bg-light` (custom; verify in app.scss) | If app-defined keep; else replace | File-level |

### 2. Tailwind v4 Misuse

| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `web/src/components/alerts/IncidentServiceGraph.vue:53, :54, :62, :64, :66, :69` | `tw-flex`, `tw-bg-gray-900/50`, `tw-text-gray-600`, `tw-justify-center`, etc. (~10 `tw-` occurrences) | Convert `tw-` to `tw:` | File-level |
| `web/src/components/alerts/IncidentDetailDrawer.vue:1005, :1032, :1053-:1137` | `tw-flex`, `tw-flex-col`, `tw-overflow-hidden`, `tw-text-base`, `tw-px-4`, `tw-py-2`, `tw-border-b`, `tw-border-solid`, `tw-flex-1`, `tw-h-full`, `tw-text-xs`, `tw-text-gray-500` (mixed `tw-` and `tw:` even on same elements; ~30 `tw-` occurrences) | Convert all `tw-` to `tw:` | File-level |
| `web/src/components/alerts/OrganizationDeduplicationSettings.vue:79, :116, :136` | `dark:tw:text-gray-400`, `dark:tw:border-gray-700` | `tw:dark:text-gray-400`, `tw:dark:border-gray-700` | File-level |
| `web/src/components/alerts/DeduplicationConfig.vue:52, :90` | `dark:tw:text-gray-400` | `tw:dark:text-gray-400` | File-level |
| `web/src/components/alerts/ImportSemanticGroupsDrawer.vue:112, :155` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/alerts/ImportSemanticGroups.vue:135, :177` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/alerts/FilterCondition.vue:228, :233` | `xl:tw:min-w-[200px]`, `lg:tw:min-w-[90px]`, `lg:tw:w-fit`, `lg:tw:min-w-[80px]` (~6) | `tw:xl:min-w-[200px]`, `tw:lg:min-w-[90px]`, etc. | File-level |
| `web/src/components/alerts/AlertHistorySummary.vue:64` | `dark:tw:text-gray-400` | `tw:dark:text-gray-400` | File-level |
| `web/src/components/alerts/IncidentTableOfContents.vue:73, :74, :119, :120, :147, :148` | `hover:tw:text-blue-400`, `hover:tw:bg-gray-700`, etc. (~6) | `tw:hover:text-blue-400`, ... | File-level |
| `web/src/components/alerts/IncidentDetailDrawer.vue:457, :498, :522, :546, :2749` | `dark:tw:border-gray-700`, `hover:tw:opacity-100`, `hover:tw:text-blue-500`, `hover:tw:bg-gray-50` (~10) | `tw:dark:border-gray-700`, `tw:hover:opacity-100`, ... | File-level |
| `web/src/components/alerts/QueryEditorDialog.vue:29` | `hover:tw:opacity-100` | `tw:hover:opacity-100` | File-level |
| `web/src/components/alerts/SemanticFieldGroupsConfig.vue:42` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-level |
| `web/src/components/alerts/IncidentTimeline.vue:226` | `hover:tw:shadow-md` | `tw:hover:shadow-md` | File-level |
| `web/src/components/alerts/steps/QueryConfig.vue:174, :327, :435, :436` | `hover:tw:text-red-500`, `hover:tw:bg-gray-600/70`, `hover:tw:bg-gray-200` | `tw:hover:text-red-500`, ... | File-level |
| +13 more `dark:tw:` / `hover:tw:` / `xl:tw:` / `lg:tw:` occurrences (33 total) |

### 3. Quasar CSS Variables (var(--q-*))

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/components/alerts/AddDestination.vue:1296, :1302, :1305, :1306` | `var(--q-primary)` (with color-mix usage) | `var(--o2-primary)` | Token (global) |
| `web/src/components/alerts/AddDestination.vue:1354` | `var(--q-text-primary)` | `var(--o2-text-primary)` | Token (global) |
| `web/src/components/alerts/AlertInsights.vue:791, :828` | `var(--q-border-color)` | `var(--o2-border-color)` | Token (global) |
| `web/src/components/alerts/AddAlert.vue:704` | `var(--q-primary)` | `var(--o2-primary)` | Token (global) |
| `web/src/components/alerts/ImportSemanticGroupsDrawer.vue:587` | `var(--q-dark)` | `var(--o2-dark)` | Token (global) |
| `web/src/components/alerts/ImportSemanticGroups.vue:623, :627, :632, :656, :664, :668` | `var(--q-dark-page)`, `var(--q-primary)`, `var(--q-primary-dark)`, `var(--q-dark)` (6 occurrences) | `var(--o2-*)` | Token (global) |
| `web/src/components/alerts/AlertSummary.vue:171-268` | `var(--q-primary)` (~15 occurrences w/ color-mix and border-left) | `var(--o2-primary)` | Token (global) |
| +60 more `var(--q-*)` across `IncidentDetailDrawer.vue`, `AlertHistoryDrawer.vue`, `AlertList.vue`, `AddDestination.vue` (96 total in alerts scope) | — | — | — |

### 4. Dead `:deep(.q-*)` Selectors & `body.body--dark`

| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `web/src/components/alerts/AlertHistory.vue:913` | `:deep(.q-dialog__inner)` | Remove (ODialog renders different DOM) | File-level |
| `web/src/components/alerts/AlertList.vue:2776` | `::v-deep .app-tabs` | Update to `:deep(.app-tabs)` (Vue 3 syntax) | File-level |
| `web/src/components/alerts/AlertList.vue:2905, :2909, :2914, :2921, :2924` | `:deep(.q-field__control/__prepend/__append)`, `:deep(.q-toggle__inner/__label)` | Remove all | File-level |
| `web/src/components/alerts/AddAlert.vue:597` | `.body--dark .alert-v3-inline-label` | `html.dark .alert-v3-inline-label` | Component-level |
| `web/src/components/alerts/AddAlert.vue:605, :613, :620, :627, :631, :635` | `:deep(.q-field__control/__native/__input/__marginal/__control-container/__append)` (6 selectors) | Remove all | File-level |
| `web/src/components/alerts/AddAlert.vue:641, :650, :655, :656, :674, :694, :793, :997, :999` | `body.body--dark .alert-v3-field { :deep(.q-field__control) }`, `:deep(.q-btn)`, plus `.body--dark .section-header`, `.body--dark .query-mode-tabs` (~9 selectors) | Remove `:deep(.q-*)`; replace `body--dark` → `html.dark` | Component-level |
| `web/src/components/alerts/AddAlert.vue:717-850` | Bare `.q-field__*` selectors (~16 outside `:deep`) | Remove all | File-level |
| `web/src/components/alerts/AlertSummary.vue:272, :289` | `body.body--dark &` (2x) | `html.dark &` | File-level |
| `web/src/components/alerts/IncidentList.vue:627, :666, :688` | `body.body--dark` (3 blocks) | `html.dark` | Component-level |
| `web/src/components/alerts/ImportSemanticGroups.vue:599` | `:deep(.q-field__control)` | Remove | File-level |
| `web/src/components/alerts/DestinationTestResult.vue:515` | `body.body--dark` | `html.dark` | Component-level |
| `web/src/components/alerts/IncidentDetailDrawer.vue:2957, :3007, :3016, :3047, :3048, :3071` | `body.body--dark` rules (6 blocks) | Replace `body--dark` with `html.dark` | Component-level |
| `web/src/components/alerts/IncidentServiceGraph.vue:496, :505` | `.body--dark .incident-service-graph`, `:hover` | `html.dark .incident-service-graph` | Component-level |
| `web/src/components/alerts/PrebuiltDestinationForm.vue:350, :354` | `.q-field`, `.q-banner pre` | Remove both | File-level |
| `web/src/components/alerts/AddDestination.vue:1263, :1268` | `.q-field__native > :first-child`, `.no-case .q-field__native span` | Remove both | File-level |
| `web/src/components/alerts/AlertList.vue:891-900` | `target.classList.contains("q-drawer__backdrop")`, `"q-layout__shadow"`, `.q-drawer__content` (3 JS class lookups) | Replace with O*-equivalent classes/refs | File-level (script) |
| `web/src/components/alerts/IncidentDetailDrawer.vue:2051` | `document.querySelector('.q-dialog, .q-menu')` (broken — won't match) | Use OUI dialog/menu refs or new classes | File-level (script) |

### 5. Quasar SCSS Variables (in `<style scoped>`)

| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `web/src/components/alerts/AlertList.vue:2852` | `$dark-page` | `var(--o2-dark-page)` | File-level |
| `web/src/components/alerts/FilterGroup.vue:549` | `$border-color` | `var(--o2-border-color)` | File-level |
| `web/src/components/alerts/FilterGroup.vue:553` | `$white` | `var(--o2-surface, #fff)` | File-level |

### 6. Quasar Directives

| File:Line | Directive | Action |
|-----------|-----------|--------|
| `web/src/components/alerts/AddDestination.vue:484` | `v-close-popup="true"` | Remove; use `@click="open=false"` |
| `web/src/components/alerts/AddTemplate.vue:121` | `v-close-popup` | Remove; use explicit close handler |

### 7. Icon Migration

| File:Line | Issue | Fix |
|-----------|-------|-----|
| `web/src/components/alerts/AlertHistory.vue:190` | `OIcon name="tw:block"` (mass-replace regression) | `OIcon name="block"` |
| `web/src/components/alerts/AddAlert.vue:348` | `OIcon :color="...'positive' : 'grey-5'"` (unsupported prop) | Wrap in `<span class="tw:text-...">` |

### 8. Inline `style=` Hot Spots (to be promoted to scoped classes / shared partial)

| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `web/src/components/alerts/AlertWizardRightColumn.vue:19` | `style="height: calc(100vh - 302px); position: sticky; top: 0;"` | File-level scoped `.alert-wizard-rightcol-sticky` |
| `web/src/components/alerts/IncidentDetailDrawer.vue:1012, :1061, :1117` | `style="margin: 15vh auto 2rem;"` (repeats) | File-level scoped `.incident-empty-state` |
| `web/src/components/alerts/IncidentServiceGraph.vue:64` | `style="width: 48px; height: 48px;"` | Replace with `tw:w-12 tw:h-12` |

### 9. Duplicate Style Blocks (candidate for component-level partial)

| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| AddAlert.vue (top), AlertList.vue, AlertHistory.vue, AlertInsights.vue | `q-table__title` class on header `span` | Drop the class — replace with `.list-header-title` partial or pure `tw:` utilities |
| OrganizationDeduplicationSettings.vue, DeduplicationConfig.vue, AlertHistorySummary.vue | `dark:tw:text-gray-400` (wrong-order; 5 occurrences) | Fix to `tw:dark:text-gray-400`; single shared `.muted-text-dark` mixin |
| IncidentList.vue, IncidentDetailDrawer.vue, IncidentServiceGraph.vue, AddAlert.vue, AlertSummary.vue, DestinationTestResult.vue | `body.body--dark` rules (~17 blocks) | `web/src/styles/themes/incident-dark.scss` partial using `html.dark` |
| AddAlert.vue:597-1000 | `.alert-v3-*` blocks with `:deep(.q-field__*)` (~16 rules) | None — delete entirely; rebuild compact-form against OInput slots |

### 10. Layer Summary

- **Global (`app.scss`)** changes needed: ~6 (introduce `--o2-primary-rgb` for color-mix; ensure `--o2-dark`, `--o2-dark-page`, `--o2-primary-dark`, `--o2-border-color`, `--o2-text-primary`; `html.dark` parity with `body--dark`)
- **Component-level partials** new/changed: 3 (`incident-dark.scss`, `alert-wizard-rightcol.scss`, `body--dark` → `html.dark` mixin)
- **File-level scoped** changes: ~250 (96 `var(--q-*)` swaps + 30 `tw-` → `tw:` + 33 wrong-order tw v4 fixes + ~40 deep selector removals + class swaps across ~30 alert components; biggest concentrations in `AddAlert.vue`, `IncidentDetailDrawer.vue`, `IncidentServiceGraph.vue`, `AlertSummary.vue`, `AlertList.vue`, `ImportSemanticGroups.vue`)
