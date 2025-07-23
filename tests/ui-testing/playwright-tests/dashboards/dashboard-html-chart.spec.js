import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage } from "./utils/dashCreation.js";
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

  test("Should display the correct  Plot UI when entering the HTML code", async ({
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

    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectChartType("html");

    await page.waitForTimeout(5000);

    // await page
    //   .locator('[data-test="dashboard-html-editor"]')
    //   .getByRole("textbox")
    //   .click();

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div")
      .click();

    await page
      .locator('[data-test="dashboard-html-editor"]')
      .getByRole("textbox")
      .locator("div").fill(`<!DOCTYPE html>
  <html>
    <body>
      <h1 data-test=>Openobserve</h1>
      <p>Testing Openobserve visibility</p>
    </body>
  </html>`);

    await expect(
      page.getByRole("heading", { name: "Openobserve" })
    ).toBeVisible();

    // Add the panel name and save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    // Save the dashboard panel

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardCreate.deleteDashboard(randomDashboardName);
  });
});
