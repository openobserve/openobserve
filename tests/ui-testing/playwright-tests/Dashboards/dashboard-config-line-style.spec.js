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
  setupLinePanelWithConfig,
  setupAreaPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Line Style Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("symbol: visible → Circle → apply; No Symbol → apply; chart renders in both cases", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    const symbolDropdown = page.locator('[data-test="dashboard-config-show_symbol"]');
    await expect(symbolDropdown).toBeVisible();

    await pm.dashboardPanelConfigs.selectSymbols("Circle");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Symbol set to Circle");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectSymbols("No Symbol");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Symbol set to No Symbol");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying symbol No Symbol persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-show_symbol"]')).toContainText("No Symbol");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("line interpolation: visible → Smooth → Linear → Step After → apply each; chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    const interpolationDropdown = page.locator('[data-test="dashboard-config-line_interpolation"]');
    await expect(interpolationDropdown).toBeVisible();

    for (const mode of ["Smooth", "Linear", "Step After"]) {
      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectLineInterpolation(mode);
      await pm.dashboardPanelActions.applyDashboardBtn();
      testLogger.info(`Line interpolation set to ${mode}`);
      await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);
    }

    testLogger.info("Verifying line interpolation Step After persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-line_interpolation"]')).toContainText("Step After");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("line thickness: visible → set 3 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-line_thickness"]')).toBeVisible();
    await pm.dashboardPanelConfigs.selectLineThickness("3");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Line thickness set to 3");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying line thickness persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-line_thickness"]')).toHaveValue("3");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("connect null values: visible → enable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    const connectNullToggle = page.locator('[data-test="dashboard-config-connect-null-values"]');
    await expect(connectNullToggle).toBeVisible();
    await connectNullToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Connect null values enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying connect null values enabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-connect-null-values"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
