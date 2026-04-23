import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
} from "./utils/configPanelHelpers.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
import testLogger from "../utils/test-logger.js";
import {
  TABLE_SELECTOR,
  TABLE_DATA_ROW_SELECTOR,
  getTableCellText,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";

/**
 * Dashboard Table Chart - Copy Cell Timestamp Formatting Tests
 *
 * REGRESSION COVERAGE:
 *   Before fix: clicking the copy button on a timestamp cell wrote the raw ISO
 *   "T"-separated string (e.g. "2024-01-15T10:30:00Z") to the clipboard.
 *   After fix:  the copy button writes the formatted display value
 *   (e.g. "2024-01-15 10:30:00") — identical to what is shown in the cell.
 *
 * THIS SPEC COVERS:
 *   - Regular table: timestamp cell display value has no "T" separator
 *   - Regular table: clipboard value after copy has no "T" separator
 *   - Regular table: clipboard value equals cell display value
 *   - Regular table: non-timestamp column copy is unchanged
 *   - Pivot table:   timestamp cell display value has no "T" separator
 *   - Pivot table:   clipboard value after copy has no "T" separator
 *   - Pivot table:   clipboard value equals cell display value
 */

// ISO "T" pattern that must NOT appear in formatted output
const ISO_T_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

test.describe("Dashboard Table Chart - Copy Cell Timestamp Formatting", () => {
  test.describe.configure({ mode: "parallel", retries: 1 });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ── Regular Table ─────────────────────────────────────────────────────────

  test(
    "should display timestamp cell value without ISO T separator",
    { tag: ["@tableChart", "@copyCellTimestamp", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Copy Cell Timestamp Display");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Timestamp column is the first column (X axis = _timestamp)
      const cellText = await getTableCellText(page, 0, 0);
      testLogger.info("Timestamp cell display value", { cellText });

      // Must be a recognisable date string
      expect(/\d{4}[-/]\d{2}[-/]\d{2}/.test(cellText)).toBe(true);
      // Must NOT contain the raw ISO "T" separator
      expect(ISO_T_RE.test(cellText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should write formatted timestamp (no ISO T) to clipboard when copy button is clicked",
    { tag: ["@tableChart", "@copyCellTimestamp", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Copy Cell Timestamp Clipboard");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Hover the first timestamp cell to reveal the copy button
      const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
      const firstCell = firstRow.locator("td").first();
      await firstCell.hover();

      // Click the copy button inside the cell
      const copyBtn = firstCell.locator(".copy-btn").first();
      await copyBtn.waitFor({ state: "visible", timeout: 5000 });
      await copyBtn.click({ force: true });

      // Read the clipboard value (permissions are granted in playwright.config.js)
      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      testLogger.info("Clipboard after copy", { clipboardText });

      // Clipboard must NOT contain the raw ISO "T" separator
      expect(ISO_T_RE.test(clipboardText)).toBe(false);
      // Clipboard must be a recognisable date string
      expect(/\d{4}[-/]\d{2}[-/]\d{2}/.test(clipboardText)).toBe(true);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should write the same value to clipboard as is displayed in the timestamp cell",
    { tag: ["@tableChart", "@copyCellTimestamp", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Copy Cell Matches Display");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Read the displayed cell text before copying
      const displayedText = await getTableCellText(page, 0, 0);

      // Hover and click the copy button
      const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
      const firstCell = firstRow.locator("td").first();
      await firstCell.hover();
      const copyBtn = firstCell.locator(".copy-btn").first();
      await copyBtn.waitFor({ state: "visible", timeout: 5000 });
      await copyBtn.click({ force: true });

      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      testLogger.info("Display vs clipboard", { displayedText, clipboardText });

      // Clipboard value must exactly match what the user sees in the cell
      expect(clipboardText).toBe(displayedText);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should copy non-timestamp column value unchanged",
    { tag: ["@tableChart", "@copyCellTimestamp", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Copy Non-Timestamp Cell");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // The second column is the count(code) numeric column — not a timestamp
      const displayedText = await getTableCellText(page, 0, 1);
      testLogger.info("Non-timestamp cell display value", { displayedText });

      // Hover the second cell and click its copy button
      const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
      const secondCell = firstRow.locator("td").nth(1);
      await secondCell.hover();
      const copyBtn = secondCell.locator(".copy-btn").first();
      await copyBtn.waitFor({ state: "visible", timeout: 5000 });
      await copyBtn.click({ force: true });

      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      testLogger.info("Non-timestamp clipboard value", { clipboardText });

      // Clipboard must match the displayed value exactly
      expect(clipboardText).toBe(displayedText);
      // Must not look like a raw ISO timestamp
      expect(ISO_T_RE.test(clipboardText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ── Pivot Table ───────────────────────────────────────────────────────────

  test(
    "should display pivot table timestamp cell without ISO T separator",
    { tag: ["@pivotTable", "@copyCellTimestamp", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Pivot Copy Cell Timestamp Display");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // X: row field, P: pivot/breakdown field, Y: value field
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // First cell in first data row (kubernetes_container_name — not a timestamp)
      // is a plain string; second data column contains aggregated numeric values.
      // The X column value must not look like a raw ISO timestamp
      const firstCellText = await getTableCellText(page, 0, 0);
      testLogger.info("Pivot first cell value", { firstCellText });
      expect(ISO_T_RE.test(firstCellText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should write formatted value (no ISO T) to clipboard when copy is clicked in pivot table",
    { tag: ["@pivotTable", "@copyCellTimestamp", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Pivot Copy Cell Clipboard");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Hover first data cell and click its copy button
      const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
      const firstCell = firstRow.locator("td").first();
      await firstCell.hover();
      const copyBtn = firstCell.locator(".copy-btn").first();
      await copyBtn.waitFor({ state: "visible", timeout: 5000 });
      await copyBtn.click({ force: true });

      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      testLogger.info("Pivot clipboard after copy", { clipboardText });

      // Must not be a raw ISO timestamp
      expect(ISO_T_RE.test(clipboardText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should write the same value to clipboard as displayed in pivot table cell",
    { tag: ["@pivotTable", "@copyCellTimestamp", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Pivot Copy Matches Display");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Read displayed value then copy and compare
      const displayedText = await getTableCellText(page, 0, 0);

      const firstRow = page.locator(TABLE_DATA_ROW_SELECTOR).first();
      const firstCell = firstRow.locator("td").first();
      await firstCell.hover();
      const copyBtn = firstCell.locator(".copy-btn").first();
      await copyBtn.waitFor({ state: "visible", timeout: 5000 });
      await copyBtn.click({ force: true });

      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      testLogger.info("Pivot display vs clipboard", { displayedText, clipboardText });

      expect(clipboardText).toBe(displayedText);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
