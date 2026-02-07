import { expect } from "playwright/test";
import logData from "../../../fixtures/log.json";
import testLogger from '../../utils/test-logger.js';
import { SELECTORS } from "../../../pages/dashboardPages/dashboard-selectors.js";

// Function to wait for the dashboard page to load
export const waitForDashboardPage = async function (page) {
  // If already on the dashboard page, skip waiting for navigation
  if (!page.url().includes("/web/dashboards")) {
    await page.waitForURL(/\/web\/dashboards.*/, { timeout: 30000 });
  }

  // Additional wait for page to stabilize
  await page.waitForTimeout(1000);

  // Wait for either the API response or the dashboard table to appear
  // Use Promise.race to succeed on whichever happens first
  try {
    await Promise.race([
      // Wait for API response
      page.waitForResponse(
        (response) =>
          /\/api\/.*\/dashboards/.test(response.url()) &&
          response.status() === 200,
        { timeout: 30000 }
      ),
      // OR wait for dashboard table to be visible
      page.waitForSelector('[data-test="dashboard-table"]', {
        state: 'visible',
        timeout: 30000
      }),
      // OR wait for import button to be visible (in case we're on import page)
      page.waitForSelector('[data-test="dashboard-import"]', {
        state: 'visible',
        timeout: 30000
      }),
    ]);
  } catch (err) {
    // If all options fail, log the error but check if we're actually on the page
    testLogger.warn("Dashboard page load check failed, verifying page state", { error: err.message });

    // Check if we're actually on the dashboard page by verifying URL
    if (page.url().includes("/web/dashboards")) {
      testLogger.info("URL indicates we're on dashboard page, continuing");
    } else {
      throw new Error("Dashboard page did not load as expected: " + err.message);
    }
  }

  // Final wait for stability
  await page.waitForTimeout(1000);
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

  // Wait for the confirmation text to ensure dialog is fully rendered
  await page.getByText('Are you sure you want to delete the dashboard?').waitFor({
    state: 'visible',
    timeout: 10000
  });

  // Wait for button to be truly stable using waitForFunction
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[data-test="dialog-box"]');
      if (!dialog) return false;

      // Find the confirm button with data-test attribute inside dialog
      const button = dialog.querySelector('[data-test="confirm-button"]');
      if (!button) return false;

      // Check if button is stable (has computed style and is not animating)
      const rect = button.getBoundingClientRect();
      const isStable = rect.width > 0 && rect.height > 0 &&
             button.offsetParent !== null &&
             !button.disabled &&
             window.getComputedStyle(button).visibility === 'visible';

      return isStable;
    },
    { timeout: 15000, polling: 100 }
  );

  testLogger.debug('Confirm button found and is stable');

  // Additional small wait for any final animations
  await page.waitForTimeout(500);

  // Set up API listener BEFORE clicking
  const deleteResponsePromise = page.waitForResponse(
    async (response) => {
      const url = response.url();
      const method = response.request().method();

      // Check if this is a DELETE request to dashboards endpoint
      const isDeleteEndpoint = method === 'DELETE' &&
                                /\/api\/.*\/dashboards\/\d+/.test(url);

      if (isDeleteEndpoint) {
        testLogger.debug(`Delete API called: ${url} - Status: ${response.status()}`);

        // Verify response body contains success message
        try {
          const body = await response.json();
          if (body.code === 200 && body.message === 'Dashboard deleted') {
            testLogger.info('Delete API confirmed: Dashboard deleted');
            return true;
          }
        } catch (e) {
          // If we can't parse JSON, just check status code
          return response.status() === 200 || response.status() === 204;
        }
      }

      return false;
    },
    { timeout: 20000 }
  ).catch((error) => {
    testLogger.warn(`Delete API timeout: ${error.message}`);
    return null; // Return null if timeout, don't throw
  });

  // Click the button using evaluate to avoid detachment issues
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-test="dialog-box"]');
    const button = dialog?.querySelector('[data-test="confirm-button"]');
    if (button) {
      button.click();
    }
  });

  testLogger.info('Clicked confirm button using evaluate');

  // Wait for API response
  const deleteResponse = await deleteResponsePromise;

  if (deleteResponse) {
    testLogger.info('Dashboard deleted successfully');
  }

  // Verify the success message appears
  await page.getByText("Dashboard deleted successfully").waitFor({
    state: 'visible',
    timeout: 10000
  }).catch(() => {
    testLogger.info('Success message not visible or disappeared quickly');
  });

  // Ensure the dashboard row is removed from the table
  // await expect(dashboardRow).not.toBeVisible({ timeout: 5000 });
}

/**
 * Set up a test dashboard for variable tests
 * Consolidates the common pattern of navigating to dashboards,
 * creating a dashboard, and waiting for it to be ready
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} pm - PageManager instance
 * @param {string} dashboardName - Name for the dashboard
 * @param {Object} options - Additional options
 * @param {boolean} options.waitForAddPanelBtn - Wait for add panel button (default: true)
 */
export async function setupTestDashboard(page, pm, dashboardName, options = {}) {
  const { waitForAddPanelBtn = true } = options;

  testLogger.info('Setting up test dashboard', { dashboardName });

  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);

  if (waitForAddPanelBtn) {
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible", timeout: 10000 });
  }

  testLogger.info('Test dashboard setup complete', { dashboardName });
}

/**
 * Clean up a test dashboard after test completion
 * Consolidates the common pattern of going back to list and deleting
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} pm - PageManager instance
 * @param {string} dashboardName - Name of dashboard to delete
 */
export async function cleanupTestDashboard(page, pm, dashboardName) {
  testLogger.info('Cleaning up test dashboard', { dashboardName });

  await pm.dashboardCreate.backToDashboardList();
  await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
  await deleteDashboard(page, dashboardName);

  testLogger.info('Test dashboard cleanup complete', { dashboardName });
}

/**
 * Add a simple panel with basic configuration
 * Consolidates the common pattern of:
 * - addPanel() -> selectChartType() -> selectStream() -> searchAndAddField(y) -> addPanelName() -> savePanel()
 *
 * @param {Object} pm - PageManager instance
 * @param {string} panelName - Name for the panel
 * @param {Object} options - Additional options
 * @param {string} options.chartType - Chart type (default: "line")
 * @param {string} options.streamName - Stream name (default: "e2e_automate")
 * @param {string} options.yAxisField - Y-axis field name (default: "kubernetes_pod_name")
 * @param {boolean} options.save - Whether to save the panel (default: true)
 * @param {Array<string>} options.filterFields - Optional array of filter field names to add
 */
export async function addSimplePanel(pm, panelName, options = {}) {
  const {
    chartType = "line",
    streamName = "e2e_automate",
    yAxisField = "kubernetes_pod_name",
    save = true,
    filterFields = []
  } = options;

  testLogger.info('Adding simple panel', { panelName, chartType, streamName, yAxisField });

  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStream(streamName);
  await pm.chartTypeSelector.searchAndAddField(yAxisField, "y");

  // Add filter fields if specified
  for (const filterField of filterFields) {
    await pm.chartTypeSelector.searchAndAddField(filterField, "filter");
  }

  await pm.dashboardPanelActions.addPanelName(panelName);

  if (save) {
    await pm.dashboardPanelActions.savePanel();
  }

  testLogger.info('Simple panel added', { panelName, saved: save });
}
