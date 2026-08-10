# Test Setup Contract: Synthetics Variables Panel  (area: Synthetics)

## Overview
The Variables Panel is a purely UI-side feature — it reads/writes the `BrowserCheck.variables` array and emits `update:check` to the parent. No test data streams or ingestion are required. Every test starts with an empty variables array and exercises the panel's local state.

Tests run against the **Create Browser Check wizard** (`/synthetics/add?type=browser`), which is behind the Enterprise/Cloud route guard. The run must target an Enterprise or Cloud deployment.

## Streams / data the spec must establish
**NONE.** This feature operates entirely on the `BrowserCheck` JavaScript object in the Vue component tree. Variable data is serialized with the rest of the check on save, but save is a parent concern — the Variables Panel tests only need the wizard's in-memory state.

## How to navigate to the feature (copy this EXACT pattern)

### Precondition: authenticated session
The shared test fixture (from `enhanced-baseFixtures.js`) handles authentication. All tests use:
```js
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
```

### Navigate to the Create Browser Check wizard
```js
// See: tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:134
await navigateToBase(page);
const baseUrl = process.env["ZO_BASE_URL"];
const orgId = process.env["ORGNAME"];
await page.goto(`${baseUrl}/web/synthetics/add?type=browser&org_identifier=${orgId}`, {
  waitUntil: 'domcontentloaded',
  timeout: 15000,
});
```

### Enter the gate and reach the Journey step
```js
// Fill URL (gate screen)
const urlInput = page.locator('[data-test="synthetics-create-url-input"]');
await urlInput.fill('https://example.com');
// Fill name
const nameInput = page.locator('[data-test="synthetics-create-name-input"]');
await nameInput.fill('Test Check');
// Click "Build manually"
const buildBtn = page.locator('[data-test="synthetics-create-build-btn"]');
await buildBtn.click();
// Wait for the Journey step to load — the Variables panel should be visible
await page.locator('[data-test="synthetics-check-variables-panel"]').waitFor({ state: 'visible', timeout: 10000 });
```

## Preconditions / toggles
- **Variables panel visible on Journey step**: After entering the wizard via "Build manually", the panel renders by default (`variablesPanelOpen` initialises to `true` in `CreateBrowserTest.vue:80`).
- **Variables panel visible on Configure step**: Click "Continue" (`[data-test="synthetics-create-continue-btn"]`) to advance. The panel is always visible on Configure (no toggle).
- **Empty state**: A fresh check starts with `variables: []` (`CreateBrowserTest.vue:462`), so the empty state renders immediately.
- **Toggle panel on Journey step**: The toggle button (`[data-test="synthetics-journey-toggle-variables-btn"]`) controls `variablesPanelOpen`. When closed, the panel `v-if="variablesPanelOpen"` unmounts it.
- **Add step for usage counting**: Click `[data-test="synthetics-journey-add-step-btn"]` to add a journey step, then reference `{{VARIABLE_NAME}}` in the step's value field to increment usage. The step editor lives inside the expanded row (`<template #expansion>`).

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **Enterprise/Cloud only**: The route `/synthetics/add` is guarded in `useEnterpriseRoutes.ts:174`. Running against an OSS build will result in a 404 or blank page. The CI run context says "oss" edition but the route is enterprise-gated — verify the target deployment is enterprise.
2. **Slow gate URL validation**: The "Build manually" button enables only after `isGateUrlValid` is truthy. The OInput uses `@blur="validateGateUrl"` — typing and tabbing out triggers validation. A test filling the URL should blur or tab away before clicking the button.
3. **Empty name error only after attempt**: The "Name is required" error message only appears after the user clicks Add/Save at least once (`attempted` ref). Assert no error on a freshly opened form.
4. **index-based selectors**: Variable cards are numbered by array index (0, 1, 2...). After a delete+undo, the restored variable regains its original index. After a permanent delete, indices shift. Write tests that track cardinal index or iterate by card content rather than hardcoding indices that may reorder.
5. **Undo timer**: The undo row auto-dismisses after ~6 seconds (`UNDO_MS = 6000`). Tests should either assert within the window or `page.clock.fastForward()` to skip.
6. **No API calls from the panel**: Variables are only persisted as part of the parent's `persist()` call. The panel's `emit("update:check", ...)` is local state; to verify server-side persistence, the test must click Save in the Configure step footer.
7. **Splitter state is module-scoped**: `variablesSplitter` in `useCheckWizardUi.ts` is a module-level `ref`. Dragging the splitter on the Journey step carries to the Configure step and vice versa. This is relevant if a test resizes the panel.
8. **Add form auto-scroll**: Opening the add form triggers `scrollIntoView`. If a test needs to verify the form is open, wait for the scroll to settle before interaction.
9. **Secure values show placeholder**: When `variable.secure` is true, the card displays `t("synthetics.authNetwork.passwordPlaceholder")` (masked dots) instead of the actual value. The OInput in edit mode uses `type="password"`. The test cannot read the secure value from the DOM.

## Page Manager
There is no dedicated Synthetics page object in `tests/ui-testing/pages/`. The Engineer should interact with the feature directly via Playwright locators using the selectors documented in the Feature Design Document.

## Example: minimal test bootstrap
```js
// tests/ui-testing/playwright-tests/Synthetics/variablesPanel.spec.js
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');

test.describe('Synthetics-Core', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    const baseUrl = process.env["ZO_BASE_URL"];
    const orgId = process.env["ORGNAME"];
    await page.goto(`${baseUrl}/web/synthetics/add?type=browser&org_identifier=${orgId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    // Fill gate
    await page.locator('[data-test="synthetics-create-url-input"]').fill('https://example.com');
    await page.locator('[data-test="synthetics-create-name-input"]').fill('Variables Test');
    await page.locator('[data-test="synthetics-create-build-btn"]').click();
    // Ensure panel is mounted
    await page.locator('[data-test="synthetics-check-variables-panel"]').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('shows empty state when no variables exist', async ({ page }) => {
    await expect(page.locator('[data-test="synthetics-check-variables-panel-empty"]')).toBeVisible();
    await expect(page.locator('[data-test="synthetics-check-variables-panel-add-variable-btn"]')).not.toBeVisible();
  });
});
```
