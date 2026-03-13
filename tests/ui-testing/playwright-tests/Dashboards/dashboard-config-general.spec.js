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
  setupBarPanel,
  setupBarPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — General Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("description: fill value, apply, save, reopen and verify it persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
    const description = "Persistent description " + Date.now();

    await setupBarPanel(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.openConfigPanel();

    const descriptionField = page.locator('[data-test="dashboard-config-description"]');
    await expect(descriptionField).toBeVisible();
    await descriptionField.click();
    await descriptionField.fill(description);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Description saved, re-opening panel to verify persistence");
    await page.locator('[data-test="dashboard-panel-bar"]').first().hover();
    await page.locator('[data-test*="dashboard-edit-panel"][data-test$="-dropdown"]').first().click();
    await page.locator('[data-test="dashboard-edit-panel"]').click();
    await pm.dashboardPanelConfigs.openConfigPanel();
    await expect(page.locator('[data-test="dashboard-config-description"]')).toHaveValue(description);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("unit: set Bytes → chart renders; set Custom → input remains visible", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const unitDropdown = page.locator('[data-test="dashboard-config-unit"]');
    await expect(unitDropdown).toBeVisible();

    // Set to Bytes
    await pm.dashboardPanelConfigs.selectUnit("Bytes");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Unit set to Bytes");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Set to Custom — unit field should remain visible
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectUnit("Custom");
    await expect(unitDropdown).toBeVisible();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying unit config persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-unit"]')).toContainText("Custom");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("decimals: set 0 → apply; set 4 → apply; chart renders in both cases", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const decimalsInput = page.locator('[data-test="dashboard-config-decimals"]');
    await expect(decimalsInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectDecimals("0");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Decimals set to 0");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectDecimals("4");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Decimals set to 4");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying decimals config persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-decimals"]')).toHaveValue("4");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("no-value replacement: set N/A → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const noValueInput = page.locator('[data-test="dashboard-config-no-value-replacement"]');
    await expect(noValueInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectNoValueReplace("N/A");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("No-value replacement set to N/A");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying no-value replacement persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-no-value-replacement"]')).toHaveValue("N/A");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("query limit: set 100 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const limitInput = page.locator('[data-test="dashboard-config-limit"]');
    await expect(limitInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectQueryLimit("100");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Query limit set to 100");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying query limit persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-limit"]')).toHaveValue("100");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
