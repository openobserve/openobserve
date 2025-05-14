import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";
import StreamSettingsPage from "../../pages/dashboardPages/streams.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard multi y axis testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });
  test("should correctly display and update multiple Y-axes in edit panel.", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const streamSettingsPage = new StreamSettingsPage(page);

    await dashboardPage.menuItem("streams-item");

    streamSettingsPage.updateStreamMaxQueryRange("e2e_automate", "3");

    await page.waitForTimeout(5000);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);

    await dashboardCreate.addPanel();

    // await page.waitForTimeout(3000);

    await chartTypeSelector.selectChartType("bar");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

    await chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    await dateTimeHelper.setRelativeTimeRange("6-w");

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    await dashboardPageActions.addPanelName(randomDashboardName);

    await dashboardPageActions.savePanel();

    await page.waitForTimeout(2000);

    await dateTimeHelper.setRelativeTimeRange("6-w");

    await page.waitForTimeout(3000);
    await expect(
      page.locator('[data-test="dashboard-panel-max-duration-warning"]')
    ).toBeVisible();

    // await page.waitForTimeout(5000);
    await dateTimeHelper.setRelativeTimeRange("2-h");

    await expect(
      page.locator('[data-test="dashboard-panel-max-duration-warning"]')
    ).not.toBeVisible();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);

    await dashboardPage.menuItem("streams-item");
    await page.waitForTimeout(3000);

    streamSettingsPage.updateStreamMaxQueryRange("e2e_automate", "0");

    // await page.locator('[data-test="dashboard-back-btn"]').click();

    // await deleteDashboard(page, randomDashboardName);
  });
});
