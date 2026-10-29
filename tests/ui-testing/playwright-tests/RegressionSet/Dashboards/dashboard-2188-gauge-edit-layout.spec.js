const { test, expect, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
const PageManager = require("../../../pages/page-manager.js");
import { ingestion } from "../../Dashboards/utils/dashIngestion.js";
import {
  setupGaugePanelWithConfig,
  reopenPanelConfig,
  discardAndCleanupTestDashboard,
} from "../../Dashboards/utils/configPanelHelpers.js";
const testLogger = require("../../utils/test-logger.js");

const NAMESPACE = "ziox";
const GAUGE_RANGE_PANEL_ERROR = "Gauge min value must be lower than max value";

test.describe("Gauge keeps its layout when an existing panel is edited (#2188)", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("editing min and max of a saved gauge keeps the dial inside its canvas after a panel error is shown and cleared", {
    tag: ["@bug-2188", "@P2", "@regression", "@dashboards", "@dashboardRegression"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_2188_range_${Date.now()}`;

    try {
      await setupGaugePanelWithConfig(page, pm, dashboardName, "Gauge 2188");
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect);

      await reopenPanelConfig(page, pm);
      // Opening the editor and its config sidebar resizes the chart, which is where the dial used to distort.
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect);

      // The issue's repro is a message under the chart, which resizes it; an inverted range is the gauge message still reachable.
      await pm.dashboardPanelConfigs.selectGuageMin("500");
      await pm.dashboardPanelConfigs.selectGuageMax("10");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toContainText([GAUGE_RANGE_PANEL_ERROR]);
      // The renderer draws an inverted range as min..min+100, so 500..600 proves this is the new option, not a stale one.
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect, { min: 500, max: 600 });

      await pm.dashboardPanelConfigs.selectGuageMin("10");
      await pm.dashboardPanelConfigs.selectGuageMax("500");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect, { min: 10, max: 500 });

      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect, { min: 10, max: 500 });
    } finally {
      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  });

  test("regrouping a saved gauge by another field lays every dial out without overflow or overlap", {
    tag: ["@bug-2188", "@P2", "@regression", "@dashboards", "@dashboardRegression"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_2188_regroup_${Date.now()}`;

    try {
      await setupGaugePanelWithConfig(page, pm, dashboardName, "Gauge 2188");
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect);

      await reopenPanelConfig(page, pm);
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "x");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      // The editor keeps drawing the old grouping until the regrouped query lands.
      await expect.poll(() => pm.dashboardPanelActions.getGaugeDialNames(), { timeout: 20000 }).toContain(NAMESPACE);
      testLogger.info("Gauge dials after regrouping", { dials: await pm.dashboardPanelActions.getGaugeDialNames() });
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect);

      await pm.dashboardPanelActions.savePanel();
      // The saved panel re-queries a shared stream, so its dial count can move; only the namespace is stable.
      await expect.poll(() => pm.dashboardPanelActions.getGaugeDialNames(), { timeout: 20000 }).toContain(NAMESPACE);
      await pm.dashboardPanelActions.expectGaugeWellFormed(expect);
    } finally {
      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  });
});
