# Troubleshooting: Table Mode Not Changing

## Problem
The PromQL Table Mode is not changing from "Time series" to "Expanded Time series", causing the Column Order button to not appear.

---

## Root Cause Analysis

The Column Order button only appears when the table mode is set to:
- ✅ **"Expanded Time series"**
- ✅ **"Aggregate"**

It does NOT appear when:
- ❌ **"Time series"** (the default)

---

## New Solution Implemented

### 1. **Text-Based Selector Approach**

Instead of relying on `data-test` attributes, the new logic:

```javascript
// Step 1: Find the label first
const tableModeLabel = page.locator('text=PromQL Table Mode').first();

// Step 2: Scroll to ensure visibility
await tableModeLabel.scrollIntoViewIfNeeded();

// Step 3: Find dropdown near the label
const tableModeDropdown = page.locator('[data-test="dashboard-config-table-mode"]').first();
// OR fallback to finding .q-select near the label
```

### 2. **Multiple Fallback Strategies**

The code now tries multiple ways to find the dropdown:

1. **Primary**: `[data-test="dashboard-config-table-mode"]`
2. **Fallback 1**: `.q-select` near the label
3. **Fallback 2**: `.q-field` in parent section

### 3. **Enhanced Debugging**

The code now:
- ✅ Logs current mode before changing
- ✅ Takes screenshots if anything fails
- ✅ Logs all available options in dropdown
- ✅ Verifies mode actually changed after selection
- ✅ Provides clear error messages

---

## Debugging Steps

### Step 1: Check Test Logs

Look for these log messages:

```
✅ GOOD - Mode changed successfully:
Found PromQL Table Mode label
Current table mode dropdown shows: Time series
Clicking table mode dropdown
Dropdown menu is visible
Available options in dropdown: ["Time series","Expanded Time series","Aggregate"]
Looking for mode option: "Expanded Time series"
Found and clicking option: "Expanded Time series"
Table mode after selection shows: Expanded Time series
✓ Table mode successfully set to: Expanded Time series
```

```
❌ BAD - Mode did not change:
Found PromQL Table Mode label
Current table mode dropdown shows: Time series
Clicking table mode dropdown
Dropdown menu did not appear after clicking
```

### Step 2: Check Screenshots

If mode change fails, check these screenshots in `test-results/`:

| Screenshot | What it shows |
|------------|---------------|
| `dropdown-not-found.png` | Table mode dropdown not located |
| `dropdown-not-open.png` | Dropdown didn't open after click |
| `table-mode-not-changed.png` | Mode value didn't change after selection |
| `mode-still-time-series.png` | Mode is still "Time series" when button is checked |
| `column-order-button-missing.png` | Column Order button not in DOM |

### Step 3: Manual Verification

Test manually in the UI:

1. Go to Metrics page
2. Execute query: `cpu_usage`
3. Switch to Table chart
4. Open config sidebar (click gear icon)
5. Look for "PromQL Table Mode" dropdown
6. Current value should show "Time series"
7. Click the dropdown - does menu appear?
8. Select "Expanded Time series"
9. Does value change?
10. Does "Configure Column Order" button appear below?

---

## Common Issues & Solutions

### Issue 1: Dropdown Not Found

**Symptom**:
```
Could not find table mode dropdown near the label
```

**Possible Causes**:
- Config panel not fully loaded
- Selector has changed in UI
- Element is outside viewport

**Solution**:
```javascript
// Add longer wait
await page.waitForTimeout(3000);

// Try scrolling the entire config panel
const configPanel = page.locator('.dashboard-sidebar, .config-sidebar').first();
await configPanel.evaluate(el => el.scrollTop = 0);

// Then scroll to the specific element
await tableModeLabel.scrollIntoViewIfNeeded();
```

---

### Issue 2: Dropdown Doesn't Open

**Symptom**:
```
Dropdown menu did not appear after clicking
```

**Possible Causes**:
- Click didn't register
- Element was obscured
- JavaScript not loaded

**Solution**:
```javascript
// Force click
await tableModeDropdown.click({ force: true });

// OR try multiple click types
await tableModeDropdown.click();
await page.waitForTimeout(300);
await tableModeDropdown.click({ clickCount: 2 });

// OR use keyboard
await tableModeDropdown.focus();
await page.keyboard.press('Enter');
```

---

### Issue 3: Option Not Found in Dropdown

**Symptom**:
```
Could not find option "Expanded Time series" in dropdown
Available options: ["Time series"]
```

**Possible Causes**:
- Options not loaded yet
- Chart type doesn't support all modes
- Query results affect available modes

**Solution**:
```javascript
// Wait longer for options to load
await page.waitForTimeout(1500);

// Check what options are actually available
const allOptions = await page.locator('[role="option"]').allTextContents();
console.log('Available options:', allOptions);

// If "Expanded Time series" not available, try "Aggregate"
if (!allOptions.some(opt => opt.includes('Expanded'))) {
  // Try selecting Aggregate instead
  const aggOption = page.locator('[role="option"]').filter({ hasText: 'Aggregate' }).first();
  await aggOption.click();
}
```

---

### Issue 4: Mode Appears to Change But Reverts

**Symptom**:
```
Table mode after selection shows: Time series
(Expected: Expanded Time series)
```

**Possible Causes**:
- Selection didn't save
- UI refreshed and reset mode
- Mode not compatible with current query

**Solution**:
```javascript
// After clicking option, verify and retry if needed
await modeOption.click();
await page.waitForTimeout(2000);

const newMode = await tableModeDropdown.textContent();
if (!newMode.includes('Expanded')) {
  testLogger.warn('Mode reverted, trying again');
  await tableModeDropdown.click();
  await page.waitForTimeout(500);
  await modeOption.click();
  await page.waitForTimeout(2000);
}
```

---

### Issue 5: Column Order Button Still Not Visible

**Symptom**:
```
Current PromQL Table Mode: "Expanded Time series"
Column Order button count: 0
```

**Possible Causes**:
- Mode changed but UI not re-rendered
- Button only appears after additional action
- Button is behind a different tab

**Solution**:
```javascript
// Wait for UI to re-render after mode change
await page.waitForTimeout(3000);

// Try clicking the config tab to refresh
const configTab = page.locator('[role="tab"]').filter({ hasText: /config|chart/i }).first();
if (await configTab.isVisible().catch(() => false)) {
  await configTab.click();
  await page.waitForTimeout(500);
}

// Check if button is in a different tab
const tabs = await page.locator('[role="tab"]').allTextContents();
testLogger.info(`Available tabs: ${tabs.join(', ')}`);
```

---

## Testing the Fix

### Run with Full Debug Logging

```bash
# Run with headed mode and slow motion
npx playwright test metrics-table-column-order.spec.js --headed --slow-mo=1000

# Run with debug mode
npx playwright test metrics-table-column-order.spec.js --debug

# Run just the first P0 test
npx playwright test metrics-table-column-order.spec.js -g "Verify Column Order button is visible"
```

### Check Test Output

Look for these key indicators:

✅ **Success indicators:**
- `Found PromQL Table Mode label`
- `Dropdown menu is visible`
- `Table mode after selection shows: Expanded Time series`
- `✓ Table mode is set correctly`
- `Column Order button is visible`

❌ **Failure indicators:**
- `Dropdown menu did not appear`
- `Could not find option`
- `Table mode may not have changed`
- `mode is still "Time series"`
- `Column Order button NOT FOUND in DOM`

---

## Alternative Workaround

If the mode selection still doesn't work, try this manual approach:

```javascript
// Instead of trying to change the mode programmatically,
// we can use the Page Evaluate API to set it directly

await page.evaluate(() => {
  // Find the Vue component and set the mode directly
  const configElement = document.querySelector('[data-test="dashboard-config-table-mode"]');
  if (configElement && configElement.__vue__) {
    // This is a hacky way but might work if dropdown selection fails
    configElement.__vue__.$emit('update:modelValue', 'expanded_timeseries');
  }
});
```

**Note**: This is a last resort and not recommended as it bypasses actual user interaction.

---

## Expected Behavior

After running the fixed code:

1. ✅ Config sidebar opens
2. ✅ "PromQL Table Mode" dropdown found
3. ✅ Dropdown clicked and menu appears
4. ✅ "Expanded Time series" option found and clicked
5. ✅ Mode changes from "Time series" to "Expanded Time series"
6. ✅ UI re-renders with new mode
7. ✅ "Configure Column Order" button appears
8. ✅ Test continues successfully

---

## Contact for Help

If issue persists after trying all these solutions:

1. Provide full test logs
2. Provide all screenshots from `test-results/`
3. Confirm UI version and any recent changes
4. Try running test with `--headed` mode and record a video

---

**Updated**: 2026-01-29
**Status**: Enhanced with multiple fallback strategies
**Priority**: P0 - Critical for Column Order feature testing
