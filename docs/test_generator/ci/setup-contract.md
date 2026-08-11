# Test Setup Contract: Functions Language Toggle (area: Functions)

## Streams / data the spec must establish
**No streams or ingested data are required.** The Functions Language Toggle is a purely UI-level component inside the Add/Edit Function form. It requires:
- An authenticated user session
- Navigation to the Functions list page in the appropriate organization

No function pre-creation, stream ingestion, or schema seeding is needed.

---

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Auth / session
- The standard `navigateToBase(page)` + the `PageManager` pattern already used in all existing Functions specs.
- See: `tests/ui-testing/playwright-tests/Functions/functions-form-validation.spec.js:13-16`
- See: `tests/ui-testing/playwright-tests/Functions/js-transform-type.spec.js:27-34`

### Organization navigation
- **For JS toggle tests (_meta org)**: Navigate to `?org_identifier=_meta`
  - See: `tests/ui-testing/playwright-tests/Functions/js-transform-type.spec.js:40-47`
  - ```js
    await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    ```
- **For VRL-only tests (non-meta org)**: Use `process.env.ORGNAME || 'default'`
  - See: `tests/ui-testing/playwright-tests/Functions/functions-form-validation.spec.js:110`
  - ```js
    await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${process.env.ORGNAME || 'default'}`);
    ```

### Edition detection
- The `isJsAllowed` gate (`config.isEnterprise`, `config.isCloud`, `_meta` org) is runtime-detectable.
  - See: `tests/ui-testing/playwright-tests/Functions/js-transform-type.spec.js:248`
  - ```js
    const edition = await pm.editionFeaturesPage.detectEdition();
    // returns 'opensource' | 'enterprise' | 'cloud'
    ```

### Page objects (already registered in PageManager)
- `pm.functionsPage` — class `FunctionsPage` (`tests/ui-testing/pages/functionsPages/functionsPage.js`)
  - Key methods: `clickAddFunctionButton(org)`, `expectVrlRadioVisible()`, `expectJsRadioVisible()`, `expectJsRadioHidden()`, `expectVrlRadioSelected()`, `expectJsRadioSelected()`, `isJsRadioVisible()`, `selectJavaScriptType()`, `selectVRLType()`, `clickCancelButton()`, `fillFunctionName(name)`, `clickSaveButton()`
- `pm.functionsFormValidation` — class `FunctionsFormValidationPage` (`tests/ui-testing/pages/functionsPages/functionsFormValidationPage.js`)
  - Key methods: `openAddFunctionForm(org)`, `assertVrlRadioSelected()`, `fillFunctionName(name)`, `clickSave()`, `expectFunctionNameError(message)`, `expectFunctionNameErrorVisible()`
- `pm.editionFeaturesPage` — class `EditionFeaturesPage` (`tests/ui-testing/pages/generalPages/editionFeaturesPage.js`)
  - Key method: `detectEdition()`

### Opening the form and asserting toggle state
- See: `tests/ui-testing/playwright-tests/Functions/functions-form-validation.spec.js:106-113`
  ```js
  await fv.openAddFunctionForm(process.env.ORGNAME || 'default');
  await fv.assertVrlRadioSelected();
  ```
- See: `tests/ui-testing/playwright-tests/Functions/js-transform-type.spec.js:59-60`
  ```js
  await pm.functionsPage.clickAddFunctionButton('_meta');
  await pm.functionsPage.expectJsRadioVisible();
  ```

---

## Preconditions / toggles
- **JS visibility gating**: No feature flags or environment variables required. The gate is resolved at runtime from:
  - `config.isEnterprise` / `config.isCloud` (build-time, from `web/src/aws-exports`)
  - `store.state.selectedOrganization.identifier` (runtime, set by URL `?org_identifier=<org>` or org switcher)
- **No SQL mode / quick mode / other ambient state** affects the toggle. The toggle is self-contained in the Add Function form.

---

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **OToggleGroupItem selection attribute**: Selection state is exposed via Reka-UI's `data-state="on"|"off"` (NOT `aria-checked` or `checked` or `aria-pressed`). Assert with `toHaveAttribute('data-state', 'on')`. See `tests/ui-testing/pages/functionsPages/functionsPage.js:328-334` for the existing assertion pattern.

2. **JS option may not exist at all**: In OSS non-meta orgs, `[data-test="function-transform-type-js-option"]` is NOT in the DOM (not just hidden). Use `isJsRadioVisible()` (catches the not-found case) before asserting visibility, and `expectJsRadioHidden()` (asserts `not.toBeVisible()` which handles absent element gracefully). See `tests/ui-testing/pages/functionsPages/functionsPage.js:378-384`.

3. **Navigate back to list before re-opening form**: If a test leaves the Add Function form open (clicked cancel or navigated away), ensure the next test goes back to the functions list page before clicking "Add function" again. The `clickAddFunctionButton(org)` method already handles this auto-recovery — it checks if the button is visible and re-navigates if not. See `tests/ui-testing/pages/functionsPages/functionsPage.js:96-116`.

4. **Org must be specified**: Navigation to functions requires `?org_identifier=<org>` in the URL. Without it, the app may redirect to a default org that doesn't match the test's expectation.

5. **No function cleanup needed for toggle-only tests**: If the test only verifies the toggle presence/selection without saving a function, no cleanup is needed. If a function IS saved, clean up with `pm.functionsPage.deleteFunctionByName(name, org)`.

6. **Edition detection is asynchronous**: `detectEdition()` reads the header button text, which needs the page to be loaded. Call it AFTER navigation (and `waitForLoadState('networkidle')`). If the edition button isn't visible (e.g., narrow viewport), the test should fall back gracefully — existing tests use the edition to decide JS visibility expectation, not to gate entire test execution.
