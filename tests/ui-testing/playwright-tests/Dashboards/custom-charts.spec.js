const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import path from "path";
import fs from "fs";
import { ingestion } from "./utils/dashIngestion.js";
import { deleteDashboard } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

const generateDashboardName = (prefix) =>
  `${prefix}_` + Math.random().toString(36).substr(2, 9);

// Function to read JSON test files
function readJsonFile(filename) {
  const filePath = path.join(__dirname, `../../../test-data/${filename}`);
  if (!fs.existsSync(filePath)) {
    testLogger.error('JSON file does not exist', { filePath });
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

test.describe("Custom Charts Tests", () => {
  let pictorialJSON, lineJSON;

  test.beforeAll(() => {
    pictorialJSON = readJsonFile("pictorial.json");
    lineJSON = readJsonFile("line.json");
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    // navigateToBase() alone can land on the wrong org's page on cloud (the
    // stored session's "last active org" wins over the org_identifier query
    // param on a bare root load) — force the correct org context with an
    // explicit navigation to a real feature page.
    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await page.waitForLoadState("domcontentloaded");
  });

  test("Add Pictorial JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);

    if (!pictorialJSON) {
      testLogger.warn('Skipping test: pictorial.json not found');
      return;
    }

    const dashboardName = generateDashboardName("Customcharts_Pictorial");
    await pm.dashboardPage.addCustomChart(dashboardName);

    // Set both editors via Monaco API — .inputarea.fill() stopped overriding the
    // panel's auto-generated query, leaving panelSchema.query empty so Apply
    // shows "Please enter query for custom chart" instead of running JS validation.
    await pm.dashboardPage.setCustomChartCode(pictorialJSON);
    await pm.dashboardPage.setDashboardPanelQuery('select * from "e2e_automate"');
    await pm.dashboardPanelActions.applyDashboardBtn();

    // The validation error is displayed inside an OTooltip on the warning
    // button — it is not in the DOM until the button is hovered.
    const errorBtn = pm.dashboardPage.getPanelErrorDataBtn();
    await expect(errorBtn).toBeVisible({ timeout: 30000 });
    await expect(
      await pm.dashboardPage.getPanelErrorTooltipText(
        "Unsafe code detected: Access to 'document' is not allowed"
      )
    ).toBeVisible({ timeout: 5000 });

    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await deleteDashboard(page, dashboardName);
  });

  test("Add line JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);
    if (!lineJSON) {
      testLogger.warn('Skipping test: line.json not found');
      return;
    }

    const dashboardName = generateDashboardName("Customcharts_Line");
    await pm.dashboardPage.addCustomChart(dashboardName);

    // Set both editors via Monaco API (see Pictorial test above)
    await pm.dashboardPage.setCustomChartCode(lineJSON);
    await pm.dashboardPage.setDashboardPanelQuery('select * from "e2e_automate"');
    await pm.dashboardPanelActions.applyDashboardBtn();

    // line.json is SAFE ECharts code (no forbidden identifiers), so Apply must
    // actually render the chart — NOT surface a validation/empty-query error.
    // (Previously this test only waited 3s and asserted nothing.)
    await pm.dashboardPanelActions.expectCustomChartRendered(expect);
    await expect(pm.dashboardPage.getUnsafeCodeText()).toBeHidden();
    await expect(pm.dashboardPage.getPleaseEnterQueryText()).toBeHidden();

    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await deleteDashboard(page, dashboardName);
  });
});
