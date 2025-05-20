import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import {
  applyQueryButton,
  waitForDashboardPage,
} from "../utils/dashCreation.js";
import { DashboardPage } from "../../pages/dashboardPage.js";
import DashboardShareExportPage from "../../pages/dashboardPages/dashboard-share-export.js";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings.js";
import DashboardVariables from "../../pages/dashboardPages/dashboard-variables.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard filter testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardDrilldown;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardPanel;
  let dashboardPanelConfigs;
  let dashboardShareExport;
  let dashboardSetting;
  let dashboardVariables;

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
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
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
    await dashboardRefresh.setRelative("6", "w");
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
    await chartTypeSelector.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await chartTypeSelector.addFilterCondition(
      1,
      "kubernetes_container_image",
      "",
      "<>",
      "$variablename"
    );

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();

    // await page.waitForTimeout(2000);
    // Verify query inspector for AND operator
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
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

    await await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    // await expect(
    //   page.getByRole("cell", {
    //     name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = "ziox" OR kubernetes_container_image <> "ziox" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    //     exact: true,
    //   })
    // ).toBeVisible();
    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
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
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardSetting = new DashboardSetting(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    const variableName = new DashboardVariables(page);

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

    await variableName.selectValueFromVariableDropDown("variablename", "ziox");

    // Add filter conditions
    await chartTypeSelector.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.waitForChartToRender();
    await page.waitForTimeout(2000);

    // Verify query inspector
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
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
  test.skip("Should apply the filter group inside group", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardSetting = new DashboardSetting(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    const variableName = new DashboardVariables(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const dashboardVariables = new DashboardVariables(page);

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
    await dashboardRefresh.setRelative("6", "w");
    // await dashboardActions.applyDashboardBtn();
    // await dashboardActions.waitForChartToRender();

    await page.waitForTimeout(3000);

    // Select variable value
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );
    // await page.waitForTimeout(3000);

    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page.getByText("Add Group").click();

    const textContent = await page
      .locator("div.field_label")
      .first()
      .evaluate((el) => {
        return Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE) // Get only text nodes
          .map((node) => node.textContent.trim()) // Trim whitespace
          .join("");
      });

    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .waitFor({ state: "visible" });
    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-column-0\\}"]')
      .click();

    await page
      .getByRole("option", { name: "kubernetes_container_name" })
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .first()
      .click();

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page
      .locator("div")
      .filter({ hasText: /^kubernetes_container_namearrow_drop_downcloseadd$/ })
      .locator('[data-test="dashboard-add-condition-add"]')
      .click();
    await page.locator("div").filter({ hasText: "Add Group" }).nth(3).click();

    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .click();

    const lastInput = page
      .locator('[data-test="dashboard-add-condition-column-0\\}"]')
      .last();
    await lastInput.click();
    lastInput.fill("kubernetes_container_image");

    await page.getByText("kubernetes_container_image", { exact: true }).click();

    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .first()
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page
      .getByRole("option", { name: "<>" })
      .locator("div")
      .nth(2)
      .click();

    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
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
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
  test.skip("1Should apply the filter group inside group", async ({ page }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.waitForTimeout(3000);
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    const zioxOption = page.getByRole("option", { name: "ziox" });

    await expect(zioxOption).toBeVisible();
    await zioxOption.click();

    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page.getByText("Add Group").click();

    // const textContent = await page
    //   .locator("div.field_label")
    //   .first()
    //   .evaluate((el) => {
    //     return Array.from(el.childNodes)
    //       .filter((node) => node.nodeType === Node.TEXT_NODE) // Get only text nodes
    //       .map((node) => node.textContent.trim()) // Trim whitespace
    //       .join("");
    //   });
    // Add filter conditions
    await chartTypeSelector.addFilterCondition11(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );
    // await page
    //   .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
    //   .waitFor({ state: "visible" });
    // await page
    //   .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
    //   .click();

    // await page
    //   .locator('[data-test="dashboard-add-condition-column-0\\}"]')
    //   .click();

    // await page
    //   .getByRole("option", { name: "kubernetes_container_name" })
    //   .click();
    // await page
    //   .locator('[data-test="dashboard-add-condition-condition-0"]')
    //   .click();
    // await page
    //   .locator('[data-test="dashboard-add-condition-operator"]')
    //   .first()
    //   .click();

    // await page.getByText("=", { exact: true }).click();
    // await page.getByLabel("Value").click();
    // await page.getByLabel("Value").fill("$variablename");

    await page
      .locator("div")
      .filter({ hasText: /^kubernetes_container_namearrow_drop_downcloseadd$/ })
      .locator('[data-test="dashboard-add-condition-add"]')
      .click();
    await page.locator("div").filter({ hasText: "Add Group" }).nth(3).click();

    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .click();

    const lastInput = page
      .locator('[data-test="dashboard-add-condition-column-0\\}"]')
      .last();
    await lastInput.click();
    lastInput.fill("kubernetes_container_image");

    await page.getByText("kubernetes_container_image", { exact: true }).click();

    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .first()
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page
      .getByRole("option", { name: "<>" })
      .locator("div")
      .nth(2)
      .click();

    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
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
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should apply the add group filter with apply the list of value successfully", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardSetting = new DashboardSetting(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    const variableName = new DashboardVariables(page);
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

    // const button = page.locator(
    //   '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    // );
    // await expect(button).toBeVisible();

    // await page.waitForTimeout(1000);
    // await button.click();

    // await page.waitForTimeout(2000);

    // await page
    //   .locator('[data-test="index-dropdown-stream"]')
    //   .waitFor({ state: "visible" });
    // await page.locator('[data-test="index-dropdown-stream"]').click();

    // await page.waitForTimeout(2000);

    // await page
    //   .getByRole("option", { name: "e2e_automate", exact: true })
    //   .click();

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-x-data"]'
    //   )
    //   .click();
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .click();
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_namespace_name"] [data-test="dashboard-add-filter-data"]'
    //   )
    //   .click();
    //  await page
    //   .locator(
    //     '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
    //   )
    //   .click();

    // await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
    //   timeout: 5000,
    // });
    // await page.locator('[data-test="date-time-btn"]').click();
    // await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    // await page.locator('[data-test="date-time-apply-btn"]').click();
    await dashboardRefresh.setRelative("6", "w");

    await dashboardActions.waitForChartToRender();

    // await page.waitForTimeout(3000);

    //  List if item pass the value in Array

    await chartTypeSelector.selectListFilterItems(
      0,
      "kubernetes_namespace_name",
      ["ingress-nginx", "kube-system"]
    );
    await dashboardActions.applyDashboardBtn();

    // await page
    //   .locator(
    //     '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
    //   )
    //   .click();

    // await page
    //   .locator('[data-test="dashboard-add-condition-list-tab"]')
    //   .waitFor({ state: "visible" });
    // await page
    //   .locator('[data-test="dashboard-add-condition-list-tab"]')
    //   .click();

    // await page.waitForTimeout(2000);

    // await page
    //   .getByRole("option", { name: "ingress-nginx" })
    //   .locator('[data-test="dashboard-add-condition-list-item"]')
    //   .click();
    // await page
    //   .getByRole("option", { name: "kube-system" })
    //   .locator('[data-test="dashboard-add-condition-list-item"]')
    //   .click();

    // await page.locator('[data-test="dashboard-apply"]').click();

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
});
