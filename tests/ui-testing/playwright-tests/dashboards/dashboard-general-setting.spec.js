import { test, expect } from "../baseFixtures";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings";
import { time } from "console";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard general setting", () => {
  const randomDashboardName =
    "Dashboard_" + Math.random().toString(36).slice(2, 11);

  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`
    );

    // Instantiate with page
  });

  test("should verify that adding a default duration time and add tab on dashboard settings", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const dashboardList = new DashboardListPage(page);
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    const newTabName = dashboardSetting.generateUniqueTabnewName("new-tab");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open dashboard settings

    await dashboardSetting.openSetting();
    await dashboardSetting.dashboardNameChange(newDashboardName);

    // Fix: Use relativeTimeSelection from DashboardSetting POM
    await dashboardSetting.relativeTimeSelection("3", "h");
    await dashboardSetting.saveSetting();

    // await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    // add tab in dashboard
    await dashboardSetting.addTabSetting(newTabName);
    await dashboardSetting.saveTabSetting();
    await dashboardSetting.closeSettingDashboard();
    await dashboardCreate.backToDashboardList();

    //delete the dashboard
    await deleteDashboard(page, newDashboardName);
  });

  test("should verify that dynamic toggle is disabled", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const dashboardList = new DashboardListPage(page);
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings
    await dashboardSetting.openSetting(); // Ensure settings are opened
    await dashboardSetting.dashboardNameChange(newDashboardName);

    //verify that dynamic toggle is disabled
    await dashboardSetting.showDynamicFilter();
    await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    await dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, newDashboardName);
  });
});
