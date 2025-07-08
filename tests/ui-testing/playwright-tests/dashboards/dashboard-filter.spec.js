import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import { waitForDashboardPage } from "../utils/dashCreation.js";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings.js";
import DashboardVariables from "../../pages/dashboardPages/dashboard-variables.js";
import Dashboardfilter from "../../pages/dashboardPages/dashboard-filter.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should successfully apply filter conditions using both AND and OR operators", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardVariables = new DashboardVariables(page);
    const dashboardSetting = new DashboardSetting(page);
    const dashboardFilter = new Dashboardfilter(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    const dashboardRefresh = new DashboardTimeRefresh(page);

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a variable
    await dashboardSetting.openSetting();

    await dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();

    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("_timestamp", "y");

    await waitForDateTimeButtonToBeEnabled(page);

    await dashboardRefresh.setRelative("6", "w");

    await dashboardActions.waitForChartToRender();

    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "filter"
    );
    await dashboardActions.applyDashboardBtn();

    // Select variable value
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Add filter conditions
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await dashboardFilter.addFilterCondition(
      1,
      "kubernetes_container_image",
      "",
      "<>",
      "$variablename"
    );

    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    // Verify query inspector for AND operator
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Change operator to OR and verify
    await page.getByText("ANDarrow_drop_down").click();

    await page.getByRole("option", { name: "OR" }).click();

    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    await page.waitForTimeout(2000);

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = new DashboardVariables(page);
    const dashboardFilter = new Dashboardfilter(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();

    await variableName.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // Add a panel to the dashboard
    await dashboardCreate.addPanel();

    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("_timestamp", "y");

    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    await variableName.selectValueFromVariableDropDown("variablename", "ziox");

    // Add filter conditions
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    // Verify query inspector
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should apply the filter group inside group", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = new DashboardVariables(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const dashboardVariables = new DashboardVariables(page);
    const dashboardFilter = new Dashboardfilter(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();

    await variableName.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await page.waitForTimeout(1000);
    // Add a panel to the dashboard
    await dashboardCreate.addPanel();

    await dashboardActions.addPanelName(panelName);

    // await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("_timestamp", "y");

    await waitForDateTimeButtonToBeEnabled(page);

    await dashboardRefresh.setRelative("6", "w");

    await dashboardActions.waitForChartToRender();

    // Select variable value
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );
    // await page.waitForTimeout(3000);

    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page.getByText("Add Group").click();

    await dashboardFilter.addGroupFilterCondition(
      0,
      "kubernetes_container_name",
      "=",
      "$variablename"
    );

    await page
      .locator("div")
      .filter({ hasText: /^kubernetes_container_namearrow_drop_downcloseadd$/ })
      .locator('[data-test="dashboard-add-condition-add"]')
      .click();
    await page.locator("div").filter({ hasText: "Add Group" }).nth(3).click();

    await dashboardFilter.addGroupFilterCondition(
      0,
      "kubernetes_container_image",
      "<>",
      "$variablename"
    );
    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    // await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();

    await expect(page.getByText("'$variablename'").first()).toBeVisible();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = \'ziox\' AND (kubernetes_container_image <> \'ziox\')) GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should apply the add group filter with apply the list of value successfully", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = new DashboardVariables(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const dashboardFilter = new Dashboardfilter(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await variableName.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await page.waitForTimeout(3000);

    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "filter"
    );

    await waitForDateTimeButtonToBeEnabled(page);

    await dashboardRefresh.setRelative("6", "w");

    await dashboardActions.waitForChartToRender();

    await dashboardFilter.selectListFilterItems(
      0,
      "kubernetes_namespace_name",
      ["ingress-nginx", "kube-system"]
    );
    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    const cell = await page.getByRole("cell", {
      name: /SELECT kubernetes_container_name as "x_axis_1", count\(kubernetes_container_image\) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IN \('ingress-nginx', 'kube-system'\) GROUP BY x_axis_1/,
    });

    // Ensure the cell is visible
    await expect(cell.first()).toBeVisible();

    // Verify the text matches
    await expect(cell.first()).toHaveText(
      'SELECT kubernetes_container_name as "x_axis_1", count(kubernetes_container_image) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IN (\'ingress-nginx\', \'kube-system\') GROUP BY x_axis_1'
    );

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should  apply the  filter using the field button", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardSetting = new DashboardSetting(page);
    const variableName = new DashboardVariables(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await variableName.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("_timestamp", "y");

    await dashboardActions.applyDashboardBtn();

    await dashboardActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);

    await dashboardRefresh.setRelative("6", "w");

    await dashboardActions.waitForChartToRender();

    await chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "filter"
    );

    await expect(
      page.locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
      )
    ).toBeVisible();
    await page.locator('[data-test="dashboard-add-condition-remove"]').click();

    await dashboardActions.applyDashboardBtn();

    // Save the dashboard panel

    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should display an error message if added the invalid operator", async ({
    page,
  }) => {
    // Page object instances
    const dashboardList = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardSetting = new DashboardSetting(page);
    const dashboardVariables = new DashboardVariables(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const dashboardFilter = new Dashboardfilter(page);

    // Go to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Open settings and add variable
    await page.waitForTimeout(3000);
    await dashboardSetting.openSetting();
    await dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // await dashboardSetting.closeSettingDashboard();

    // Add panel
    await dashboardCreate.addPanel();

    // Select stream and add Y field
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("_timestamp", "y");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();

    // Set date range
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardRefresh.setRelative("6", "w");
    await dashboardActions.waitForChartToRender();

    // Add filter field
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );

    // Add invalid filter condition (IN operator with only one value)
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "IN",
      "$variablename"
    );
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();

    // Expect error message
    await expect(
      page.getByText("sql parser error: Expected:").first()
    ).toBeVisible();

    // Fix filter condition (change to "=" operator)
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();

    // Save panel
    await dashboardActions.addPanelName("Dashboard_test");
    await dashboardActions.savePanel();

    // Delete dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should Filter work correctly if Added the breakdown field", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardSetting = new DashboardSetting(page);
    const dashboardVariables = new DashboardVariables(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);

    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await page.waitForTimeout(3000);

    // Open settings and add variable
    await dashboardSetting.openSetting();
    await dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Select stream and add fields
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("_timestamp", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");

    await dashboardActions.applyDashboardBtn();

    // Set date range
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await dashboardRefresh.setRelative("6", "w");
    await dashboardActions.waitForChartToRender();

    // Add filter field and set value
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Add filter condition
    const dashboardFilter = new Dashboardfilter(page);
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();

    // Open query inspector and verify
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'$variablename\' GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardCreate.deleteDashboard(randomDashboardName);
  });
});
