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

// Cleanup path for the tests that end up on the alert form: the left menu
// returns to /dashboards with no folder in the URL, and the list then lands on
// Favorites for any account that has some. Select the folder the dashboard was
// created in so the row is on screen no matter what the account has starred.
const returnToDashboardFolder = async (page, pm, folderName = "default") => {
  // Visiting the Alerts page can reset the app's active-org state, so a plain
  // sidebar click here can land on the wrong org's dashboards (which then
  // redirects to billing) — force the org explicitly rather than trusting
  // menuItem()'s sidebar-click navigation.
  await page.goto(
    `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=${folderName}`
  );
  await page.waitForLoadState("domcontentloaded");
  await waitForDashboardPage(page);

  // waitForDashboardPage settles on the folders API response, which lands well
  // before the folder sidebar paints — give the tab its own window rather than
  // inheriting openFolderByName's 10s, which the list coming off the alert form
  // routinely overruns.
  await pm.dashboardFolder
    .getFolderCardByName(folderName)
    .waitFor({ state: "visible", timeout: 30000 });
  await pm.dashboardFolder.openFolderByName(folderName);
};

test.describe("Dashboard Create Alert testcases", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    // navigateToBase() alone can land on the wrong org's page on cloud (the
    // stored session's "last active org" wins over the org_identifier query
    // param on a bare root load) — force the correct org context with an
    // explicit navigation to a real feature page.
    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await page.waitForLoadState("domcontentloaded");
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
      await pm.dashboardPanelEdit
        .getPanelContainer()
        .first()
        .hover();

      // Click the panel dropdown menu and select "Create Alert"
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      // Verify navigation to the alert form, flagged as a panel prefill
      await page.waitForURL(/.*alerts\/add.*prefill=panel.*/, {
        timeout: 15000,
      });

      // The prefill marker is in the URL; the payload deliberately is not.
      const currentUrl = page.url();
      expect(currentUrl).toContain("prefill=panel");
      // The panel payload rides sessionStorage now, not the URL — a query string
      // long enough to be truncated by a browser or proxy was the reason.
      expect(currentUrl).not.toContain("panelData=");

      testLogger.info("Navigated to alert creation page with panel data", {
        url: currentUrl,
      });

      // Navigate back to dashboards to clean up
      await returnToDashboardFolder(page, pm);
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

      // Save the panel and wait for dashboard to reload chart data.
      // _search_stream is SSE/chunked (progress events, then a final
      // [[DONE]] message) — page.waitForResponse(status===200) resolves on
      // the first response event (headers), which fires as soon as the
      // stream opens, not when it actually finishes. waitForStreamComplete
      // reads the body and waits for the real [[DONE]] marker instead.
      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions.getChartRendererCanvasElement().first().waitFor({ state: "visible", timeout: 15000 });

      // Right-click on the chart renderer to trigger alert context menu
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify the alert context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();
      testLogger.info("Alert context menu is visible after right-click");

      // Verify menu items contain threshold text
      const aboveOption = pm.dashboardPanelEdit.getAlertContextMenuAbove();
      await expect(aboveOption).toBeVisible({ timeout: 5000 });
      await expect(aboveOption).toContainText("Create Alert with threshold above");

      const belowOption = pm.dashboardPanelEdit.getAlertContextMenuBelow();
      await expect(belowOption).toBeVisible({ timeout: 5000 });
      await expect(belowOption).toContainText("Create Alert with threshold below");

      // Click "above threshold" option and wait for navigation simultaneously
      await Promise.all([
        page.waitForURL(/.*alerts\/add.*prefill=panel.*/, {
          timeout: 15000,
        }),
        pm.dashboardPanelEdit.selectAlertAboveThreshold(),
      ]);

      const currentUrl = page.url();
      expect(currentUrl).toContain("prefill=panel");
      // The panel payload rides sessionStorage now, not the URL — a query string
      // long enough to be truncated by a browser or proxy was the reason.
      expect(currentUrl).not.toContain("panelData=");

      testLogger.info(
        "Navigated to alert creation page from context menu (above threshold)"
      );

      // Navigate back and clean up
      await returnToDashboardFolder(page, pm);
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

      // Save the panel and wait for dashboard to reload chart data.
      // _search_stream is SSE/chunked (progress events, then a final
      // [[DONE]] message) — page.waitForResponse(status===200) resolves on
      // the first response event (headers), which fires as soon as the
      // stream opens, not when it actually finishes. waitForStreamComplete
      // reads the body and waits for the real [[DONE]] marker instead.
      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions.getChartRendererCanvasElement().first().waitFor({ state: "visible", timeout: 15000 });

      // Right-click on the chart renderer
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();

      // Click "below threshold" option and wait for navigation simultaneously
      await Promise.all([
        page.waitForURL(/.*alerts\/add.*prefill=panel.*/, {
          timeout: 15000,
        }),
        pm.dashboardPanelEdit.selectAlertBelowThreshold(),
      ]);

      const currentUrl = page.url();
      expect(currentUrl).toContain("prefill=panel");
      // The panel payload rides sessionStorage now, not the URL — a query string
      // long enough to be truncated by a browser or proxy was the reason.
      expect(currentUrl).not.toContain("panelData=");

      testLogger.info(
        "Navigated to alert creation page from context menu (below threshold)"
      );

      // Navigate back and clean up
      await returnToDashboardFolder(page, pm);
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

      // Save the panel and wait for dashboard to reload chart data.
      // _search_stream is SSE/chunked (progress events, then a final
      // [[DONE]] message) — page.waitForResponse(status===200) resolves on
      // the first response event (headers), which fires as soon as the
      // stream opens, not when it actually finishes. waitForStreamComplete
      // reads the body and waits for the real [[DONE]] marker instead.
      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions.getChartRendererCanvasElement().first().waitFor({ state: "visible", timeout: 15000 });

      // Right-click on the chart renderer
      await pm.dashboardPanelEdit.rightClickChartForAlert();

      // Verify context menu appears
      await pm.dashboardPanelEdit.expectAlertContextMenuVisible();
      testLogger.info("Context menu visible, clicking outside");

      // Click outside the context menu (on the page body)
      await pm.dashboardPanelEdit.clickOutsideContextMenu();

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
  // this is skipped for now as we are working on alert v3 

  test.skip(
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
      await pm.dashboardPanelEdit
        .getPanelContainer()
        .first()
        .hover();
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      // Verify navigation to pre-filled alert creation page
      await page.waitForURL(/.*alerts\/add.*prefill=panel.*/, {
        timeout: 15000,
      });

      // Get the pre-filled alert name
      const alertNameInput = pm.alertsPage.getAlertNameInput();
      await expect(alertNameInput).toBeVisible({ timeout: 30000 });
      const alertName = await alertNameInput.inputValue();
      expect(alertName).toContain("Alert_from_");
      testLogger.info("Alert form pre-filled from panel", { alertName });

      // Step 4: Complete the alert wizard (scheduled alert from panel data)
      const continueBtn = pm.alertsPage.getContinueButton();

      // Step 1 (Setup) - pre-filled → Continue
      await continueBtn.click();

      // Step 2 (SQL/Conditions) - pre-filled → Continue
      await continueBtn.click();

      // Step 3 (Compare with Past) → Skip, Continue
      await continueBtn.click();

      // Step 4 (Settings) → Set threshold and select destination
      const thresholdOperator = pm.alertsPage.getThresholdOperatorSelect();
      await thresholdOperator.waitFor({ state: "visible", timeout: 10000 });
      await thresholdOperator.click();
      await pm.alertsPage.getThresholdOperatorOption(">=").waitFor({ state: "visible", timeout: 5000 });
      await pm.alertsPage.getThresholdOperatorOption(">=").click();

      // The input may place data-test on the native <input> or on its root div,
      // so match both: 'input[data-test]' (on input) and '[data-test] input' (input inside parent)
      const thresholdInput = pm.alertsPage.getThresholdValueInput();
      await thresholdInput.waitFor({ state: "visible", timeout: 10000 });
      await thresholdInput.clear();
      await thresholdInput.fill("1");

      // Select destination
      const destinationDropdown = pm.alertsPage.getDestinationsSelect();
      await destinationDropdown.waitFor({ state: "visible", timeout: 5000 });
      await destinationDropdown.click();

      const destOption = pm.alertsPage.getDestinationOption(destinationName);
      await expect(destOption).toBeVisible({ timeout: 5000 });
      await destOption.click();
      await page.keyboard.press("Escape");

      // Step 5 (Dedup) → Skip, Continue
      await continueBtn.click();

      // Step 6 (Advanced) → Skip, Continue
      await continueBtn.click();

      // Submit the alert
      await pm.alertsPage.getAddAlertSubmitButton().click();

      // Verify alert saved successfully
      await expect(
        pm.alertsPage.getToastMessageByText('Alert saved successfully.')
      ).toBeVisible({ timeout: 30000 });
      testLogger.info("Alert created successfully from dashboard panel", {
        alertName,
      });

      // Verify alert appears in the alerts list
      const alertSearchInput = pm.alertsPage.getAlertListSearchInput();
      await alertSearchInput.waitFor({ state: "visible", timeout: 15000 });
      await alertSearchInput.fill(alertName.toLowerCase());
      await pm.alertsPage.getAlertTableRows().first().waitFor({ state: "visible", timeout: 10000 });

      // Verify alert row is visible
      const firstRow = pm.alertsPage.getAlertTableRows().first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
      const firstRowText = await firstRow.textContent();
      expect(firstRowText).toContain("Alert_from_");
      testLogger.info("Alert found in alerts list", { alertName });

      // Cleanup: Delete the alert via kebab menu on the first row
      const kebabButton = firstRow.locator('[data-test*="-more-options"]').first();
      await kebabButton.waitFor({ state: "visible", timeout: 5000 });
      await kebabButton.click();
      await pm.alertsPage.getDeleteMenuOption().waitFor({ state: "visible", timeout: 5000 });
      await pm.alertsPage.getDeleteMenuOption().click();
      await pm.alertsPage.getDialogPrimaryButton().click();
      await expect(pm.alertsPage.getAlertDeletedText()).toBeVisible({ timeout: 10000 });
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
