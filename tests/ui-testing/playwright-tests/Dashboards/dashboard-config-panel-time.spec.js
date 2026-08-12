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
  setupBarPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Panel Time Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("panel time toggle: visible + unchecked by default → enable → +Set button appears → click → picker visible", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const panelTimeToggle = pm.dashboardPanelTime.panelTimeToggle;
    const setBtn = pm.dashboardPanelTime.setPanelTimeBtn;

    await expect(panelTimeToggle).toBeVisible();
    await expect(panelTimeToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "false");
    await expect(setBtn).not.toBeVisible();

    await pm.dashboardPanelTime.enablePanelTime();
    await expect(setBtn).toBeVisible();

    await setBtn.click();
    await expect(pm.dashboardPanelTime.panelTimePickerWrapper).toBeVisible();
    testLogger.info("Panel time toggle enabled, +Set clicked, picker visible");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("set relative time → picker stays visible; cancel X → +Set reappears", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelTime.enablePanelTime();
    await pm.dashboardPanelTime.setPanelTimeBtn.click();
    await pm.dashboardPanelTime.setPanelTimeRelative("1-h");

    const timePicker = pm.dashboardPanelTime.panelTimePickerWrapper;
    await expect(timePicker).toBeVisible();
    testLogger.info("Relative time set to Last 1h");

    // Cancel X → +Set reappears
    await pm.dashboardPanelTime.cancelPanelTimeBtn.click();
    await expect(pm.dashboardPanelTime.setPanelTimeBtn).toBeVisible();
    testLogger.info("Cancel X clicked — +Set reappeared");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("disable panel time toggle → time section hides", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelTime.enablePanelTime();
    await expect(pm.dashboardPanelTime.setPanelTimeBtn).toBeVisible();

    await pm.dashboardPanelTime.disablePanelTime();
    await expect(pm.dashboardPanelTime.setPanelTimeBtn).not.toBeVisible();
    testLogger.info("Panel time section hidden after disabling toggle");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("panel time persists: set 15m → save → reopen → toggle still enabled", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelTime.enablePanelTime();
    await pm.dashboardPanelTime.setPanelTimeBtn.click();
    await pm.dashboardPanelTime.setPanelTimeRelative("15-m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Panel saved with panel time, re-opening to verify persistence");
    await pm.dashboardPanelActions.openFirstPanelEditor();
    await pm.dashboardPanelConfigs.openConfigPanel();

    expect(await pm.dashboardPanelTime.isPanelTimeEnabled()).toBe(true);
    testLogger.info("Panel time toggle remains enabled after save/reopen");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("save with panel time: API responds 200", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelTime.enablePanelTime();
    await pm.dashboardPanelTime.setPanelTimeBtn.click();
    await pm.dashboardPanelTime.setPanelTimeRelative("1-h");
    await pm.dashboardPanelActions.applyDashboardBtn();

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        /\/api\/.*\/dashboards\/.*/.test(response.url()) &&
        (response.request().method() === "PUT" || response.request().method() === "POST"),
      { timeout: 15000 }
    );
    await pm.dashboardPanelActions.savePanel();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(200);
    testLogger.info("Save API returned 200 with panel time configured");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("absolute panel time: enable → set date range → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelTime.enablePanelTime();
    await pm.dashboardPanelTime.setPanelTimeBtn.click();
    const today = new Date().getDate();
    const startDay = Math.max(1, today - 4);
    await pm.dashboardPanelTime.setPanelTimeAbsolute(startDay, today);
    testLogger.info(`Absolute panel time set (day ${startDay} to day ${today})`);

    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying panel time toggle enabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelTime.panelTimeToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
