import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"], { waitUntil: "networkidle" });

  if (await page.getByText("Login as internal user").isVisible()) {
    await page.getByText("Login as internal user").click();
  }

  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);

  // wait for login api response
  const waitForLogin = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/login") && response.status() === 200
  );

  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();

  await waitForLogin;

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
    waitUntil: "networkidle",
  });
  await page
    .locator('[data-test="navbar-organizations-select"]')
    .getByText("arrow_drop_down")
    .click();
  await page.getByRole("option", { name: "default", exact: true }).click();
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const fetchResponse = await fetch(
    `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
    {
      method: "POST",
      headers: headers,
      body: JSON.stringify(logsdata),
    }
  );
  const response = await fetchResponse.json();
  console.log(response);
}

async function waitForDashboardPage(page) {
  const dashboardListApi = page.waitForResponse(
    (response) =>
      /\/api\/.+\/dashboards/.test(response.url()) && response.status() === 200
  );

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/dashboards**");

  await page.waitForSelector(`text="Please wait while loading dashboards..."`, {
    state: "hidden",
  });
  await dashboardListApi;
  await page.waitForTimeout(500);
}

// Refactored test cases using Page Object Model

test.describe("dashboard UI testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardDrilldown;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardPanel;
  let dashboardPanelConfigs;

  test.beforeEach(async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);

    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should add and delete the dashboard", async ({ page }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.searchDashboard(randomDashboardName);

    await dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should create a duplicate of the dashboard", async ({ page }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 30000,
    });
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.searchDashboard(randomDashboardName);

    await dashboardList.duplicateDashboard(randomDashboardName);
  });

  test("should create a dashboard and add the breakdown", async ({ page }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    await dashboardActions.applyDashboardBtn();
  });

  test("should update the data when changing the time between both absolute and relative time using the Kolkata time zone.", async ({
    page,
  }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    await dashboardRefresh.setRelative("3", "h");
    // await dashboardRefresh.setAbsolute("7");

    await dashboardActions.applyDashboardBtn();
  });

  test("should update the chart with the results of a custom SQL query", async ({
    page,
  }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await page.locator('[data-test="dashboard-customSql"]').click();


    // await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator('.inputarea')
      .fill(
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1'
      );

    // await dashboardActions.applyDashboardBtn();
    await chartTypeSelector.searchAndAddField("x_axis_1", "x");
    await chartTypeSelector.searchAndAddField("y_axis_1", "y");
    await chartTypeSelector.searchAndAddField("breakdown_1", "b");

    await dashboardActions.applyDashboardBtn();
  });

  test("should display the correct and updated chart when changing the chart type", async ({
    page,
  }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // await dashboardActions.applyDashboardBtn();
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectChartType("scatter");
    await chartTypeSelector.selectChartType("gauge");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    await dashboardPanel.deletePanel(panelName);
  });

  test("should navigate to another dashboard using the DrillDown feature.", async ({
    page,
  }) => {
    const randomDashboardName = `Dashboard_${Date.now()}`;
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_component",
      "b"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_instance",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_managed_by",
      "y"
    );

    await dashboardActions.applyDashboardBtn();

    const drilldownName = dashboardDrilldown.generateUniqueDrilldownName();
    const folderName = "default";
    const tabName = "Default";
    const dashboardName = randomDashboardName;
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownDashboard(
      folderName,
      drilldownName,
      dashboardName,
      tabName
    );

    await dashboardActions.applyDashboardBtn();
  });
});
