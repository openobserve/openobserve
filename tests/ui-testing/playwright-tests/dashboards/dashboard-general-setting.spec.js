import { test, expect } from "../baseFixtures";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time";
import { time } from "console";
import { waitForDashboardPage } from "../utils/dashCreation";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard general setting", () => {
  let dashboardCreate;
  let dashboardSetting;
  let dateTimeHelper;
  let dashboardTimeRefresh;
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
    dashboardCreate = new DashboardCreate(page);
    dashboardSetting = new DashboardSetting(page);
    dateTimeHelper = new DateTimeHelper(page);
    dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    const newTabName = dashboardSetting.generateUniqueTabnewName("new-tab");

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    await waitForDashboardPage(page);

    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    await dashboardSetting.openSetting();

    await dashboardSetting.dashboardNameChange(newDashboardName);

    // Fix: Use relativeTimeSelection from DashboardSetting POM
    await dashboardSetting.relativeTimeSelection("3", "h");
    await dashboardSetting.saveSetting();
    await dashboardSetting.addTabSetting(newTabName);

    // await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    
  });

  test("should verify that dynamic toggle is disabled", async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardSetting = new DashboardSetting(page);
    dateTimeHelper = new DateTimeHelper(page);
    dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const newDashboardName =
      dashboardSetting.generateUniqueDashboardnewName("new-dashboard");
    const newTabName = dashboardSetting.generateUniqueTabnewName("new-tab");

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await waitForDashboardPage;

    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.createDashboard(randomDashboardName);
    await waitForDashboardPage;

    await page
    .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    .waitFor({
      state: "visible",
    });
    await dashboardSetting.openSetting(); // Ensure settings are opened
    await dashboardSetting.dashboardNameChange(newDashboardName);
    await dashboardSetting.showDynamicFilter();

    await dashboardSetting.saveSetting();
    await expect(page.getByText("Dashboard updated successfully")).toBeVisible({
      timeout: 30000,
    });
    await dashboardSetting.closeSettingDashboard();
  });
});
