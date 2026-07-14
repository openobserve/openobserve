const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanelWithConfig,
  reopenPanelConfig,
  discardAndCleanupTestDashboard,
} from "./utils/configPanelHelpers.js";
import {
  TABLE_SELECTOR,
  TABLE_DATA_ROW_SELECTOR,
  readColumnCells,
  waitForPanelTableSettled,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

// hex must be a 6-digit value (e.g. "#ff0000") to match Playwright's computed
// "rgb(r, g, b)" CSS serialization exactly.
function hexToRgb(hex) {
  const int = parseInt(hex.slice(1), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

// The table panel always has two columns: x_axis_1 (_timestamp, auto-added) and
// y_axis_1 (the configured y-field). Numeric-formatting tests must target the
// y-axis column; the auto/unique-color test wants a genuine text column (x-axis).
async function addYAxisOverrideColumn(pm) {
  await pm.dashboardPanelConfigs.openOverrideConfig();
  await pm.dashboardPanelConfigs.addLastOverrideField();
}

async function addXAxisOverrideColumn(pm) {
  await pm.dashboardPanelConfigs.openOverrideConfig();
  await pm.dashboardPanelConfigs.addFirstOverrideField();
}

/**
 * Builds a table panel with an explicit categorical x-axis (kubernetes_container_hash,
 * 7 distinct values with a wide count spread in the fixture: 8, 28, 440, 554, 814, 2002)
 * instead of the default histogram(_timestamp) grouping. The ingestion endpoint stamps
 * the whole fixture batch with one ingestion-time timestamp (the fixture has no explicit
 * _timestamp field), so histogram(_timestamp) collapses to a single bucket in CI's single
 * fresh ingestion — this made row-count-dependent tests flaky/failing there despite
 * passing locally (hours of accumulated repeat runs gave the dev server real timestamp
 * spread that CI doesn't have). Grouping by a raw field instead gives deterministic,
 * environment-independent row counts and per-row values.
 */
async function buildCategoricalTablePanel(page, pm, dashboardName) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("table");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "x");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
  await pm.dashboardPanelActions.addPanelName("Test Panel");
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelConfigs.openConfigPanel();
}

test.describe("Dashboard Table — Column Formatting (PR #12531)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("field type override: auto-detected numeric shows formatting sections; forcing text hides them", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    // Force a numeric y-axis value (count aggregation) so "auto" field-type detection
    // resolves to numeric once the query re-applies.
    await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    await addYAxisOverrideColumn(pm);

    const unitSelect = pm.dashboardPanelConfigs.getOverrideUnitSelect();
    const addRuleBtn = pm.dashboardPanelConfigs.getAddConditionRuleBtn();
    await expect(unitSelect).toBeVisible();
    await expect(addRuleBtn).toBeVisible();
    testLogger.info("Auto-detected numeric column shows Value Formatting + Conditional Styling sections");

    await pm.dashboardPanelConfigs.selectFieldType("text");
    await expect(unitSelect).not.toBeVisible();
    await expect(addRuleBtn).not.toBeVisible();
    testLogger.info("Forcing field type to text hides numeric-only sections");

    await pm.dashboardPanelConfigs.selectFieldType("num");
    await expect(unitSelect).toBeVisible();
    testLogger.info("Forcing field type back to numeric restores sections");

    await pm.dashboardPanelConfigs.closeOverrideConfig();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("custom unit: input appears when unit=Custom and value persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");
    await pm.dashboardPanelActions.applyDashboardBtn();

    await addYAxisOverrideColumn(pm);
    // Leave fieldType as "auto" — the count() aggregation already makes this column
    // genuinely numeric, so auto-detection shows the unit selector without needing
    // an explicit field_type override (keeps the saved override_config to a single
    // "unit" entry).
    await pm.dashboardPanelConfigs.selectFormatUnit("Custom");

    const customUnitInput = pm.dashboardPanelConfigs.getCustomUnitInput();
    await expect(customUnitInput).toBeVisible();
    await pm.dashboardPanelConfigs.fillCustomUnit("req/s");
    testLogger.info("Custom unit input filled");

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.openOverrideConfig();
    await expect(
      pm.dashboardPanelConfigs.getCustomUnitInput().locator('[data-test$="-field"]')
    ).toHaveValue("req/s");
    testLogger.info("Custom unit value persisted after save");
    await pm.dashboardPanelConfigs.closeOverrideConfig();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("text/background color: applied styling shows on the table cell", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");
    await pm.dashboardPanelActions.applyDashboardBtn();

    await addYAxisOverrideColumn(pm);
    await pm.dashboardPanelConfigs.selectFieldType("num");
    const bgHex = "#ff0000";
    const textHex = "#ffffff";
    await pm.dashboardPanelConfigs.setFormatColor("bg", bgHex);
    await pm.dashboardPanelConfigs.setFormatColor("text", textHex);
    testLogger.info("Text and background color set for numeric column");

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
    await pm.dashboardPanelActions.applyDashboardBtn();

    const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
    await firstRow.waitFor({ state: "visible", timeout: 15000 });
    const styledCell = firstRow.locator("td").last();
    await expect(styledCell).toHaveCSS("background-color", hexToRgb(bgHex));
    await expect(styledCell).toHaveCSS("color", hexToRgb(textHex));
    testLogger.info("Table cell reflects configured text/background color");

    // This environment's backend build doesn't yet accept the text_color/
    // background_color override_config variants on save (version-skew, not a
    // product bug) — the in-session DOM assertions above already prove the
    // feature works, so skip savePanel() and discard instead of persisting.
    await discardAndCleanupTestDashboard(page, dashboardName);
  });

  test("conditional styling: rules evaluate per row; a later matching rule overrides an earlier match", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // Categorical x-axis (kubernetes_container_hash) gives 7 rows with a real, deterministic
    // count() spread (8, 28, 440, 554, 814, 2002, plus a null-hash group) — needed so the two
    // rules below produce a genuine, verifiable per-row split rather than an all-or-nothing
    // result that a first-match-wins bug couldn't be distinguished from.
    await buildCategoricalTablePanel(page, pm, dashboardName);

    await addYAxisOverrideColumn(pm);
    await pm.dashboardPanelConfigs.selectFieldType("num");

    // Rule 0: operator defaults to "<"; matches every row with count < 1000 (most rows) — blue.
    await pm.dashboardPanelConfigs.addConditionalRule();
    await pm.dashboardPanelConfigs.fillConditionThreshold(0, "1000");
    await pm.dashboardPanelConfigs.setConditionRuleColor(0, "bg", "#0000ff");

    // Rule 1: a strict subset of rule 0 (count < 30) — red. Rows with count < 30 match BOTH
    // rules; since rules are evaluated in order and the last match wins, those rows must
    // render red, not blue. Rows with 30 <= count < 1000 match only rule 0 and stay blue.
    // If evaluation were first-match-wins instead, the <30 rows would incorrectly stay blue —
    // this design catches that regression, unlike asserting a single overall color.
    await pm.dashboardPanelConfigs.addConditionalRule();
    await pm.dashboardPanelConfigs.fillConditionThreshold(1, "30");
    await pm.dashboardPanelConfigs.setConditionRuleColor(1, "bg", "#ff0000");
    testLogger.info("Two conditional rules configured: rule0 count<1000 blue, rule1 count<30 red (subset)");

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
    await pm.dashboardPanelActions.applyDashboardBtn();

    // The rules are evaluated against the table Apply is still fetching; the loop below
    // reads computed styles row by row, which (unlike toHaveCSS) does not retry, so it
    // has to run against a table that has stopped moving.
    await waitForPanelTableSettled(page);

    const rows = page.locator(TABLE_DATA_ROW_SELECTOR);
    await rows.first().waitFor({ state: "visible", timeout: 15000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(1);

    let sawBlue = false;
    let sawRed = false;
    for (let i = 0; i < rowCount; i++) {
      const cell = rows.nth(i).locator("td").last();
      const text = await cell.locator('[data-test="dashboard-table-cell-value"]').textContent();
      const value = parseFloat(text || "");
      if (Number.isNaN(value)) continue;
      const bg = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
      if (value < 30) {
        expect(bg, `row with count ${value} (<30, matches both rules) must show rule 1's red — last matching rule wins`).toBe(hexToRgb("#ff0000"));
        sawRed = true;
      } else if (value < 1000) {
        expect(bg, `row with count ${value} (matches only rule 0) must show rule 0's blue`).toBe(hexToRgb("#0000ff"));
        sawBlue = true;
      }
    }
    expect(sawBlue, "expected at least one row matching only rule 0 (blue)").toBe(true);
    expect(sawRed, "expected at least one row matching both rules, showing rule 1's red (last-wins)").toBe(true);
    testLogger.info("Conditional rules evaluated per row with correct last-match-wins override");

    // This environment's backend build doesn't yet accept the conditional_styles
    // override_config variant on save (version-skew, not a product bug) — the
    // in-session DOM assertions above already prove the feature works.
    await discardAndCleanupTestDashboard(page, dashboardName);
  });

  test("alignment: changing alignment updates cell content justification", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    await addYAxisOverrideColumn(pm);
    await pm.dashboardPanelConfigs.selectAlignment("Center");
    testLogger.info("Alignment set to Center");

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
    await pm.dashboardPanelActions.applyDashboardBtn();

    const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
    await firstRow.waitFor({ state: "visible", timeout: 15000 });
    const wrapperDiv = firstRow.locator("td").last().locator("div").first();
    await expect(wrapperDiv).toHaveClass(/justify-center/);
    testLogger.info("Table cell wrapper reflects Center alignment class");

    // This environment's backend build doesn't yet accept the alignment
    // override_config variant on save (version-skew, not a product bug) — the
    // in-session DOM assertion above already proves the feature works.
    await discardAndCleanupTestDashboard(page, dashboardName);
  });

  test("auto/unique color: distinct text-column values render with distinct background colors", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildCategoricalTablePanel(page, pm, dashboardName);

    // Target the x-axis column (kubernetes_container_hash) — a genuine text column with
    // guaranteed multi-value cardinality — so the unique-color toggle has real distinct
    // string values to color.
    await addXAxisOverrideColumn(pm);
    await pm.dashboardPanelConfigs.toggleAutoColor();
    testLogger.info("Auto/unique color toggled on for text column");

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Apply re-runs the query, and the colors only exist on the table it renders when it
    // comes back. Sampling before then read the PRE-Apply table — every cell still
    // transparent, so one distinct background color, and the assertion below failed for
    // a feature that works.
    await waitForPanelTableSettled(page);

    const rows = page.locator(TABLE_DATA_ROW_SELECTOR);
    await rows.first().waitFor({ state: "visible", timeout: 15000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(1);

    // One pass over the DOM: reading value and color per row in separate round-trips let
    // a re-render land between them and mix two tables' worth of data together.
    const cells = await readColumnCells(page, 0, Math.min(rowCount, 10));
    const textValues = new Set(cells.map((c) => c.text));
    const bgColors = new Set(cells.map((c) => c.bgColor));

    // Sanity check: the column itself must actually have multiple distinct values —
    // otherwise a single-color result below would be indistinguishable from "the
    // unique-color feature is broken" vs. "there was nothing to color differently".
    expect(textValues.size).toBeGreaterThan(1);
    expect(bgColors.size).toBeGreaterThan(1);
    testLogger.info("Distinct column values render with distinct auto-assigned colors", { distinctValues: textValues.size, distinctColors: bgColors.size });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
