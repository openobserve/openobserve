const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import { waitForDashboardPage } from "./utils/dashCreation.js";
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should successfully apply filter conditions using both AND and OR operators", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });

    // Open dashboard settings and add a variable
    await pm.dashboardSetting.openSetting();

    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectChartType("line");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "filter"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Select variable value
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Add filter conditions
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await pm.dashboardFilter.addFilterCondition(
      1,
      "kubernetes_container_image",
      "",
      "<>",
      "$variablename"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

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

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();

    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectChartType("line");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Add filter conditions
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test.skip("Should apply the filter group inside group", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();

    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await page.waitForTimeout(1000);
    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.dashboardPanelActions.addPanelName(panelName);

    // await pm.chartTypeSelector.selectChartType("line");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    await pm.dashboardPanelActions.waitForChartToRender();

    // Select variable value
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );
    // await page.waitForTimeout(3000);

    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page.getByText("Add Group").click();

    await pm.dashboardFilter.addGroupFilterCondition(
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

    await pm.dashboardFilter.addGroupFilterCondition(
      0,
      "kubernetes_container_image",
      "<>",
      "$variablename"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should apply the add group filter with apply the list of value successfully", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await page.waitForTimeout(3000);

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "x"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "filter"
    );

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardFilter.selectListFilterItems(
      0,
      "kubernetes_namespace_name",
      ["ingress-nginx", "kube-system"]
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should  apply the  filter using the field button", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "filter"
    );

    await expect(
      page.locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
      )
    ).toBeVisible();
    await page.locator('[data-test="dashboard-add-condition-remove"]').click();

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the dashboard panel

    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should display an error message if added the invalid operator", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Go to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Open settings and add variable
    await page.waitForTimeout(3000);
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    // await pm.dashboardSetting.closeSettingDashboard();

    // Add panel
    await pm.dashboardCreate.addPanel();

    // Select stream and add Y field
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Set date range
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("6", "w");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add filter field
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );

    // Add invalid filter condition (IN operator with only one value)
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "IN",
      "$variablename"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Expect error message
    await expect(
      page
        .getByText(
          /(sql parser error: Expected:|Search field not found:|Schema error: No field named controller\.?)/i
        )
        .first()
    ).toBeVisible();

    // Fix filter condition (change to "=" operator)
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Save panel
    await pm.dashboardPanelActions.addPanelName("Dashboard_test");
    await pm.dashboardPanelActions.savePanel();

    // Delete dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("Should Filter work correctly if Added the breakdown field", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page.waitForTimeout(3000);

    // Open settings and add variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add a panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and add fields
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "b"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Set date range
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await pm.dashboardTimeRefresh.setRelative("6", "w");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add filter field and set value
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Add filter condition

    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$variablename"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
  test("should verify the custom value search from variable dropdown", async ({
    page,
  }) => {
    const valuesResponses = [];

    // Listen for all responses to capture _values API calls
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/_values?")) {
        valuesResponses.push({
          url,
          status: response.status(),
        });
      }
    });

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      true
    );

    // await page.waitForLoadState('networkidle');

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and add fields
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    // Perform custom value search in variable dropdown to trigger _values API calls
    const variableInput = page.getByLabel("variablename", { exact: true });
    await variableInput.waitFor({ state: "visible", timeout: 10000 });
    await variableInput.click();

    // Type partial search terms to trigger multiple _values API calls
    const searchTerms = ["zi", "zio", "ziox"];
    for (const term of searchTerms) {
      await variableInput.fill(term);
      await page.waitForLoadState('networkidle'); // Allow API calls to complete
    }

    // Select the final value
    const option = page.getByRole("option", { name: "ziox" });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();

    // Wait for any remaining network activity to settle
    await page.waitForLoadState('networkidle');

    // Assert that we captured at least one _values API call
    expect(valuesResponses.length).toBeGreaterThan(0);

    // Assert all collected responses have 200 status
    for (const res of valuesResponses) {
      expect(res.status).toBe(200);
    }

    // Add filter field and set value
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );

    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "IN",
      "$variablename"
    );

    // Save panel and cleanup
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
});
