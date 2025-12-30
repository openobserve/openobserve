const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const dashboardName = `Dashboard_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("dashboard variables settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should try to open variables, click add variable, and without saving close it ", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Get the variable name
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // Cancel the variable
    await pm.dashboardSetting.cancelVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  // query values test cases

  test("should add query_values to dashboard and save it", async ({ page }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    // const dashboardName = generateDashboardName();

    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add a query values variable
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Save the variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should add max records size, check toggle of multi select, and save it", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",

      // Add a variable with specified properties
      "kubernetes_namespace_name"
    );
    // Set max records size and enable multi-select
    await pm.dashboardSetting.addMaxRecord("2");
    await pm.dashboardSetting.enableMultiSelect();
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that by default select is working", async ({ page }) => {
    // Initialize page manager
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();
    const defaultValue = "ingress-nginx";

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add a query values variable
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    // Set the default value
    await pm.dashboardSetting.addMaxRecord("2");
    await pm.dashboardSetting.addCustomValue(defaultValue);
    // Save the variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on query_values variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Wait for the add panel button to be visible
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add a query values variable
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );

    // Set max records size to 2
    await pm.dashboardSetting.addMaxRecord("2");

    // Hide the variable
    await pm.dashboardSetting.hideVariable();

    // Save the variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify constant variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);

    const variableName = pm.dashboardSetting.variableName();

    // Navigate to dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Wait for the add panel button to be visible
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Select constant type
    await pm.dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );

    // Save the variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("should verify that hide on constant variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page manager
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and save variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );
    await pm.dashboardSetting.hideVariable();
    await pm.dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("should verify textbox variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);

    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open dashboard settings and variables section
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Select and add a textbox variable
    await pm.dashboardSetting.selectTextType("TextBox", variableName);

    // Save the added variable
    await pm.dashboardSetting.saveVariable();

    // Ensure the add variable button is visible
    await page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });

    // Close the settings window
    await pm.dashboardSetting.closeSettingWindow();

    //delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on textbox variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open the settings and variables section and save variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.selectTextType("TextBox", variableName);
    await pm.dashboardSetting.hideVariable();
    await pm.dashboardSetting.saveVariable();

    // Ensure the add variable button is visible
    await page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });

    // Close the settings window
    await pm.dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify custom variables by adding and its visible on dashboard", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the settings and variables section and save variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );

    // Save the added variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Ensure the panel is visible
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that multi select is working properly", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);

    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open settings and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Select custom type and enable multi-select
    await pm.dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await pm.dashboardSetting.enableMultiSelect();

    // Save the variable
    await pm.dashboardSetting.saveVariable();

    await pm.dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on custom variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page objects
    const pm = new PageManager(page);
    const variableName = pm.dashboardSetting.variableName();

    // Navigate to the dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open settings and variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Select custom type and enable multi-select
    await pm.dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await pm.dashboardSetting.hideVariable();

    // Save the variable
    await pm.dashboardSetting.saveVariable();

    await pm.dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
