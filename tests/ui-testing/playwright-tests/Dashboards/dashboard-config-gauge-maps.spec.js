const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupGaugePanelWithConfig,
  setupGeomapPanelWithConfig,
  setupMapsPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Gauge and Maps Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("gauge min + max: visible → set min 10 + max 500 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGaugePanelWithConfig(page, pm, dashboardName);

    const gaugeMinInput = page.locator('[data-test="dashboard-config-gauge-min"]');
    const gaugeMaxInput = page.locator('[data-test="dashboard-config-gauge-max"]');
    await expect(gaugeMinInput).toBeVisible();
    await expect(gaugeMaxInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectGuageMin("10");
    await pm.dashboardPanelConfigs.selectGuageMax("500");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Gauge min=10, max=500");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying gauge min/max persist after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-gauge-min"]')).toHaveValue("10");
    await expect(page.locator('[data-test="dashboard-config-gauge-max"]')).toHaveValue("500");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("geomap lat/lng/zoom: all inputs visible → set values → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-basemap"]')).toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-latitude"]')).toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-longitude"]')).toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-zoom"]')).toBeVisible();

    await pm.dashboardPanelConfigs.selectLatitude("40.7128");
    await pm.dashboardPanelConfigs.selectLongitude("-74.0060");
    await pm.dashboardPanelConfigs.selectZoom("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Geomap lat/lng/zoom set");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying geomap lat/lng/zoom persist after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-latitude"]')).toHaveValue("40.7128");
    await expect(page.locator('[data-test="dashboard-config-longitude"]')).toHaveValue("-74.0060");
    await expect(page.locator('[data-test="dashboard-config-zoom"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("symbol size: By Value → min/max visible + set values; Fixed → fixed input visible + min/max hidden", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    // By Value — min and max inputs appear
    await pm.dashboardPanelConfigs.selectSymbolSize("By Value");
    const symbolMinInput = page.locator('[data-test="dashboard-config-map-symbol-min"]');
    const symbolMaxInput = page.locator('[data-test="dashboard-config-map-symbol-max"]');
    await expect(symbolMinInput).toBeVisible();
    await expect(symbolMaxInput).toBeVisible();
    await symbolMinInput.click();
    await symbolMinInput.fill("5");
    await symbolMaxInput.click();
    await symbolMaxInput.fill("30");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Symbol size By Value with min=5 and max=30");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Fixed — fixed input appears, min/max hidden
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectSymbolSize("Fixed");
    await expect(symbolMinInput).not.toBeVisible();
    await expect(symbolMaxInput).not.toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-map-symbol-fixed"]')).toBeVisible();
    testLogger.info("Symbol size Fixed: fixed input visible, min/max hidden");

    testLogger.info("Verifying symbol size Fixed persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-map-symbol-size"]')).toContainText("Fixed");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("layer type: dropdown visible → Scatter → apply; Heatmap → apply; chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-layer-type"]')).toBeVisible();

    await pm.dashboardPanelConfigs.selectLayerType("Scatter");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Layer type set to Scatter");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectLayerType("Heatmap");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Layer type set to Heatmap");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying layer type Heatmap persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-layer-type"]')).toContainText("Heatmap");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("maps chart type: map type dropdown visible → select World → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMapsPanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-map-type"]')).toBeVisible();
    await pm.dashboardPanelConfigs.selectMapType("World");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Map type set to World");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying map type World persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-map-type"]')).toContainText("World");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
