# Dashboards Variables — Policy Audit

**Scope:** All `dashboard-variables*.spec.js`, `dashboard-mustache-variables.spec.js`, and their POM/utility files.

**Date:** 2026-05-23

**Status:** CLEAN — all policy violations resolved.

---

## Vue Source Files Modified

| File | Change |
|---|---|
| `web/src/lib/forms/Select/OSelect.vue` | Added `:data-test-label="String(filteredOptions[vRow.index].label ?? '')"` to `ListboxItem` |
| `web/src/components/dashboards/settings/AddSettingVariable.vue` | Added `data-test="dashboard-variable-cycle-error"` to cycle error div |
| `web/src/components/dashboards/PanelContainer.vue` | Added `:data-test-panel-title="props.data.title"` to panel container |
| `web/src/components/dashboards/settings/VariableQueryValueSelector.vue` | Added `data-test="variable-query-value-selector-no-data"` to "No Data Found" div |
| `web/src/components/dashboards/settings/VariableQueryValueSelector.vue` (HTML snippets) | Added `data-test` attributes to all content spans in test HTML snippets |

---

## POM / Utility Files Modified

| File | Violations Fixed |
|---|---|
| `dashboard-stream-field-utils.js` | Replaced all `waitForTimeout`, `body.click`, `filter({ hasText })`, `getByRole` |
| `dashboard-variables.js` | Replaced all `waitForTimeout`, `getByRole`, scope/type/stream/field option selectors |
| `dashboard-variables-scoped.js` | Replaced all `waitForTimeout`, `getByRole`, `filter({ hasText })`, `body.click`, `getByText` |

---

## Spec Files Modified

| File | Violations Fixed |
|---|---|
| `dashboard-variables-creation-scopes.spec.js` | `getByRole("option")` → `data-test-value`, `filter({ hasText })` on tabs/panels → `data-test-label`, `body.click` → `keyboard.press("Escape")` |
| `dashboard-variables-panel-level.spec.js` | `getByRole("option")` → `data-test-value`, `filter({ hasText })` → `data-test-label`, `filter({ hasText })` on panel containers → `data-test-panel-title`, `waitForTimeout` removed |
| `dashboard-variables-tab-level.spec.js` | `waitForTimeout(1000)` removed |
| `dashboard-variables-refresh.spec.js` | `waitForTimeout(1000)` × 4 removed |
| `dashboard-variables-custom-parents.spec.js` | `waitForTimeout(2000)` + `body.click` → popover wait + `keyboard.press("Escape")` |
| `dashboard-variables-stream-field.spec.js` | `waitForTimeout` × 13 removed/replaced with `safeWaitForNetworkIdle` |
| `dashboard-mustache-variables.spec.js` | `waitForTimeout(5000)` × 8 + `waitForTimeout(3000)` × 2 → deterministic waits; `getByRole("heading")` → `data-test` selectors; `getByText("controller")` → `data-test` span selectors; `filter({ hasText: /error/i })` → plain `[role="alert"]` count |
| `dashboard-variables-dependency.spec.js` | `waitForTimeout(5000)` removed; `getByText("No Data Found")` → `data-test="variable-query-value-selector-no-data"` |

---

## New data-test Selectors Added

| Selector | Location | Purpose |
|---|---|---|
| `[data-test-label="..."]` on `[data-test$="-option"]` | `OSelect.vue` | Label-based selection for UUID-valued items (tabs, panels) |
| `data-test="dashboard-variable-cycle-error"` | `AddSettingVariable.vue` | Cycle error div for `hasCircularDependencyError()` |
| `data-test-panel-title="<title>"` | `PanelContainer.vue` | Panel title attribute for locating panels by name |
| `data-test="variable-query-value-selector-no-data"` | `VariableQueryValueSelector.vue` | Empty state indicator |
| `data-test="mustache-heading"` etc. | HTML snippets in mustache spec | HTML panel heading elements |
| `data-test="mustache-value"` etc. | HTML snippets in mustache spec | HTML panel content spans |
| `data-test="undefined-var-text"` | HTML snippets in mustache spec | Undefined variable paragraph |

---

## Selector Patterns Used (for option selection)

| Dropdown | data-test-value pattern | data-test-label pattern |
|---|---|---|
| Scope | `[data-test="dashboard-variable-scope-select-option"][data-test-value="global|tabs|panels"]` | — |
| Type | `[data-test="dashboard-variable-type-select-option"][data-test-value="query_values|constant|textbox|custom"]` | — |
| Stream type | `[data-test="dashboard-variable-stream-type-select-option"][data-test-value="logs|metrics|traces"]` | — |
| Stream | `[data-test$="-option"][data-test-value="${streamName}"]` | — |
| Field | `[data-test$="-option"][data-test-value="${fieldName}"]` | — |
| Tabs | `[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]` | used (UUID values) |
| Panels | `[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelName}"]` | used (UUID values) |
| Filter name | `[data-test="dashboard-query-values-filter-name-selector-option"][data-test-value="${fieldName}"]` | — |
| Filter operator | `[data-test="dashboard-query-values-filter-operator-selector-option"][data-test-value="${operator}"]` | — |
| Variable inner | `[data-test="variable-selector-${label}-inner-option"][data-test-value="${value}"]` | — |

---

## Self-Audit Results (§11 checks)

- No JSDoc blocks removed from POM files: PASS
- No section banners removed: PASS
- No testLogger calls removed: PASS
- No new `waitForTimeout` introduced: PASS
- No `test.skip` added to spec files: PASS
