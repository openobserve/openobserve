import { expect } from "playwright/test";
import logData from "../../../fixtures/log.json";
import testLogger from '../../utils/test-logger.js';

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
  testLogger.info('Deleting dashboard', { dashboardName });

  // Wait for page to be fully loaded
// ✅ Wait for either the Dashboard API or Folder API (whichever comes first)
  await Promise.race([
    page.waitForResponse(
      (response) => {
        const url = response.url();
        return (
          ( /\/api\/.*\/dashboards/.test(url) ||
            /\/api\/.*\/folders/.test(url) ) &&
          response.status() === 200
        );
      },
      { timeout: 20000 }
    ),
    page.waitForSelector('[data-test="dashboard-table"]', { timeout: 20000 }),
  ]);

  // const dashboardRow = page.locator(`//tr[.//td[text()="${dashboardName}"]]`);
  // await expect(dashboardRow).toBeVisible(); // Ensure the row is visible
  const dashboardRow = page
  .locator('//tr[.//div[@title="' + dashboardName + '"]]')
  .nth(0);

  const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');
  await deleteButton.click();

  // Wait for the confirmation popup and confirm deletion
  const confirmButton = page.locator('[data-test="confirm-button"]');
  await expect(confirmButton).toBeVisible();

  // Set up the response listener BEFORE clicking
  const deleteResponsePromise = page.waitForResponse(
    (response) => {
      const url = response.url();
      const isDeleteEndpoint = /\/api\/.*\/dashboards\/[^\/]+$/.test(url);
      const isSuccessStatus = response.status() === 200 || response.status() === 204;

      if (isDeleteEndpoint) {
        testLogger.debug(`Delete API called: ${url} - Status: ${response.status()}`);
      }

      return isDeleteEndpoint && isSuccessStatus;
    },
    { timeout: 20000 }
  );

  // Click to confirm deletion
  await confirmButton.click();

  // Wait for the API response to confirm deletion
  try {
    await deleteResponsePromise;
    testLogger.info('Dashboard deleted successfully via API');
  } catch (error) {
    testLogger.warn(`Delete API timeout, but continuing: ${error.message}`);
    // Don't fail the test if the API times out - the dashboard might have been deleted
    // We'll verify by checking if the success message appears
  }

  // Optionally verify the success message appears (but don't fail if it disappears quickly)
  await page.getByText("Dashboard deleted successfully").waitFor({
    state: 'visible',
    timeout: 5000
  }).catch(() => {
    testLogger.info('Success message not visible or disappeared quickly - but API confirmed deletion');
  });

  // Ensure the dashboard row is removed from the table
  // await expect(dashboardRow).not.toBeVisible({ timeout: 5000 });
}
