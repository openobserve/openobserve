import { expect } from "playwright/test";
import logData from "../../cypress/fixtures/log.json";

// fuction of Dashboard page and Apply query button
export const waitForDashboardPage = async function (page) {
  const dashboardListApi = page.waitForResponse(
    (response) =>
      /\/api\/.+\/dashboards/.test(response.url()) && response.status() === 200
  );

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/dashboards**");

  await page.waitForSelector(`text="Please wait while loading dashboards..."`, {
    state: "hidden",
  });
  await dashboardListApi;
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
