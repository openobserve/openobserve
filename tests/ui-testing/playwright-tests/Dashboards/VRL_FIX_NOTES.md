# VRL Test Cases - Fix Notes

## Issue Fixed

**Error**: `TimeoutError: locator.click: Timeout 15000ms exceeded` when trying to click on transform type selector.

## Root Cause

The test was trying to click on the wrong element:
```javascript
// ❌ OLD APPROACH (INCORRECT)
await page.locator('[data-test="logs-search-bar-transform-type-select"]')
  .locator('input[aria-label="Transform Type"]')
  .click();
```

This was trying to access a dropdown that doesn't exist or is not the correct way to enable VRL.

## Solution

Based on the UI screenshot and HTML element provided, the correct approach is to directly click the VRL toggle button:

```javascript
// ✅ NEW APPROACH (CORRECT)
const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
const isChecked = await vrlToggle.getAttribute("aria-checked");

if (isChecked === "false") {
  await vrlToggle.click();
  await page.waitForTimeout(1000);
}
```

## Helper Function Created

A reusable helper function was created to enable VRL editor:

```javascript
async function enableVrlEditor(page) {
  const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
  await vrlToggle.waitFor({ state: "visible", timeout: 10000 });

  const isChecked = await vrlToggle.getAttribute("aria-checked");

  if (isChecked === "false") {
    await vrlToggle.click();
    await page.waitForTimeout(1000);
  }
}
```

## Element Details

The correct VRL toggle button element:

```html
<div
  class="q-toggle cursor-pointer..."
  role="switch"
  aria-checked="true"
  data-test="logs-search-bar-show-query-toggle-btn"
  title="Toggle Function Editor"
>
  <!-- Toggle button with function.svg icon -->
</div>
```

## Key Attributes

- **data-test**: `logs-search-bar-show-query-toggle-btn`
- **role**: `switch`
- **aria-checked**: `"true"` (enabled) or `"false"` (disabled)
- **title**: "Toggle Function Editor"

## All Test Cases Updated

All 10 test cases have been updated to use the `enableVrlEditor()` helper function:

1. ✅ Display VRL Function Toggle and Editor
2. ✅ Apply VRL Function and Display Results
3. ✅ Restrict Chart Type to Table Only
4. ✅ Show Error for All Non-Table Chart Types
5. ✅ Save VRL Panel to Dashboard
6. ✅ Handle Complex VRL Function
7. ✅ Preserve VRL Function Across Tabs
8. ✅ Override Histogram Default Chart Type
9. ✅ Create Multiple VRL Fields
10. ✅ Allow Table Chart Selection

## Testing the Fix

Run the tests to verify the fix:

```bash
# Run all VRL tests
npx playwright test tests/ui-testing/playwright-tests/dashboards/visualize-vrl.spec.js

# Run specific test
npx playwright test visualize-vrl.spec.js -g "Should apply VRL function"

# Run in headed mode to see the fix in action
npx playwright test visualize-vrl.spec.js --headed
```

## Expected Behavior

1. Test navigates to logs page
2. Fills SQL query editor
3. Sets time range
4. **Clicks VRL toggle button** (the function icon button in toolbar)
5. VRL editor appears
6. Test fills VRL function (e.g., `.vrl=100`)
7. Applies query
8. Opens visualization tab
9. Verifies table chart renders
10. Tests continue successfully

## No More Timeout Errors

The helper function:
- ✅ Waits for the toggle button to be visible (max 10 seconds)
- ✅ Checks if VRL editor is already enabled (aria-checked attribute)
- ✅ Only clicks if needed (avoids unnecessary clicks)
- ✅ Adds small delay after click for editor to appear
- ✅ Uses correct element selector

---

**Fixed Date**: 2026-01-30
**Issue**: Timeout clicking transform type selector
**Solution**: Direct VRL toggle button click with aria-checked check
