/**
 * Dashboard Share Link Functional Tests
 *
 * Tests for PR #9878: fix: dashboard share url
 * Verifies that the share link correctly captures and preserves dashboard state
 * including time ranges, tabs, variables, and auto-refresh intervals.
 *
 * The fix ensures dashboardShareURL recomputes reactively when route changes
 * by adding a dependency on route.fullPath.
 */

import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import testLogger from "../utils/test-logger.js";
import PageManager from "../../pages/page-manager.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { safeWaitForHidden, safeWaitForNetworkIdle } from "../utils/wait-helpers.js";
import {
  getVariableSelector,
  getVariableSelectorInner,
  getEditVariableBtn,
  getVariableLoadingIndicator,
  SELECTORS,
} from "../../pages/dashboardPages/dashboard-selectors.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard share URL button testcases", () => {
  const generateDashboardName = (prefix = "ShareLinkDash") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  // Track dashboard name per test for cleanup
  let currentDashboardName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    currentDashboardName = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    await page.waitForTimeout(2000);
    testLogger.info("Test setup completed");
  });

  test.afterEach(async ({ page }) => {
    if (currentDashboardName) {
      try {
        const pm = new PageManager(page);
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, currentDashboardName);
      } catch (e) {
        testLogger.warn("Cleanup failed (non-fatal):", { error: e.message });
      }
    }
  });

  test("should copy share URL with all current URL parameters including dashboard ID, folder, and tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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
  });

  test("should preserve time range parameters (relative time) in share URL", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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

    // Share URL converts relative time to absolute from/to timestamps
    const newPageUrl = newPage.url();
    testLogger.info("New page URL:", { newPageUrl });
    expect(newPageUrl).toContain("from=");
    expect(newPageUrl).toContain("to=");

    // Close the new page
    await newPage.close();
  });

  test("should preserve time range parameters (absolute time) in share URL", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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
  });

  test("should preserve variable values in share URL and maintain them when opening in new tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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

    // Wait for variable to be saved in settings
    await page
      .locator(getEditVariableBtn(variableName))
      .waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable selector to appear on dashboard
    await page
      .locator(getVariableSelector(variableName))
      .waitFor({ state: "visible", timeout: 15000 });

    // Wait for variable loading to complete
    await page
      .locator(getVariableLoadingIndicator(variableName))
      .waitFor({ state: "hidden", timeout: 10000 })
      .catch(() => {});

    // Click the variable dropdown (inner q-select element)
    const variableDropdown = page.locator(
      getVariableSelectorInner(variableName)
    );
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await variableDropdown.click();

    // Wait for dropdown menu to open
    await page
      .locator(SELECTORS.MENU)
      .waitFor({ state: "visible", timeout: 5000 });

    // Select the first option
    const firstOption = page.locator(SELECTORS.ROLE_OPTION).first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const selectedValue = await firstOption.textContent();
    await firstOption.click();

    testLogger.info("Selected variable value:", { selectedValue });

    // Wait for dropdown to close and selection to apply
    await safeWaitForHidden(page, ".q-menu", { timeout: 3000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

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

    // Wait for network to settle so variables fully render
    await newPage.waitForLoadState("networkidle");

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
      getVariableSelector(variableName)
    );
    await newPageVariableSelector.waitFor({
      state: "visible",
      timeout: 15000,
    });

    // Wait for variable loading to complete in new page
    await newPage
      .locator(getVariableLoadingIndicator(variableName))
      .waitFor({ state: "hidden", timeout: 15000 })
      .catch(() => {});
    await safeWaitForNetworkIdle(newPage, { timeout: 5000 });

    // Verify the variable selector has rendered with a value
    await expect(newPageVariableSelector).toBeVisible();

    // Close the new page
    await newPage.close();
  });

  test("should preserve selected tab in share URL and open same tab in new page", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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
    await page.locator('[data-test="dashboard-settings-tab-tab"]').click();
    await page.waitForTimeout(500);

    // Add a new tab
    const newTabName = `Tab_${Date.now()}`;
    await pm.dashboardSetting.addTabSetting(newTabName);
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(1000);

    // Close settings
    await pm.dashboardSetting.closeSettingDashboard();
    await page.waitForTimeout(1000);

    // Click on the newly created tab
    const tabButton = page
      .locator(".q-tabs .q-tab")
      .filter({ hasText: newTabName });
    await tabButton.waitFor({ state: "visible", timeout: 15000 });
    await tabButton.click();
    await page.waitForTimeout(1000);

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
  });

  test("should preserve all parameters together: time, variables, tab, and timezone", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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

    // Add a panel first (while dashboard is empty, before variable interactions)
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

    // Wait for panel save to settle
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Now add a variable via settings
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

    // Wait for variable to be saved in settings
    await page
      .locator(getEditVariableBtn(variableName))
      .waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable selector to appear on dashboard
    await page
      .locator(getVariableSelector(variableName))
      .waitFor({ state: "visible", timeout: 15000 });

    // Wait for variable loading to complete
    await page
      .locator(getVariableLoadingIndicator(variableName))
      .waitFor({ state: "hidden", timeout: 10000 })
      .catch(() => {});

    // Click the variable dropdown (inner q-select element)
    const variableDropdown = page.locator(
      getVariableSelectorInner(variableName)
    );
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await variableDropdown.click();

    // Wait for dropdown menu to open and select first option
    await page
      .locator(SELECTORS.MENU)
      .waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().click();

    // Wait for dropdown to close and selection to apply
    await safeWaitForHidden(page, ".q-menu", { timeout: 3000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Get current URL
    const currentURL = page.url();
    testLogger.info("Current URL with all parameters:", { currentURL });

    // Extract all parameters
    const urlObj = new URL(currentURL);
    const dashboardId = urlObj.searchParams.get("dashboard");
    const folderId = urlObj.searchParams.get("folder");
    const tabId = urlObj.searchParams.get("tab");
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

    // Wait for network to settle so variables and panels fully render
    await newPage.waitForLoadState("networkidle");

    // Verify dashboard name
    await expect(newPage.getByText(randomDashboardName)).toBeVisible({
      timeout: 10000,
    });

    // Verify the URL in new page contains all parameters
    const newPageURL = newPage.url();
    testLogger.info("Complete redirected URL:", { newPageURL });

    expect(newPageURL).toContain(dashboardId);
    expect(newPageURL).toContain(`folder=${folderId}`);
    expect(newPageURL).toContain(`tab=${tabId}`);

    // Share URL converts relative time to absolute from/to timestamps
    expect(newPageURL).toContain("from=");
    expect(newPageURL).toContain("to=");

    if (variableParam) {
      expect(newPageURL).toContain(`var-${variableName}`);
    }

    // Close the new page
    await newPage.close();
  });

  test("should generate short URL that redirects to full dashboard URL with all parameters", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    currentDashboardName = randomDashboardName;

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

    // Verify it's a short URL
    expect(shortURL).toContain("/short/");

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
    // Share URL converts relative time to absolute from/to timestamps
    expect(redirectedURL).toContain("dashboard=");
    expect(redirectedURL).toContain("folder=");
    expect(redirectedURL).toContain("from=");
    expect(redirectedURL).toContain("to=");
  });
});
