# ConfigPanel E2E Writing Guide (Playwright)

## How to Write Tests — Step by Step

This guide explains how to write e2e tests for `ConfigPanel.vue` using the existing project patterns.

---

## Standard File Template

Every config panel spec file follows this structure:

```js
const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require("../utils/test-logger.js");

// Unique dashboard name per test run
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — <Feature Name>", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);           // populate test data
  });

  test("should ...", async ({ page }) => {
    const pm = new PageManager(page);

    // 1. Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // 2. Create dashboard + panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName("My Panel");

    // 3. Select chart type and stream
    await pm.chartTypeSelector.selectChartType("bar");     // or "table", "line", etc.
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // 4. Apply to render the chart
    await pm.dashboardPanelActions.applyDashboardBtn();

    // 5. Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // 6. Make config changes (see sections below)
    // ...

    // 7. Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();

    // 8. Assert
    // ...

    // 9. Save panel
    await pm.dashboardPanelActions.savePanel();

    // 10. Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
```

---

## Available PageManager Methods (Config Panel)

All config panel actions go through `pm.dashboardPanelConfigs`:

```js
pm.dashboardPanelConfigs.openConfigPanel()               // open the sidebar
pm.dashboardPanelConfigs.legendPosition("Right")         // legend position dropdown
pm.dashboardPanelConfigs.selectUnit("Bytes")             // unit dropdown
pm.dashboardPanelConfigs.selectDecimals("2")             // decimals input
pm.dashboardPanelConfigs.selectQueryLimit("100")         // query limit input
pm.dashboardPanelConfigs.selectNoValueReplace("N/A")     // no value replacement
pm.dashboardPanelConfigs.selectAxisWidth("80")           // axis width input
pm.dashboardPanelConfigs.Y_AxisMin("0")                  // y-axis min
pm.dashboardPanelConfigs.Y_AxisMax("100")                // y-axis max
pm.dashboardPanelConfigs.selectValuePosition("Top")      // label position
pm.dashboardPanelConfigs.selectValueRotate("45")         // label rotate
pm.dashboardPanelConfigs.selectSymbols("Circle")         // show symbol dropdown
pm.dashboardPanelConfigs.selectLineInterpolation("Linear") // line interpolation
pm.dashboardPanelConfigs.selectLineThickness("3")        // line thickness input
pm.dashboardPanelConfigs.selectTrellisLayout("Auto")     // trellis layout
pm.dashboardPanelConfigs.selectTranspose()               // table transpose toggle
pm.dashboardPanelConfigs.selectWrapCell()                // table wrap cells toggle
pm.dashboardPanelConfigs.selectDynamicColumns()          // table dynamic columns toggle
pm.dashboardPanelConfigs.addTimeShift()                  // add time shift entry
pm.dashboardPanelConfigs.removeTimeShift(0)              // remove time shift by index
pm.dashboardPanelConfigs.openColorBySeries()             // open color-by-series popup
pm.dashboardPanelConfigs.saveColorBySeries()             // save color-by-series
pm.dashboardPanelConfigs.cancelColorBySeries()           // cancel color-by-series
```

For panel time:
```js
pm.dashboardPanelTime.enablePanelTime()                  // toggle on
pm.dashboardPanelTime.disablePanelTime()                 // toggle off
pm.dashboardPanelTime.isPanelTimeEnabled()               // returns bool
pm.dashboardPanelTime.setPanelTimeRelative("1-h")        // set relative time
pm.dashboardPanelTime.setPanelTimeAbsolute(startDay, endDay)
```

---

## Tests Grouped by File (Priority Order)

Total: **168 tests** across **9 recommended spec files**

---

### File 1 — `dashboard-config-general.spec.js` (9 tests)

**What it covers:** Description, Unit, Decimals, No Value Replacement, Query Limit

| # | Test Name |
|---|-----------|
| 1 | Description field visible and editable for all chart types |
| 2 | Description persists after saving the panel |
| 3 | Custom chart type only shows description field |
| 4 | Set unit to "Bytes" → values display byte suffix |
| 5 | Set unit to "Custom" → custom unit input appears and applies |
| 6 | Set decimals to 0 → no decimal places in chart |
| 7 | Set decimals to 4 → 4 decimal places in chart |
| 8 | Set no-value replacement to "N/A" → empty cells show "N/A" |
| 9 | Query limit set to 100 → only 100 rows returned |

**How to write:**

```js
// Test 4 — Unit
test("should display byte suffix when unit is set to Bytes", async ({ page }) => {
  const pm = new PageManager(page);
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(randomDashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("bar");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
  await pm.dashboardPanelActions.applyDashboardBtn();

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.selectUnit("Bytes");      // pick "Bytes" from unit dropdown
  await pm.dashboardPanelActions.applyDashboardBtn();

  // Assert unit label is visible in y-axis
  const yAxis = page.locator(".echarts-for-react");
  await expect(yAxis).toBeVisible();

  await pm.dashboardPanelActions.savePanel();
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, randomDashboardName);
});
```

---

### File 2 — `dashboard-config-legends.spec.js` (13 tests)

**What it covers:** Show Legends, Legend Position, Legend Type, Legend Width/Height with unit toggle

| # | Test Name |
|---|-----------|
| 10 | Show Legends toggle visible for applicable chart types |
| 11 | Disable Show Legends → legend disappears from chart |
| 12 | Legend position set to "Right" → legend on right side |
| 13 | Legend position set to "Bottom" → legend on bottom |
| 14 | Legend position set to "Auto" → default behavior restored |
| 15 | Legend type set to "Scroll" → legend becomes scrollable |
| 16 | Legend type set to "Plain" → legend is static |
| 17 | Legend width input appears when position is "Right" |
| 18 | Set legend width in px → chart area adjusts |
| 19 | Toggle legend width unit: px → % |
| 20 | Legend height input appears when position is "Auto" or "Bottom" |
| 21 | Set legend height in px → chart area adjusts |
| 22 | Toggle legend height unit: px → % |

**How to write:**

```js
// Test 12 — Legend Position Right
test("should move legend to right when position is set to Right", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup: create dashboard, add bar chart panel, apply ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.legendPosition("Right");   // built-in method
  await pm.dashboardPanelActions.applyDashboardBtn();

  // Assert legend container is on the right side
  const legend = page.locator(".chart-legend");
  await expect(legend).toBeVisible();

  // cleanup ...
});

// Test 17 — Legend width input appears when position is Right
test("should show legend width input when position is Right", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.legendPosition("Right");

  // Assert legend width input is now visible
  const legendWidthInput = page.locator('[data-test="dashboard-config-legend-width"]');
  await expect(legendWidthInput).toBeVisible();

  // Assert legend height input is NOT visible
  const legendHeightInput = page.locator('[data-test="dashboard-config-legend-height"]');
  await expect(legendHeightInput).not.toBeVisible();

  // cleanup ...
});

// Test 19 — Toggle legend width unit px → %
test("should switch legend width unit between px and percent", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.legendPosition("Right");

  // px is active by default
  const pxBtn = page.locator('[data-test="dashboard-config-legend-width-unit-active"]').first();
  await expect(pxBtn).toBeVisible();

  // click % unit button
  await page.locator('[data-test="dashboard-config-legend-width-unit-inactive"]').click();

  // % button should now be active
  const percentBtn = page.locator('[data-test="dashboard-config-legend-width-unit-active"]').first();
  await expect(percentBtn).toBeVisible();

  // cleanup ...
});
```

---

### File 3 — `dashboard-config-table.spec.js` (11 tests)

**What it covers:** Wrap cells, Transpose, Dynamic Columns, Pagination, Rows per page
*(These only appear for `table` chart type)*

| # | Test Name |
|---|-----------|
| 23 | Wrap cells toggle visible only for table chart type |
| 24 | Enable wrap cells → long text wraps inside cells |
| 25 | Table transpose toggle visible only for table (non-PromQL) |
| 26 | Enable transpose → rows and columns are swapped |
| 27 | Dynamic columns toggle visible only for table (non-PromQL) |
| 28 | Enable dynamic columns → columns update dynamically |
| 29 | Pagination toggle visible only for table chart type |
| 30 | Enable pagination → pagination controls appear |
| 31 | Rows per page input appears only when pagination is enabled |
| 32 | Set rows per page to 25 → table shows 25 rows per page |
| 33 | Disable pagination → rows per page input disappears |

**How to write:**

```js
// Test 23 — Wrap cells only visible for table
test("should show wrap cells toggle only for table chart type", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with bar chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Not visible for bar chart
  await expect(page.locator('[data-test="dashboard-config-wrap-table-cells"]'))
    .not.toBeVisible();

  // cleanup, then repeat with table chart type
});

// Test 30 — Pagination enables controls
test("should show pagination controls when pagination is enabled", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with table chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Enable pagination
  await page.locator('[data-test="dashboard-config-show-pagination"]').click();
  await pm.dashboardPanelActions.applyDashboardBtn();

  // Pagination controls should appear in the rendered table
  const paginationControl = page.locator(".q-table__bottom");
  await expect(paginationControl).toBeVisible();

  // cleanup ...
});

// Test 31 — Rows per page appears only when pagination on
test("should show rows per page input only when pagination is enabled", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with table chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Not visible before enabling
  await expect(page.locator('[data-test="dashboard-config-rows-per-page"]'))
    .not.toBeVisible();

  // Enable pagination
  await page.locator('[data-test="dashboard-config-show-pagination"]').click();

  // Now visible
  await expect(page.locator('[data-test="dashboard-config-rows-per-page"]'))
    .toBeVisible();

  // cleanup ...
});
```

---

### File 4 — `dashboard-config-axis.spec.js` (14 tests)

**What it covers:** Y-Axis min/max, Axis Width, Show Border, Gridlines, Label Position, Label Rotate, Axis Label Rotate, Label Truncate

| # | Test Name |
|---|-----------|
| 34 | Y-axis min input visible for cartesian chart types |
| 35 | Set Y-axis min → chart Y-axis starts from custom value |
| 36 | Set Y-axis max → chart Y-axis ends at custom value |
| 37 | Clear Y-axis min/max → auto-scaling resumes |
| 38 | Axis width input visible for applicable chart types |
| 39 | Set axis width → Y-axis width adjusts |
| 40 | Show Border toggle visible for applicable chart types |
| 41 | Enable axis border → border appears around chart area |
| 42 | Show Gridlines toggle visible for applicable chart types |
| 43 | Disable gridlines → grid lines hidden from chart |
| 44 | Label position set to "Top" → labels appear above data |
| 45 | Label rotate to 45° → labels rotate on chart |
| 46 | X-axis label rotate input → axis labels rotate |
| 47 | Set label truncate width → long axis labels truncated |

**How to write:**

```js
// Test 35 — Y-axis min
test("should set Y-axis min value and verify chart reflects it", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with bar chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.Y_AxisMin("50");           // built-in method
  await pm.dashboardPanelActions.applyDashboardBtn();

  // Chart canvas should render (chart doesn't expose axis values in DOM easily,
  // so just assert the chart is visible and no error)
  await expect(page.locator(".echarts-for-react")).toBeVisible();

  // cleanup ...
});

// Test 43 — Gridlines
test("should hide gridlines when toggle is disabled", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with bar chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Gridlines toggle — click to disable (it's on by default)
  await page.locator('[data-test="dashboard-config-show-gridlines"]').click();
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();

  // cleanup ...
});

// Test 47 — Axis label truncate
test("should truncate x-axis labels to specified width", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  const truncateInput = page.locator('[data-test="dashboard-config-axis-label-truncate-width"]');
  await truncateInput.waitFor({ state: "visible" });
  await truncateInput.click();
  await truncateInput.fill("50");
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();

  // cleanup ...
});
```

---

### File 5 — `dashboard-config-line-style.spec.js` (9 tests)

**What it covers:** Show Symbol, Line Interpolation, Line Thickness, Connect Null Values
*(These only appear for `line` or `area` chart types)*

| # | Test Name |
|---|-----------|
| 48 | Show Symbol dropdown visible for line/area charts |
| 49 | Select circle symbol → markers on data points |
| 50 | Select "No Symbol" → no marker on data points |
| 51 | Line interpolation dropdown visible for line/area charts |
| 52 | Select "Smooth" → curved lines |
| 53 | Select "Linear" → straight lines |
| 54 | Select "Step After" → step-after lines |
| 55 | Set line thickness to 3 → thicker lines |
| 56 | Enable Connect Null Values → gaps connected in chart |

**How to write:**

```js
// Test 52 — Line interpolation smooth
test("should apply smooth line interpolation", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with line chart type ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.selectLineInterpolation("Smooth");  // built-in method
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();
  // cleanup ...
});

// Test 55 — Line thickness
test("should apply custom line thickness", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with line chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.selectLineThickness("3");  // built-in method
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();
  // cleanup ...
});

// Test 56 — Connect null values
test("should connect null values when toggle is enabled", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with line chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await page.locator('[data-test="dashboard-config-connect-null-values"]').click();
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();
  // cleanup ...
});
```

---

### File 6 — `dashboard-config-trellis.spec.js` (10 tests)

**What it covers:** Trellis Layout dropdown, custom columns, Group by Y Axis
*(Requires a breakdown field to be active)*

| # | Test Name |
|---|-----------|
| 57 | Trellis dropdown visible for applicable chart types |
| 58 | Select "Auto" trellis → chart reflows into auto grid |
| 59 | Select "Vertical" trellis → panels arranged vertically |
| 60 | Select "Custom" → number of columns input appears |
| 61 | Set custom columns to 3 → 3 columns rendered |
| 62 | Set columns above 16 → value capped at 16 |
| 63 | Trellis dropdown disabled when no breakdown field |
| 64 | Trellis dropdown disabled when time shifts are active |
| 65 | Group by Y Axis toggle appears when trellis is active |
| 66 | Enable Group by Y Axis → axes grouped per trellis panel |

**How to write:**

```js
// Test 60 — Custom columns input appears
test("should show num of columns input when Custom trellis selected", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with bar chart + breakdown field ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.selectTrellisLayout("Custom");   // built-in method

  // Columns input should appear
  const colInput = page.locator('[data-test="trellis-chart-num-of-columns"]');
  await expect(colInput).toBeVisible();

  // cleanup ...
});

// Test 62 — Column count max 16
test("should cap trellis columns at 16", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.selectTrellisLayout("Custom");

  const colInput = page.locator('[data-test="trellis-chart-num-of-columns"]');
  await colInput.waitFor({ state: "visible" });
  await colInput.fill("20");
  await colInput.blur();                // triggers the clamping logic

  // value should be clamped to 16
  await expect(colInput).toHaveValue("16");

  // cleanup ...
});

// Test 63 — Disabled when no breakdown
test("should disable trellis when no breakdown field is set", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with bar chart (no breakdown field) ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  const trellisDropdown = page.locator('[data-test="dashboard-trellis-chart"]');
  await expect(trellisDropdown).toHaveAttribute("aria-disabled", "true");

  // cleanup ...
});
```

---

### File 7 — `dashboard-config-panel-time.spec.js` (14 tests)

**What it covers:** Panel time toggle, +Set flow, cancel, persist, global vs individual time
*(Already partially covered — these are the gaps)*

| # | Test Name |
|---|-----------|
| 67 | Allow Panel Time toggle is visible in config panel |
| 68 | Enable toggle → "+Set" button appears |
| 69 | Click "+Set" → DateTimePicker appears |
| 70 | Set relative time (Last 1h) → tooltip shows formatted time |
| 71 | Click cancel X → picker hides and time cleared |
| 72 | Disable toggle → time picker section hides |
| 73 | Panel time persists after saving and reopening panel |
| 74 | Panel time picker visible in view mode |
| 75 | Global time change does NOT affect panel with individual time |
| 76 | Toggle off → panel reverts to global time |
| 77 | Panel time info tooltip visible on hover |
| 78 | Save panel with time set → verify via API response |
| 79 | Panel time URL parameter reflects configured time |
| 80 | Set absolute panel time (date range) → applies correctly |

**How to write:**

```js
// Test 68 — +Set button appears after toggle
test("should show +Set button when panel time toggle is enabled", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Toggle not yet enabled — Set button should not be visible
  const setBtn = page.locator('[data-test="dashboard-config-set-panel-time"]');
  await expect(setBtn).not.toBeVisible();

  // Enable panel time toggle
  await pm.dashboardPanelTime.enablePanelTime();

  // +Set button should now be visible
  await expect(setBtn).toBeVisible();

  // cleanup ...
});

// Test 71 — Cancel clears time
test("should hide time picker when cancel X is clicked", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelTime.enablePanelTime();

  // Click +Set to show picker
  await page.locator('[data-test="dashboard-config-set-panel-time"]').click();
  await pm.dashboardPanelTime.setPanelTimeRelative("1-h");

  // Picker should be visible
  const picker = page.locator('[data-test="dashboard-config-panel-time-picker"]');
  await expect(picker).toBeVisible();

  // Cancel — click X
  await page.locator('[data-test="dashboard-config-cancel-panel-time"]').click();

  // +Set should reappear, picker gone
  await expect(page.locator('[data-test="dashboard-config-set-panel-time"]')).toBeVisible();

  // cleanup ...
});
```

---

### File 8 — `dashboard-config-gauge-maps.spec.js` (17 tests)

**What it covers:** Gauge min/max, GeoMap lat/lng/zoom/symbol/layer, Maps map type

| # | Test Name |
|---|-----------|
| 81 | Gauge min input visible only for gauge chart type |
| 82 | Set gauge min → gauge scale starts from custom value |
| 83 | Gauge max input visible only for gauge chart type |
| 84 | Set gauge max → gauge scale ends at custom value |
| 85 | Basemap dropdown visible only for geomap type |
| 86 | Latitude input visible only for geomap type |
| 87 | Longitude input visible only for geomap type |
| 88 | Zoom level input visible only for geomap type |
| 89 | Set lat/lng/zoom → map view updates |
| 90 | Symbol size "By Value" → min/max inputs appear |
| 91 | Symbol size "Fixed" → fixed size input appears |
| 92 | Set min/max symbol size → data points scale |
| 93 | Layer type "Scatter" → scatter layer shown |
| 94 | Layer type "Heatmap" → heatmap layer shown |
| 95 | GeoMap weight input visible when no weight field present |
| 96 | Map type dropdown visible for maps chart type |
| 97 | Select "World" map type → world map shown |

**How to write:**

```js
// Test 82 — Gauge min
test("should apply gauge min value", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with gauge chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  const gaugeMin = page.locator('[data-test="dashboard-config-gauge-min"]');
  await gaugeMin.waitFor({ state: "visible" });
  await gaugeMin.click();
  await gaugeMin.fill("10");
  await pm.dashboardPanelActions.applyDashboardBtn();

  await expect(page.locator(".echarts-for-react")).toBeVisible();
  // cleanup ...
});

// Test 90 — Symbol size by value shows min/max
test("should show min and max inputs when symbol size is By Value", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with geomap chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // By Value should already be selected by default
  await expect(page.locator('[data-test="dashboard-config-map-symbol-min"]')).toBeVisible();
  await expect(page.locator('[data-test="dashboard-config-map-symbol-max"]')).toBeVisible();

  // Switch to Fixed
  await pm.dashboardPanelConfigs.symbolSize.click();
  await page.getByRole("option", { name: "Fixed" }).click();

  // min/max should disappear, fixed input appears
  await expect(page.locator('[data-test="dashboard-config-map-symbol-min"]')).not.toBeVisible();
  await expect(page.locator('[data-test="dashboard-config-map-symbol-fixed"]')).toBeVisible();

  // cleanup ...
});
```

---

### File 9 — `dashboard-config-advanced.spec.js` (24 tests)

**What it covers:** Time Shift/Compare Against, Color Palette, Color By Series, Override Config, Value Mapping, Mark Line, Drilldown, Background Color (metric), Top N, Chart Align

| # | Test Name |
|---|-----------|
| 98 | "Comparison Against" section visible for applicable chart types |
| 99 | 0m reference entry always present and disabled |
| 100 | Click Add → new time shift row appears |
| 101 | Set time shift to "1h" → comparison series added |
| 102 | Add multiple time shifts → multiple comparison series |
| 103 | Remove a time shift → that series removed |
| 104 | Trellis disabled when time shifts are active |
| 105 | Color palette dropdown visible |
| 106 | Select different color palette → chart colors update |
| 107 | Color by series add button visible |
| 108 | Open color by series popup → series list appears |
| 109 | Assign color to a series → that series uses the color |
| 110 | Delete a color mapping → reverts to default |
| 111 | Save color by series → colors persist after apply |
| 112 | Cancel color by series → no changes applied |
| 113 | Override config section visible only for table |
| 114 | Add column override → column styling applied |
| 115 | Value mapping visible only for table |
| 116 | Add value mapping rule → mapped value shown |
| 117 | Background color config visible only for metric type |
| 118 | Top N field appears when breakdown field exists |
| 119 | Set top N to 5 → only 5 series shown |
| 120 | "Others" series toggle with top N |
| 121 | Chart align dropdown changes chart alignment |

**How to write:**

```js
// Test 100 — Add time shift
test("should add new time shift row when Add button is clicked", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with line chart ...

  await pm.dashboardPanelConfigs.openConfigPanel();

  // Initially only 0m entry exists
  const timeShiftRows = page.locator('.custom-date-time-picker');
  await expect(timeShiftRows).toHaveCount(1);      // only the 0m reference

  // Add time shift
  await pm.dashboardPanelConfigs.addTimeShift();   // built-in method

  // Now 2 rows
  await expect(timeShiftRows).toHaveCount(2);

  // cleanup ...
});

// Test 103 — Remove time shift
test("should remove time shift row when X is clicked", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.addTimeShift();

  // Verify row exists
  const removeBtn = page.locator('[data-test="dashboard-addpanel-config-time-shift-remove-0"]');
  await expect(removeBtn).toBeVisible();

  // Remove it
  await pm.dashboardPanelConfigs.removeTimeShift(0);  // built-in method

  // Remove button should be gone
  await expect(removeBtn).not.toBeVisible();

  // cleanup ...
});

// Test 108 — Color by series popup opens
test("should open color by series popup", async ({ page }) => {
  const pm = new PageManager(page);
  // ... setup with line chart + breakdown ...

  await pm.dashboardPanelConfigs.openConfigPanel();
  await pm.dashboardPanelConfigs.openColorBySeries();   // built-in method

  await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).toBeVisible();

  await pm.dashboardPanelConfigs.cancelColorBySeries();
  // cleanup ...
});
```

---

## Common Assert Patterns

```js
// Element visible
await expect(page.locator('[data-test="..."]')).toBeVisible();

// Element hidden
await expect(page.locator('[data-test="..."]')).not.toBeVisible();

// Input has value
await expect(page.locator('[data-test="..."]')).toHaveValue("100");

// Toggle is checked (aria-checked)
const toggle = page.locator('[data-test="dashboard-config-allow-panel-time"]');
await expect(toggle).toHaveAttribute("aria-checked", "true");

// Toggle is unchecked
await expect(toggle).toHaveAttribute("aria-checked", "false");

// Count of elements
await expect(page.locator(".some-class")).toHaveCount(3);

// Element disabled
await expect(page.locator('[data-test="dashboard-trellis-chart"]')).toHaveAttribute("aria-disabled", "true");

// Table row count
const rows = await page.$$eval("tbody tr", (r) => r.length);
expect(rows).toBeLessThanOrEqual(25);

// Chart rendered
await expect(page.locator(".echarts-for-react")).toBeVisible();
```

---

## Test Count Summary

| File | Feature Area | Tests |
|------|-------------|-------|
| `dashboard-config-general.spec.js` | Description, Unit, Decimals, No-Value, Query Limit | 9 |
| `dashboard-config-legends.spec.js` | Legends toggle, position, type, width, height | 13 |
| `dashboard-config-table.spec.js` | Wrap, Transpose, Dynamic Cols, Pagination | 11 |
| `dashboard-config-axis.spec.js` | Y-Axis, Axis Width, Border, Gridlines, Labels | 14 |
| `dashboard-config-line-style.spec.js` | Symbol, Interpolation, Thickness, Connect Nulls | 9 |
| `dashboard-config-trellis.spec.js` | Trellis layout, columns, group by Y axis | 10 |
| `dashboard-config-panel-time.spec.js` | Panel time toggle, set, cancel, persist, global | 14 |
| `dashboard-config-gauge-maps.spec.js` | Gauge min/max, GeoMap, Maps chart | 17 |
| `dashboard-config-advanced.spec.js` | Time Shift, Color, Override, Value Map, Drilldown | 24 |
| **Subtotal (new)** | | **121** |
| **Already covered** (existing 9 spec files) | Panel time, color, pagination, transpose, geomap | ~47 |
| **Grand Total** | | **168** |

---

## Quick Start Checklist

Before writing tests:
- [ ] Read `pages/dashboardPages/dashboard-panel-configs.js` — know all available methods
- [ ] Read `pages/dashboardPages/dashboard-panel-time.js` — panel time methods
- [ ] Use `pm.dashboardPanelConfigs.openConfigPanel()` to open the sidebar first
- [ ] Always call `applyDashboardBtn()` after config changes before asserting
- [ ] Always call `savePanel()` before ending the test if saving
- [ ] Always call `deleteDashboard()` in cleanup
- [ ] Use `[data-test="..."]` selectors — never rely on CSS classes or text

## Chart Types for Each Config

| Config | Visible for Chart Types |
|--------|------------------------|
| Wrap/Transpose/Dynamic Cols/Pagination | `table` only |
| Gauge min/max | `gauge` only |
| GeoMap settings (lat/lng/zoom/layer) | `geomap` only |
| Map type | `maps` only |
| Background color | `metric` only |
| Line interpolation/thickness/symbol | `line`, `area` |
| Connect null values | `line`, `area` |
| Trellis layout | `bar`, `line`, `area`, `scatter` |
| Time shift | `bar`, `line`, `area`, `scatter` |
| Y-axis min/max, gridlines, labels | `bar`, `line`, `area`, `scatter` |
| Unit, decimals, legend | most chart types |
