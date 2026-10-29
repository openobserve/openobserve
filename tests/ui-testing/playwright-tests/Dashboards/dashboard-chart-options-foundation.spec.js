const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import {
  generateDashboardName,
  setupPromQLChartWithConfig,
  setupStackedPanelWithConfig,
  setupMapsPanelWithConfig,
  reopenPanelConfig,
  waitForPanelRenderSettled,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

const TAGS = ["@dashboard", "@dashboardChartOptions", "@P1", "@all"];

test.describe("Dashboard chart options — PromQL series limit, query type, reducer", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test("series limit: shown for PromQL stacked, hidden for PromQL line", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChartWithConfig(page, pm, dashboardName, { chartType: "line", query: "cpu_usage" });
    await expect(configs.promqlSeriesLimit).toHaveCount(0);

    await pm.chartTypeSelector.selectChartType("stacked");
    await configs.expandAllConfigSections();
    await configs.scrollSidebarToElement(configs.promqlSeriesLimit);
    await expect(configs.promqlSeriesLimit).toBeVisible();
    await expect(configs.promqlSeriesLimitField).toHaveAttribute("placeholder", /^\d+$/);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("series limit: limit 1 caps the series, shows the notice, and persists after save", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChartWithConfig(page, pm, dashboardName, { chartType: "stacked", query: "cpu_usage" });
    await configs.setPromqlSeriesLimit(1);
    await pm.dashboardPanelActions.applyDashboardBtn();
    expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);

    const seriesCapChip = pm.dashboardNotices.noticeChip("series-cap");
    await expect(seriesCapChip).toBeVisible({ timeout: 20000 });
    await expect(seriesCapChip).toContainText(/(?:^|\D)1\/\d[\d,]*\+? series/);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await configs.scrollSidebarToElement(configs.promqlSeriesLimit);
    // Needs a backend that carries promql_series_limit in PanelConfig (#15806); older builds drop it on save.
    await expect(configs.promqlSeriesLimitField).toHaveValue("1");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("query type: custom mode Instant sends start == end and persists after save", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChartWithConfig(page, pm, dashboardName, { chartType: "line", query: "cpu_usage" });
    await expect(configs.promqlQueryTypeTrigger).toBeVisible();
    await expect(configs.promqlQueryTypeTrigger).toContainText("Range");

    await configs.selectPromqlQueryType("Instant");
    const request = pm.dashboardPanelActions.nextPromQLQueryRangeRequest();
    await pm.dashboardPanelActions.applyDashboardBtn();
    const url = await request;
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start).toBe(end);
    expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await expect(configs.promqlQueryTypeTrigger).toContainText("Instant");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("reducer: aggregation shown for PromQL gauge and h-bar, persists after save", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChartWithConfig(page, pm, dashboardName, { chartType: "gauge", query: "sum(cpu_usage)" });
    await expect(configs.aggregation).toBeVisible();

    await pm.chartTypeSelector.selectChartType("h-bar");
    await configs.expandAllConfigSections();
    await expect(configs.aggregation).toBeVisible();
    await configs.selectAggregation("Max (maximum value)");
    await pm.dashboardPanelActions.applyDashboardBtn();
    expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await expect(configs.aggregation).toContainText("Max");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("reducer: PromQL metric hides aggregation once every query is Instant", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChartWithConfig(page, pm, dashboardName, { chartType: "metric", query: "sum(cpu_usage)" });
    await expect(configs.aggregation).toBeVisible();

    await configs.selectPromqlQueryType("Instant");
    await expect(configs.aggregation).toBeHidden();

    await pm.dashboardPanelActions.applyDashboardBtn();
    expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});

test.describe("Dashboard chart options — stacked thresholds and maps pan/zoom", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  for (const chartType of ["stacked", "h-stacked"]) {
    test(`thresholds: ${chartType} offers line/band show-as and a step persists after save`, { tag: TAGS }, async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName, { chartType });

      await configs.selectThresholdsShowAs("Shaded band");
      await configs.addThresholdStep(5);
      await pm.dashboardPanelActions.applyDashboardBtn();
      expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await configs.scrollSidebarToElement(configs.thresholdStepValueField(0));
      await expect(configs.thresholdStepValueField(0)).toHaveValue("5");
      await expect(configs.thresholdsShowAsTrigger).toContainText("Shaded band");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    });
  }

  test("maps: pan and zoom on persists after save", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupMapsPanelWithConfig(page, pm, dashboardName);
    await configs.scrollSidebarToElement(configs.mapRoam);
    // SQL maps default pan and zoom off; only PromQL maps default it on.
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "false");
    await configs.toggleMapRoam();
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.applyDashboardBtn();
    expect(await waitForPanelRenderSettled(page, pm), "panel never finished loading").toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await configs.scrollSidebarToElement(configs.mapRoam);
    // Needs a backend that carries enable_roam in PanelConfig (#15806); older builds drop it on save.
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "true");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
