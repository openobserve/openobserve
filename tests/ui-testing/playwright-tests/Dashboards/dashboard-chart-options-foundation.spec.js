const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import {
  generateDashboardName,
  buildPromQLPanel,
  setupMapsPanelWithConfig,
  reopenPanelConfig,
  waitForPanelRenderSettled,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

const PROMQL_RANGE_URL = /\/prometheus\/api\/v1\/query_range\?/;

/** Builds a PromQL panel of `chartType` and opens the config sidebar. */
async function setupPromQLChart(page, pm, dashboardName, chartType, query = "cpu_usage") {
  await buildPromQLPanel(page, pm, dashboardName, { chartType, query });
  await pm.dashboardPanelConfigs.openConfigPanel();
}

/** Resolves with the next PromQL query_range request URL, parsed. */
function nextPromQLRequest(page) {
  return page
    .waitForRequest((req) => PROMQL_RANGE_URL.test(req.url()), { timeout: 30000 })
    .then((req) => new URL(req.url()));
}

test.describe("Dashboard chart options — PromQL series limit, query type, reducer", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test("series limit: shown for PromQL stacked, hidden for PromQL line", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChart(page, pm, dashboardName, "line");
    await expect(configs.promqlSeriesLimit).toHaveCount(0);

    await pm.chartTypeSelector.selectChartType("stacked");
    await configs.expandAllConfigSections();
    await configs.scrollSidebarToElement(configs.promqlSeriesLimit);
    await expect(configs.promqlSeriesLimit).toBeVisible();
    await expect(configs.promqlSeriesLimitField).toHaveAttribute("placeholder", /^\d+$/);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("series limit: limit 1 caps the series, shows the notice, and persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChart(page, pm, dashboardName, "stacked");
    await configs.setPromqlSeriesLimit(1);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelRenderSettled(page, pm);

    await expect(pm.dashboardNotices.noticeChip("series-cap")).toBeVisible({ timeout: 20000 });

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await configs.scrollSidebarToElement(configs.promqlSeriesLimit);
    // Needs a backend that carries promql_series_limit in PanelConfig (#15806); older builds drop it on save.
    await expect(configs.promqlSeriesLimitField).toHaveValue("1");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("query type: custom mode Instant sends start == end and persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChart(page, pm, dashboardName, "line");
    await expect(configs.promqlQueryTypeTrigger).toBeVisible();
    await expect(configs.promqlQueryTypeTrigger).toContainText("Range");

    await configs.selectPromqlQueryType("Instant");
    const request = nextPromQLRequest(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    const url = await request;
    expect(url.searchParams.get("start")).toBe(url.searchParams.get("end"));
    await waitForPanelRenderSettled(page, pm);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await expect(configs.promqlQueryTypeTrigger).toContainText("Instant");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("reducer: aggregation shown for PromQL gauge and h-bar, persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChart(page, pm, dashboardName, "gauge", "sum(cpu_usage)");
    await expect(configs.aggregation).toBeVisible();

    await pm.chartTypeSelector.selectChartType("h-bar");
    await configs.expandAllConfigSections();
    await expect(configs.aggregation).toBeVisible();
    await configs.selectConfigOption("dashboard-config-aggregation", "Max (maximum value)");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelRenderSettled(page, pm);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await expect(configs.aggregation).toContainText("Max");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("reducer: PromQL metric hides aggregation once every query is Instant", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupPromQLChart(page, pm, dashboardName, "metric", "sum(cpu_usage)");
    await expect(configs.aggregation).toBeVisible();

    await configs.selectPromqlQueryType("Instant");
    await expect(configs.aggregation).toBeHidden();

    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelRenderSettled(page, pm);
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
    test(`thresholds: ${chartType} offers line/band show-as and a step persists after save`, async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType(chartType);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "b");
      await pm.dashboardPanelActions.addPanelName("Test Panel");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await configs.openConfigPanel();

      await configs.selectThresholdsShowAs("Shaded band");
      await configs.addThresholdStep(5);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await waitForPanelRenderSettled(page, pm);

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await configs.scrollSidebarToElement(configs.thresholdStepValueField(0));
      await expect(configs.thresholdStepValueField(0)).toHaveValue("5");
      await expect(configs.thresholdsShowAsTrigger).toContainText("Shaded band");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    });
  }

  test("maps: pan and zoom off persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupMapsPanelWithConfig(page, pm, dashboardName);
    await configs.scrollSidebarToElement(configs.mapRoam);
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "true");
    await configs.toggleMapRoam();
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "false");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelRenderSettled(page, pm);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await configs.scrollSidebarToElement(configs.mapRoam);
    // Needs a backend that carries enable_roam in PanelConfig (#15806); older builds drop it on save.
    await expect(configs.mapRoamBtn).toHaveAttribute("aria-checked", "false");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
