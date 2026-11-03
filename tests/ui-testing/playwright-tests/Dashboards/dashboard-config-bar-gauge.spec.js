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
  setupBarGaugePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

// ConfigPanel's sentinel for an option left unset, which the select reports as its value.
const DEFAULT_VALUE = "__auto__";

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Bar Gauge Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("bar gauge: renders with data and shows its options with their defaults", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupBarGaugePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await configs.scrollSidebarToElement(configs.barGaugeMode);
    await expect(configs.barGaugeRangeMode).toBeVisible();
    await expect(configs.barGaugeMode).toBeVisible();
    await expect(configs.barGaugeOrientation).toBeVisible();
    await expect(configs.barGaugeShowUnfilled).toBeVisible();
    await expect(configs.gaugeRangeMode).toBeHidden();
    await expect(configs.gaugeStyle).toBeHidden();

    await configs.expectConfigSelectValue(configs.barGaugeModeTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.barGaugeOrientationTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.barGaugeRangeModeTrigger, DEFAULT_VALUE);
    await configs.expectConfigToggle(configs.barGaugeShowUnfilled, true);
    await expect(configs.gaugeMin).toBeHidden();
    await expect(configs.gaugeMax).toBeHidden();

    expect(await configs.getConfigSelectOptionLabels("dashboard-config-bar_gauge_mode")).toEqual([
      "Default (Gradient)",
      "Gradient",
      "Retro LCD",
      "Basic",
    ]);
    expect(await configs.getConfigSelectOptionLabels("dashboard-config-bar_gauge_orientation")).toEqual([
      "Default (Horizontal)",
      "Horizontal",
      "Vertical",
    ]);
    expect(await configs.getConfigSelectOptionLabels("dashboard-config-bar-gauge-range-mode")).toEqual([
      "Default (auto from data)",
      "Fixed",
      "Auto",
    ]);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("display mode, orientation and unfilled area: each renders and persists after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupBarGaugePanelWithConfig(page, pm, dashboardName);

    for (const [mode, value] of [["Gradient", "gradient"], ["Basic", "basic"], ["Retro LCD", "lcd"]]) {
      await configs.selectBarGaugeMode(mode);
      await configs.expectConfigSelectValue(configs.barGaugeModeTrigger, value);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      testLogger.info("Bar gauge rendered", { mode });
    }

    await configs.selectBarGaugeOrientation("Vertical");
    await configs.setConfigToggle(configs.barGaugeShowUnfilled, false);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying bar gauge mode, orientation and unfilled area persist after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.barGaugeModeTrigger, "lcd");
    await configs.expectConfigSelectValue(configs.barGaugeOrientationTrigger, "vertical");
    await configs.expectConfigToggle(configs.barGaugeShowUnfilled, false);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("range: min/max show only for Fixed, and Fixed bounds persist after save", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupBarGaugePanelWithConfig(page, pm, dashboardName);
    await expect(configs.gaugeMin).toBeHidden();

    await configs.selectBarGaugeRangeMode("Fixed");
    await expect(configs.gaugeMin).toBeVisible();
    await expect(configs.gaugeMax).toBeVisible();
    await configs.selectGuageMin("0");
    await configs.selectGuageMax("1000");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await configs.selectBarGaugeRangeMode("Auto");
    await expect(configs.gaugeMin).toBeHidden();
    await expect(configs.gaugeMax).toBeHidden();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await configs.selectBarGaugeRangeMode("Fixed");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying bar gauge Fixed range and bounds persist after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.barGaugeRangeModeTrigger, "fixed");
    await expect(configs.gaugeMinField).toHaveValue("0");
    await expect(configs.gaugeMaxField).toHaveValue("1000");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Default resets a saved mode, orientation and range back to unset", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupBarGaugePanelWithConfig(page, pm, dashboardName);
    await configs.selectBarGaugeMode("Basic");
    await configs.selectBarGaugeOrientation("Vertical");
    await configs.selectBarGaugeRangeMode("Auto");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.barGaugeModeTrigger, "basic");
    await configs.selectBarGaugeMode("Default (Gradient)");
    await configs.selectBarGaugeOrientation("Default (Horizontal)");
    await configs.selectBarGaugeRangeMode("Default (auto from data)");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying Default selections persist as unset after save");
    await reopenPanelConfig(page, pm);
    await configs.expectConfigSelectValue(configs.barGaugeModeTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.barGaugeOrientationTrigger, DEFAULT_VALUE);
    await configs.expectConfigSelectValue(configs.barGaugeRangeModeTrigger, DEFAULT_VALUE);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("switching type: gauge hides the bar gauge options, switching back restores them", async ({ page }) => {
    const pm = new PageManager(page);
    const configs = pm.dashboardPanelConfigs;
    const dashboardName = generateDashboardName();

    await setupBarGaugePanelWithConfig(page, pm, dashboardName);
    await configs.selectBarGaugeMode("Retro LCD");

    await pm.chartTypeSelector.selectChartType("gauge");
    await configs.expandAllConfigSections();
    await configs.scrollSidebarToElement(configs.gaugeStyle);
    await expect(configs.gaugeStyle).toBeVisible();
    await expect(configs.gaugeRangeMode).toBeVisible();
    await expect(configs.barGaugeMode).toBeHidden();
    await expect(configs.barGaugeOrientation).toBeHidden();
    await expect(configs.barGaugeShowUnfilled).toBeHidden();
    await expect(configs.barGaugeRangeMode).toBeHidden();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.chartTypeSelector.selectChartType("bar-gauge");
    await configs.expandAllConfigSections();
    await configs.scrollSidebarToElement(configs.barGaugeMode);
    await expect(configs.barGaugeMode).toBeVisible();
    await expect(configs.barGaugeOrientation).toBeVisible();
    await expect(configs.barGaugeShowUnfilled).toBeVisible();
    await expect(configs.barGaugeRangeMode).toBeVisible();
    await expect(configs.gaugeStyle).toBeHidden();
    await expect(configs.gaugeRangeMode).toBeHidden();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
