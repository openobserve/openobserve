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

  await page.locator('[data-test="dashboard-table"]').waitFor({
    state: 'visible',
    timeout: 20000,
  });

  const nameCell = page
    .locator(`[data-test="dashboard-name-cell-${dashboardName}"]`)
    .first();

  // The dashboard list is paginated and is not sorted newest-first. Narrow it
  // to the generated dashboard when its row is not on the current page.
  //
  // Filling the search ONCE and then waiting 15s is not enough: this runs right
  // after returning from the panel editor, so the list is often still loading
  // and re-rendering. A fill landing mid-render is discarded (the input remounts
  // empty), leaving the search unapplied and the row on some other page — the
  // wait then expires against a row that was never going to appear. Re-assert
  // the filter until the row shows up.
  const searchInput = page.locator('[data-test="dashboard-search-field"]').first();
  const findAttempts = 3;
  for (let attempt = 1; attempt <= findAttempts; attempt++) {
    if (await nameCell.isVisible().catch(() => false)) break;

    if (await searchInput.count()) {
      // Re-fill only when the filter did not stick, so a slow-but-applied
      // search is left alone rather than being retyped underneath itself.
      if ((await searchInput.inputValue().catch(() => "")) !== dashboardName) {
        await searchInput.fill(dashboardName).catch(() => {});
      }
    }

    // waitFor() blocks; isVisible({timeout}) does NOT — that option is
    // documented as ignored and the call returns immediately. Polling with
    // isVisible here made all three attempts complete in microseconds, so the
    // loop never actually gave the filtered list time to render and was a
    // no-op versus the single waitFor below.
    const found = await nameCell
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (found) break;
  }

  await nameCell.waitFor({ state: 'visible', timeout: 15000 });

  const deleteButton = nameCell
    .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]')
    .locator('[data-test="dashboard-delete"]');
  await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
  await deleteButton.click();

  // Wait for the confirmation dialog to ensure it is fully rendered
  await page.locator('[data-test="dashboard-confirm-dialog"]').waitFor({
    state: 'visible',
    timeout: 10000
  });

  // Wait for button to be truly stable using waitForFunction
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[data-test="dashboard-confirm-dialog"]');
      if (!dialog) return false;

      // Find the confirm button with data-test attribute inside dialog
      const button = dialog.querySelector('[data-test="o-dialog-primary-btn"]');
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

  // Wait for confirm button to be stable before clicking
  await page.locator('[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]').waitFor({ state: 'visible', timeout: 5000 });

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
    const dialog = document.querySelector('[data-test="dashboard-confirm-dialog"]');
    const button = dialog?.querySelector('[data-test="o-dialog-primary-btn"]');
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

  // Verify the success toast appears
  await page.locator('[data-test-variant="success"]').waitFor({
    state: 'visible',
    timeout: 10000
  }).catch(() => {
    testLogger.info('Success message not visible or disappeared quickly');
  });

  // Ensure the dashboard row is removed from the table
  // await expect(dashboardRow).not.toBeVisible({ timeout: 5000 });
}

/**
 * Reopen a dashboard from the dashboard list
 * Uses the same XPath pattern as deleteDashboard for reliable dashboard selection
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} dashboardName - Name of the dashboard to open
 */
export async function reopenDashboardFromList(page, dashboardName) {
  testLogger.info('Reopening dashboard from list', { dashboardName });

  // Wait for dashboard list to load
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

  const dashboardNameDiv = page.locator(`[data-test="dashboard-name-cell-${dashboardName}"]`).first();
  await dashboardNameDiv.waitFor({ state: 'visible', timeout: 10000 });
  await dashboardNameDiv.click();

  testLogger.debug('Clicked on dashboard name');

  // Wait for dashboard to open
  await page.waitForSelector('[data-test="dashboard-if-no-panel-add-panel-btn"]', {
    state: "visible",
    timeout: 10000
  });

  testLogger.info('Dashboard reopened successfully', { dashboardName });
}

/**
 * A one-line snapshot of what the dashboard view actually rendered, for failure
 * messages. A bare `locator.waitFor` timeout says only "the button never showed",
 * which is the one thing already known — this says what was on screen instead.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function describeDashboardView(page) {
  const state = await page
    .evaluate(() => ({
      url: location.href,
      backBtn: !!document.querySelector('[data-test="dashboard-back-btn"]'),
      // RenderDashboardCharts' own container — absent means the view body never mounted
      chartsContainer: !!document.querySelector(".render-dashboard-charts-container"),
      panelContainers: document.querySelectorAll('[data-test="dashboard-panel-container"]').length,
      tabList: !!document.querySelector('[data-test="dashboard-tab-list"]'),
      // The empty-state illustration renders alongside the add-panel card, but the
      // card itself is gated on `!viewOnly` — art present + button absent narrows
      // the cause to a view-only render rather than a load that never finished.
      emptyStateArt: !!document.querySelector('[data-test="empty-panel-art"]'),
      toast:
        document.querySelector("[data-test-variant]")?.getAttribute("data-test-message") ?? null,
    }))
    .catch((e) => ({ evaluateFailed: e.message }));
  return JSON.stringify(state);
}

/**
 * Wait for a freshly created (empty) dashboard to be ready for `addPanel()`.
 *
 * createDashboard() returns as soon as /dashboards/view is reachable and the
 * header's back button has mounted, but the empty-state add-panel button lives in
 * RenderDashboardCharts (v-if="!panels.length"), which only renders once the
 * dashboard GET and variables init have finished. Under parallel load that lands
 * well after the header.
 *
 * Occasionally that initial load wedges outright and no amount of extra waiting
 * helps — the previous single 30s wait then died with an opaque timeout. Recovery
 * is a re-navigation to the view URL, which re-runs the dashboard GET and variables
 * init; the dashboard already exists by this point, so it is safe and idempotent.
 *
 * The re-navigation deliberately uses the URL captured on entry rather than
 * page.reload(): when that first load fails outright the app bounces back to the
 * dashboards list, and reloading would just reload the list forever. If it still
 * isn't ready, fail with what was actually on screen rather than a bare timeout.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dashboardName - only used for logging
 */
export async function waitForEmptyDashboardReady(page, dashboardName) {
  const addPanelBtn = page.locator(SELECTORS.ADD_PANEL_BTN);
  // createDashboard() has just landed on /dashboards/view, so this is the URL to
  // return to. Capture it now — by the time the wait below expires the app may
  // have navigated away.
  const viewUrl = page.url();

  try {
    await addPanelBtn.waitFor({ state: "visible", timeout: 20000 });
    return;
  } catch {
    testLogger.warn("Empty-state add-panel button did not render, re-opening dashboard view", {
      dashboardName,
      viewUrl,
      state: await describeDashboardView(page),
    });
  }

  if (!/\/dashboards\/view/.test(viewUrl)) {
    throw new Error(
      `setupTestDashboard("${dashboardName}"): expected to be on the dashboard view after ` +
        `createDashboard(), but the URL was ${viewUrl}. Dashboard view state: ${await describeDashboardView(page)}`
    );
  }

  await page.goto(viewUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  try {
    await addPanelBtn.waitFor({ state: "visible", timeout: 30000 });
    testLogger.info("Empty-state add-panel button rendered after re-opening the view", {
      dashboardName,
    });
  } catch {
    throw new Error(
      `setupTestDashboard("${dashboardName}"): the empty-state add-panel button never rendered, ` +
        `even after re-opening ${viewUrl}. Dashboard view state: ${await describeDashboardView(page)}`
    );
  }
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
    await waitForEmptyDashboardReady(page, dashboardName);
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
  // remove the auto-seeded default y-axis before adding this panel's measure
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
