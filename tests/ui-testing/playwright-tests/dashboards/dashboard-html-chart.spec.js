import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

// Basic HTML snippet for the first test
const BASIC_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test>Openobserve</h1>
    <p>Testing Openobserve visibility</p>
  </body>
</html>`;

// HTML snippet that renders a bold dashboard variable for the second test
const VARIABLE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test>Openobserve</h1>
    <p>
      <span style="font-weight:900;">$variablename</span>&nbsp;Testing&nbsp;Openobserve&nbsp;visibility
    </p>
  </body>
</html>`;

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("HTML chart dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("Should display the correct Plot UI when entering the HTML code", async ({
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

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("html");

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div")
      .click();

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div")
      .fill(BASIC_HTML_SNIPPET);

    await expect(
      page.getByRole("heading", { name: "Openobserve" })
    ).toBeVisible();

    // Add the panel name and save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should correctly replace the dashboard variable value on the HTML chart.", async ({
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

    await pm.chartTypeSelector.selectChartType("html");

    await pm.dashboardTimeRefresh.setRelative("15", "m");

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div")
      .click();

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div")
      .fill(VARIABLE_HTML_SNIPPET);

    await expect(
      page.getByRole("heading", { name: "Openobserve" })
    ).toBeVisible();

    await expect(
      page.locator('[data-test="html-renderer"]').getByText("controller")
    ).toBeVisible();

    // Save the dashboard panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
