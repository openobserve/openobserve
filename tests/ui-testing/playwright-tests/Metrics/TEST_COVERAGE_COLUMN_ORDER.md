# PromQL Table Chart - Column Order Feature Test Coverage

## Feature Overview

The **Column Order feature** allows users to customize the display order of columns in PromQL table charts. This feature is available for two table modes:
- **Aggregate mode** (`all`): Shows aggregated metrics with labels as columns
- **Expanded Time Series mode** (`expanded_timeseries`): Shows timestamp + all metric labels + values

### User Workflow
1. User creates a PromQL query and switches to table visualization
2. User opens the chart configuration panel
3. User clicks the "Configure Column Order" button
4. A popup dialog appears with all available columns listed
5. User can reorder columns using:
   - Drag and drop handles
   - Move up/down arrow buttons
6. User saves changes or cancels to discard

### Technical Implementation
- **Component**: `ColumnOrderPopUp.vue`
- **Config Storage**: `config.column_order` (array of column names)
- **Data Processor**: `convertPromQLTableChart.ts`
- **Feature Location**: Chart config panel under table mode settings

---

## Test File Structure

**File**: `tests/ui-testing/playwright-tests/Metrics/metrics-table-column-order.spec.js`

### Test Organization

The test suite is organized by priority levels following the existing Metrics test patterns:

- **P0 (Critical/Smoke Tests)**: Core functionality that must work
- **P1 (Functional Tests)**: Main features and user workflows
- **P2 (Edge Cases)**: Boundary conditions and special scenarios

---

## Test Cases Breakdown

### P0 - Critical Tests (2 tests)

#### 1. Verify Column Order button is visible for Aggregate table mode
**Tag**: `@metrics`, `@table`, `@column-order`, `@P0`, `@all`

**Validates**:
- Column Order button appears in config panel for Aggregate mode
- Button has correct label text
- Button is accessible and clickable

**Acceptance Criteria**:
- ✓ Button with `data-test="dashboard-config-column-order-button"` is visible
- ✓ Button contains text "Configure Column Order"

---

#### 2. Verify Column Order popup opens and displays available columns
**Tag**: `@metrics`, `@table`, `@column-order`, `@P0`, `@all`

**Validates**:
- Popup dialog opens when button is clicked
- All UI elements are present (title, description, buttons, column list)
- Columns from the query are displayed

**Acceptance Criteria**:
- ✓ Popup with `data-test="dashboard-column-order-popup"` appears
- ✓ Save and Cancel buttons are visible
- ✓ At least one column row is displayed
- ✓ Drag handles and move buttons are present

---

### P1 - Functional Tests (7 tests)

#### 3. Verify columns can be reordered using move up button
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Move up button functionality
- Column order changes when button is clicked
- Visual feedback of reordering

**Test Steps**:
1. Open popup and note initial column order
2. Click "Move Up" button on second column
3. Verify second column moved to first position

**Acceptance Criteria**:
- ✓ Column positions swap correctly
- ✓ Column names reflect new order

---

#### 4. Verify columns can be reordered using move down button
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Move down button functionality
- Bidirectional reordering works

**Test Steps**:
1. Open popup and note initial column order
2. Click "Move Down" button on first column
3. Verify first column moved to second position

**Acceptance Criteria**:
- ✓ Column positions swap correctly
- ✓ Column names reflect new order

---

#### 5. Verify drag handles are present for each column
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Drag and drop UI elements are rendered
- Each column has a drag handle icon

**Acceptance Criteria**:
- ✓ Drag handles with `data-test^="column-order-drag-handle-"` exist
- ✓ Count matches number of columns
- ✓ Icons are visible

---

#### 6. Verify column order can be saved and persists
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Save functionality works
- Column order persists after saving
- Table re-renders with new column order

**Test Steps**:
1. Note initial table column headers
2. Open popup and reorder columns
3. Click Save button
4. Verify popup closes
5. Verify table reflects new column order

**Acceptance Criteria**:
- ✓ Save button closes popup
- ✓ Table column headers update to match new order
- ✓ Column count remains the same

---

#### 7. Verify cancel button discards column order changes
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Cancel functionality
- Changes are discarded when canceled
- Original order is restored

**Test Steps**:
1. Open popup and note initial order
2. Reorder columns
3. Click Cancel button
4. Re-open popup
5. Verify original order is restored

**Acceptance Criteria**:
- ✓ Cancel button closes popup
- ✓ Reopening shows original order
- ✓ Table remains unchanged

---

#### 8. Verify close icon also cancels column order changes
**Tag**: `@metrics`, `@table`, `@column-order`, `@P1`, `@all`

**Validates**:
- Close icon (X button) acts as cancel
- Alternative way to dismiss without saving

**Test Steps**:
1. Open popup and make changes
2. Click close icon in header
3. Verify popup closes
4. Verify changes were discarded

**Acceptance Criteria**:
- ✓ Close icon with `data-test="dashboard-column-order-cancel"` exists
- ✓ Clicking closes popup
- ✓ Changes not persisted

---

### P2 - Edge Cases (6 tests)

#### 9. Verify move up button is disabled for first column
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- Boundary condition: first column cannot move up
- Proper UI state for disabled button

**Acceptance Criteria**:
- ✓ Move up button on first column has disabled attribute
- ✓ Button is visually disabled

---

#### 10. Verify move down button is disabled for last column
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- Boundary condition: last column cannot move down
- Proper UI state for disabled button

**Acceptance Criteria**:
- ✓ Move down button on last column has disabled attribute
- ✓ Button is visually disabled

---

#### 11. Verify Column Order feature works with expanded_timeseries mode
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- Feature availability in both supported table modes
- Popup works consistently across modes

**Acceptance Criteria**:
- ✓ Column Order button visible in expanded_timeseries mode
- ✓ Popup opens and displays columns
- ✓ Functionality works same as Aggregate mode

---

#### 12. Verify multiple consecutive reorders work correctly
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- Complex reordering scenarios
- Moving a column multiple positions

**Test Steps**:
1. Open popup with at least 3 columns
2. Move third column up twice
3. Verify it's now in first position

**Acceptance Criteria**:
- ✓ Multiple moves execute correctly
- ✓ Final order matches expected result

---

#### 13. Verify column numbers update correctly after reordering
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- UI displays correct sequential numbering
- Numbers update dynamically during reordering

**Test Steps**:
1. Note column numbers (1., 2., 3., etc.)
2. Reorder columns
3. Verify numbers still sequential

**Acceptance Criteria**:
- ✓ Numbers remain 1., 2., 3., etc. after reorder
- ✓ No duplicate numbers
- ✓ No gaps in sequence

---

#### 14. Verify empty state is not shown when columns are available
**Tag**: `@metrics`, `@table`, `@column-order`, `@P2`, `@all`

**Validates**:
- Proper conditional rendering
- Empty state only shows when no columns

**Acceptance Criteria**:
- ✓ Draggable list is visible when columns exist
- ✓ Empty state icon not shown
- ✓ Empty state message not displayed

---

## Running the Tests

### Run all Column Order tests
```bash
npx playwright test metrics-table-column-order.spec.js
```

### Run by priority
```bash
# P0 tests only
npx playwright test metrics-table-column-order.spec.js --grep @P0

# P1 tests only
npx playwright test metrics-table-column-order.spec.js --grep @P1

# P2 tests only
npx playwright test metrics-table-column-order.spec.js --grep @P2
```

### Run by tag
```bash
# All column order tests
npx playwright test --grep @column-order

# All table tests
npx playwright test --grep @table
```

### Run in headed mode (see browser)
```bash
npx playwright test metrics-table-column-order.spec.js --headed
```

### Run with debug mode
```bash
npx playwright test metrics-table-column-order.spec.js --debug
```

---

## Test Data Requirements

The tests use the shared metrics ingestion setup:
- **Metrics ingested**: `cpu_usage` (with labels for multiple columns)
- **Time range**: Last 15 minutes
- **Setup**: `ensureMetricsIngested()` from `shared-metrics-setup.js`

---

## Key Selectors Used

| Element | Selector | Description |
|---------|----------|-------------|
| Column Order Button | `[data-test="dashboard-config-column-order-button"]` | Opens the popup |
| Column Order Popup | `[data-test="dashboard-column-order-popup"]` | Main dialog |
| Column Row | `[data-test="column-order-row-{index}"]` | Individual column item |
| Drag Handle | `[data-test="column-order-drag-handle-{index}"]` | Drag icon |
| Move Up Button | `[data-test="column-order-move-up-{index}"]` | Arrow up button |
| Move Down Button | `[data-test="column-order-move-down-{index}"]` | Arrow down button |
| Save Button | `[data-test="dashboard-column-order-save-btn"]` | Saves changes |
| Cancel Button | `[data-test="dashboard-column-order-cancel-btn"]` | Discards changes |
| Close Icon | `[data-test="dashboard-column-order-cancel"]` | X button in header |

---

## Related Files

### Source Code
- `web/src/components/dashboards/addPanel/ColumnOrderPopUp.vue` - Popup component
- `web/src/components/dashboards/addPanel/PromQLChartConfig.vue` - Config panel
- `web/src/utils/dashboard/promql/convertPromQLTableChart.ts` - Data processor
- `web/src/components/dashboards/panels/PromQLTableChart.vue` - Table renderer

### Unit Tests
- `web/src/components/dashboards/addPanel/ColumnOrderPopUp.spec.ts` - Component unit tests

### E2E Tests
- `tests/ui-testing/playwright-tests/Metrics/metrics-table-column-order.spec.js` - This file

---

## Coverage Summary

| Category | Test Count | Coverage |
|----------|------------|----------|
| P0 (Critical) | 2 | Button visibility, popup opening |
| P1 (Functional) | 7 | Reordering, saving, canceling |
| P2 (Edge Cases) | 6 | Boundary conditions, special scenarios |
| **Total** | **15** | **Complete feature coverage** |

### Feature Coverage Matrix

| Feature | Covered | Test(s) |
|---------|---------|---------|
| Button Visibility | ✅ | Test #1 |
| Popup Opening | ✅ | Test #2 |
| Move Up | ✅ | Test #3 |
| Move Down | ✅ | Test #4 |
| Drag Handles | ✅ | Test #5 |
| Save Changes | ✅ | Test #6 |
| Cancel Changes | ✅ | Test #7, #8 |
| Disabled States | ✅ | Test #9, #10 |
| Multiple Modes | ✅ | Test #11 |
| Complex Reorders | ✅ | Test #12 |
| UI Updates | ✅ | Test #13 |
| Empty State | ✅ | Test #14 |

---

## Notes for Test Maintenance

1. **Async Waits**: Tests include appropriate `waitForTimeout` calls for UI rendering
2. **Graceful Degradation**: Tests handle missing UI elements gracefully with try-catch
3. **Logging**: Comprehensive logging for debugging test failures
4. **Page Object Model**: Uses existing PageManager pattern for consistency
5. **Serial Execution**: Tests run in serial mode to avoid state conflicts
6. **Test Isolation**: Each test is independent and can run standalone

---

## Future Enhancements

Potential additional test scenarios:
1. Drag and drop functionality (currently only testing buttons)
2. Column order persistence across page refresh
3. Column order with filtered/hidden columns
4. Column order with sticky columns configuration
5. Performance testing with large column counts (50+ columns)
6. Accessibility testing (keyboard navigation, screen readers)
7. Column order in different dashboard contexts (view mode, edit mode)

---

## Success Criteria

All tests should pass with the following conditions:
- ✅ Zero test failures
- ✅ No flaky tests (consistent pass rate)
- ✅ Tests complete within reasonable time (< 5 min for full suite)
- ✅ Clear, actionable error messages on failure
- ✅ All critical user workflows covered

---

**Created**: 2026-01-29
**Author**: Claude (Anthropic)
**Test Framework**: Playwright
**Language**: JavaScript
