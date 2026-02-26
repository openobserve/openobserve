// Dashboard Create Alert - E2E Tests
// PR #9682: fix: allow to create alert from anywhere from dashboard chart
// Tests for creating alerts from dashboard panel menu and chart context menu

import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
import testLogger from "../utils/test-logger.js";

const randomDashboardName =
  "Dashboard_Alert_" + Math.random().toString(36).slice(2, 11);

test.describe("Dashboard Create Alert testcases", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ===== P0: SMOKE TESTS =====

  test(
    "should navigate to alert creation page via panel dropdown menu Create Alert option",
    { tag: ["@dashboardCreateAlert", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Create Alert from panel dropdown menu");

      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-menu");

      // Navigate to dashboards and create a new dashboard with a bar chart panel
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(randomDashboardName);

      // Add a bar chart panel with data
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply query and wait for chart to render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Save the panel to get back to dashboard view
      await pm.dashboardPanelActions.savePanel();

      // Hover over the panel to reveal the dropdown menu
      await page
        .locator('[data-test="dashboard-panel-container"]')
        .first()
        .hover();

      // Click the panel dropdown menu and select "Create Alert"
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      // Verify navigation to alert creation page with fromPanel=true and panelData
      await page.waitForURL(/.*alerts\/add.*fromPanel=true.*/, {
        timeout: 15000,
      });

      // Verify URL contains panelData (proves panel data was passed)
      const currentUrl = page.url();
      expect(currentUrl).toContain("fromPanel=true");
      expect(currentUrl).toContain("panelData=");

      testLogger.info("Navigated to alert creation page with panel data", {
        url: currentUrl,
      });

      // Navigate back to dashboards to clean up
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await deleteDashboard(page, randomDashboardName);

      testLogger.info("Test completed: Create Alert from panel menu");
    }
  );

  test(
    "should show alert context menu on right-clicking a bar chart and navigate to alert creation via above threshold",
    { tag: ["@dashboardCreateAlert", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info(
        "Testing alert context menu on chart right-click (above threshold)"
      );

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_Alert_Ctx_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-ctx");

      // Navigate to dashboards and create a new dashboard with a bar chart panel
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      // Add a bar chart panel with data
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply query and wait for chart to render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Save the panel and wait for dashboard to reload chart data
      const dashboardStreamPromise = page.waitForResponse(
        (resp) => resp.url().includes("_search_stream") && resp.status() === 200,
        { timeout: 30000 }
      ).catch(() => {});
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await page.locator('[data-test="chart-renderer"] canvas').first().waitFor({ state: "visible", timeout: 15000 });

      // Right-click on the chart renderer to trigger alert context menu
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify the alert context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();
      testLogger.info("Alert context menu is visible after right-click");

      // Verify menu items contain threshold text
      const aboveOption = page.locator(
        '[data-test="alert-context-menu-above"]'
      );
      await expect(aboveOption).toBeVisible({ timeout: 5000 });
      await expect(aboveOption).toContainText("Create Alert with threshold above");

      const belowOption = page.locator(
        '[data-test="alert-context-menu-below"]'
      );
      await expect(belowOption).toBeVisible({ timeout: 5000 });
      await expect(belowOption).toContainText("Create Alert with threshold below");

      // Click "above threshold" option
      await pm.dashboardPanelEdit.selectAlertAboveThreshold();

      // Verify navigation to alert creation page with panel data
      await page.waitForURL(/.*alerts\/add.*fromPanel=true.*/, {
        timeout: 15000,
      });

      const currentUrl = page.url();
      expect(currentUrl).toContain("fromPanel=true");
      expect(currentUrl).toContain("panelData=");

      testLogger.info(
        "Navigated to alert creation page from context menu (above threshold)"
      );

      // Navigate back and clean up
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);

      testLogger.info(
        "Test completed: Alert context menu above threshold"
      );
    }
  );

  // ===== P1: FUNCTIONAL TESTS =====

  test(
    "should navigate to alert creation via below threshold from chart context menu",
    { tag: ["@dashboardCreateAlert", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info(
        "Testing alert context menu on chart right-click (below threshold)"
      );

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_Alert_Below_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-below");

      // Navigate to dashboards and create a new dashboard with a line chart panel
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      // Add a line chart panel with data
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply query and wait for chart to render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Save the panel to get back to dashboard view
      await pm.dashboardPanelActions.savePanel();

      // Wait for dashboard view to stabilize
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.locator('[data-test="chart-renderer"]').first().waitFor({ state: "visible", timeout: 10000 });

      // Right-click on the chart renderer
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();

      // Click "below threshold" option
      await pm.dashboardPanelEdit.selectAlertBelowThreshold();

      // Verify navigation to alert creation page
      await page.waitForURL(/.*alerts\/add.*fromPanel=true.*/, {
        timeout: 15000,
      });

      const currentUrl = page.url();
      expect(currentUrl).toContain("fromPanel=true");
      expect(currentUrl).toContain("panelData=");

      testLogger.info(
        "Navigated to alert creation page from context menu (below threshold)"
      );

      // Navigate back and clean up
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: Alert context menu below threshold");
    }
  );
  
  test(
    "should close alert context menu when clicking outside",
    { tag: ["@dashboardCreateAlert", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing alert context menu closes on click outside");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_Alert_Outside_" +
        Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-outside");

      // Navigate to dashboards and create a new dashboard with a bar chart panel
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      // Add a bar chart panel with data
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply query and wait for chart to render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Save the panel and wait for dashboard to reload chart data
      const dashboardStreamPromise = page.waitForResponse(
        (resp) => resp.url().includes("_search_stream") && resp.status() === 200,
        { timeout: 30000 }
      ).catch(() => {});
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await page.locator('[data-test="chart-renderer"] canvas').first().waitFor({ state: "visible", timeout: 15000 });

      // Right-click on the chart renderer
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();
      testLogger.info("Context menu visible, clicking outside");

      // Click outside the context menu (on the page body)
      await page.locator("body").click({ position: { x: 10, y: 10 } });

      // Verify context menu is hidden
      await pm.dashboardPanelEdit.expectAlertContextMenuHidden();
      testLogger.info("Context menu closed after clicking outside");

      // Clean up
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: Context menu closes on click outside");
    }
  );

  // ===== P0: END-TO-END ALERT CREATION =====

  test(
    "should create a real alert end-to-end from dashboard panel Create Alert option",
    { tag: ["@dashboardCreateAlert", "@smoke", "@P0"] },
    async ({ page }) => {
      test.slow(); // E2E test covering dashboard + alert wizard flow

      testLogger.info(
        "Testing full E2E alert creation from dashboard panel menu"
      );

      const pm = new PageManager(page);
      const randomSuffix = Math.random().toString(36).slice(2, 8);
      const dashName = "Dashboard_Alert_E2E_" + randomSuffix;
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-e2e");

      // Step 1: Set up alert infrastructure (template + destination)
      const templateName = "auto_dash_alert_template_" + randomSuffix;
      const destinationName = "auto_dash_alert_dest_" + randomSuffix;

      await pm.alertTemplatesPage.ensureTemplateExists(templateName);
      await pm.alertDestinationsPage.ensureDestinationExists(
        destinationName,
        "DEMO",
        templateName
      );
      testLogger.info("Alert infrastructure ready", {
        templateName,
        destinationName,
      });

      // Step 2: Create dashboard with bar chart panel
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashName);

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Dashboard panel created and saved", { panelName });

      // Step 3: Click "Create Alert" from panel dropdown menu
      await page
        .locator('[data-test="dashboard-panel-container"]')
        .first()
        .hover();
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      // Verify navigation to pre-filled alert creation page
      await page.waitForURL(/.*alerts\/add.*fromPanel=true.*/, {
        timeout: 15000,
      });

      // Get the pre-filled alert name
      const alertNameInput = page.locator(
        '[data-test="add-alert-name-input"]'
      );
      await expect(alertNameInput).toBeVisible({ timeout: 30000 });
      const alertName = await alertNameInput.inputValue();
      expect(alertName).toContain("Alert_from_");
      testLogger.info("Alert form pre-filled from panel", { alertName });

      // Step 4: Complete the alert wizard (scheduled alert from panel data)
      const continueBtn = page.getByRole("button", { name: "Continue" });

      // Step 1 (Setup) - pre-filled → Continue
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Step 2 (SQL/Conditions) - pre-filled → Continue
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Step 3 (Compare with Past) → Skip, Continue
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Step 4 (Settings) → Set threshold and select destination
      // data-test selectors added in AlertSettings.vue; fallback for pre-build compat
      const thresholdOperator = page
        .locator('[data-test="alert-threshold-operator-select"]')
        .or(page.locator(".step-alert-conditions .q-select").first());
      await thresholdOperator.first().waitFor({ state: "visible", timeout: 10000 });
      await thresholdOperator.first().click();
      await page.getByText(">=", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
      await page.getByText(">=", { exact: true }).click();

      const thresholdInput = page
        .locator('[data-test="alert-threshold-value-input"] input')
        .or(page.locator(".step-alert-conditions input[type='number']").first());
      await thresholdInput.first().waitFor({ state: "visible", timeout: 5000 });
      await thresholdInput.first().fill("1");

      // Select destination
      const destinationDropdown = page
        .locator('[data-test="alert-destinations-select"]')
        .or(page.locator(".destinations-select-field").first());
      await destinationDropdown.first().waitFor({ state: "visible", timeout: 5000 });
      await destinationDropdown.first().click();

      // Quasar q-select renders items as q-item in a popup menu
      const destOption = page.locator(".q-item").filter({ hasText: destinationName }).first();
      await expect(destOption).toBeVisible({ timeout: 5000 });
      await destOption.click();
      await page.keyboard.press("Escape");

      // Step 5 (Dedup) → Skip, Continue
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Step 6 (Advanced) → Skip, Continue
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Submit the alert
      await page.locator('[data-test="add-alert-submit-btn"]').click();

      // Verify alert saved successfully
      await expect(
        page.getByText("Alert saved successfully.")
      ).toBeVisible({ timeout: 30000 });
      testLogger.info("Alert created successfully from dashboard panel", {
        alertName,
      });

      // Verify alert appears in the alerts list
      const alertSearchInput = page.locator(
        '[data-test="alert-list-search-input"]'
      );
      await alertSearchInput.waitFor({ state: "visible", timeout: 15000 });
      await alertSearchInput.fill(alertName.toLowerCase());
      await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 10000 });

      // Verify alert row is visible
      const firstRow = page.locator("table tbody tr").first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
      const firstRowText = await firstRow.textContent();
      expect(firstRowText).toContain("Alert_from_");
      testLogger.info("Alert found in alerts list", { alertName });

      // Cleanup: Delete the alert via kebab menu on the first row
      const kebabButton = firstRow.locator('[data-test*="-more-options"]').first();
      await kebabButton.waitFor({ state: "visible", timeout: 5000 });
      await kebabButton.click();
      await page.getByText("Delete", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
      await page.getByText("Delete", { exact: true }).click();
      await page.locator('[data-test="confirm-button"]').click();
      await expect(page.getByText("Alert deleted")).toBeVisible({ timeout: 10000 });
      testLogger.info("Alert deleted", { alertName });

      // Cleanup: Delete the dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);

      testLogger.info(
        "Test completed: Full E2E alert creation from dashboard panel"
      );
    }
  );
});
