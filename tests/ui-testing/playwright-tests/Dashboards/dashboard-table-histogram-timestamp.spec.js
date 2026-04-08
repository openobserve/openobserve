const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require("../utils/test-logger.js");

// Quasar virtual-scroll table — get text of a specific cell (row/col zero-based)
async function getTableCellText(page, rowIndex, colIndex) {
  return page.$eval(
    '[data-test="dashboard-panel-table"]',
    (table, { ri, ci }) => {
      const virtualContent = table.querySelector(".q-virtual-scroll__content");
      if (!virtualContent) return "";
      const rows = virtualContent.querySelectorAll("tr");
      const row = rows[ri];
      if (!row) return "";
      const cell = row.querySelectorAll("td")[ci];
      if (!cell) return "";
      const clone = cell.cloneNode(true);
      clone.querySelectorAll("button, .copy-btn").forEach((b) => b.remove());
      return clone.textContent.trim().replace(/content_copy/g, "").trim();
    },
    { ri: rowIndex, ci: colIndex }
  );
}

/**
 * Dashboard Table - Histogram & Timestamp Format Tests
 *
 * Tests the behavior of the `_timestamp` field in a Table chart under four
 * combinations of "Select Function" (Histogram vs None) and the
 * "Mark this field as non-timestamp" checkbox (unchecked vs checked).
 *
 * Expected behavior (once the timestamp-conversion fix ships):
 *   Histogram + non-timestamp unchecked → formatted date string  (e.g. "2026-04-08 15:44:50")
 *   Histogram + non-timestamp checked   → formatted date string  (Histogram overrides the flag)
 *   None      + non-timestamp unchecked → formatted date string  (system auto-formats _timestamp)
 *   None      + non-timestamp checked   → raw 16-digit µs value  (e.g. "1775643642297594.00")
 *
 * NOTE: Scenarios are authored against the *fixed* behaviour so they will
 * pass once the conversion bug is resolved.
 */

// Regex for a human-readable date string: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
const FORMATTED_DATE_PATTERN = /\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/;

// ──────────────────────────────────────────────
// Shared setup: table chart with _timestamp (X) + code (Y)
// Histogram is the default function when _timestamp is added to the X-axis.
// ──────────────────────────────────────────────
async function setupTimestampTablePanel(page, pm, dashboardName, panelName) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.chartTypeSelector.selectChartType("table");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  // Adding _timestamp to X defaults to the Histogram function
  await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
  await pm.chartTypeSelector.searchAndAddField("code", "y");
}

/**
 * Ensures the non-timestamp checkbox is in the desired state.
 * The app may auto-check it when _timestamp is added, so we set state explicitly.
 * @param {object} pm - PageManager instance
 * @param {boolean} shouldBeChecked
 */
async function ensureNonTimestampCheckbox(pm, shouldBeChecked) {
  await pm.chartTypeSelector.treatAsNonTimestampCheckbox.waitFor({
    state: "visible",
    timeout: 10000,
  });
  const isChecked = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
  if (isChecked !== shouldBeChecked) {
    await pm.chartTypeSelector.toggleTreatAsNonTimestamp();
  }
  if (shouldBeChecked) {
    await expect(pm.chartTypeSelector.treatAsNonTimestampCheckbox).toBeChecked();
  } else {
    await expect(pm.chartTypeSelector.treatAsNonTimestampCheckbox).not.toBeChecked();
  }
}

/**
 * Close the X-axis field property popup and wait for it to disappear.
 */
async function closeFieldPopup(page, pm) {
  await page.keyboard.press("Escape");
  await pm.chartTypeSelector.treatAsNonTimestampCheckbox
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {});
}

test.describe("Dashboard Table - Histogram and Timestamp Format", () => {
  test.describe.configure({ mode: "parallel", retries: 1 });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Histogram function + non-timestamp UNCHECKED
  // Expected: timestamp column shows formatted date string
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "should display formatted date when Histogram function is set and non-timestamp is unchecked",
    { tag: ["@tableChart", "@histogram", "@timestampFormat", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTimestampTablePanel(
        page, pm, dashboardName,
        "Histogram - Non-Timestamp Unchecked"
      );

      // Open X-axis popup, ensure non-timestamp is UNCHECKED
      await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");
      await ensureNonTimestampCheckbox(pm, false);
      await closeFieldPopup(page, pm);

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const cellText = await getTableCellText(page, 0, 0);
      testLogger.info("Scenario 1 cell value", { cellText });

      // Must match a human-readable date format
      expect(FORMATTED_DATE_PATTERN.test(cellText)).toBe(true);
      // Must NOT look like a raw microsecond integer
      expect(/^\d{13,19}(\.\d+)?$/.test(cellText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: Histogram function + non-timestamp CHECKED
  // Expected: timestamp column still shows formatted date string
  // (Histogram processing overrides the non-timestamp flag)
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "should display formatted date when Histogram function is set and non-timestamp is checked",
    { tag: ["@tableChart", "@histogram", "@timestampFormat", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTimestampTablePanel(
        page, pm, dashboardName,
        "Histogram - Non-Timestamp Checked"
      );

      // Open X-axis popup, ensure non-timestamp is CHECKED
      await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");
      await ensureNonTimestampCheckbox(pm, true);
      await closeFieldPopup(page, pm);

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const cellText = await getTableCellText(page, 0, 0);
      testLogger.info("Scenario 2 cell value", { cellText });

      // Histogram function still produces a formatted date even with non-timestamp checked
      expect(FORMATTED_DATE_PATTERN.test(cellText)).toBe(true);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: None function + non-timestamp UNCHECKED
  // Expected: timestamp column shows formatted date string
  // (system auto-formats _timestamp even without Histogram)
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "should display formatted date when None function is set and non-timestamp is unchecked",
    { tag: ["@tableChart", "@histogram", "@timestampFormat", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTimestampTablePanel(
        page, pm, dashboardName,
        "None Function - Non-Timestamp Unchecked"
      );

      // Open X-axis popup, switch function to None, ensure non-timestamp is UNCHECKED
      await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");
      await pm.chartTypeSelector.selectFunction("None");
      await ensureNonTimestampCheckbox(pm, false);
      await closeFieldPopup(page, pm);

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const cellText = await getTableCellText(page, 0, 0);
      testLogger.info("Scenario 3 cell value", { cellText });

      // _timestamp with None function and non-timestamp unchecked → still formatted
      expect(FORMATTED_DATE_PATTERN.test(cellText)).toBe(true);
      expect(/^\d{13,19}(\.\d+)?$/.test(cellText)).toBe(false);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4: None function + non-timestamp CHECKED
  // Expected: raw 16-digit microsecond value (e.g. "1775643642297594.00")
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "should display raw 16-digit microsecond value when None function is set and non-timestamp is checked",
    { tag: ["@tableChart", "@histogram", "@timestampFormat", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTimestampTablePanel(
        page, pm, dashboardName,
        "None Function - Non-Timestamp Checked"
      );

      // Open X-axis popup, switch to None function, ensure non-timestamp is CHECKED
      await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");
      await pm.chartTypeSelector.selectFunction("None");
      await ensureNonTimestampCheckbox(pm, true);
      await closeFieldPopup(page, pm);

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const cellText = await getTableCellText(page, 0, 0);
      testLogger.info("Scenario 4 cell value", { cellText });

      // Should be a raw numeric value, NOT a formatted date string
      expect(FORMATTED_DATE_PATTERN.test(cellText)).toBe(false);

      // Parse the numeric value (strip any locale commas/spaces)
      const numericValue = parseFloat(cellText.replace(/,/g, ""));
      expect(isNaN(numericValue)).toBe(false);

      // A microsecond-epoch timestamp is > 1 quadrillion (1e15)
      // e.g. 1775643642297594 µs ≈ year 2026
      expect(numericValue).toBeGreaterThan(1e15);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
