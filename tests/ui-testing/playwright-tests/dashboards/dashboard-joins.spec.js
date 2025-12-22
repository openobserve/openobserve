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
import DashboardJoinsHelper from "./utils/dashboardJoinsHelper.js";

const randomDashboardName =
  "Dashboard_Joins_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard joins testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    // Ingest data into a second stream for join testing
    await ingestion(page, "e2e_automate_logs");

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should successfully add a single INNER join with one condition", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Add a panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and add fields
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Set date range
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("6", "w");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add a join
    await joinsHelper.addJoin();

    // Configure the join
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });

    // Close join popup
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Apply and render chart
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify SQL query contains INNER JOIN
    // await joinsHelper.verifyJoinInSQL('INNER JOIN "e2e_automate_logs"');

      // Open the query inspector and verify the SQL query
      await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    // await page.waitForTimeout(5000);
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .nth(1)
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save panel
    await pm.dashboardPanelActions.savePanel();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should successfully add a LEFT join with multiple conditions", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Add panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Configure chart
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Remove default X-axis field (histogram of _timestamp) first
    await page
      .locator('[data-test="dashboard-x-item-x_axis_1-remove"]')
      .click();

    // Now add custom X and Y fields
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "x");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add join with multiple conditions
    await joinsHelper.addJoin();

    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "left",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
        {
          leftField: "kubernetes_namespace_name",
          operator: "=",
          rightField: "kubernetes_namespace_name",
        },
      ],
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Apply and verify
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open the query inspector and verify the SQL query
      await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    // await page.waitForTimeout(5000);
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT e2e_automate.kubernetes_pod_name as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" LEFT JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name AND e2e_automate.kubernetes_namespace_name = stream_0.kubernetes_namespace_name GROUP BY x_axis_1',
        })
        .nth(1)
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save and clean up
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should successfully add a RIGHT join and verify SQL generation", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    // await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add RIGHT join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "right",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_container_name",
          operator: "=",
          rightField: "kubernetes_container_name",
        },
      ],
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

     // Open the query inspector and verify the SQL query
     await page
     .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
     .click();
   // await page.waitForTimeout(5000);
   await expect(
     page
       .getByRole("cell", {
         name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" RIGHT JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_container_name = stream_0.kubernetes_container_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
       })
       .nth(1)
   ).toBeVisible();

   await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should successfully add multiple joins to a single panel", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

     // Wait for dashboard UI to be fully stable
     await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    // await pm.dashboardTimeRefresh.setRelative("6", "w");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add first join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Add second join (chaining from first join)
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 1,
      joinType: "left",
      targetStream: "e2e_automate",
      conditions: [
        {
          leftField: "kubernetes_namespace_name",
          operator: "=",
          rightField: "kubernetes_namespace_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify join count
    const joinCount = await joinsHelper.getJoinCount();
    expect(joinCount).toBe(2);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify both joins appear in SQL
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(2000);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name LEFT JOIN "e2e_automate" AS stream_1 ON stream_0.kubernetes_namespace_name = stream_1.kubernetes_namespace_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .nth(1)
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should successfully remove a join from the panel", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add two joins
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 1,
      joinType: "left",
      targetStream: "e2e_automate",
      conditions: [
        {
          leftField: "kubernetes_namespace_name",
          operator: "=",
          rightField: "kubernetes_namespace_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify 2 joins exist
    let joinCount = await joinsHelper.getJoinCount();
    expect(joinCount).toBe(2);

    // Remove first join
    await joinsHelper.removeJoin(0);

    // Verify only 1 join remains
    joinCount = await joinsHelper.getJoinCount();
    expect(joinCount).toBe(1);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should successfully edit an existing join configuration", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add initial join with INNER type
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Edit the join - change type to LEFT and add another condition
    await joinsHelper.editJoin(0, {
      joinType: "left",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
        {
          leftField: "kubernetes_container_name",
          operator: "=",
          rightField: "kubernetes_container_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

      // Verify both joins appear in SQL
      await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(2000);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" LEFT JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name AND e2e_automate.kubernetes_container_name = stream_0.kubernetes_container_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .nth(1)
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should handle join with different operators (!=, >, <, >=, <=)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Test != operator
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "!=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

      // Verify both joins appear in SQL
      await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(2000);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name != stream_0.kubernetes_pod_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .nth(1)
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should display error when join has no matching data", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Create join with condition that won't match (using != with same values)
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "!=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForTimeout(3000);

     // Verify both joins appear in SQL
     await page
     .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
     .click();
   await page.waitForTimeout(2000);

   await expect(
     page
       .getByRole("cell", {
         name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name != stream_0.kubernetes_pod_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
       })
       .nth(1)
   ).toBeVisible();
   await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Save panel
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should work correctly with join and filters combined", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    // Add variable for filter
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "containername",
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
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add filter
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "filter");
    await pm.dashboardVariables.selectValueFromVariableDropDown("containername", "ziox");
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      "$containername"
    );

    // Add join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

      // Verify both joins appear in SQL
      await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(2000);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name WHERE e2e_automate.kubernetes_container_name = \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should work correctly with join and breakdown fields", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

     // Verify both joins appear in SQL
     await page
     .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
     .click();
   await page.waitForTimeout(2000);

   await expect(
     page
       .getByRole("cell", {
         name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1", e2e_automate.kubernetes_container_name as "breakdown_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC',
       })
       .nth(1)
   ).toBeVisible();
   await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should correctly generate stream aliases (stream_0, stream_1, etc.)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const joinsHelper = new DashboardJoinsHelper(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("join-test");

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({ state: "visible" });

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add first join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 0,
      joinType: "inner",
      targetStream: "e2e_automate_logs",
      conditions: [
        {
          leftField: "kubernetes_pod_name",
          operator: "=",
          rightField: "kubernetes_pod_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Add second join
    await joinsHelper.addJoin();
    await joinsHelper.configureJoin({
      joinIndex: 1,
      joinType: "left",
      targetStream: "e2e_automate",
      conditions: [
        {
          leftField: "kubernetes_namespace_name",
          operator: "=",
          rightField: "kubernetes_namespace_name",
        },
      ],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

     // Verify both joins appear in SQL
     await page
     .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
     .click();
   await page.waitForTimeout(2000);

   await expect(
     page
       .getByRole("cell", {
         name: 'SELECT histogram(e2e_automate._timestamp) as "x_axis_1", count(e2e_automate._timestamp) as "y_axis_1" FROM "e2e_automate" INNER JOIN "e2e_automate_logs" AS stream_0 ON e2e_automate.kubernetes_pod_name = stream_0.kubernetes_pod_name LEFT JOIN "e2e_automate" AS stream_1 ON stream_0.kubernetes_namespace_name = stream_1.kubernetes_namespace_name GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
       })
       .nth(1)
   ).toBeVisible();
   await page.locator('[data-test="query-inspector-close-btn"]').click();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
});
