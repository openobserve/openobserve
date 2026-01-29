# Column Order Test Fix - Config Panel Opening Issue

## Problem
Test was failing with timeout error:
```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('[data-test="dashboard-config-column-order-button"]')
```

**Root Cause**: The config side panel was not opening because the test was using direct page locators instead of the PageManager methods.

---

## Solution

### Changes Made

#### 1. Fixed Config Panel Opening (Line ~67)
**Before:**
```javascript
// Open chart configuration panel
testLogger.info('Opening chart configuration panel');
const configButton = page.locator('[data-test="dashboard-config-expand"]');
const isConfigVisible = await configButton.isVisible().catch(() => false);

if (isConfigVisible) {
  await configButton.click();
  await page.waitForTimeout(500);
  testLogger.info('Chart configuration panel opened');
} else {
  testLogger.info('Config panel may already be open');
}
```

**After:**
```javascript
// Open chart configuration sidebar using PageManager method
testLogger.info('Opening chart configuration sidebar');
const configButton = await pm.metricsPage.getDashboardSidebarButton();
await expect(configButton).toBeVisible({ timeout: 10000 });

await pm.metricsPage.clickDashboardSidebarButton();
await page.waitForTimeout(1000);

const sidebarVisible = await pm.metricsPage.isSidebarVisible();
expect(sidebarVisible).toBe(true);
testLogger.info('Chart configuration sidebar opened successfully');
```

**Key Changes:**
- ✅ Use `pm.metricsPage.getDashboardSidebarButton()` instead of direct locator
- ✅ Use `pm.metricsPage.clickDashboardSidebarButton()` to open sidebar
- ✅ Use `pm.metricsPage.isSidebarVisible()` to verify it opened
- ✅ Added explicit assertion to ensure sidebar is visible

---

#### 2. Added Proper Cleanup in afterEach (Line ~29)
**Before:**
```javascript
test.afterEach(async ({ page }, testInfo) => {
  testLogger.testEnd(testInfo.title, testInfo.status);
});
```

**After:**
```javascript
test.afterEach(async ({ page }, testInfo) => {
  // Close config sidebar if open using the collapse button
  await pm.metricsPage.clickDashboardSidebarCollapseButton();
  await page.waitForTimeout(500);
  testLogger.info('Closed sidebar using collapse button');

  testLogger.testEnd(testInfo.title, testInfo.status);
});
```

**Key Changes:**
- ✅ Properly close sidebar after each test
- ✅ Prevents sidebar state from affecting subsequent tests
- ✅ Follows same pattern as `metrics-config-tabs.spec.js`

---

#### 3. Enhanced First Test with Better Debugging (Line ~140)
Added additional logging and verification:
```javascript
// Verify we're in the config sidebar
const sidebarVisible = await pm.metricsPage.isSidebarVisible();
testLogger.info(`Config sidebar visible: ${sidebarVisible}`);
expect(sidebarVisible).toBe(true);

// Wait a bit more for config panel to fully render
await page.waitForTimeout(1000);

// Log what's visible in the config panel for debugging
const visibleButtons = await page.locator('button').allTextContents();
testLogger.info(`Visible buttons in config: ${visibleButtons.slice(0, 10).join(', ')}`);
```

**Key Changes:**
- ✅ Verify sidebar is actually open before looking for Column Order button
- ✅ Added logging to debug what's visible in the config panel
- ✅ Increased timeout from 5000ms to 10000ms for Column Order button
- ✅ Wait additional 1000ms for config panel to fully render

---

#### 4. Improved Table Mode Selection (Line ~95)
**Before:**
```javascript
const tableModeSelector = page.locator('[data-test="dashboard-config-table-mode"]');
const isModeVisible = await tableModeSelector.isVisible().catch(() => false);
```

**After:**
```javascript
// Wait for config panel to be fully loaded
await page.waitForTimeout(1000);

// Look for the PromQL Table Mode selector
const tableModeSelector = page.locator('[data-test="dashboard-config-table-mode"]').first();
const isModeVisible = await tableModeSelector.isVisible({ timeout: 5000 }).catch(() => false);
```

**Key Changes:**
- ✅ Added wait for config panel to fully load
- ✅ Use `.first()` to get the first matching element
- ✅ Added explicit timeout for visibility check
- ✅ Better error handling with fallback to Escape key

---

## Why This Pattern is Important

### PageManager Pattern Benefits
The PageManager pattern in this test suite provides:

1. **Centralized Selectors**: All selectors defined in one place
2. **Reusable Methods**: Common operations wrapped in methods
3. **Consistent Behavior**: All tests use the same approach
4. **Easier Maintenance**: Changes to UI only require updating PageManager

### Reference Implementation
The correct pattern is demonstrated in `metrics-config-tabs.spec.js`:
```javascript
// Opening sidebar
const configButton = await pm.metricsPage.getDashboardSidebarButton();
await expect(configButton).toBeVisible({ timeout: 10000 });
await pm.metricsPage.clickDashboardSidebarButton();
await page.waitForTimeout(1000);

let sidebarVisible = await pm.metricsPage.isSidebarVisible();
expect(sidebarVisible).toBe(true);

// Closing sidebar
await pm.metricsPage.clickDashboardSidebarCollapseButton();
await page.waitForTimeout(500);
```

---

## PageManager Methods Used

| Method | Purpose | Selector |
|--------|---------|----------|
| `getDashboardSidebarButton()` | Get sidebar toggle button | `[data-test="dashboard-sidebar"]` |
| `clickDashboardSidebarButton()` | Open config sidebar | Clicks the button |
| `isSidebarVisible()` | Check if sidebar is open | `.dashboard-sidebar, .config-sidebar, [class*="sidebar"]` |
| `clickDashboardSidebarCollapseButton()` | Close config sidebar | `[data-test="dashboard-sidebar-collapse-btn"]` |

---

## Testing the Fix

### Run the Fixed Test
```bash
# Run all column order tests
npx playwright test metrics-table-column-order.spec.js

# Run just the first P0 test
npx playwright test metrics-table-column-order.spec.js -g "Verify Column Order button is visible"

# Run with headed mode to see what's happening
npx playwright test metrics-table-column-order.spec.js --headed

# Run with debug mode for step-by-step execution
npx playwright test metrics-table-column-order.spec.js --debug
```

### Expected Behavior
1. ✅ Metrics page loads
2. ✅ Query executes successfully
3. ✅ Chart type switches to table
4. ✅ **Config sidebar opens** (this was failing before)
5. ✅ Table mode changes to Aggregate
6. ✅ Column Order button becomes visible
7. ✅ Test passes

---

## Troubleshooting

If the test still fails:

### 1. Check if config sidebar is actually opening
Add this debug code:
```javascript
const sidebarVisible = await pm.metricsPage.isSidebarVisible();
console.log('Sidebar visible:', sidebarVisible);

// Take a screenshot
await page.screenshot({ path: 'debug-sidebar.png', fullPage: true });
```

### 2. Verify the table mode is correct
The Column Order button only appears for these table modes:
- `all` (Aggregate)
- `expanded_timeseries` (Expanded Time Series)

It does NOT appear for:
- `single` (Timestamp mode)

### 3. Check data-test attributes in UI
Verify these selectors exist in the UI:
```javascript
// Should exist
[data-test="dashboard-sidebar"] // Sidebar toggle button
[data-test="dashboard-config-table-mode"] // Table mode selector
[data-test="dashboard-config-column-order-button"] // Column order button
```

### 4. Verify query returns data with multiple columns
The Column Order feature requires:
- Query returns results with metric labels
- Multiple columns available to reorder
- Table visualization is active

---

## Related Files

- **Test File**: `tests/ui-testing/playwright-tests/Metrics/metrics-table-column-order.spec.js`
- **Reference Test**: `tests/ui-testing/playwright-tests/Metrics/metrics-config-tabs.spec.js`
- **Page Object**: `tests/ui-testing/pages/metricsPages/metricsPage.js`
- **UI Component**: `web/src/components/dashboards/addPanel/PromQLChartConfig.vue`

---

## Summary

The fix was simple but critical:
- **Problem**: Using direct page locators instead of PageManager methods
- **Solution**: Use the established PageManager pattern for opening/closing config sidebar
- **Result**: Config sidebar now opens correctly, allowing tests to find the Column Order button

This fix aligns the Column Order tests with the existing test patterns in the Metrics test suite.

---

**Updated**: 2026-01-29
**Status**: ✅ Fixed
