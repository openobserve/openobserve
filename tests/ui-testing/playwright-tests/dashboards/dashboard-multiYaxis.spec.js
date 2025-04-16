import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDashboardPage } from "../utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashboardPages/dashboardChart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-Create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
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

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);

    await dashboardCreate.AddPanel();

    await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    await chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    await dateTimeHelper.setRelativeTimeRange("5-M");

    // await dashboardCreate.applyButton();

    // await chartTypeSelector.searchAndAddField(
    //   "kubernetes_namespace_name",
    //   "filter"
    // );

    // await chartTypeSelector.addFilterCondition1(
    //   "kubernetes_namespace_name",
    //   "",
    //   ">=",
    //   "test-namespace"
    // );

    await page.waitForTimeout(2000);
  });
});
