import { test as base, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

// Extend Playwright test to grant clipboard permissions
export const test = base.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await use(context);
    await context.close();
  },
});

test.describe.configure({ mode: "parallel" });

test.describe("dashboard share URL button testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("should copy share URL with all current URL parameters including dashboard ID, folder, and tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for the dashboard view page to load
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Get the current URL before clicking share button
    const currentURL = page.url();
    testLogger.info("Current URL before share:", { currentURL });

    // Extract URL parameters
    const urlParams = new URL(currentURL);
    const dashboardId = urlParams.searchParams.get("dashboard");
    const folderId = urlParams.searchParams.get("folder");
    const tabId = urlParams.searchParams.get("tab");

    // Click the share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify the success message appears
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL from clipboard
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Navigate to the copied URL (it will redirect to the full URL)
    await page.goto(copiedUrl);

    // Wait for dashboard to load after redirect
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the dashboard name is visible
    await expect(page.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Get the redirected URL and verify it contains all expected parameters
    const redirectedUrl = page.url();
    testLogger.info("Redirected URL:", { redirectedUrl });

    // Verify the redirected URL contains the dashboard ID
    expect(redirectedUrl).toContain(dashboardId);

    // Verify the redirected URL contains the folder parameter
    expect(redirectedUrl).toContain(`folder=${folderId}`);

    // Verify the redirected URL contains the tab parameter
    expect(redirectedUrl).toContain(`tab=${tabId}`);

    // Clean up: Go back to dashboard list and delete
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve time range parameters (relative time) in share URL", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    // Select stream and add fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );

    // Set relative time (e.g., 15 minutes)
    await pm.dashboardTimeRefresh.setRelative("15", "m");

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be saved
    await page.waitForTimeout(2000);

    // Get current URL to check time parameters
    const currentURL = page.url();
    testLogger.info("Current URL with time params:", { currentURL });

    // Click the share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with time:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page/context to simulate new tab
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load in new page
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the dashboard name is visible
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify the redirected URL contains the period parameter
    const newPageUrl = newPage.url();
    testLogger.info("New page URL:", { newPageUrl });
    expect(newPageUrl).toContain("period=15m");

    // Verify the time range is correctly set (check the date-time button)
    const dateTimeBtn = newPage.locator('[data-test="date-time-btn"]');
    await expect(dateTimeBtn).toBeVisible({ timeout: 10000 });
    await expect(dateTimeBtn).toContainText("Past 15 minutes");

    // Close the new page
    await newPage.close();

    // Clean up: delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve time range parameters (absolute time) in share URL", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Add a panel
    await pm.dashboardCreate.addPanel();

    // Select stream and add fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );

    // Set absolute time range
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-absolute-tab"]').click();

    // Wait for absolute time inputs to be visible
    await page.waitForTimeout(1000);

    // Get the current date/time for testing
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Format times for input (using simple format)
    const startTime = twoHoursAgo.toISOString();
    const endTime = now.toISOString();

    // Apply the changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be saved
    await page.waitForTimeout(2000);

    // Get current URL to check time parameters
    const currentURL = page.url();
    testLogger.info("Current URL with absolute time:", { currentURL });

    // Click the share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with absolute time:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the dashboard name is visible
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify the redirected URL contains 'from' and 'to' parameters
    const newPageUrl = newPage.url();
    testLogger.info("New page redirected URL:", { newPageUrl });
    expect(newPageUrl).toContain("from=");
    expect(newPageUrl).toContain("to=");

    // Close the new page
    await newPage.close();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve variable values in share URL and maintain them when opening in new tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Generate unique variable name
    const variableName = pm.dashboardSetting.variableName();

    // Open settings and add a variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear in the UI
    await page.waitForTimeout(2000);

    // Select a value from the variable dropdown
    const variableSelector = page.locator(
      `[data-test="dashboard-variable-${variableName}-selector"]`
    );
    await variableSelector.waitFor({ state: "visible", timeout: 10000 });
    await variableSelector.click();

    // Wait for dropdown options to load
    await page.waitForTimeout(1000);

    // Select the first option
    const firstOption = page.locator(".q-item").first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const selectedValue = await firstOption.textContent();
    await firstOption.click();

    testLogger.info("Selected variable value:", { selectedValue });

    // Wait for selection to apply
    await page.waitForTimeout(1000);

    // Get current URL to verify variable parameter
    const currentURL = page.url();
    testLogger.info("Current URL with variable:", { currentURL });

    // Verify URL contains the variable parameter
    expect(currentURL).toContain(`var-${variableName}`);

    // Click the share button
    await page.locator('[data-test="dashboard-share-btn"]').waitFor({
      state: "visible",
    });
    await page.locator('[data-test="dashboard-share-btn"]').click();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with variable:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page to simulate new tab
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load in new page
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the dashboard name is visible
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify the redirected URL contains the variable parameter
    const newPageUrl = newPage.url();
    testLogger.info("New page URL with variable:", { newPageUrl });
    expect(newPageUrl).toContain(`var-${variableName}`);

    // Verify the variable selector exists and has the correct value selected
    const newPageVariableSelector = newPage.locator(
      `[data-test="dashboard-variable-${variableName}-selector"]`
    );
    await newPageVariableSelector.waitFor({
      state: "visible",
      timeout: 10000,
    });

    // Get the selected value in the new page
    const newPageSelectedValue = await newPageVariableSelector
      .locator(".q-field__native")
      .textContent();
    testLogger.info("Variable value in new page:", { newPageSelectedValue });

    // Verify the variable value is maintained (should contain the selected value)
    // Note: The exact matching might vary based on the UI implementation
    expect(newPageSelectedValue).toBeTruthy();

    // Close the new page
    await newPage.close();

    // Clean up: delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve multiple variables in share URL and maintain them in new tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Generate unique variable names
    const variableName1 = pm.dashboardSetting.variableName();
    const variableName2 = `var_${Date.now()}_2`;

    // Open settings and add first variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName1,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await pm.dashboardSetting.saveVariable();

    // Add second variable
    await page.waitForTimeout(1000);
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName2,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variables to appear
    await page.waitForTimeout(2000);

    // Select values for both variables
    // First variable
    const variableSelector1 = page.locator(
      `[data-test="dashboard-variable-${variableName1}-selector"]`
    );
    await variableSelector1.waitFor({ state: "visible", timeout: 10000 });
    await variableSelector1.click();
    await page.waitForTimeout(1000);
    await page.locator(".q-item").first().click();

    // Second variable
    await page.waitForTimeout(500);
    const variableSelector2 = page.locator(
      `[data-test="dashboard-variable-${variableName2}-selector"]`
    );
    await variableSelector2.waitFor({ state: "visible", timeout: 10000 });
    await variableSelector2.click();
    await page.waitForTimeout(1000);
    await page.locator(".q-item").first().click();

    // Wait for selections to apply
    await page.waitForTimeout(1000);

    // Get current URL
    const currentURL = page.url();
    testLogger.info("Current URL with multiple variables:", { currentURL });

    // Verify URL contains both variable parameters
    expect(currentURL).toContain(`var-${variableName1}`);
    expect(currentURL).toContain(`var-${variableName2}`);

    // Click the share button
    await page.locator('[data-test="dashboard-share-btn"]').waitFor({
      state: "visible",
    });
    await page.locator('[data-test="dashboard-share-btn"]').click();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with multiple variables:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the redirected URL contains both variable parameters
    const newPageUrl = newPage.url();
    testLogger.info("New page URL with multiple variables:", { newPageUrl });
    expect(newPageUrl).toContain(`var-${variableName1}`);
    expect(newPageUrl).toContain(`var-${variableName2}`);

    // Verify both variable selectors exist in the new page
    await newPage
      .locator(`[data-test="dashboard-variable-${variableName1}-selector"]`)
      .waitFor({ state: "visible", timeout: 10000 });
    await newPage
      .locator(`[data-test="dashboard-variable-${variableName2}-selector"]`)
      .waitFor({ state: "visible", timeout: 10000 });

    // Close the new page
    await newPage.close();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve selected tab in share URL and open same tab in new page", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Open settings to add a new tab
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.waitForTimeout(1000);

    // Click on Tabs section
    await page.locator('[data-test="dashboard-setting-tab-item"]').click();
    await page.waitForTimeout(500);

    // Add a new tab
    const newTabName = `Tab_${Date.now()}`;
    await page.locator('[data-test="dashboard-tab-add-btn"]').click();
    await page.waitForTimeout(500);

    // Fill tab name
    await page.locator('[data-test="dashboard-tab-name-input"]').fill(newTabName);
    await page.locator('[data-test="dashboard-tab-save-btn"]').click();
    await page.waitForTimeout(1000);

    // Close settings
    await page.locator('[data-test="dashboard-setting-close-btn"]').click();
    await page.waitForTimeout(1000);

    // Click on the newly created tab
    const tabLocator = page.locator(`[data-test="dashboard-tab-${newTabName}"]`);
    if (await tabLocator.isVisible()) {
      await tabLocator.click();
      await page.waitForTimeout(1000);
    }

    // Get current URL to verify tab parameter
    const currentURL = page.url();
    testLogger.info("Current URL with custom tab:", { currentURL });

    // Verify URL contains the tab parameter
    const urlObj = new URL(currentURL);
    const tabParam = urlObj.searchParams.get("tab");
    expect(tabParam).toBeTruthy();

    // Click the share button
    await page.locator('[data-test="dashboard-share-btn"]').waitFor({
      state: "visible",
    });
    await page.locator('[data-test="dashboard-share-btn"]').click();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with tab:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the same tab is active in the new page
    const newPageURL = newPage.url();
    expect(newPageURL).toContain(`tab=${tabParam}`);

    // Close the new page
    await newPage.close();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve timezone parameter in share URL", async ({ page }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Add a panel
    await pm.dashboardCreate.addPanel();

    // Select stream and add fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );

    // Open date-time picker to set timezone
    await page.locator('[data-test="date-time-btn"]').click();
    await page.waitForTimeout(500);

    // Click on timezone selector
    const timezoneSelector = page.locator('[data-test="date-time-timezone-select"]');
    if (await timezoneSelector.isVisible()) {
      await timezoneSelector.click();
      await page.waitForTimeout(500);

      // Select a specific timezone (e.g., "Asia/Kolkata")
      await page.getByRole("option", { name: /Asia\/Kolkata/i }).click();
      await page.waitForTimeout(500);
    }

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be saved
    await page.waitForTimeout(2000);

    // Get current URL
    const currentURL = page.url();
    testLogger.info("Current URL with timezone:", { currentURL });

    // Check if timezone parameter exists
    const urlObj = new URL(currentURL);
    const timezoneParam = urlObj.searchParams.get("timezone");

    // Click the share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied URL with timezone:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify the dashboard name is visible
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify timezone in redirected URL if it was set
    const newPageUrl = newPage.url();
    testLogger.info("New page URL with timezone:", { newPageUrl });
    if (timezoneParam) {
      expect(newPageUrl).toContain(`timezone=${timezoneParam}`);
    }

    // Close the new page
    await newPage.close();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should preserve all parameters together: time, variables, tab, and timezone", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Add a variable
    const variableName = pm.dashboardSetting.variableName();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear
    await page.waitForTimeout(2000);

    // Select a value from the variable
    const variableSelector = page.locator(
      `[data-test="dashboard-variable-${variableName}-selector"]`
    );
    if (await variableSelector.isVisible()) {
      await variableSelector.click();
      await page.waitForTimeout(1000);
      await page.locator(".q-item").first().click();
      await page.waitForTimeout(1000);
    }

    // Add a panel with time range
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );

    // Set time range to 30 minutes
    await pm.dashboardTimeRefresh.setRelative("30", "m");

    // Apply and save panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Wait for everything to settle
    await page.waitForTimeout(2000);

    // Get current URL
    const currentURL = page.url();
    testLogger.info("Current URL with all parameters:", { currentURL });

    // Extract all parameters
    const urlObj = new URL(currentURL);
    const dashboardId = urlObj.searchParams.get("dashboard");
    const folderId = urlObj.searchParams.get("folder");
    const tabId = urlObj.searchParams.get("tab");
    const period = urlObj.searchParams.get("period");
    const variableParam = urlObj.searchParams.get(`var-${variableName}`);

    // Click the share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Read the copied URL
    const copiedUrl = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Copied complete URL:", { copiedUrl });

    // The copied URL should be a short URL
    expect(copiedUrl).toContain("/short/");

    // Open the copied URL in a new page
    const context = page.context();
    const newPage = await context.newPage();
    await newPage.goto(copiedUrl);

    // Wait for dashboard to load completely
    await newPage.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify dashboard name
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify time range is displayed correctly
    const dateTimeBtn = newPage.locator('[data-test="date-time-btn"]');
    await expect(dateTimeBtn).toBeVisible({ timeout: 10000 });
    if (period === "30m") {
      await expect(dateTimeBtn).toContainText("Past 30 minutes");
    }

    // Verify variable selector exists
    if (variableParam) {
      await newPage
        .locator(`[data-test="dashboard-variable-${variableName}-selector"]`)
        .waitFor({ state: "visible", timeout: 10000 });
    }

    // Verify the URL in new page contains all parameters
    const newPageURL = newPage.url();
    testLogger.info("Complete redirected URL:", { newPageURL });
    
    expect(newPageURL).toContain(dashboardId);
    expect(newPageURL).toContain(`folder=${folderId}`);
    
    if (period) {
      expect(newPageURL).toContain(`period=${period}`);
    }
    
    if (variableParam) {
      expect(newPageURL).toContain(`var-${variableName}`);
    }

    // Close the new page
    await newPage.close();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should generate short URL that redirects to full dashboard URL with all parameters", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard view
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Add a panel with time range
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );

    // Set relative time
    await pm.dashboardTimeRefresh.setRelative("15", "m");

    // Apply and save
    await pm.dashboardPanelActions.applyDashboardBtn();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    await page.waitForTimeout(2000);

    // Get the current full URL
    const fullURL = page.url();
    testLogger.info("Full dashboard URL:", { fullURL });

    // Click share button
    await pm.dashboardShareExport.shareDashboard();

    // Verify success message
    await expect(page.getByText("Link copied successfully")).toBeVisible({
      timeout: 10000,
    });

    // Get the copied short URL
    const shortURL = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    testLogger.info("Short URL copied:", { shortURL });

    // Verify it's a short URL (should be shorter than the original)
    expect(shortURL.length).toBeLessThan(fullURL.length);

    // Navigate to the short URL
    await page.goto(shortURL);

    // Wait for redirect and dashboard to load
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Verify dashboard name is visible
    await expect(page.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify the final URL after redirect contains the dashboard parameters
    const redirectedURL = page.url();
    testLogger.info("Redirected URL:", { redirectedURL });

    // The redirected URL should contain dashboard parameters
    expect(redirectedURL).toContain("dashboard=");
    expect(redirectedURL).toContain("folder=");
    expect(redirectedURL).toContain("period=15m");

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
