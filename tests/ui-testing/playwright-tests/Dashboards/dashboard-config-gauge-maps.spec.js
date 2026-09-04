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
// Kept for reference, commented rather than deleted so it can be restored easily.
// This override beat --retries=0 locally (making a clean baseline impossible) and
// in CI it *cut* the project's retry budget (3 standard / 2 alpha1) down to 1.
// test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Gauge and Maps Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("gauge min + max: visible → set min 10 + max 500 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGaugePanelWithConfig(page, pm, dashboardName);

    const gaugeMinInput = pm.dashboardPanelConfigs.gaugeMin;
    const gaugeMaxInput = pm.dashboardPanelConfigs.gaugeMax;
    await expect(gaugeMinInput).toBeVisible();
    await expect(gaugeMaxInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectGuageMin("10");
    await pm.dashboardPanelConfigs.selectGuageMax("500");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Gauge min=10, max=500");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying gauge min/max persist after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.gaugeMin.locator('[data-test$="-field"]')).toHaveValue("10");
    await expect(pm.dashboardPanelConfigs.gaugeMax.locator('[data-test$="-field"]')).toHaveValue("500");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("geomap lat/lng/zoom: all inputs visible → set values → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.baseMap).toBeVisible();
    await expect(pm.dashboardPanelConfigs.latitude).toBeVisible();
    await expect(pm.dashboardPanelConfigs.longitude).toBeVisible();
    await expect(pm.dashboardPanelConfigs.zoom).toBeVisible();

    await pm.dashboardPanelConfigs.selectLatitude("40.7128");
    await pm.dashboardPanelConfigs.selectLongitude("-74.006");
    await pm.dashboardPanelConfigs.selectZoom("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Geomap lat/lng/zoom set");
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelConfigs.geomapRenderer.first()).toBeVisible({ timeout: 10000 });

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying geomap lat/lng/zoom persist after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.latitude.locator('[data-test$="-field"]')).toHaveValue("40.7128");
    await expect(pm.dashboardPanelConfigs.longitude.locator('[data-test$="-field"]')).toHaveValue("-74.006");
    await expect(pm.dashboardPanelConfigs.zoom.locator('[data-test$="-field"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("symbol size: By Value → min/max visible + set values; Fixed → fixed input visible + min/max hidden", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    // By Value — min and max inputs appear
    await pm.dashboardPanelConfigs.selectSymbolSize("By Value");
    const symbolMinInput = pm.dashboardPanelConfigs.minimumSize;
    const symbolMaxInput = pm.dashboardPanelConfigs.maximumSize;
    await expect(symbolMinInput).toBeVisible();
    await expect(symbolMaxInput).toBeVisible();
    await symbolMinInput.locator('[data-test$="-field"]').fill("5");
    await symbolMaxInput.locator('[data-test$="-field"]').fill("30");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Symbol size By Value with min=5 and max=30");
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelConfigs.geomapRenderer.first()).toBeVisible({ timeout: 10000 });

    // Fixed — fixed input appears, min/max hidden
    await pm.dashboardPanelConfigs.selectSymbolSize("Fixed");
    await expect(symbolMinInput).not.toBeVisible();
    await expect(symbolMaxInput).not.toBeVisible();
    await expect(pm.dashboardPanelConfigs.mapSymbolFixed).toBeVisible();
    testLogger.info("Symbol size Fixed: fixed input visible, min/max hidden");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying symbol size Fixed persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.symbolTrigger).toHaveAttribute('data-test-selected-value', 'fixed');
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("layer type: dropdown visible → Scatter → apply; Heatmap → apply; chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.layerType).toBeVisible();

    await pm.dashboardPanelConfigs.selectLayerType("Scatter");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Layer type set to Scatter");
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelConfigs.geomapRenderer.first()).toBeVisible({ timeout: 10000 });

    await pm.dashboardPanelConfigs.selectLayerType("Heatmap");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Layer type set to Heatmap");
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelConfigs.geomapRenderer.first()).toBeVisible({ timeout: 10000 });

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying layer type Heatmap persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.layerTypeTrigger).toHaveAttribute('data-test-selected-value', 'heatmap');
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("weight: geomap without weight field → weight input visible → set value 2 → apply → chart renders; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupGeomapPanelWithConfig(page, pm, dashboardName);

    // weight_fixed input appears for geomap when no weight field is mapped (isWeightFieldPresent = false)
    const weightInput = pm.dashboardPanelConfigs.weight;
    await expect(weightInput).toBeVisible({ timeout: 5000 });
    testLogger.info("Weight (fixed) input visible for geomap");

    await weightInput.locator('[data-test$="-field"]').fill("2");

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Applied with weight_fixed = 2");
    await pm.dashboardPanelActions.waitForChartToRender();
    await expect(pm.dashboardPanelConfigs.geomapRenderer.first()).toBeVisible({ timeout: 10000 });

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying weight value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.weight.locator('[data-test$="-field"]')).toHaveValue("2");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("maps chart type: map type dropdown visible → select World → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMapsPanelWithConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.mapType).toBeVisible();
    await pm.dashboardPanelConfigs.selectMapType("World");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Map type set to World");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying map type World persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.mapTypeTrigger).toHaveAttribute('data-test-selected-value', 'world');
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
