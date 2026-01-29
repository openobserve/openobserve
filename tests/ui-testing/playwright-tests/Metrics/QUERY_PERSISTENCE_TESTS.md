# Column Order Persistence - Query Execution Tests

## Overview

These test cases verify that column order configuration persists correctly after running queries, re-running queries, and switching between different chart types.

### ⚠️ Important: Timestamp Column Behavior

**The `Timestamp` column is ALWAYS in the first position (position 0) in the table and is NOT reorderable.**

This means:
- **Column Order Popup**: Shows only reorderable columns (e.g., `__name__`, `environment`, `flag`, etc.)
- **Table Chart**: Shows `Timestamp` in position 0, then the reorderable columns starting from position 1

**Example**:
```
Column Order Popup positions:
├─ Position 0: __name__
├─ Position 1: environment
└─ Position 2: flag

Table Chart positions:
├─ Position 0: Timestamp (NOT in popup, always first)
├─ Position 1: __name__ (popup position 0)
├─ Position 2: environment (popup position 1)
└─ Position 3: flag (popup position 2)
```

When we move a column to "1st position" in the popup, it becomes **2nd position in the table** (after Timestamp).

---

## Test Cases Added

### 1. ✅ **Verify column order persists after re-running the query** (P1)

**Test File**: `metrics-table-column-order.spec.js`

**Scenario**:
1. User executes a query (e.g., `cpu_usage`)
2. User switches to table chart and sets table mode to "Expanded Time series"
3. User opens Column Order popup and reorders columns (moves 2nd column to 1st position)
4. User saves the column order configuration
5. User closes the config sidebar
6. **User re-runs the query by clicking Apply button**
7. Verify the table still shows columns in the custom order (NOT default order)

**Expected Result**:
- ✅ Column order configuration persists after re-running the query
- ✅ The column that was moved to 1st position remains in 1st position
- ✅ Table renders with custom column order, not default order

**Why This Matters**:
This is the core scenario you mentioned - verifying that when users set column ordering and then run the query again, the order position remains the same on the table chart.

**Code Location**: Lines ~660-720

---

### 2. ✅ **Verify column order persists when switching between chart types** (P1)

**Test File**: `metrics-table-column-order.spec.js`

**Scenario**:
1. User sets custom column order in table chart
2. User saves the column order
3. **User switches to a different chart type (e.g., line chart)**
4. **User switches back to table chart**
5. Verify the column order is still maintained

**Expected Result**:
- ✅ Column order persists when switching away from table and back to table
- ✅ Column order configuration is not lost during chart type changes
- ✅ User doesn't need to reconfigure column order after switching chart types

**Why This Matters**:
Users often switch between different visualizations while exploring data. Column order should persist across these switches.

**Code Location**: Lines ~722-770

---

### 3. ✅ **Verify column order is maintained with different queries on same metric** (P2)

**Test File**: `metrics-table-column-order.spec.js`

**Scenario**:
1. User sets custom column order for query `cpu_usage`
2. User saves the column order
3. User closes config sidebar
4. **User modifies the query to `sum(cpu_usage)` (adds aggregation)**
5. User re-runs the modified query
6. Verify table renders (behavior may differ based on query type)

**Expected Result**:
- ✅ Table renders successfully with modified query
- ⚠️ Column order behavior is documented (may differ if column structure changes significantly)
- ✅ No errors occur when query is modified

**Why This Matters**:
This test documents how column ordering behaves when the query structure changes. If the same columns are present, order should persist. If columns change significantly (e.g., aggregation removes labels), behavior may differ.

**Code Location**: Lines ~772-840

---

## Test Execution

### Run All Query Persistence Tests

```bash
# Run all P1 tests (includes the 2 critical persistence tests)
npx playwright test metrics-table-column-order.spec.js --grep @P1

# Run all tests
npx playwright test metrics-table-column-order.spec.js

# Run with headed mode to see behavior
npx playwright test metrics-table-column-order.spec.js --headed

# Run specific test
npx playwright test metrics-table-column-order.spec.js -g "persists after re-running the query"
```

---

## Complete Test Suite Summary

After adding these tests, the complete test suite now has **19 test cases**:

### P0 - Critical (2 tests)
1. Verify Column Order button is visible for Expanded Time series table mode
2. Verify Column Order popup opens and displays available columns

### P1 - Functional (9 tests)
3. Verify columns can be reordered using move up button
4. Verify columns can be reordered using move down button
5. Verify drag handles are present for each column
6. Verify column order can be saved and persists
7. Verify cancel button discards column order changes
8. Verify close icon also cancels column order changes
9. ✅ **NEW: Verify column order changes are reflected in the actual table chart**
10. ✅ **NEW: Verify column order persists after re-running the query**
11. ✅ **NEW: Verify column order persists when switching between chart types**

### P2 - Edge Cases (8 tests)
12. Verify move up button is disabled for first column
13. Verify move down button is disabled for last column
14. Verify Column Order button is NOT visible for Time series mode
15. Verify Column Order feature works with Aggregate mode
16. Verify multiple consecutive reorders work correctly
17. Verify column numbers update correctly after reordering
18. Verify empty state is not shown when columns are available
19. ✅ **NEW: Verify column order is maintained with different queries on same metric**

---

## Visual Test Flow for Re-running Query Test

```
┌─────────────────────────────────────────────────────┐
│ 1. Execute query: cpu_usage                         │
│    Switch to table chart                            │
│    Set mode: Expanded Time series                   │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 2. Initial Table State:                             │
│    [Timestamp] [__name__] [environment] [flag]      │
│     ^always     ^pos 1      ^pos 2        ^pos 3    │
│                                                      │
│    Column Order Popup shows (no Timestamp):         │
│    [__name__] [environment] [flag]                  │
│     ^pos 0     ^pos 1        ^pos 2                 │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 3. Move popup position 1 to position 0              │
│    (Move "environment" up)                          │
│                                                      │
│    New order in popup:                              │
│    [environment] [__name__] [flag]                  │
│     ^pos 0        ^pos 1     ^pos 2                 │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 4. Click Save                                       │
│    Column order configuration saved                 │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 5. Verify table shows new order:                    │
│    [Timestamp] [environment] [__name__] [flag]      │
│     ^always     ^NOW pos 1   ^NOW pos 2   ^pos 3   │
│    ✅ "environment" correctly in position 1         │
│       (2nd column after Timestamp)                  │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 6. Close config sidebar                             │
│    Click Apply to re-run query                      │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 7. Query executes again                             │
│    Table re-renders                                 │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 8. Verify order still maintained:                   │
│    [Timestamp] [environment] [__name__] [flag]      │
│     ^always     ^STILL pos 1 ^STILL pos 2 ^pos 3   │
│    ✅ Persistence verified!                         │
│    ✅ "environment" remains in position 1           │
└─────────────────────────────────────────────────────┘
```

---

## Key Verification Points

For each test, we verify:

1. ✅ **Initial State**: Table has correct initial column order
2. ✅ **Configuration**: Column order can be changed in popup
3. ✅ **Save Action**: Changes are saved successfully
4. ✅ **Immediate Effect**: Table updates to show new order right away
5. ✅ **Persistence**: Order remains after query re-execution
6. ✅ **Consistency**: Same columns appear in same order

---

## Debugging Failed Tests

If column order doesn't persist after re-running query:

### 1. Check if configuration is saved
```javascript
// Add this after saving
testLogger.info('Checking if column order config was saved');
await page.screenshot({ path: 'test-results/after-save.png' });
```

### 2. Check table state before and after re-run
```javascript
// Before re-run
const beforeHeaders = await page.locator('table thead th').allTextContents();
testLogger.info(`Headers before re-run: ${JSON.stringify(beforeHeaders)}`);

// After re-run
const afterHeaders = await page.locator('table thead th').allTextContents();
testLogger.info(`Headers after re-run: ${JSON.stringify(afterHeaders)}`);
```

### 3. Check if query actually re-executed
```javascript
// Add network listener
page.on('response', response => {
  if (response.url().includes('/api/')) {
    testLogger.info(`API call: ${response.url()}`);
  }
});
```

---

## Related Files

- **Test File**: `tests/ui-testing/playwright-tests/Metrics/metrics-table-column-order.spec.js`
- **Vue Component**: `web/src/components/dashboards/addPanel/ColumnOrderPopUp.vue`
- **Table Component**: `web/src/components/dashboards/panels/PromQLTableChart.vue`
- **Column Order Logic**: `web/src/utils/dashboard/promql/convertPromQLTableChart.ts` (lines 63-84)

---

**Created**: 2026-01-29
**Purpose**: Document column order persistence tests for query re-execution scenarios
**Priority**: P1 - Critical for user experience
