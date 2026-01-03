const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard tabs setting", () => {
  const generateDashboardName = (prefix = "Dashboard") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should try to open tabs, click add tabs, and without saving close it", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName =
      pm.dashboardSetting.generateUniqueTabnewName("updated-tab");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);

    // Cancel the tab without saving
    await pm.dashboardSetting.cancelTabwithoutSave();
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should go to tabs, click on add tab, add its name and save it", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName =
      pm.dashboardSetting.generateUniqueTabnewName("updated-tab");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();
    await pm.dashboardSetting.closeSettingDashboard();

    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should edit tab name and save it", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName = pm.dashboardSetting.generateUniqueTabnewName("New-tab");
    const updatedTabName =
      pm.dashboardSetting.generateUniqueTabnewName("Updated-tab");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();
    // await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
    //   timeout: 3000,
    // });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });

    // Edit the tab name and save it
    await pm.dashboardSetting.updateDashboardTabName(
      newTabName,
      updatedTabName
    );

    await pm.dashboardSetting.saveEditedtab();
    // await expect(page.getByText("Tab added successfully")).toBeVisible({
    //   timeout: 2000,
    // });
    await expect(page.getByText("Tab updated successfully")).toBeVisible({
      timeout: 2000,
    });
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
  test("should edit tab name and cancel it", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName = pm.dashboardSetting.generateUniqueTabnewName("New-tab");
    const updatedTabName =
      pm.dashboardSetting.generateUniqueTabnewName("Updated-tab");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    // Edit the tab name and cancel it
    await pm.dashboardSetting.updateDashboardTabName(
      newTabName,
      updatedTabName
    );
    await pm.dashboardSetting.cancelEditedtab();
    // await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
    //   timeout: 3000,
    // });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should delete tab, click delete and confirm it", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const newTabName = pm.dashboardSetting.generateUniqueTabnewName("New-tab");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings, add a tab, and delete it
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    // await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
    //   timeout: 3000,
    // });
    await expect(page.getByText("Tab added successfully")).toBeVisible({
      timeout: 2000,
    });

    // Delete the tab
    await pm.dashboardSetting.deleteTab(newTabName);
    await expect(page.getByText("Tab deleted successfully")).toBeVisible({
      timeout: 2000,
    });
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
