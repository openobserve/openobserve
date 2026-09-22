# Test Setup Contract: OTable Select Cell Click Selection  (area: GeneralTests)

Host page: **Settings → Model Pricing** (`/web/settings/model_pricing?org_identifier={ORGNAME}`).
This is the OSS page that renders `OTable` with `selection="multiple"`, **no** `isRowSelectable`
guard, and seeded built-in rows — so the feature's toggle path is reachable without creating data.

## Streams / data the spec must establish

No stream/ingestion is involved — this is a component-interaction feature backed by seeded
config rows. Data conditions:

- `[shared/read-only]` **Built-in model-pricing rows** — source `built_in`, always present on the
  "All" tab (the Model Pricing spec asserts `builtInTable.locator('tbody tr').first()` is visible,
  see `model-pricing.spec.js:128`). Why: every test just reads/selects them; never mutate/delete them.
- `[per-test]` *(optional)* **Own org model** — only needed if a test must assert the
  `model-pricing-delete-selected-btn` (gated by `selectedIdsOnlyContainsOwn`, i.e. selected rows
  whose `source === "org"` and `org_id === current`). For the core select/deselect assertions,
  `model-pricing-export-selected-btn` (visible for ANY selection) + the checkbox `data-state` are
  sufficient and require no per-test creation.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / org**: `navigateToBase(page)` → `new PageManager(page)` →
  `pm.modelPricingPage.gotoModelPricingPage()`.
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/model-pricing.spec.js:103-105` and
  `tests/ui-testing/pages/generalPages/modelPricingPage.js:131-137`.
  `ORGNAME` defaults to `default` (env-driven).
- **Wait for table ready**: `await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 15000 })`
  (`listTitle` = `[data-test="model-pricing-list-table"]`).
- **Optional own-model creation (API)**: copy `apiCreateModel(defaultBody(name, pattern))` from
  `tests/ui-testing/playwright-tests/GeneralTests/model-pricing.spec.js:46-101`, using
  `getAuthHeaders()` / `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`; clean up via `apiDeleteModel(id)`.

## Selectors the assertions must use

| Intent | Selector |
|--------|----------|
| Row select cell (click PADDING) | `[data-test="model-pricing-list-table"] td[data-test="o2-table-select-cell"]` |
| Row checkbox (assert state) | `label[data-test^="o2-table-select-"] button[role="checkbox"]` (NOT `input`) |
| Header select-all cell (click PADDING) | `[data-test="model-pricing-list-table"] th[data-test="o2-table-th-select"]` |
| Header select-all checkbox | `[data-test="o2-table-select-all"] button[role="checkbox"]` |
| Selection observable | `[data-test="model-pricing-export-selected-btn"]` (appears when ≥1 row selected) |

## Preconditions / toggles

- `selection="multiple"` is hardcoded on the host (ModelPricingList.vue:95); no toggle to flip.
- No SQL/quick-mode, no RBAC gating relevant here (read-only selection). Built-in rows are
  selectable (no guard); do NOT attempt the delete-selected button with built-in rows selected.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Click the padding, not the checkbox.** The select cell is 44px wide (`TABLE_CHECKBOX_COL_SIZE`,
   `OTable.types.ts:88`), `paddingLeft ≈14px`, checkbox `size-sm` = 14px → the checkbox label spans
   x∈[14,28]. A naive `.click()` on the `<td>` hits x=22 **on the checkbox**, which toggles via the
   checkbox path (still selects, but does not exercise the cell-padding feature). Use
   `td[data-test="o2-table-select-cell"]`.click with `position: { x: 40, y: <center> }` (or the
   equivalent right-edge offset) for the padding path. Same for `th[data-test="o2-table-th-select"]`.
2. **Checkbox is a `<button role="checkbox">`, not `<input>`.** Assert via `data-state="checked"`
   (or `aria-checked`), never `.isChecked()` on a native input. Precedent:
   `modelPricingPage.js:229` ("OCheckbox renders as button[role=checkbox]").
3. **Strict-mode prefix collision.** `data-test^="o2-table-select-"` matches the cell
   (`o2-table-select-cell`) AND the checkbox labels (`o2-table-select-0`, `...-all`). Scope cell
   clicks to the exact `td[data-test="o2-table-select-cell"]` and checkbox clicks to
   `label[data-test^="o2-table-select-"] button[role="checkbox"]`. Precedent: `dashboard-favorites.js:89-93`.
4. **Do NOT host on IAM Users in OSS.** `User.vue` sets `:is-row-selectable="row => row.enableDelete"`
   with `enableDelete = config.isCloud == "true" ? true : false` — every OSS row is non-selectable,
   so the select cell silently no-ops. This is the #1 "tests fail because the wrong page was picked"
   trap for this feature.
5. **Selection must not navigate.** The select cell / checkbox both `@click.stop`, so no `row-click`
   fires. If a test observes a route change after a select-cell click, it means the click landed on a
   data cell or the row, not the select cell — re-check the position offset.
