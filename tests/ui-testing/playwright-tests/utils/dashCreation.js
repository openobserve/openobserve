import { expect } from "playwright/test";
import logData from "../../cypress/fixtures/log.json";

// Function to wait for the dashboard page to load
export const waitForDashboardPage = async function (page) {
  // If already on the dashboard page, skip waiting for navigation
  if (!page.url().includes("/web/dashboards")) {
    await page.waitForURL(/\/web\/dashboards.*/, { timeout: 20000 });
  }

  // Wait for either the API response or the dashboard table to appear
  try {
    await Promise.race([
      page.waitForResponse(
        (response) =>
          /\/api\/.*\/dashboards/.test(response.url()) &&
          response.status() === 200,
        { timeout: 20000 }
      ),
      page.waitForSelector('[data-test="dashboard-table"]', { timeout: 20000 }),
    ]);
  } catch (err) {
    throw new Error("Dashboard page did not load as expected: " + err.message);
  }

  await page.waitForTimeout(500);
};

export const applyQueryButton = async function (page) {
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  await expect.poll(async () => (await search).status()).toBe(200);
};

export async function deleteDashboard(page, dashboardName) {
  console.log(`Deleting dashboard with name: ${dashboardName}`);

  // const dashboardRow = page.locator(`//tr[.//td[text()="${dashboardName}"]]`);
  // await expect(dashboardRow).toBeVisible(); // Ensure the row is visible
  const dashboardRow = page
    .locator('//tr[.//td[text()="' + dashboardName + '"]]')
    .nth(0);

  const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');
  await deleteButton.click();

  // Wait for the confirmation popup and confirm deletion
  const confirmButton = page.locator('[data-test="confirm-button"]');
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  // Ensure the dashboard is removed
  await expect(page.getByText("Dashboard deleted successfully")).toBeVisible();
}
