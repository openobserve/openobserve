const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";

import StreamSettingsPage from "../../pages/generalPages/streams.js";
import PageManager from "../../pages/page-manager";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard max query testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;

    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle');
  });
  test.skip("should correctly display max query range error message when max query range is exceeded.", async ({
    page,
  }) => {
    // Instantiate PageManager (pm) for this test case
    const pm = new PageManager(page);
    const streamSettingsPage = new StreamSettingsPage(page);

    // Ensure Streaming is disabled for consistent test behaviour
    await pm.managementPage.ensureStreamingDisabled();

    await pm.dashboardList.menuItem("streams-item");

    await streamSettingsPage.updateStreamMaxQueryRange("e2e_automate", "4");

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("bar");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "y"
    );

    await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    // Wait for date-time controls to be ready before setting time range
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);

    await pm.dashboardPanelActions.savePanel();

    // Wait for date-time controls to be ready before setting time range
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");

    const orgName = process.env.ORGNAME || 'default';
    const response = await page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/${orgName}/_search?type=logs&search_type=dashboards`) &&
        response.status() === 200
    );
    const data = await response.json();

    expect(data.hits.length).toBeGreaterThan(0);

    await expect(
      page.locator('[data-test="dashboard-panel-max-duration-warning"]')
    ).toBeVisible({ timeout: 15000 });

    // Wait for date-time controls to be ready before setting time range
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dateTimeHelper.setRelativeTimeRange("2-h");

    await expect(
      page.locator('[data-test="dashboard-panel-max-duration-warning"]')
    ).not.toBeVisible();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);

    // await page.waitForTimeout(1000);

    await pm.dashboardList.menuItem("streams-item");

    await streamSettingsPage.updateStreamMaxQueryRange("e2e_automate", "0");
  });
});
