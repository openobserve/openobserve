import { test, expect } from "../baseFixtures";
import path from "path";
import fs from "fs";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/dashboardPages/page-manager";

// Function to read JSON test files
function readJsonFile(filename) {
  const filePath = path.join(__dirname, `../../../test-data/${filename}`);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: JSON file does not exist at: ${filePath}`);
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
  
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
  });

  test("Add Pictorial JSON in Monaco Editor", async ({ page }) => {
    //initialize the page manager
    const pm = new PageManager(page);

    if (!pictorialJSON) {
      console.error("Skipping test: pictorial.json not found");
      return;
    }

    await pm.dashboardPage.addCustomChart();

    // Type the content with raw modifier to bypass autocomplete
    await page.keyboard.insertText(pictorialJSON);

    await page.waitForTimeout(1000);
    // await page.locator('[data-test="dashboard-panel-error-bar-icon"]').click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .getByRole("textbox")
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
      console.error("Skipping test: line.json not found");
      return;
    }

    await pm.dashboardPage.addCustomChart();

    // Type the content with raw modifier to bypass autocomplete
    await page.keyboard.insertText(lineJSON);

    await page.waitForTimeout(1000);
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .getByRole("textbox")
      .fill('select * from "e2e_automate"');
    await page.waitForTimeout(3000);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForTimeout(3000);
  });
});
