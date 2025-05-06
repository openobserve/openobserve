import { test, expect } from "../baseFixtures";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time";
import { time } from "console";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard general setting", () => {
  let dashboardCreate;
  let dashboardSetting;
  let dateTimeHelper;
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
    dashboardCreate = new DashboardCreate(page);
    dashboardSetting = new DashboardSetting(page);
    dateTimeHelper = new DateTimeHelper(page);
  });

  test("should verify that adding a default duration time and add tab on dashboard settings", async ({
    page,
  }) => {
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    const newTabName = dashboardSetting.generateUniqueTabnewName("new-tab");
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardSetting.setting.click(); // Ensure settings are opened
    await dashboardSetting.dashboardNameChange(newDashboardName);

    // Fix: Use relativeTimeSelection from DashboardSetting POM
    await dashboardSetting.relativeTimeSelection("date", "2-h");

    await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    await dashboardSetting.closeSettingDashboard();
    await dashboardSetting.addTabSetting(newTabName);
  });

  test("should verify that dynamic toggle is disabled", async ({ page }) => {
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardSetting.setting.click(); // Ensure settings are opened
    await dashboardSetting.dashboardNameChange(newDashboardName);
    await dashboardSetting.showDynamicFilter();

    await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    await dashboardSetting.closeSettingDashboard();
  });
});
