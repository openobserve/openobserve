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
const dashboardName = `Dashboard_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
  });

  test("should try to open variables, click add variable, and without saving close it ", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardSetting = new DashboardSetting(page);

    // Get the variable name
    const variableName = dashboardSetting.variableName();

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // Cancel the variable
    await dashboardSetting.cancelVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  // query values test cases

  test("should add query_values to dashboard and save it", async ({ page }) => {
    // const dashboardName = generateDashboardName();
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboard page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Add a query values variable
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Save the variable
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should add max records size, check toggle of multi select, and save it", async ({
    page,
  }) => {
    // Initialize page objects
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",

      // Add a variable with specified properties
      "kubernetes_namespace_name"
    );
    // Set max records size and enable multi-select
    await dashboardSetting.addMaxRecord("2");
    await dashboardSetting.enableMultiSelect();
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that by default select is working", async ({ page }) => {
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    const defaultValue = "ingress-nginx";

    // Navigate to the dashboard page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Add a query values variable
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    // Set the default value
    await dashboardSetting.addMaxRecord("2");
    await dashboardSetting.addCustomValue(defaultValue);
    // Save the variable
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on query_values variable dashboard is working", async ({
    page,
  }) => {
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboard page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Wait for the add panel button to be visible
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Add a query values variable
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );

    // Set max records size to 2
    await dashboardSetting.addMaxRecord("2");

    // Hide the variable
    await dashboardSetting.hideVariable();

    // Save the variable
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify constant variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Wait for the add panel button to be visible
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Select constant type
    await dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );

    // Save the variable
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("should verify that hide on constant variable dashboard is working", async ({
    page,
  }) => {
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the setting and save variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );
    await dashboardSetting.hideVariable();
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("should verify textbox variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open dashboard settings and variables section
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Select and add a textbox variable
    await dashboardSetting.selectTextType("TextBox", variableName);

    // Save the added variable
    await dashboardSetting.saveVariable();

    // Ensure the add variable button is visible
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });

    // Close the settings window
    await dashboardSetting.closeSettingWindow();

    //delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on textbox variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page objects
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open the settings and variables section and save variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectTextType("TextBox", variableName);
    await dashboardSetting.hideVariable();
    await dashboardSetting.saveVariable();

    // Ensure the add variable button is visible
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });

    // Close the settings window
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify custom variables by adding and its visible on dashboard", async ({
    page,
  }) => {
    // Initialize page objects
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open the settings and variables section and save variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );

    // Save the added variable
    await dashboardSetting.saveVariable();

    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();

    // Ensure the panel is visible
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that multi select is working properly", async ({
    page,
  }) => {
    // Initialize page objects
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Open settings and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Select custom type and enable multi-select
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await dashboardSetting.enableMultiSelect();

    // Save the variable
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should verify that hide on custom variable dashboard is working", async ({
    page,
  }) => {
    // Initialize page objects
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    // Navigate to the dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    // Open settings and variables
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();

    // Select custom type and enable multi-select
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await dashboardSetting.hideVariable();

    // Save the variable
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
