# Anomaly Detection Page — Quasar Removal Audit

## Summary

The Anomaly Detection page (Anomaly list + 2-step wizard hosted by `AddAlert.vue`) has been partially migrated from Quasar to O* components. The list view (`AnomalyDetectionList.vue`) is clean and well-migrated. However, the wizard steps and the summary panel contain substantial leftover Quasar artifacts:

- **Critical**: `AnomalyAlerting.vue` references `visibleChipCount` in the template but never declares it in `setup()` — runtime ReferenceError every time the destination select renders a chip.
- **Critical**: `AnomalyDetectionConfig.vue` passes Quasar-only QSelect props (`use-input`, `fill-input`, `hide-selected`, `input-debounce`, `@filter`, `#no-option`) to the new `OSelect`, which does not accept them. Slots and handlers are dead, and the field-search UX is broken.
- **Critical**: `OSelect` requires `SelectOption[]` (`{ label, value }`), but multiple call-sites in `AnomalyDetectionConfig.vue` pass plain `string[]` (`filteredStreamFields`, `detectionFunctions`, `filterOperators`, `filteredDetectionFields`).
- **Stale tests**: All three spec files still call `installQuasar()` and `AnomalyAlerting.spec.ts` asserts on `filteredDestinations` / `filterDestinations` which were dropped from the component.
- **CSS**: Multiple `var(--q-primary)` references, `:deep(.q-field__*)` rules targeting non-existent Quasar internals, `body.body--light/dark` selectors, and the legacy `text-red-8` class (Quasar typography). Dead `alert-v3-select` / `alert-v3-input` class hooks are passed but their definitions live in `AddAlert.vue` `<style scoped>` and target removed Quasar internals.

## Files Audited

- `web/src/components/anomaly_detection/AnomalyDetectionList.vue` (475 lines)
- `web/src/components/anomaly_detection/AnomalyDetectionList.spec.ts` (~366 lines)
- `web/src/components/anomaly_detection/AnomalySummary.vue` (192 lines)
- `web/src/components/anomaly_detection/steps/AnomalyAlerting.vue` (261 lines)
- `web/src/components/anomaly_detection/steps/AnomalyAlerting.spec.ts` (153 lines)
- `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue` (1451 lines)
- `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.spec.ts` (467 lines)

## Critical Issues

### 1. `visibleChipCount` is undefined at runtime — destination select renders incorrectly
**File:** `web/src/components/anomaly_detection/steps/AnomalyAlerting.vue:76, 94, 95, 99`

The template uses `visibleChipCount` in three places to decide which destination chips to show and to compute the `+N` overflow label. The variable is not declared in `setup()` nor returned by the component. In production Vue this evaluates to `undefined`, so:
- `v-if="index < visibleChipCount"` is always `false` → no chips render
- The `+N` overflow span never appears
- The destination tag area silently breaks once at least one destination is selected

The new OSelect supports a `maxVisibleChips` prop (default 3). The whole `#selected-item` template can be deleted in favor of the built-in chip rendering, or `visibleChipCount` must be defined and returned.

**Solution:**
```diff
- <OSelect v-model="formData.destinations" multiple ...>
-   <template #selected-item="{ option, index, removeAtIndex }">
-     <span v-if="index < visibleChipCount">...</span>
-     <span v-if="index === visibleChipCount">+{{ totalSelected - visibleChipCount }}</span>
-   </template>
- </OSelect>
+ <OSelect v-model="formData.destinations" multiple :max-visible-chips="3" ... />
```

### 2. Quasar-only QSelect props passed to OSelect — no effect, broken UX
**File:** `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:62-105 (filter-field-select)`

```
<OSelect
  v-model="filter.field"
  :options="filteredStreamFields"
  use-input         <-- Quasar QSelect prop
  fill-input        <-- Quasar QSelect prop
  hide-selected     <-- Quasar QSelect prop (OSelect has `hideSelected` for multi-select only)
  input-debounce="200" <-- Quasar QSelect prop
  @filter="filterFieldOptions"  <-- Quasar QSelect event
  ...
>
  <template #no-option> ... </template>  <-- Quasar QSelect slot
</OSelect>
```

OSelect's public API (`web/src/lib/forms/Select/OSelect.types.ts`) supports `searchable`, `searchDebounce`, `creatable`, `@search`, `@create`, and `#empty`. None of the Quasar-style hooks above wire up. The user cannot type-to-filter the stream-field selector, and the helpful "no fields found / select stream first" empty message in `#no-option` never appears.

`filterFieldOptions` and `filterDetectionFieldOptions` (lines 833-854) use Quasar's `update(callback)` pattern which no Vue invocation will ever trigger.

**Solution:**
```diff
  <OSelect
    v-model="filter.field"
    :options="filteredStreamFields"
-   use-input fill-input hide-selected
-   input-debounce="200"
-   @filter="filterFieldOptions"
+   searchable
+   :search-debounce="200"
+   @search="(val) => filteredStreamFields = allStreamFields.filter(f => f.label.toLowerCase().includes((val ?? '').toLowerCase()))"
  >
-   <template #no-option> ... </template>
+   <template #empty>No fields found</template>
  </OSelect>
```

### 3. OSelect option shape mismatch — `string[]` instead of `SelectOption[]`
**File:** `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue`

OSelect requires `options: { label: string; value: SelectValue }[]`. The following call-sites pass raw string arrays:

| Line | Binding | Source |
|------|---------|--------|
| 63   | `:options="filteredStreamFields"`           | `ref<string[]>` (line 766) |
| 88   | `:options="filterOperators"`                | re-exported `ANOMALY_FILTER_OPERATORS` (likely `string[]`) |
| 195  | `:options="detectionFunctions"`             | `["count", "avg", "sum", ...]` (line 722) |
| 208  | `:options="filteredDetectionFields"`        | `ref<string[]>` (line 767) |

Inside OSelect, options are read as `opt.label`/`opt.value` (see `web/src/lib/forms/Select/OSelect.vue:204, 230, 261, 312`). String arrays will silently render empty dropdowns or throw when normalisation hits `.label.toLowerCase()`.

Compare with `intervalUnits` (line 732) and `retrainIntervalOptions` (line 736) — these are correctly shaped as `[{ label, value }]`.

**Solution:**
```diff
- const filteredStreamFields = ref<string[]>([]);
- const detectionFunctions = ["count", "avg", "sum", ...];
+ const filteredStreamFields = ref<{ label: string; value: string }[]>([]);
+ const detectionFunctions = [
+   { label: "count", value: "count" },
+   { label: "avg", value: "avg" },
+   { label: "sum", value: "sum" },
+ ];
+ // Apply same shape to filterOperators, filteredDetectionFields.
```

### 4. Quasar selectors in scoped `:deep()` rules — dead CSS
**Files:**
- `web/src/components/anomaly_detection/steps/AnomalyAlerting.vue:238-258` — `:deep(.q-field__inner|.q-field__control|.q-field__control-container|.q-field__marginal|.q-field__append)` inside `.destination-select`.
- `web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:1313-1322` — `:deep(.q-field__native span)` and `:deep(.q-field__input)` inside `.filter-field-select`.

These rules target Quasar QField internals that no longer exist in OSelect. The intended layout fix (chip overflow / ellipsis on the filter selector) is silently a no-op. Need to switch to OSelect's actual DOM/selectors or use `maxVisibleChips`/CSS at the OSelect level.

**Solution:**
```diff
- :deep(.q-field__inner) { /* ... */ }
- :deep(.q-field__control) { /* ... */ }
- :deep(.q-field__native span) { text-overflow: ellipsis; ... }
+ // Use OSelect props instead:
+ <OSelect :max-visible-chips="3" size="sm" class="tw:min-w-0" ... />
```

### 5. Legacy `text-red-8` class (Quasar typography) — no effect
**Files (multiple lines):**
- `AnomalyAlerting.vue:127`
- `AnomalyDetectionConfig.vue:153, 160, 276, 332, 387, 439`

`text-red-8` is a Quasar utility class. Without Quasar's CSS it does nothing — the error label is unstyled. Replace with `tw:text-red-500` (already used for asterisks at lines 191, 235, 291, etc.) or a token-based `var(--o2-color-danger)`.

**Solution:**
```diff
- class="... text-red-8 ..."
+ class="... tw:text-red-500 ..."
```

## Logical Issues

### 1. `filterFieldOptions` / `filterDetectionFieldOptions` are dead code
`web/src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue:833-854, 1261-1262`

Both helpers expect Quasar's `(val, update)` signature and are wired to OSelect via `@filter` (line 74) which OSelect never emits. They remain returned from `setup()` (1261-1262) but are unreachable. They will also crash the spec if any test triggers them, because the second arg `update` will be undefined.

**Solution:**
```diff
- const filterFieldOptions = (val, update) => { update(() => { ... }); };
- const filterDetectionFieldOptions = (val, update) => { update(() => { ... }); };
+ const filterFieldOptions = (val: string) => {
+   filteredStreamFields.value = allStreamFields.value.filter(
+     f => f.label.toLowerCase().includes((val ?? '').toLowerCase())
+   );
+ };
```

### 2. Field-filter UX regressed for stream selection
Because of issues #2/#3 above, the user can no longer type to filter the long stream-fields list (`allStreamFields.value.sort()` at line 809). On a stream with hundreds of fields the dropdown becomes unusable.

**Solution:** See Critical Issues #2 and #3 — add `searchable` prop and reshape options as `{ label, value }[]`.

### 3. Spec drift in `AnomalyAlerting.spec.ts`
**File:** `web/src/components/anomaly_detection/steps/AnomalyAlerting.spec.ts:97-130`

Tests still assert against component internals that were removed in the migration:
- `(w.vm as any).filteredDestinations` — no longer exists; `setup()` returns only `{ t, store, openAddDestination }`.
- `(w.vm as any).filterDestinations("slack", cb)` — no longer exists.
- The `_anomalies` text assertion at line 79 depends on an unresolved i18n key — likely a placeholder leak.

These tests fail at the time of writing.

**Solution:**
```diff
- expect((w.vm as any).filteredDestinations).toBeDefined();
- expect((w.vm as any).filterDestinations("slack", cb)).toBe(...);
+ // Drop these tests — internals were removed during migration.
```

### 4. `AnomalySummary` body class selector mismatch
**File:** `web/src/components/anomaly_detection/AnomalySummary.vue:179, 185`

```scss
body.body--light & { ... }
body.body--dark & { ... }
```

Quasar set `body--light` / `body--dark` classes on `<body>`. With Quasar removed those classes are no longer applied (the app now toggles a different mechanism, e.g. `<html class="dark">`). The scroll-to-bottom button's themed border/background therefore never paints, falling back to the unscoped defaults.

**Solution:**
```diff
- body.body--light & { ... }
- body.body--dark & { ... }
+ html.light & { ... }
+ html.dark & { ... }
```

## CSS / Layout Issues

### Hardcoded tokens that should reference `var(--o2-*)`
- `AnomalyAlerting.vue:216-217`  `background-color: #212121; border: 1px solid #343434;` (dark mode)
- `AnomalyAlerting.vue:222-223`  `background-color: #ffffff; border: 1px solid #e6e6e6;` (light mode)
- `AnomalyDetectionConfig.vue:1295-1296` — same dark-mode hardcoded literals duplicated.
- `AnomalyDetectionConfig.vue:1301-1303` — same light-mode literals duplicated.
- `AnomalyDetectionConfig.vue:1353` — `border: 1px solid rgba(0, 0, 0, 0.12);` (light SQL editor border)
- `AnomalyDetectionConfig.vue:1357` — `border: 1px solid rgba(255, 255, 255, 0.18);` (dark SQL editor border)
- `AnomalyDetectionConfig.vue:1421-1422` — `border-color: #d0d0d0;` / `color: #5c5c5c;` (inactive frequency toggle, light).
- `AnomalyDetectionConfig.vue:1438` — `border-color: #404040; color: #bdbdbd;` (inactive frequency toggle, dark).
- `AnomalyDetectionList.vue:210` — inline `style="background: rgba(0,0,0,0.06); ..."` on error `<pre>` (no dark-mode variant).
- `AnomalySummary.vue:177` — `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);` (only one variant).

All of the above hardcodes the surface and border palette, breaking design-token coherence. They should use `var(--o2-surface-*)`, `var(--o2-border)`, etc.

**Solution:**
```diff
- background-color: #212121; border: 1px solid #343434;  /* dark */
- background-color: #ffffff; border: 1px solid #e6e6e6;  /* light */
+ background-color: var(--o2-card-bg);
+ border: 1px solid var(--o2-border-color);
```

### `var(--q-primary)` still referenced
- `AnomalySummary.vue:125, 132, 133, 137, 148, 149, 151, 180, 181, 186, 187`
- `AnomalyDetectionConfig.vue:1414, 1415`

`--q-primary` was Quasar's variable; with the framework removed it has no value. The `.summary-clickable` chips, `.plain-english-section` band, the scroll-to-bottom button, and the active `frequency-toggle-btn` lose their colour. Use `var(--o2-primary)` (or whatever the canonical primary token is).

**Solution:**
```diff
- color: var(--q-primary);
- background: var(--q-primary);
+ color: var(--o2-primary);
+ background: var(--o2-primary);
```

### `!important` overuse and unscoped `body` selectors
- `AnomalySummary.vue:180-189` — five `!important` declarations inside `body.body--light &` / `body.body--dark &` selectors. Combined with issue (4) above this CSS is double-broken.
- `AnomalyDetectionConfig.vue:1408-1448` — `frequency-toggle-btn` styling sprays `!important` everywhere and toggles theme via `.dark-mode` / `.light-mode` class selectors duplicated on the root.

**Solution:**
```diff
- body.body--dark .summary-clickable {
-   background: var(--q-primary) !important;
-   color: #fff !important;
- }
+ html.dark .summary-clickable {
+   background: var(--o2-primary);
+   color: #fff;
+ }
```

### Excessive inline styles
- `AnomalyDetectionConfig.vue` contains **30** `style=...` attributes (mostly fixed widths `width: 87px`, `width: 110px`, `width: 178px`, etc., plus `font-size: 11px`, `line-height: 12px`). Promote to scoped utility classes (e.g. `.field-input`, `.field-select`, `.help-text-error`) or use `tw:` width utilities.
- `AnomalyAlerting.vue` — 4 inline styles for the same fixed-width pattern.

**Solution:**
```diff
- <OInput style="width: 87px; font-size: 11px;" ... />
+ <OInput class="tw:w-[87px] tw:text-[11px]" ... />
+ // Or define semantic classes like .field-input-sm in scoped style.
```

### Three-Layer CSS Violations

| Layer issue | Location |
|-------------|----------|
| Duplicated file-level scoped block | `.step-anomaly-alerting { … dark-mode/light-mode … }` (`AnomalyAlerting.vue:204-227`) and `.step-anomaly-config { … dark-mode/light-mode … }` (`AnomalyDetectionConfig.vue:1283-1306`). Both define the **same wizard step shell** (rounded panel, theme-aware surface/border). Promote to a shared partial under `web/src/styles/alerts/_wizard-step.scss` or a `OPanel`/`OCard` core component. |
| Same `alert-settings-row` rule duplicated | `AnomalyAlerting.vue:229-232` and `AnomalyDetectionConfig.vue:1308-1311`. |
| `:deep(.q-field__*)` selectors in scoped files attempting to style OSelect internals | `AnomalyAlerting.vue:238-258`, `AnomalyDetectionConfig.vue:1313-1322`. These should be replaced with OSelect-native props or by extending the component-level OSelect partial. |
| File-level scoped styles override OSelect/ORange design tokens by name | `AnomalyDetectionConfig.vue:1394-1398` `--color-slider-track-fill: var(--o2-primary-color);` — fine as a local override but the token should be documented or hoisted. Note: `--o2-primary-color` should be verified to exist (no other file in the audited set references this exact name; the rest use `var(--o2-primary)`). |
| Global pollution | `AnomalySummary.vue:179, 185` uses `body.body--light &` / `body.body--dark &` — relies on Quasar adding classes to `<body>`. With Quasar removed, this leaks into and depends on global body state that no longer exists. |

**Solution:**
```diff
// Create web/src/styles/alerts/_wizard-step.scss:
+ .wizard-step-shell {
+   border-radius: 8px;
+   background: var(--o2-card-bg);
+   border: 1px solid var(--o2-border-color);
+ }
// In AnomalyAlerting.vue / AnomalyDetectionConfig.vue, remove the duplicated rules and use:
- .step-anomaly-alerting { /* duplicated rules */ }
+ <template> ... class="wizard-step-shell" ... </template>
```

## Component Migration Issues

| Component / prop | File:line | Status |
|------------------|-----------|--------|
| `OSelect` use-input / fill-input / hide-selected / input-debounce / @filter / #no-option | `AnomalyDetectionConfig.vue:62-105, 192-228` | NOT supported by OSelect — dead |
| `OSelect :options=` passes `string[]` | `AnomalyDetectionConfig.vue:63, 88, 195, 208` | Requires `SelectOption[]` |
| `visibleChipCount` used in template, not defined | `AnomalyAlerting.vue:76, 94-99` | Undefined |
| `OSelect #selected-item` slot | `AnomalyAlerting.vue:74-101` | OSelect uses `#chip` slot; `#selected-item` is not in `SelectSlots`. The slot's `removeAtIndex` callback is also not in OSelect's slot scope. |
| `OScrollArea` not used where it was previously | `AnomalySummary.vue` rolls its own scroll detection — fine but could use a shared component. |
| `OToggleGroupItem size="sm"` | `AnomalyDetectionConfig.vue:37` | Supported by ToggleGroupItem (`md`/`sm`/`xs`). |
| `OBadge variant="primary"` for `status==="training"` | `AnomalyDetectionList.vue:298` | Valid variant. Note `BadgeVariant` does not have a `secondary` — the existing `default`/`primary`/`success`/`warning`/`error` covers usage. |
| Tooltip child-mode usage | `AnomalyDetectionList.vue:55`, `AnomalyAlerting.vue:38`, `AnomalyDetectionConfig.vue:244, 300, …` | OTooltip supports anchor-to-parent mode when no default slot; valid. |
| `@click:primary` / `@click:secondary` on ODialog | `AnomalyDetectionList.vue:161-162, 181-182, 200-201` | Valid per ODialogStub in the spec file. |

## Test File Issues

- All three spec files still import and call `installQuasar()`. With Quasar physically removed from the bundle (per the migration brief), `@/test/unit/helpers/install-quasar-plugin` may still exist as a no-op shim, but tests should be migrated off it for clarity.
  - `AnomalyDetectionList.spec.ts:18, 22`
  - `AnomalyAlerting.spec.ts:18, 22`
  - `AnomalyDetectionConfig.spec.ts:18, 49`
- `AnomalyAlerting.spec.ts:97-130` asserts on `filteredDestinations` and `filterDestinations` properties that were stripped from `AnomalyAlerting.vue`. Tests in those `describe("destinations")` blocks will fail.
- `AnomalyAlerting.spec.ts:79` `expect(w.text()).toContain("_anomalies")` — this looks like an unresolved i18n key snippet (`alerts.anomaly.disabledNotificationsInfo` → maybe falls through to a `..._anomalies` substring). Test will be brittle if the key resolves.
- `AnomalyAlerting.spec.ts:136-141` is non-deterministic — wrapped in `if (refreshBtn.exists())` so the assertion may silently skip.
- `AnomalyDetectionList.spec.ts:27-76` stubs ODialog with `update:open` emit but the component uses `v-model:open` — should work, but the stub does not stub `OTable`, `OSelect`, `OBadge`, `OTooltip`, `OIcon`, `OSpinner`, leaving the test brittle to changes in those internal components. Diff is 246-line growth in this spec, mostly added tests for the new dialog/table flow — they exercise the new behavior but rely heavily on `data-test` attributes (some of which target dialogs that auto-teleport — confirm the `ODialogStub` covers all three dialogs).
- `AnomalyDetectionConfig.spec.ts:194-199, 454-465` rely on `(wrapper.vm as any).previewPanelSchema` and call `loadPreview()` directly. With the new schema gating (`!sql || !stream_name`) the result is `null`, which matches the test expectation, but `previewPanelSchema` is now an inner `ref` returned from `setup()` — the test indexes `.queries?.[0]?.query` (line 90), so the assertion still passes. OK.

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers";
- installQuasar();
- expect(w.text()).toContain("_anomalies");
+ expect(w.text()).toContain(t("alerts.anomaly.disabledNotificationsInfo"));
- if (refreshBtn.exists()) { expect(refreshBtn.isVisible()).toBe(true); }
+ expect(refreshBtn.exists()).toBe(true);
+ expect(refreshBtn.isVisible()).toBe(true);
```

## Validations / Accessibility

- **Validation:** `AnomalyDetectionConfig.vue:942-980` `validate()` is hand-rolled and bypasses `formRef.value.validate()` rules for SQL emptiness, timestamp alias, intervals and detection field. This is fine but doubles up with OForm's own validation. Consider routing all rules through OForm field-level validators so error messages are uniform.
- **Accessibility:** The destination chip remove button (`AnomalyAlerting.vue:82-90`) has `aria-label="Remove"` — good. But the literal "*" required indicator (`AnomalyAlerting.vue:59`, `AnomalyDetectionConfig.vue:126, 191, 235, 291, 346, 398, 455`) is rendered as a plain `<span>` with no `aria-hidden="true"` and no programmatic association with the labelled input — screen readers will announce a stray "asterisk".
- **Accessibility:** The info-tooltip icons (`OIcon name="info"` in `AnomalyDetectionConfig.vue` and `AnomalyAlerting.vue`) are decorative and lack a focusable trigger — keyboard users cannot reveal the tooltip content.
- The `<pre>` block at `AnomalyDetectionList.vue:208-211` is set to `max-height: 120px; overflow-y: auto` but no `tabindex="0"` — keyboard users cannot scroll long error messages.
- `loadConfigs()` polls every 30 s (`AnomalyDetectionList.vue:436`) and does not announce updates (`aria-live` region missing) — assistive tech users won't know the status badge changed.

**Solution:**
```diff
- <span>*</span>
+ <span aria-hidden="true">*</span>
- <OIcon name="info" />
+ <OIcon name="info" tabindex="0" :aria-label="t('common.moreInfo')" />
- <pre style="max-height: 120px; overflow-y: auto">
+ <pre tabindex="0" class="tw:max-h-[120px] tw:overflow-y-auto">
- <div class="anomaly-list">
+ <div class="anomaly-list" role="region" aria-live="polite">
```

## Recommendations

Priority order for fixes (highest first):

1. **(Blocking) Define `visibleChipCount`** in `AnomalyAlerting.vue` setup, or, preferably, delete the custom `#selected-item` template and use OSelect's built-in `maxVisibleChips` prop. Without this fix, no destination chip ever renders.
2. **(Blocking) Re-shape options** in `AnomalyDetectionConfig.vue` to `SelectOption[]`. Convert `allStreamFields`, `numericStreamFields`, `detectionFunctions`, `filterOperators`, `filteredStreamFields`, `filteredDetectionFields` to `{ label, value }` (or set `labelKey`/`valueKey` accordingly and provide objects).
3. **(Blocking) Remove dead QSelect props/slots/handlers** (`use-input`, `fill-input`, `hide-selected`, `input-debounce`, `@filter`, `#no-option`) and replace with `searchable`, `searchDebounce`, `#empty`, and `@search`. Delete `filterFieldOptions` / `filterDetectionFieldOptions`.
4. **(High) Replace `text-red-8` → `tw:text-red-500`** (7 occurrences) so validation errors are actually red.
5. **(High) Replace `var(--q-primary)` with `var(--o2-primary)`** in `AnomalySummary.vue` (11 occurrences) and `AnomalyDetectionConfig.vue` (2 occurrences).
6. **(High) Drop `body.body--light` / `body.body--dark` selectors** in `AnomalySummary.vue` — gate the styling on the same theme class the rest of the app uses (`.dark` / `[data-theme="dark"]` etc).
7. **(High) Fix `AnomalyAlerting.spec.ts`** — drop `filteredDestinations`/`filterDestinations` tests or re-add the props in the component.
8. **(Medium) Delete or relocate `:deep(.q-field__*)` rules** — Quasar internals don't exist anymore. Use OSelect props or extend OSelect-level CSS.
9. **(Medium) Tokenize hardcoded surface/border colors** in both step files. Promote the duplicated `.step-anomaly-*` / `.alert-settings-row` shell to a shared component-level partial.
10. **(Medium) Remove `installQuasar()` calls** from all three spec files now that Quasar is gone.
11. **(Low) Accessibility polish** — make required asterisks `aria-hidden`, add `aria-live` to the list polling, ensure tooltip triggers are keyboard-focusable.
12. **(Low) Collapse 30 inline `style="width: …px"` attributes** in `AnomalyDetectionConfig.vue` into a small set of utility classes.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| AnomalyAlerting.vue:238 | `:deep(.q-field__inner)` | remove | file-scoped |
| AnomalyAlerting.vue:243 | `:deep(.q-field__control)` | remove | file-scoped |
| AnomalyAlerting.vue:249 | `:deep(.q-field__control-container)` | remove | file-scoped |
| AnomalyAlerting.vue:253 | `:deep(.q-field__marginal)` | remove | file-scoped |
| AnomalyAlerting.vue:256 | `:deep(.q-field__append)` | remove | file-scoped |
| AnomalyDetectionConfig.vue:1314 | `:deep(.q-field__native span)` | remove | file-scoped |
| AnomalyDetectionConfig.vue:1319 | `:deep(.q-field__input)` | remove | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| AnomalySummary.vue:125 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:132-133 | `var(--q-primary)` (color-mix) | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:137 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:148-149 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:151 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:180-181 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalySummary.vue:186-187 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalyDetectionConfig.vue:1414 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| AnomalyDetectionConfig.vue:1415 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| AnomalyAlerting.vue:238-256 | 5x `:deep(.q-field__*)` blocks | remove | file-scoped |
| AnomalyDetectionConfig.vue:1314-1319 | 2x `:deep(.q-field__*)` blocks | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

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
| AnomalyDetectionList.vue:210 | `background:rgba(0,0,0,0.06); max-height:120px; overflow-y:auto` | scoped `.anomaly-list-preview` class |
| AnomalyDetectionConfig.vue:51 | `width:178px; min-height:36px` | scoped `.config-step-label` class |
| AnomalyDetectionConfig.vue:55,128 | `width: calc(100% - 190px)` | scoped `.config-step-content` class |
| AnomalyDetectionConfig.vue:72 | `width:200px` | `tw:w-[200px]` |
| AnomalyDetectionConfig.vue:90 | `width:110px` | `tw:w-[110px]` |
| AnomalyDetectionConfig.vue:97 | `max-width:160px` | `tw:max-w-[160px]` |
| AnomalyDetectionConfig.vue:124 | `width:190px; height:36px` | scoped class |
| AnomalyDetectionConfig.vue:154,162,277,333 | `font-size:11px; line-height:12px` | scoped `.config-helper-text` class |
| AnomalyDetectionConfig.vue:199 | `width:110px` | `tw:w-[110px]` |
| AnomalyDetectionConfig.vue:217 | `width:140px` | `tw:w-[140px]` |
| AnomalyDetectionConfig.vue:258,314,369 | `width:87px` | scoped `.threshold-input` class |
| AnomalyDetectionConfig.vue:267,323 | `min-width:100px` | `tw:min-w-[100px]` |
| AnomalyDetectionConfig.vue:289 | `width:190px; height:36px` | scoped class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| AnomalyDetectionConfig.vue:154/162/277/333 | repeated `font-size:11px; line-height:12px` | extract `.config-helper-text` class |
| AnomalyDetectionConfig.vue:258/314/369 | repeated `width:87px` threshold inputs | extract `.threshold-input` class |
| AnomalyDetectionConfig.vue:124/289 | repeated `width:190px; height:36px` | extract `.step-label` class |
| AnomalyDetectionConfig.vue:47/120/185/286/341/450 | repeated `alert-settings-row` / `paired-row` mixed pattern | already partial classes; ensure shared SCSS exists |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0 (referenced `_wizard-step.scss` does not exist in worktree)
- Component-level partial changes: 3 (`config-helper-text`, `threshold-input`, `.step-label` shared across config steps)
- File-level scoped changes: ~38 (7 q-field deep blocks, 11 q-primary vars, 20 inline styles)
