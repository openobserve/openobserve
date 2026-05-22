# QA Automation Audit — Quasar Migration
## PR: feat/ux-revamp-main | Branch → main

| Field | Value |
|---|---|
| **PR** | [#11838 — feat: ux improvement main](https://github.com/openobserve/openobserve/pull/11838) |
| **Branch** | `feat/ux-revamp-main` → `main` |
| **Audit Date** | 2026-05-20 |
| **Total Stale Locators Found** | 303 occurrences across 51 files |
| **Scope** | Locator changes + Missing `data-test` only — fix BEFORE running tests |

---

## ⚠️ Fix Before Running Tests

These are **broken locators confirmed in your codebase right now**. Fix them first, then run tests.

---

## 1. CRITICAL — `confirm-button` and `dialog-box` (Renamed in Migration)

These old `data-test` values no longer exist. Every usage will fail immediately.

### `pages/dashboardPages/dashCreation.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 93 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 101 | `[data-test="dialog-box"]` | `[data-test="dashboard-confirm-dialog"]` |
| 105 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 161 | `[data-test="dialog-box"]` | `[data-test="dashboard-confirm-dialog"]` |
| 162 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `pages/logsPages/logsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 212 | `[data-test="dialog-box"]` | `[data-test="log-detail-dialog"]` *(verify actual data-test on log detail dialog)* |

### `pages/metricsPages/metricsBuilderPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 1250 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 1253 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `pages/streamsPages/streamsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 495 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/dashboards/crossLinking.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 890 | `[data-test="dialog-box"]` | `[data-test="dashboard-confirm-dialog"]` *(scope to correct dialog)* |

### `playwright-tests/dashboards/dashboard-create-alert.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 498 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/dashboards/visualize.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 291 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/dashboards/visualize-vrl.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 291 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/Logs/logs-sql-autocomplete.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 46 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/Logs/region.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 126 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/Metrics/metrics-promql-builder.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 1425 | `[data-test="confirm-button"]` (in multi-fallback selector) | `[data-test="o-dialog-primary-btn"]` |

### `playwright-tests/RegressionSet/dashboard-regression.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 141 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 142 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 260 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |
| 393 | `[data-test="confirm-button"]` | `[data-test="o-dialog-primary-btn"]` |

---

## 2. CRITICAL — `.q-dialog` Used as Selector (DOM Removed)

`.q-dialog` no longer exists in the DOM. `safeWaitForHidden('.q-dialog')` will never find the element, causing tests to either timeout or pass incorrectly.

### `playwright-tests/dashboards/dashboard-variables-dependency.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 85 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 834 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 908 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |

### `playwright-tests/dashboards/dashboard-variables-global.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 63 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 134 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 209 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 267 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 335 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 393 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 441 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |

### `playwright-tests/dashboards/dashboard-variables-tab-level.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 71 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 145 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 270 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 342 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 482 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 559 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 654 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 676 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |

### `playwright-tests/dashboards/dashboard-variables-url-sync.spec.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 59 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 115 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 205 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 262 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 331 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 392 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 458 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 529 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |
| 601 | `safeWaitForHidden(page, '.q-dialog')` | `safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]')` |

### `pages/alertsPages/alertsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 264 | `qDialogLocator: '.q-dialog'` | `qDialogLocator: '[data-test="alert-dialog"]'` *(verify actual data-test)* |
| 2499 | `this.page.locator('.q-dialog').first()` | `this.page.locator('[data-test="alert-confirm-dialog"]').first()` *(verify actual data-test)* |

### `pages/generalPages/sanityPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 547 | `waitForElementHidden('.q-dialog')` | `waitForElementHidden('[data-test="*-dialog"]')` *(use specific dialog data-test)* |
| 584 | `waitForElementHidden('.q-dialog__backdrop')` | `waitForElementHidden('[data-test="*-dialog-overlay"]')` *(verify overlay data-test)* |

### `pages/dashboardPages/dashboard-selectors.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 22 | `DIALOG: '.q-dialog, [data-test="dashboard-settings-drawer"]...'` | `DIALOG: '[data-test="dashboard-settings-drawer"]'` — remove `.q-dialog` from compound selector |
| 23 | `DIALOG_CARD: '.q-dialog .q-card'` | Remove or replace with specific dialog data-test |
| 26 | `MENU: '.q-menu'` | `MENU: '[data-test="*-popover"]'` — use specific per-component popover data-test |

---

## 3. HIGH — `.q-menu` Used in POM Files (DOM Removed)

`.q-menu` no longer exists. Dropdowns now render with `[data-test="*-popover"]`.

### `pages/alertsPages/alertCreationWizard.js` — 20+ occurrences

| Lines | Old (Broken) | New (Fix To) |
|---|---|---|
| 121,122 | `.q-menu:visible` / `.q-menu:visible .q-item` | Scope to specific select's popover via parent `data-test` |
| 165 | `.q-menu:visible .q-item` | Same |
| 240, 270 | `.q-menu:visible .q-item` | Same |
| 414, 420 | `.q-menu:visible` / `.o-select-dropdown:visible` | Already has fallback — validate `.o-select-dropdown` works |
| 445, 533, 564 | `.q-menu:visible` | Scope to alert form select popovers |
| 612, 753, 764 | `.q-menu:visible` | Same |
| 786, 901, 978 | `.q-menu:visible .q-item` | Same |
| 1083, 1242, 1264 | `.q-menu:visible .q-item` / `.q-menu:visible` | Same |
| 1394, 1417, 1429 | `.q-menu:visible .q-item` | Same |
| 1462, 1479, 1506 | `.q-menu:visible` | Same |
| 1665, 1696 | `.q-menu:visible` | Same |

**Recommended pattern for alert wizard selects:**
```js
// Scope to the parent OSelect's data-test popover
const popover = this.page.locator('[data-test="alert-stream-select-popover"]');
await popover.waitFor({ state: 'visible' });
const option = popover.locator('[data-test="o-select-option"]').filter({ hasText: optionText });
await option.click();
```

### `pages/alertsPages/alertsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 2312 | `.q-menu .q-item` | Scope to specific select popover |
| 2347 | `.q-menu .q-item` | Same |
| 3184 | `.q-menu .q-item .q-item` | Scope to autocomplete popover |
| 3223, 3242, 3263, 3294 | `.q-menu:visible .q-item` | Scope to specific select popovers |

### `pages/alertsPages/alertDestinationsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 812, 815 | `.q-item__label:has-text(...)` (fallback) | Use `[data-test="o-select-option"]` scoped to parent |
| 2136, 2161, 2168 | `.q-menu .q-item` | Scope to destination select popover |

### `pages/commonActions.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 54 | `.q-menu:visible` | Scope to specific dropdown popover using parent `data-test` |
| 241 | `.q-dialog__backdrop` | Use `[data-test="*-dialog-overlay"]` or scoped dialog data-test |

### `pages/dashboardPages/dashboard-panel-time.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 308 | `.q-menu` (waitFor hidden) | `[data-test="dashboard-datetime-popover"]` |

### `pages/anomalyPages/anomalyDetectionPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 71 | `qMenuItem: '.q-menu .q-item'` | Scope to specific anomaly select popover |
| 72 | `qMenu: '.q-menu'` | Specific popover data-test |
| 73 | `qDialog: '.q-dialog'` | Specific dialog data-test |
| 1123 | `.q-menu:visible` | Scope to popover |

---

## 4. HIGH — `.q-notification` / `.q-notification__message` (DOM Removed)

Toast/notification component is now `OToast`. The `.q-notification` class no longer exists.

### Files with `.q-notification` usage

| File | Lines | Old (Broken) | Notes |
|---|---|---|---|
| `pages/alertsPages/alertsPage.js` | 586, 1023, 1559, 3135 | `.q-notification`, `.q-notification__message`, `.q-notification--negative` | All broken |
| `pages/alertsPages/alertDestinationsPage.js` | 60 | `.q-notification__message` | Property definition |
| `pages/generalPages/correlationSettingsPage.js` | 61, 557, 593, 735, 766, 801, 814 | `.q-notification*` various | All broken |
| `pages/generalPages/enrichmentPage.js` | 1639, 1650, 1783 | `.q-notification__message` | All broken |
| `pages/generalPages/ingestionConfigPage.js` | 17 | `.q-notification__message` | Property definition |
| `pages/generalPages/sanityPage.js` | 561 | `.q-notification__message` | Broken |
| `pages/generalPages/themePage.js` | 53 | `.q-notification__message` | Property definition |
| `pages/dashboardPages/dashboard-stream-field-utils.js` | 371 | `.q-notification--standard.bg-negative` | Broken |
| `pages/dashboardPages/visualise.js` | 62 | `.q-notification` (fallback) | Broken |

**Action needed — find OToast data-test in migrated code:**
```js
// Find what data-test OToast uses in the new implementation
// Then replace all .q-notification usages with:
this.page.locator('[data-test="o-toast"]')           // success toast
this.page.locator('[data-test="o-toast-error"]')     // error toast
// OR check for aria role:
this.page.locator('[role="status"]')                 // toast role
this.page.locator('[role="alert"]')                  // error alert role
```

---

## 5. HIGH — `.q-stepper` / `.q-field` / `.q-table` in Alert Pages

These Quasar structural classes no longer exist in migrated components.

### `pages/alertsPages/alertDestinationsPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 48 | `this.stepperStep = '.q-stepper__step'` | Find new stepper `data-test` or step indicator class |
| 671 | `.q-table__control button` | Find new table control selector |
| 956 | `.q-stepper` (isVisible check) | Use specific stepper data-test or container |
| 959 | `.q-stepper__step` (querySelectorAll) | Use new step data-test |
| 1516 | `.q-dialog__inner, .q-card` | Use specific dialog `data-test` |
| 1638 | `.q-dialog__inner, .q-card` | Use specific dialog `data-test` |

### `pages/alertsPages/alertTemplatesPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 158 | `.q-table__control button` | Find new table add button data-test |
| 161 | `.q-toolbar button:has-text("Add")` | Use `data-test` on add button |
| 228 | `.q-table__control input[type="text"]`, `.q-field__input` | Use `data-test` on search input |
| 762 | `.q-table__control button:has-text("Import")` | Use `data-test` on import button |

### `pages/generalPages/enrichmentPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 11, 54 | `.q-input`, `.q-field__control`, `.q-field__native` | Use `data-test` on the specific OInput |
| 225, 975, 1331, 1393, 1665 | `.q-field__native` | Use `data-test` on OInput |
| 238, 775, 1006, 1479, 1837 | `.q-table__title` | Use `data-test` on table title |
| 855 | `.q-field, .q-option-group, .q-radio` | Use `data-test` on form fields |
| 1204, 1275 | `.q-dialog .q-card`, `.q-dialog__inner` | Use specific dialog data-test |
| 1586 | `.q-table` | Use `data-test` on table container |

### `pages/generalPages/schemaPage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 245 | `.q-form > div:nth-child(2) > .q-field > ...` | Use `data-test` on the target OInput |

### `pages/generalPages/homePage.js`

| Line | Old (Broken) | New (Fix To) |
|---|---|---|
| 488 | `.q-toolbar button` (theme switcher) | Use `data-test` on theme toggle button |

---

## 6. MEDIUM — `keyboard.press('Escape')` to Close Dialogs

ODialog (Reka UI) does **not** auto-focus, so `Escape` does nothing unless focus is manually set inside the dialog first. Any usage that closes a dialog via Escape will silently fail — the dialog stays open and blocks subsequent clicks.

### POM Files with Escape to Close Dialog

| File | Lines | Context |
|---|---|---|
| `pages/alertsPages/alertCreationWizard.js` | 46, 184, 284, 377, 383, 460, 628, 719, 803, 832, 1201, 1212, 1286, 1315, 1517, 1633, 1712 | Alert wizard dialog/dropdown close |
| `pages/alertsPages/alertDestinationsPage.js` | Multiple | Destination dialog close |
| `pages/alertsPages/alertManagement.js` | Multiple | Alert management dialogs |
| `pages/alertsPages/alertsPage.js` | Multiple | General alert dialogs |
| `pages/alertsPages/alertTemplatesPage.js` | Multiple | Template dialogs |
| `pages/anomalyPages/anomalyDetectionPage.js` | 802, 864 | Anomaly dialog close |
| `pages/commonActions.js` | 245 | Generic dialog close |
| `pages/dashboardPages/dashboard-chart.js` | Multiple | Chart config dialogs |
| `pages/dashboardPages/dashboard-panel-edit.js` | Multiple | Panel edit dialog |
| `pages/dashboardPages/dashboard-panel-time.js` | Multiple | Time config popover |
| `pages/dashboardPages/dashboard-stream-field-utils.js` | Multiple | Stream field dialog |
| `pages/dashboardPages/dashboard-variables-scoped.js` | Multiple | Variable dialog |
| `pages/logsPages/logsPage.js` | Multiple | Log detail dialog |
| `pages/metricsPages/metricsBuilderPage.js` | Multiple | Metrics builder dialog |
| `pages/pipelinesPages/pipelinesPage.js` | Multiple | Pipeline dialog |

**Fix pattern for every Escape usage that closes a dialog:**
```js
// ❌ BROKEN — Escape won't close ODialog
await this.page.keyboard.press('Escape');

// ✅ FIX — click the explicit close button
await this.page.locator('[data-test="MY-DIALOG-DATA-TEST"] [data-test="o-dialog-close-btn"]').click();
```

> **For dropdowns** (where Escape WAS used to close a popover/menu):
```js
// ❌ BROKEN
await this.page.keyboard.press('Escape');

// ✅ FIX — click outside or click trigger again to close
await this.page.locator('[data-test="MY-SELECT-DATA-TEST"]').click(); // toggle closed
// OR
await this.page.locator('body').click({ position: { x: 0, y: 0 } }); // click outside
```

---

## 7. MEDIUM — `.q-item__label` (DOM Removed)

Used for reading list item labels. Replaced by direct text content in new components.

| File | Line | Old | Fix |
|---|---|---|---|
| `pages/generalPages/correlationSettingsPage.js` | 856, 880 | `.q-item__label` | `[data-test="*-option"]` or `getByText()` scoped to container |
| `pages/generalPages/languagePage.js` | 30 | `.q-item__label` in list of selectors to check | Remove from list |
| `pages/alertsPages/alertDestinationsPage.js` | 815 | `.q-item__label:has-text(...)` (fallback) | `[data-test="o-select-option"]` scoped to parent |

---

## 8. New Standardized data-test (Reference)

Use these when replacing broken locators above.

### ODialog — scoped to parent dialog data-test

| New `data-test` | Element |
|---|---|
| `o-dialog-close-btn` | X / close button inside dialog |
| `o-dialog-primary-btn` | Confirm / Save / Submit button |
| `o-dialog-secondary-btn` | Cancel / Dismiss button |
| `o-dialog-title` | Dialog heading |

### ODrawer

| New `data-test` | Element |
|---|---|
| `o-drawer-title` | Drawer heading |
| `dashboard-settings-drawer` | Dashboard settings drawer |

### OSelect / ODropdown — scoped to parent component data-test

| New `data-test` | Element |
|---|---|
| `${parentDataTest}-popover` | Dropdown content container |
| `${parentDataTest}-inner-popover` | Variable selector inner popover |
| `o-select-option` | Option item (always scope to parent popover) |
| `o-select-all` | Select all row |
| `o-select-overflow-chip` | +N more chip |

---

## 9. Missing data-test — Needs Adding to Vue Components

Elements that no `data-test` at all — need to be added by the developer.

| Vue Component | Element | Suggested `data-test` | Priority |
|---|---|---|---|
| Date-time picker | Popover container | `dashboard-datetime-popover` | HIGH |
| `QueryInspector.vue` | ODialog root | `query-inspector-dialog` | HIGH |
| Alert confirmation dialog | ODialog root | `alert-confirm-dialog` | HIGH |
| Log detail dialog | ODialog root | `log-detail-dialog` | HIGH |
| Alert destinations stepper | Stepper container | `alert-destination-stepper` | HIGH |
| Alert destinations step | Each step | `alert-destination-step-{n}` | HIGH |
| Org create form | Validation error text | `org-name-validation-error` | MEDIUM |
| Dashboard confirm/delete | ODialog root | `dashboard-confirm-dialog` | MEDIUM |
| `VariableSettings.vue` | Scope select | `variable-scope-select` | MEDIUM |
| Region selector | Per-region option | `region-option-${regionId}` | MEDIUM |
| Log detail panel | o2 ID value field | `log-detail-o2-id` | MEDIUM |
| OToast | Toast container | `o-toast` | HIGH |
| OToast (error) | Error toast | `o-toast-error` | HIGH |

---

## 10. Quick Fix Summary (Priority Order)

```
1. dashCreation.js          — confirm-button → o-dialog-primary-btn (5 lines)
2. dashboard-selectors.js   — remove .q-dialog, .q-menu from SELECTORS constants
3. dashboard-variables-*.spec.js — .q-dialog → dashboard-settings-drawer (25+ lines)
4. streamsPage.js           — confirm-button → o-dialog-primary-btn
5. metricsBuilderPage.js    — confirm-button → o-dialog-primary-btn
6. dashboard-regression.spec.js — confirm-button × 4
7. visualize.spec.js / visualize-vrl.spec.js — confirm-button × 2
8. dashboard-create-alert.spec.js — confirm-button × 1
9. alertsPage.js / alertCreationWizard.js — .q-menu, .q-dialog, .q-notification
10. All Escape key usages near dialogs — replace with o-dialog-close-btn click
```

---

*Audit scope: actual codebase scan | 303 stale locators in 51 files | 2026-05-20*
