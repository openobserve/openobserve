import { test, expect } from "../baseFixtures";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard tabs setting", () => {
  const generateDashboardName = (prefix = "Dashboard") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
  });

  test("should try to open tabs, click add tabs, and without saving close it", async ({
    page,
  }) => {
    const randomDashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const newTabName = dashboardSetting.generateUniqueTabnewName("updated-tab");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await dashboardSetting.openSetting();
    await dashboardSetting.addTabSetting(newTabName);

    // Cancel the tab without saving
    await dashboardSetting.cancelTabwithoutSave();
    await dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should go to tabs, click on add tab, add its name and save it", async ({
    page,
  }) => {
    const randomDashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const newTabName = dashboardSetting.generateUniqueTabnewName("updated-tab");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await dashboardSetting.openSetting();
    await dashboardSetting.addTabSetting(newTabName);
    await dashboardSetting.saveTabSetting();
    await dashboardSetting.closeSettingDashboard();
    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should edit tab name and save it", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const newTabName = dashboardSetting.generateUniqueTabnewName("New-tab");
    const updatedTabName =
      dashboardSetting.generateUniqueTabnewName("Updated-tab");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await dashboardSetting.openSetting();
    await dashboardSetting.addTabSetting(newTabName);
    await dashboardSetting.saveTabSetting();
    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });

    // Edit the tab name and save it
    await dashboardSetting.updateDashboardTabName(newTabName, updatedTabName);
    await dashboardSetting.saveEditedtab();
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });
    await expect(page.getByText("Tab updated successfully")).toBeVisible({
      timeout: 2000,
    });
    await dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
  test("should edit tab name and cancel it", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const newTabName = dashboardSetting.generateUniqueTabnewName("New-tab");
    const updatedTabName =
      dashboardSetting.generateUniqueTabnewName("Updated-tab");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await dashboardSetting.openSetting();
    await dashboardSetting.addTabSetting(newTabName);
    await dashboardSetting.saveTabSetting();

    // Edit the tab name and cancel it
    await dashboardSetting.updateDashboardTabName(newTabName, updatedTabName);
    await dashboardSetting.cancelEditedtab();
    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });
    await dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should delete tab, click delete and confirm it", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const newTabName = dashboardSetting.generateUniqueTabnewName("New-tab");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings, add a tab, and delete it
    await dashboardSetting.openSetting();
    await dashboardSetting.addTabSetting(newTabName);
    await dashboardSetting.saveTabSetting();

    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 3000,
    });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });
    
    // Delete the tab
    await dashboardSetting.deleteTab(newTabName);
    await expect(page.getByText("Tab deleted successfully")).toBeVisible({
      timeout: 2000,
    });
    await dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
