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

    // Set chart code directly via Monaco API — keyboard.insertText races against
    // the .inputarea fill below (focus shifts before Monaco commits)
    await pm.dashboardPage.setCustomChartCode(pictorialJSON);
    // await page.locator('[data-test="dashboard-panel-error-bar-icon"]').click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".inputarea")
      .fill('select * from "e2e_automate"');
    await page.waitForTimeout(2000);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForTimeout(3000);
    await expect(
      page.getByText(
        "Unsafe code detected: Access to 'document' is not allowed"
      )
    ).toBeVisible();
  });

  test("Add line JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);
    if (!lineJSON) {
      testLogger.warn('Skipping test: line.json not found');
      return;
    }

    await pm.dashboardPage.addCustomChart();

    // Set chart code directly via Monaco API (see Pictorial test above)
    await pm.dashboardPage.setCustomChartCode(lineJSON);
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".inputarea")
      .fill('select * from "e2e_automate"');
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForTimeout(3000);
  });
});
