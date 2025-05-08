import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion, removeUTFCharacters } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);

    // Ensure the "dashboards-item" menu is loaded before proceeding
    await dashboardList.menuItem("dashboards-item");
    await page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
  });

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(500);

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

    await page.waitForTimeout(2000);
    await button.click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await dateTimeHelper.setRelativeTimeRange("6-w");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();
    await dashboardPanel.editPanel(panelName);
    await dashboardPanelConfigs.openConfigPanel();

    await dashboardPanelConfigs.selectLineThickness("2");
    await dashboardPanelConfigs.selectLineInterpolation("smooth");
    await dashboardPanelConfigs.selectValuePosition("Inside Top");
    await dashboardPanelConfigs.selectValueRotate("45");
    await dashboardPanelConfigs.selectSymbols("Yes");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should successfully apply filter conditions using both AND and OR operators", async ({
    page,
  }) => {
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

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    const filterButton1 = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton1).toBeVisible();
    await filterButton1.click();

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    await page.getByRole("option", { name: "ziox" }).click();

    await page.locator('[data-test="dashboard-add-condition-add"]').click();
    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
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
      .locator(
        '[data-test="dashboard-add-condition-label-1-kubernetes_container_image"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-1"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-1"]')
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .last()
      .click();

    await page
      .getByRole("option", { name: "<>" })
      .locator("div")
      .nth(2)
      .click();
    await page
      .locator("div")
      .filter({ hasText: /^Value$/ })
      .nth(2)
      .click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
    await expect(page.getByText("'$variablename'").first()).toBeVisible();
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    const cell = page.getByRole("cell", {
      name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      exact: true,
    });

    // Check if the cell is visible
    await expect(cell).toBeVisible();

    // Verify it contains the correct text
    await expect(cell).toHaveText(
      'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC'
    );

    await page.waitForTimeout(2000);
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.getByText("ANDarrow_drop_down").click();
    await page.getByRole("option", { name: "OR" }).click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    const ORoprator = page.getByRole("cell", {
      name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      exact: true,
    });

    // Check if the cell is visible
    await expect(ORoprator).toBeVisible();

    // Verify it contains the correct text
    await expect(ORoprator).toHaveText(
      'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC'
    );

    await page.waitForTimeout(2000);
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownDashboard(
      folderName,
      drilldownName,
      randomDashboardName,
      tabName
    );
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should duplicate a dashboard and verify duplication", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardList.duplicateDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard Duplicated")).toBeVisible();
  });

  test("should move a dashboard to another folder", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const folderName = dashboardFolder.generateUniqueFolderName("Test_Folder");
    const folder = "testing";

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardList.moveDashboardToAnotherFolder(folder);
    await expect(page.getByText("Dashboard moved successfully")).toBeVisible();
  });

  test("should refresh a dashboard and verify data update", async ({
    page,
  }) => {
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

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
    await dashboardTimeRefresh.refreshDashboard();
  });

  test("should edit a dashboard panel and verify changes", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
    await dashboardPanel.editPanel(panelName);
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("add panel to dashboard", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });
});
