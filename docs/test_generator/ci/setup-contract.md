# Test Setup Contract: OTable Select Cell Selection  (area: GeneralTests)

## Streams / data the spec must establish

No stream/ingestion is required — this feature is IAM table UI with no backend data dependency
beyond a service-account row.

- `<unique service account>` **[per-test]** — one freshly created, non-system Service Account row per
  test, with a unique name. Why: provides a selectable row for single-row select/deselect and a
  guaranteed row for select-all assertions. Created and deleted inside each test (see below).
- `SRE Agent system-managed row` **[shared/read-only]** — may or may not be present depending on the
  environment. It is **non-selectable** (`row.is_system`), rendered with
  `data-test="service-accounts-system-account-label"`. No setup: just assert around it (the
  `expectAllSelectableRowsSelected` helper already excludes it).

## How to create it (copy these EXACT patterns — do NOT invent setup)

The existing spec `tests/ui-testing/playwright-tests/GeneralTests/otableSelectCell.spec.js` already
contains the full, working setup/teardown. Reuse it verbatim:

- **Navigate + create the row (per-test, `beforeEach`)**:
  ```js
  const pm = new PageManager(page);
  const uniqueName = `sa${Date.now()}x${Math.floor(Math.random() * 10000)}`;
  const email = pm.iamPage.serviceAccountEmailFor(uniqueName);
  await pm.iamPage.gotoIamPage();                    // left nav → IAM
  await pm.iamPage.iamPageServiceAccountsTab();      // click Service Accounts tab
  await pm.iamPage.iamPageAddServiceAccount();       // open add dialog
  await pm.iamPage.enterNameServiceAccount(uniqueName);
  await pm.iamPage.clickSaveServiceAccount();
  await pm.iamPage.verifySuccessMessage('Service account created successfully.');
  await pm.iamPage.clickServiceAccountPopUpClosed(); // close token dialog
  await pm.iamPage.reloadServiceAccountPage();       // page.reload + tab wait
  await pm.iamPage.waitForSelectCell(email);         // readiness gate
  ```
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/otableSelectCell.spec.js:13-31`.
  Helpers: `tests/ui-testing/pages/iamPages/iamPage.js` — `gotoIamPage` (114), `iamPageServiceAccountsTab`
  (141), `iamPageAddServiceAccount` (147), `enterNameServiceAccount` (167), `serviceAccountEmailFor` (179),
  `clickSaveServiceAccount` (199), `verifySuccessMessage` (204), `clickServiceAccountPopUpClosed` (243),
  `reloadServiceAccountPage` (251), `waitForSelectCell` (339).

- **Teardown (per-test, `afterEach`, best-effort)**:
  ```js
  await pm.iamPage.deletedServiceAccount(email);   // opens delete dialog
  await pm.iamPage.requestServiceAccountOk();       // confirms + waits for dialog close
  ```
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/otableSelectCell.spec.js:33-41`.
  Helpers: `deletedServiceAccount` (258), `requestServiceAccountOk` (277).

- **Auth / org**: worker auth state from `enhanced-baseFixtures` + `navigateToBase(page)`. Org name
  comes from `process.env.ORGNAME || 'default'` (used by `serviceAccountEmailFor`, `iamPage.js:180`).
  The synthetic identifier is `<name>.<org>@sa.internal` (lowercased).

- **Timing / readiness**: after creation the token dialog must be closed and the page reloaded; the
  single gate to wait on is `waitForSelectCell(email)` (`expect(...).toBeVisible({ timeout: 15000 })`,
  `iamPage.js:339-341`). Do not use `networkidle` — deployed envs poll RUM/analytics continuously
  (`iamPage.js:253` comment).

## Preconditions / toggles

- Ensure the Service Accounts **tab** is active before asserting; the table is only rendered there.
- No SQL mode / quick-mode toggles involved.
- Non-selectable rows (system / `o2-sre-agent.*`) are disabled by `isRowSelectable`
  (`ServiceAccountsList.vue:1138-1140`); select-all never includes them.

## Selection helper contract (already implemented in `iamPage.js:335-398`)

| Helper | What it does | Underlying selector |
|--------|--------------|---------------------|
| `waitForSelectCell(email)` | gates row readiness | `td[data-test="o2-table-select-cell"]` scoped to row |
| `clickSelectCellPadding(email)` | clicks `x = width-4` of the cell (padding, not checkbox) | same cell |
| `clickSelectAllCellPadding()` | clicks `x = width-4` of header cell | `th[data-test="o2-table-th-select"]` |
| `clickCheckboxByEmail(email)` | clicks the checkbox square | cell → `button[role="checkbox"]` |
| `expectRowCheckboxChecked/Unchecked(email)` | asserts `data-state` | cell → `button[role="checkbox"]` |
| `expectSelectAllCheckboxChecked/Unchecked()` | asserts header `data-state` | `[data-test="o2-table-select-all"] button[role="checkbox"]` |
| `expectDeleteSelectedBtnVisible/Hidden()` | asserts bulk-delete button | `[data-test="service-accounts-list-delete-accounts-btn"]` |
| `expectAllSelectableRowsSelected()` | all non-system row checkboxes checked | tbody `tr[data-test^="o2-table-row-"]` minus system row |

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Header checkbox data-test is `o2-table-select-all`, NOT `o2-table-select-header`** — the header
  passes `row-id="all"` (`OTableHeader.vue:511`), overriding the `rowId ?? 'header'` default in
  `OTableSelectCheckbox.vue`.
- **Row checkbox data-test is index-based** (`o2-table-select-{row.index}`), so it changes with
  sort/filter/pagination. Always scope by email anchor (`selectCellByEmail`) — never hardcode an index.
- **The select cell is 44px wide** (`TABLE_CHECKBOX_COL_SIZE`, `OTable.types.ts:88`) with the checkbox
  (`size="sm"` = 14px) on the left and `padding-left: var(--spacing-table-edge)`. Clicking the padding
  means clicking near the **right** edge (`x = width - 4`); clicking the left/center lands on the
  checkbox square and exercises the (parked) double-fire path instead.
- **Padding click ≠ row-click**: the select cell uses `@click.stop`, so padding clicks toggle selection
  without firing `row-click` — do not assert navigation on selection.
- **The `test.fixme` (checkbox square) is parked** — clicking `button[role="checkbox"]` directly can
  double-fire in the browser (`OCheckbox.vue` `<label @click.stop>` forwards a second click). Keep it a
  `fixme`; do not try to make it green by retrying, which would mask the defect.
- **Cleanup is best-effort** — the `afterEach` delete is wrapped in try/catch because a failed delete
  must not mask a test failure (`otableSelectCell.spec.js:33-41`).
