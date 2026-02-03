# VRL Visualization Support - Test Cases

## Overview

This test suite contains **20 Priority 1 (P1) test cases** for VRL (Vector Remap Language) visualization support. VRL functions are currently **only supported for table charts**.

## Test File

**Location**: `tests/ui-testing/playwright-tests/dashboards/visualize-vrl.spec.js`

## Key Feature Behavior

Based on the UI screenshots and design:
- ✅ VRL functions can be added via a toggle/editor in the visualization toolbar
- ✅ VRL functions work with `SELECT *` and aggregation queries
- ✅ **Only table charts are supported** when VRL functions are present
- ✅ Attempting to switch to line/bar/area/scatter charts shows an error notification
- ✅ VRL panels can be saved to dashboards
- ✅ VRL configuration persists across tab switches

## Test Cases Summary

### 1. ✅ Display VRL Function Toggle and Editor
**Test**: `[P1] Should display VRL function toggle and editor in visualization tab`

**What it tests**:
- VRL toggle button is visible in visualization toolbar
- VRL editor appears when toggle is clicked
- Editor is ready to accept VRL code

---

### 2. ✅ Apply VRL Function and Display Results
**Test**: `[P1] Should apply VRL function and display results in table visualization`

**What it tests**:
- VRL function (`.vrl=100`) applies successfully
- Table visualization renders with data
- Table chart is automatically selected
- Data rows are visible

---

### 3. ✅ Chart Type Restriction to Table Only
**Test**: `[P1] Should restrict chart type to table only when VRL function is present`

**What it tests**:
- Error notification appears when trying to switch to line chart
- Error message: "VRL functions are present. Only table chart is supported when using VRL functions."
- Table chart remains selected after attempted switch

---

### 4. ✅ Error for All Non-Table Chart Types
**Test**: `[P1] Should show error for all non-table chart types when VRL is present`

**What it tests**:
- Line chart switch shows error
- Bar chart switch shows error
- Area chart switch shows error
- Scatter chart switch shows error
- Table chart always remains selected

---

### 5. ✅ Save VRL Panel to Dashboard
**Test**: `[P1] Should save VRL panel to dashboard and preserve VRL configuration`

**What it tests**:
- "Add To Dashboard" button works with VRL panels
- Panel saves successfully
- Panel renders on dashboard with table visualization
- VRL configuration is preserved

---

### 6. ✅ Complex VRL Function Handling
**Test**: `[P1] Should handle complex VRL function with multiple field creation`

**VRL Example**:
```vrl
.vrl_status = "processed"
.vrl_count = 100
.vrl_flag = true
```

**What it tests**:
- Complex VRL with multiple fields executes correctly
- Multiple VRL-generated fields appear
- No dashboard errors
- Table has multiple columns

---

### 7. ✅ VRL Persistence Across Tabs
**Test**: `[P1] Should preserve VRL function when switching between logs and visualize tabs`

**What it tests**:
- VRL function persists when switching from Visualize → Logs
- VRL function persists when switching from Logs → Visualize
- Chart continues to render correctly
- No errors after tab switches

---

### 8. ✅ Histogram Query Override
**Test**: `[P1] Should override histogram default chart type (line) to table when VRL is present`

**What it tests**:
- Histogram queries normally default to line chart
- With VRL present, table chart is selected instead
- Line chart is NOT selected
- Chart renders without errors

---

### 9. ✅ Multiple VRL Fields Display
**Test**: `[P1] Should create multiple VRL fields and display all in table`

**VRL Example**:
```vrl
.new_field = "test_value"
.status = "success"
```

**What it tests**:
- Multiple VRL-generated fields are created
- All fields appear as columns in table
- Table has data rows
- All columns are visible

---

### 10. ✅ Table Chart Selection Allowed
**Test**: `[P1] Should allow table chart selection but no other chart types with VRL`

**What it tests**:
- Table chart can be clicked/selected without error
- No error notification appears for table chart
- Other chart types still show errors
- Table chart remains functional

---

### 11. ✅ Dynamic Columns Configuration
**Test**: `[P1] Should enable dynamic columns configuration when VRL function is applied`

**What it tests**:
- Table chart automatically enables dynamic columns for VRL
- VRL-generated columns appear in the table
- Column headers are visible
- VRL column data is displayed correctly

---

### 12. ✅ VRL Toggle Disable/Re-enable
**Test**: `[P1] Should disable VRL toggle and allow chart type switching`

**What it tests**:
- VRL toggle can be disabled after being enabled
- VRL function editor can be cleared
- Query can be run without VRL after disabling
- Behavior changes when VRL is disabled

---

### 13. ✅ H-Bar Chart Restriction
**Test**: `[P1] Should show error for h-bar chart when VRL function is present`

**What it tests**:
- H-bar chart switch shows error when VRL is present
- Error message appears correctly
- Table chart remains selected after attempted switch
- VRL restriction applies to all chart types including h-bar

---

### 14. ✅ Query Refresh Persistence
**Test**: `[P1] Should persist VRL function after running query multiple times`

**What it tests**:
- VRL function persists after running query in visualization tab
- Chart renders correctly after multiple query executions
- Table chart remains selected
- VRL column values remain visible

---

### 15. ✅ VRL Data Types Display
**Test**: `[P1] Should display VRL-generated fields as table columns with correct data types`

**VRL Example**:
```vrl
.vrl_string = "test"
.vrl_number = 42
.vrl_boolean = true
```

**What it tests**:
- String values are displayed correctly
- Number values are displayed correctly
- Boolean values are displayed correctly
- Multiple data type columns appear in table

---

### 16. ✅ Time Range Change Persistence
**Test**: `[P1] Should maintain VRL toggle state after changing time range`

**What it tests**:
- VRL toggle remains enabled after changing time range
- VRL editor remains visible
- VRL function is preserved
- Table chart is still selected in visualization

---

### 17. ✅ VRL with Aggregation Query
**Test**: `[P1] Should handle VRL with aggregation query and force table chart`

**SQL Example**:
```sql
SELECT kubernetes_namespace_name as "x_axis_1", count(*) as "y_axis_1"
FROM "e2e_automate" GROUP BY x_axis_1 LIMIT 10
```

**What it tests**:
- Aggregation queries with VRL force table chart (not bar/line)
- Data rows are displayed in table
- Bar chart switch shows VRL error
- VRL restriction applies to aggregation results

---

### 18. ✅ No VRL Error Without VRL
**Test**: `[P1] Should not show VRL error notification when VRL is not present`

**What it tests**:
- Without VRL, chart type switching works normally
- VRL-specific error message does NOT appear
- Other chart types can be selected
- Validates error message is specific to VRL

---

### 19. ✅ VRL Editor Format and Display
**Test**: `[P1] Should display VRL function editor with correct placeholder and format`

**What it tests**:
- VRL editor is visible when toggle is enabled
- Editor input area is ready for input
- VRL content can be entered correctly
- Editor displays correctly

---

### 20. ✅ Edit Dashboard Panel with VRL
**Test**: `[P1] Should preserve VRL configuration when editing existing dashboard panel`

**What it tests**:
- Dashboard panel with VRL can be edited
- VRL column is preserved in edit mode
- Table chart type remains selected
- VRL configuration survives edit/save cycle

---

## VRL Function Examples

### Simple VRL (from screenshot)
```vrl
.vrl=100
```

### Field Creation VRL
```vrl
.new_field = "test_value"
.status = "success"
```

### Complex VRL with Multiple Fields
```vrl
.vrl_status = "processed"
.vrl_count = 100
.vrl_flag = true
```

### Multi-Type VRL (String, Number, Boolean)
```vrl
.vrl_string = "test"
.vrl_number = 42
.vrl_boolean = true
```

## SQL Query Examples

### SELECT * Query
```sql
SELECT * FROM "e2e_automate"
```

### Aggregation Query
```sql
SELECT kubernetes_namespace_name as "x_axis_1",
       count(*) as "y_axis_1"
FROM "e2e_automate"
GROUP BY x_axis_1
LIMIT 10
```

### Histogram Query
```sql
SELECT histogram(_timestamp) as "x_axis_1",
       count(kubernetes_namespace_name) as "y_axis_1"
FROM "e2e_automate"
GROUP BY x_axis_1
ORDER BY x_axis_1 ASC
```

## Running the Tests

### Run all VRL tests:
```bash
npx playwright test tests/ui-testing/playwright-tests/dashboards/visualize-vrl.spec.js
```

### Run specific test:
```bash
npx playwright test visualize-vrl.spec.js -g "Should restrict chart type"
```

### Run in headed mode (see browser):
```bash
npx playwright test visualize-vrl.spec.js --headed
```

### Run with specific browser:
```bash
npx playwright test visualize-vrl.spec.js --project=chromium
```

### Run in debug mode:
```bash
npx playwright test visualize-vrl.spec.js --debug
```

## Test Execution Time

**Estimated Time**: ~8-10 minutes for all 20 tests

## Test Coverage

| Category | Coverage |
|----------|----------|
| VRL Editor UI | ✅ Toggle display, Editor visibility, Editor format |
| VRL Function Execution | ✅ Simple VRL, Complex VRL, Multiple fields, Data types |
| Chart Type Restrictions | ✅ Error for line/bar/area/scatter/h-bar, Table allowed |
| Dashboard Integration | ✅ Save panel, Load panel, Edit panel |
| Data Persistence | ✅ Tab switching, Time range change, Query refresh |
| Query Types | ✅ SELECT *, Aggregation, Histogram |
| Toggle State | ✅ Enable, Disable, Re-enable, Persistence |
| Dynamic Columns | ✅ Auto-enabled for VRL, Column display |
| Negative Testing | ✅ No VRL error when VRL not present |

## Error Messages Tested

### Chart Type Restriction Error:
```
"VRL functions are present. Only table chart is supported when using VRL functions."
```

This error appears when users try to switch from table chart to:
- Line chart
- Bar chart
- Area chart
- Scatter chart
- Pie chart

## Test Prerequisites

- **Stream**: `e2e_automate` with log data
- **Time Range**: Past 8 hours of data
- **Fields**: `kubernetes_namespace_name`, `_timestamp`, and other kubernetes fields
- **Ingestion**: Test data must be ingested via `dashIngestion.js`

## UI Elements Tested

### VRL-Specific Elements:
- `[data-test="logs-search-bar-show-query-toggle-btn"]` - VRL toggle button
- `[data-test="logs-vrl-function-editor"]` - VRL editor
- `[data-test="logs-search-bar-function-dropdown"]` - Transform type dropdown
- `[data-test="logs-search-bar-transform-type-select"]` - Transform type select

### Chart Elements:
- `[data-test="selected-chart-table-item"]` - Table chart selector
- `[data-test="selected-chart-line-item"]` - Line chart selector
- `[data-test="selected-chart-bar-item"]` - Bar chart selector
- `[data-test="selected-chart-area-item"]` - Area chart selector
- `[data-test="selected-chart-scatter-item"]` - Scatter chart selector

### Visualization Elements:
- `[data-test="dashboard-panel-table"]` - Table visualization
- `[data-test="chart-renderer"]` - Chart renderer canvas

## Known Limitations

1. **Chart Type**: Only table charts are supported with VRL (by design)
2. **Chart Switching**: Attempting to switch to non-table charts shows error
3. **Dynamic Columns**: Table charts with VRL automatically enable dynamic columns

## Integration with Existing Tests

This test suite follows the same patterns as:
- `visualize.spec.js` - Main visualization tests
- Uses `PageManager` for page object pattern
- Uses `ingestion()` helper for test data
- Uses `deleteDashboard()` for cleanup

## CI/CD Integration

```yaml
# Add to .github/workflows/playwright.yml
- name: Run VRL Visualization Tests
  run: npx playwright test tests/ui-testing/playwright-tests/dashboards/visualize-vrl.spec.js
```

## Troubleshooting

### Test fails: "VRL toggle not visible"
**Fix**: Ensure you're in the visualization tab, not logs tab

### Test fails: "Table not rendering"
**Fix**: Verify `e2e_automate` stream has data in the past 8 hours

### Test fails: "Error notification not appearing"
**Fix**: Ensure VRL function was actually applied before switching chart type

### Test timeout: "Query taking too long"
**Fix**: Reduce time range from "8h" to "1h" or check ingestion

## Screenshots Reference

Based on the provided screenshots, the tests cover:
1. ✅ VRL toggle button in toolbar (highlighted in red)
2. ✅ VRL function editor showing `.vrl=100`
3. ✅ Table chart with data displayed
4. ✅ Error notification when switching chart types
5. ✅ "Add To Dashboard" button functionality

## Related Documentation

- **Design Doc**: https://github.com/openobserve/designs/blob/main/visualization-vrl-support/VRL_VISUALIZATION_SUPPORT_HLD.md
- **VRL Language**: https://vector.dev/docs/reference/vrl/
- **Playwright Docs**: https://playwright.dev/

---

**Test Suite Version**: 2.0
**Created**: 2026-01-30
**Updated**: 2026-01-31
**Test Count**: 20 P1 test cases
**Estimated Execution Time**: 8-10 minutes
