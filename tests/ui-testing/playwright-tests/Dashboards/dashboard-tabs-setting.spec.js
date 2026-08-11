const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard tabs setting", () => {
  const generateDashboardName = (prefix = "Dashboard") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
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
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

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
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    await expect(pm.dashboardSetting.getToastMessageByText("Tab added successfully")).toBeVisible({
      timeout: 5000,
    });

    await pm.dashboardSetting.closeSettingDashboard();

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
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();
    await expect(pm.dashboardSetting.getToastMessageByText("Tab added successfully")).toBeVisible({
      timeout: 5000,
    });

    // Edit the tab name and save it
    await pm.dashboardSetting.updateDashboardTabName(
      newTabName,
      updatedTabName
    );

    await pm.dashboardSetting.saveEditedtab();
    await expect(pm.dashboardSetting.getToastMessageByText("Tab updated successfully")).toBeVisible({
      timeout: 5000,
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
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

    // Open dashboard settings and add a tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    await expect(pm.dashboardSetting.getToastMessageByText("Tab added successfully")).toBeVisible({
      timeout: 5000,
    });

    // Edit the tab name and cancel it
    await pm.dashboardSetting.updateDashboardTabName(
      newTabName,
      updatedTabName
    );
    await pm.dashboardSetting.cancelEditedtab();
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
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

    // Open dashboard settings, add a tab, and delete it
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();

    await expect(pm.dashboardSetting.getToastMessageByText("Tab added successfully")).toBeVisible({
      timeout: 5000,
    });

    // Delete the tab
    await pm.dashboardSetting.deleteTab(newTabName);
    await expect(pm.dashboardSetting.getToastMessageByText("Tab deleted successfully")).toBeVisible({
      timeout: 5000,
    });
    await pm.dashboardSetting.closeSettingDashboard();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
