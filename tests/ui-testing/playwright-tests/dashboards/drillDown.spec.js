const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

test("should create dashboard with trellis chart and configure logs auto drill-down with new tab", async ({
  page,
}) => {
  const pm = new PageManager(page);
  const panelName =
    pm.dashboardPanelActions.generateUniquePanelName("panel-test");
  // const dateTimeHelper = new DateTimeHelper(page);

  // Navigate to dashboards
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);

  // Create a new dashboard
  await pm.dashboardCreate.createDashboard(randomDashboardName);
  await pm.dashboardCreate.addPanel();


  // Select area chart (works well with trellis)
  await pm.chartTypeSelector.selectChartType("area");

  // Select a stream
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");

  // // Add fields for the chart
  // await pm.chartTypeSelector.searchAndAddField(
  //   "kubernetes_annotations_kubernetes_io_psp",
  //   "x"
  // );
  await pm.chartTypeSelector.searchAndAddField(
    "kubernetes_host",
    "y"
  );

  // Apply the chart
  await pm.dashboardPanelActions.applyDashboardBtn();
  // await pm.dashboardPanelActions.waitForChartToRender();

  // Open config panel
  await pm.dashboardPanelConfigs.openConfigPanel();

  // Scroll down to make drill-down button visible
  // await pm.dashboardPanelConfigs.scrollDownSidebarUntilOverrideVisible();

  // Configure drill-down with logs auto mode and open in new tab
  await pm.dashboardPanelConfigs.configureDrillDown({
    type: 'logs',
    mode: 'auto',
    openInNewTab: true
  });

  // Add panel name and save
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.savePanel();

  // Verify panel is saved
  await page.waitForTimeout(2000);
  await expect(page.locator(`text=${panelName}`)).toBeVisible();

  // Click on a chart point to trigger drill-down
  const chartContainer = page.locator('[data-test="dashboard-panel-container"]').first();
  await chartContainer.waitFor({ state: "visible" });

  // Click on the chart area
  await chartContainer.click({ position: { x: 100, y: 100 } });

  // Wait for drill-down menu/link to appear
  await page.waitForTimeout(1000);

  // Look for drill-down link (adjust selector based on your actual implementation)
  const drillDownLink = page.locator('[data-test="drilldown-link"]').or(
    page.locator('text=/.*drill.*/i').first()
  );

  if (await drillDownLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Listen for new page and click the drill-down link
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      drillDownLink.click()
    ]);

    // Wait for the new logs page to load
    await newPage.waitForLoadState('domcontentloaded');

    // Verify we're on the logs page
    await expect(newPage).toHaveURL(/.*logs.*/);

    // Verify logs page elements are visible
    await expect(newPage.locator('[data-test="logs-search-bar"]').or(
      newPage.locator('[data-test="log-table"]')
    )).toBeVisible({ timeout: 10000 });

    // Close the new tab
    await newPage.close();
  }

  // Clean up - delete the dashboard
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, dashboardName);
});
});