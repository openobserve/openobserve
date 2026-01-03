const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });

test.describe("dashboard general setting", () => {
  const randomDashboardName =
    "Dashboard_" + Math.random().toString(36).slice(2, 11);

  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should verify that adding a default duration time and add tab on dashboard settings", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const newDashboardName =
      pm.dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    const newTabName = pm.dashboardSetting.generateUniqueTabnewName("new-tab");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open dashboard settings

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.dashboardNameChange(newDashboardName);

    // Fix: Use relativeTimeSelection from pm.dashboardSetting POM
    await pm.dashboardSetting.relativeTimeSelection("3", "h");
    await pm.dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    // add tab in dashboard
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();
    await pm.dashboardSetting.closeSettingDashboard();
    await pm.dashboardCreate.backToDashboardList();

    //delete the dashboard
    await deleteDashboard(page, newDashboardName);
  });

  test("should verify that dynamic toggle is disabled", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const newDashboardName =
      pm.dashboardSetting.generateUniqueDashboardnewName("new-dashboard");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings
    await pm.dashboardSetting.openSetting(); // Ensure settings are opened
    await pm.dashboardSetting.dashboardNameChange(newDashboardName);

    //verify that dynamic toggle is disabled
    await pm.dashboardSetting.showDynamicFilter();
    await pm.dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, newDashboardName);
  });
});
