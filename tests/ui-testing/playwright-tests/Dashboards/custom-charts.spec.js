const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import path from "path";
import fs from "fs";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

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
  });

  test("Add Pictorial JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);

    if (!pictorialJSON) {
      testLogger.warn('Skipping test: pictorial.json not found');
      return;
    }

    await pm.dashboardPage.addCustomChart();

    // Set both editors via Monaco API — .inputarea.fill() stopped overriding the
    // panel's auto-generated query, leaving panelSchema.query empty so Apply
    // shows "Please enter query for custom chart" instead of running JS validation.
    await pm.dashboardPage.setCustomChartCode(pictorialJSON);
    await pm.dashboardPage.setDashboardPanelQuery('select * from "e2e_automate"');
    await pm.dashboardPanelActions.applyDashboardBtn();

    // The validation error is displayed inside an OTooltip on the warning
    // button — it is not in the DOM until the button is hovered.
    const errorBtn = page.locator('[data-test="panel-error-data"]');
    await expect(errorBtn).toBeVisible({ timeout: 30000 });
    await errorBtn.hover();
    await expect(
      page.locator('[data-test="o-tooltip-content"] div').getByText(
        "Unsafe code detected: Access to 'document' is not allowed"
      )
    ).toBeVisible({ timeout: 5000 });
  });

  test("Add line JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);
    if (!lineJSON) {
      testLogger.warn('Skipping test: line.json not found');
      return;
    }

    await pm.dashboardPage.addCustomChart();

    // Set both editors via Monaco API (see Pictorial test above)
    await pm.dashboardPage.setCustomChartCode(lineJSON);
    await pm.dashboardPage.setDashboardPanelQuery('select * from "e2e_automate"');
    await pm.dashboardPanelActions.applyDashboardBtn();

    // line.json is SAFE ECharts code (no forbidden identifiers), so Apply must
    // actually render the chart — NOT surface a validation/empty-query error.
    // (Previously this test only waited 3s and asserted nothing.)
    await pm.dashboardPanelActions.expectCustomChartRendered(expect);
    await expect(page.getByText("Unsafe code detected")).toBeHidden();
    await expect(
      page.getByText("Please enter query for custom chart")
    ).toBeHidden();
  });
});
