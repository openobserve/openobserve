const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
const logData = require("../../fixtures/log.json");

import { ingestion } from "./utils/dashIngestion.js";
import { setupTestDashboard, cleanupTestDashboard } from "./utils/dashCreation.js";

// Tests run in parallel (mode: "parallel" below), so dashboard names must be
// generated fresh per test — a shared name would cause cross-test create/delete
// collisions between workers.
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

// Logs stream the setup contract requires — ingested via the shared helper
// (default stream name in dashIngestion.js), read-only across tests.
const STREAM_NAME = "e2e_automate";

test.describe("Dashboard Add Panel Stream List Loads Without Preselected Stream testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // [shared/read-only] e2e_automate logs stream — every test only reads it.
    await ingestion(page, STREAM_NAME);
    pm = new PageManager(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"] ?? "default"}`
    );
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    testLogger.info("Test setup completed");
  });

  test("should load the stream list on the Logs Build page with no stream preselected", {
    tag: ["@add-panel-stream-list", "@dashboards", "@P0", "@all"],
  }, async () => {
    testLogger.info("Opening the Logs Build page (page key 'build', edit mode)");

    // No stream is selected — the "Build" toggle has no stream guard.
    await pm.logsVisualise.openBuildTab();

    // Core fix: the stream select is present and enabled with no preselected stream.
    await pm.logsVisualise.expectStreamSelectEnabled();

    // The dropdown lists the ingested logs stream (not stuck on "No options found").
    await pm.logsVisualise.expectStreamOptionVisible(STREAM_NAME);
    testLogger.info("Stream list loaded on the Build page with no preselected stream");
  });

  test("should load the stream list on a new Dashboard Add Panel with no prior stream selection", {
    tag: ["@add-panel-stream-list", "@dashboards", "@P0", "@all"],
  }, async ({ page }) => {
    const dashboardName = generateDashboardName();
    testLogger.info("Creating a fresh dashboard for the Add Panel flow");

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();

    // New panel (editMode=false) loads the stream list on mount.
    await pm.logsVisualise.expectStreamSelectEnabled();
    await pm.logsVisualise.expectStreamOptionVisible(STREAM_NAME);
    testLogger.info("Stream list loaded on the Add Panel page with no prior selection");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("should drop logs streams from the list when the stream type changes to metrics", {
    tag: ["@add-panel-stream-list", "@dashboards", "@P1", "@all"],
  }, async () => {
    testLogger.info("Verifying the stream-type switch reloads the list (stale guard)");

    await pm.logsVisualise.openBuildTab();
    await pm.logsVisualise.expectStreamSelectEnabled();
    // Establish the logs stream is listed before switching type.
    await pm.logsVisualise.expectStreamOptionVisible(STREAM_NAME);
    await pm.logsVisualise.closeStreamDropdown();

    await pm.chartTypeSelector.selectStreamType("metrics");
    // Guard the switch actually took effect before asserting its effect.
    await pm.logsVisualise.expectStreamTypeSelected("metrics");

    // The logs stream must no longer be listed — a late logs response cannot clobber metrics.
    await pm.logsVisualise.expectStreamOptionAbsent(STREAM_NAME);
    testLogger.info("Logs stream dropped after switching stream type to metrics");
  });

  test("should filter stream options by a case-insensitive substring search", {
    tag: ["@add-panel-stream-list", "@dashboards", "@P2", "@all"],
  }, async () => {
    testLogger.info("Verifying the searchable stream select filters options");

    await pm.logsVisualise.openBuildTab();

    const labels = await pm.logsVisualise.searchStreamDropdown("autom");
    expect(labels.length).toBeGreaterThan(0);
    // Every remaining option must match the substring (the filter actually applied).
    for (const label of labels) {
      expect(label.toLowerCase()).toContain("autom");
    }
    // The ingested stream matches the substring and remains listed.
    expect(labels.some((label) => label.includes(STREAM_NAME))).toBe(true);
    testLogger.info("Stream options filtered by substring search");
  });

  test("should load the stream list on the Metrics Visualize page with a blank stream", {
    tag: ["@add-panel-stream-list", "@metrics", "@P1", "@all"],
  }, async () => {
    testLogger.info("Opening the Metrics Visualize workspace (page key 'metrics')");

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.switchToVisualize();
    await pm.logsVisualise.waitForPanelEditor();

    // The metrics page hides the stream-type select; the stream select is enabled.
    await pm.logsVisualise.expectStreamSelectEnabled();

    const labels = await pm.logsVisualise.getStreamOptionLabels();
    if (labels.length === 0) {
      test.skip(true, "No metrics streams ingested in this org — stream list empty by design");
    }
    expect(labels.length).toBeGreaterThan(0);
    testLogger.info("Stream list loaded on the Metrics Visualize page with a blank stream");
  });
});
