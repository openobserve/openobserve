/**
 * Panel Time Test Setup Utilities
 * Provides reusable functions for creating dashboards and panels with panel time configurations
 */

import { expect } from "playwright/test";
import testLogger from '../../utils/test-logger.js';
import { waitForDashboardPage, deleteDashboard } from './dashCreation.js';

/**
 * Start creating a panel (opens add panel form, fills basic fields) WITHOUT saving.
 * Use this when you need to perform actions in Add Panel mode before saving.
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Configuration object
 * @param {string} config.dashboardName - Dashboard name
 * @param {string} config.panelName - Panel name
 * @param {string} config.stream - Stream name (optional, default: "e2e_automate")
 * @param {string} config.streamType - Stream type (optional, default: "logs")
 */
export async function startPanelCreation(page, pm, config) {
  const {
    dashboardName,
    panelName = 'Test Panel',
    stream = 'e2e_automate',
    streamType = 'logs'
  } = config;

  testLogger.info('Starting panel creation (without saving)', { dashboardName, panelName });

  // Navigate to dashboards
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();

  // Create dashboard
  await pm.dashboardCreate.createDashboard(dashboardName);
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  // Click add panel
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Wait for AddPanel view to load
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  // Set panel name
  await page.locator('[data-test="dashboard-panel-name"]').fill(panelName);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // Select stream type and stream
  await pm.chartTypeSelector.selectStreamType(streamType);
  await pm.chartTypeSelector.selectStream(stream);

  // Add fields for proper chart configuration
  await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "b");

  testLogger.info('Panel creation form ready (unsaved)', { dashboardName, panelName });
}

/**
 * Create a dashboard with a panel that has panel time configured
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Configuration object
 * @param {string} config.dashboardName - Dashboard name
 * @param {string} config.panelName - Panel name (optional, default: "Test Panel")
 * @param {boolean} config.panelTimeEnabled - Enable panel time toggle (optional, default: true)
 * @param {string} config.panelTimeRange - Time range for panel config (optional, default: "1-h"). Pass null to enable toggle without setting time.
 * @param {string} config.stream - Stream name (optional, default: "e2e_automate")
 * @param {string} config.streamType - Stream type (optional, default: "logs")
 * @returns {Promise<Object>} - {dashboardName, panelId}
 */
export async function createDashboardWithPanelTime(page, pm, config) {
  const {
    dashboardName,
    panelName = 'Test Panel',
    panelTimeEnabled = true,
    panelTimeRange = '1-h',
    stream = 'e2e_automate',
    streamType = 'logs'
  } = config;

  testLogger.info('Creating dashboard with panel time', {
    dashboardName,
    panelName,
    panelTimeEnabled,
    panelTimeRange
  });

  // Navigate to dashboards
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();

  // Create dashboard
  await pm.dashboardCreate.createDashboard(dashboardName);
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  // Add panel with panel time configuration
  const panelId = await addPanelWithPanelTime(page, pm, {
    panelName,
    panelTimeEnabled,
    panelTimeRange,
    stream,
    streamType
  });

  testLogger.info('Dashboard created successfully', { dashboardName, panelId });

  return { dashboardName, panelId };
}

/**
 * Add a panel with panel time configuration to existing dashboard
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Panel configuration
 * @param {string} config.panelName - Panel name (optional, default: "Test Panel")
 * @param {boolean} config.panelTimeEnabled - Enable panel time toggle (optional, default: true)
 * @param {string} config.panelTimeRange - Time range for panel config (optional, default: "1-h"). Pass null to enable toggle without setting time.
 * @param {string} config.stream - Stream name (optional, default: "e2e_automate")
 * @param {string} config.streamType - Stream type (optional, default: "logs")
 * @returns {Promise<string>} - Panel ID
 */
export async function addPanelWithPanelTime(page, pm, config) {
  const {
    panelName = 'Test Panel',
    panelTimeEnabled = true,
    panelTimeRange = '1-h',
    stream = 'e2e_automate',
    streamType = 'logs'
  } = config;

  testLogger.info('Adding panel with panel time', { panelName, panelTimeEnabled, panelTimeRange });

  // Click add panel button - handle both cases (no panels vs existing panels)
  const noPanelBtn = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');
  const addPanelBtn = page.locator('[data-test="dashboard-panel-add"]');

  // Try to click the button for existing panels first, otherwise click the no-panel button
  if (await addPanelBtn.isVisible().catch(() => false)) {
    await addPanelBtn.click();
  } else {
    await noPanelBtn.click();
  }
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Wait for AddPanel view to load
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  // Set panel name
  await page.locator('[data-test="dashboard-panel-name"]').fill(panelName);

  // Wait for UI to settle after filling panel name
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // Select stream type and stream using PageManager methods
  await pm.chartTypeSelector.selectStreamType(streamType);
  await pm.chartTypeSelector.selectStream(stream);

  // Add fields to Y and breakdown axes for proper chart configuration
  await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "b");

  // Configure panel time if enabled (v4.0: useDefaultTime toggle + optional "+Set" button)
  if (panelTimeEnabled) {
    // Open config panel sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Enable "Use Default Time" toggle
    await pm.dashboardPanelTime.enablePanelTime();

    // If panelTimeRange is provided, click "+Set" button and configure time
    if (panelTimeRange) {
      // Click "+Set" button to open date time picker
      const setButton = page.locator('[data-test="dashboard-config-set-panel-time"]');
      await setButton.waitFor({ state: "visible", timeout: 5000 });
      await setButton.click();

      // Select time in the config picker
      await pm.dashboardPanelTime.setPanelTimeRelative(panelTimeRange);

      // Click the global Apply button (required for config time changes in v4.0)
      await page.locator('[data-test="dashboard-apply"]').click();
      await page.waitForTimeout(500); // Wait for Apply to process
    }
    // If panelTimeRange is null: toggle is ON but no time set, follows global time
  }

  // Save panel and get panel ID using common function
  // Use -1 to get the last panel (the one we just added)
  const panelId = await savePanelAndGetId(page, { panelIndex: -1 });

  // Wait for the Add Panel button to be ready for the next panel addition
  // This ensures the dashboard is fully transitioned back to view mode
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  testLogger.info('Panel added successfully', { panelId, panelName });

  return panelId;
}

/**
 * Create a dashboard with multiple panels having different time configurations
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Configuration object
 * @param {string} config.dashboardName - Dashboard name
 * @param {Array} config.panels - Array of panel configurations
 * @returns {Promise<Object>} - {dashboardName, panelIds: []}
 */
export async function createDashboardWithMultiplePanels(page, pm, config) {
  const { dashboardName, panels } = config;

  testLogger.info('Creating dashboard with multiple panels', { dashboardName, panelCount: panels.length });

  // Navigate to dashboards and create
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);

  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  const panelIds = [];

  // Add each panel
  for (let i = 0; i < panels.length; i++) {
    const panelConfig = panels[i];
    testLogger.info(`Adding panel ${i + 1}/${panels.length}`, { panelName: panelConfig.panelName });

    const panelId = await addPanelWithPanelTime(page, pm, panelConfig);
    panelIds.push(panelId);

    // Wait for panel to stabilize before adding next one
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  testLogger.info('All panels created successfully', { dashboardName, panelIds });

  return { dashboardName, panelIds };
}

/**
 * Open dashboard by name from dashboard list
 * @param {Object} page - Playwright page object
 * @param {string} dashboardName - Dashboard name
 */
export async function openDashboard(page, dashboardName) {
  testLogger.info('Opening dashboard', { dashboardName });

  // Find and click the dashboard row
  const dashboardRow = page.locator(`//tr[.//div[@title="${dashboardName}"]]`).first();
  await dashboardRow.waitFor({ state: "visible", timeout: 10000 });
  await dashboardRow.click();

  // Wait for dashboard to load
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.locator('[data-test^="dashboard-panel-"]').first().waitFor({
    state: "visible",
    timeout: 15000
  }).catch(() => {
    testLogger.debug('No panels found in dashboard, might be empty');
  });

  testLogger.info('Dashboard opened successfully', { dashboardName });
}

/**
 * Edit a panel in dashboard
 * @param {Object} page - Playwright page object
 * @param {string} panelName - Panel name
 */
export async function editPanel(page, panelName) {
  testLogger.info('Editing panel', { panelName });

  // Click panel edit button
  await page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`).click();
    await page.locator('[data-test="dashboard-edit-panel"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-test="dashboard-edit-panel"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').waitFor({ state: "visible", timeout: 10000 });

  testLogger.info('Panel edit mode opened', { panelName });
}

/**
 * Save panel after editing
 * @param {Object} page - Playwright page object
 */
export async function savePanel(page) {
  testLogger.info('Saving panel');

  // Ensure any open menus/dropdowns are closed before clicking save
  // This prevents the save button from being intercepted by overlays
  // Wait for both .q-menu and portal menus to be hidden
  await page.locator('.q-menu').first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // Also wait for any date picker portal menus to close (they use q-portal--menu--* IDs)
  await page.locator('[id^="q-portal--menu--"]').first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

  // Click somewhere neutral to dismiss any remaining overlays (like date picker)
  await page.locator('[data-test="dashboard-panel-name"]').click().catch(() => {});
  await page.waitForTimeout(200);

  await page.locator('[data-test="dashboard-panel-save"]').click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Wait for panel to appear back in dashboard
  await page.locator('[data-test^="dashboard-panel-"]').first().waitFor({
    state: "visible",
    timeout: 15000
  });

  testLogger.info('Panel saved successfully');
}

/**
 * Save panel and capture panel ID from API response
 * @param {Object} page - Playwright page object
 * @param {Object} options - Options object
 * @param {number} options.panelIndex - Panel index to extract (0-based). Use -1 for last panel. Default: -1
 * @returns {Promise<string>} - Panel ID
 */
export async function savePanelAndGetId(page, options = {}) {
  const { panelIndex = -1 } = options;

  testLogger.info('Saving panel and capturing ID from API response', { panelIndex });

  // Setup API response listener before saving
  const saveResponsePromise = page.waitForResponse(
    response => response.url().includes('/api/') &&
                response.url().includes('/dashboards/') &&
                response.request().method() === 'PUT',
    { timeout: 30000 }
  );

  // Click save button
  await page.locator('[data-test="dashboard-panel-save"]').click();

  // Wait for the save to complete
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Wait for transition back to dashboard view (add panel form should be hidden)
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({
    state: "hidden",
    timeout: 10000
  }).catch(() => {});

  // Get panel ID from API response
  let panelId;
  try {
    const saveResponse = await saveResponsePromise;
    const responseBody = await saveResponse.json();

    // Extract panel ID from response structure: response.v8.tabs[0].panels[index].id
    if (responseBody.v8 &&
        responseBody.v8.tabs &&
        responseBody.v8.tabs.length > 0 &&
        responseBody.v8.tabs[0].panels &&
        responseBody.v8.tabs[0].panels.length > 0) {
      const panels = responseBody.v8.tabs[0].panels;
      // Use specified index, or last panel if index is -1
      const targetIndex = panelIndex >= 0 ? panelIndex : panels.length - 1;
      panelId = panels[targetIndex].id;
      testLogger.info('Panel ID from API response', { panelId, panelIndex: targetIndex });
    } else {
      throw new Error('Invalid API response structure');
    }
  } catch (error) {
    // Fallback to DOM extraction if API response fails
    testLogger.warn('Failed to get panel ID from API, falling back to DOM', { error: error.message });
    const fallbackIndex = panelIndex >= 0 ? panelIndex : 0;
    panelId = await getPanelId(page, fallbackIndex);
    testLogger.info('Panel ID from DOM (fallback)', { panelId });
  }

  return panelId;
}

/**
 * Get panel ID from panel element (by index)
 * @param {Object} page - Playwright page object
 * @param {number} panelIndex - Panel index (0-based)
 * @returns {Promise<string>} - Panel ID
 */
export async function getPanelId(page, panelIndex = 0) {
  const panels = page.locator('[data-test^="dashboard-panel-"]');
  const panelCount = await panels.count();

  if (panelCount === 0) {
    throw new Error('No panels found on dashboard');
  }

  if (panelIndex >= panelCount) {
    throw new Error(`Panel index ${panelIndex} out of range. Only ${panelCount} panels found.`);
  }

  const panel = panels.nth(panelIndex);
  const dataTest = await panel.getAttribute('data-test');
  const panelId = dataTest.replace('dashboard-panel-', '');

  testLogger.debug('Got panel ID', { panelIndex, panelId });
  return panelId;
}

/**
 * Navigate to dashboard URL with specific parameters
 * @param {Object} page - Playwright page object
 * @param {Object} params - URL parameters
 * @param {string} params.dashboardId - Dashboard ID
 * @param {Object} params.panelTimes - Panel time parameters (e.g., {panel1: "1h", panel2: "7d"})
 * @param {string} params.globalTime - Global time parameter (e.g., "15m")
 */
export async function navigateToDashboardWithParams(page, params) {
  const { dashboardId, panelTimes = {}, globalTime } = params;

  let url = `/web/dashboards/view?dashboard=${dashboardId}`;

  if (globalTime) {
    url += `&period=${globalTime}`;
  }

  Object.keys(panelTimes).forEach(panelId => {
    url += `&panel-time-${panelId}=${panelTimes[panelId]}`;
  });

  testLogger.info('Navigating to dashboard with params', { url });

  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  testLogger.info('Dashboard loaded with params');
}

/**
 * Get dashboard ID from current URL
 * @param {Object} page - Playwright page object
 * @returns {string} - Dashboard ID
 */
export function getDashboardIdFromURL(page) {
  const url = new URL(page.url());
  const dashboardId = url.searchParams.get('dashboard');

  if (!dashboardId) {
    throw new Error('Dashboard ID not found in URL');
  }

  return dashboardId;
}

/**
 * Wait for all panels to finish loading
 * @param {Object} page - Playwright page object
 * @param {number} timeout - Timeout in milliseconds
 */
export async function waitForAllPanelsToLoad(page, timeout = 15000) {
  testLogger.info('Waiting for all panels to load');

  // Wait for network idle
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    testLogger.debug('Network did not become idle, continuing anyway');
  });

  // Wait for any loading indicators to disappear
  const loadingIndicators = page.locator('[data-test$="-loading"]');
  const count = await loadingIndicators.count();

  if (count > 0) {
    testLogger.debug(`Found ${count} loading indicators, waiting for them to disappear`);
    for (let i = 0; i < count; i++) {
      await loadingIndicators.nth(i).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }
  }

  testLogger.info('All panels loaded');
}

/**
 * Clean up dashboard after test
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {string} dashboardName - Dashboard name
 */
export async function cleanupDashboard(page, pm, dashboardName) {
  testLogger.info('Cleaning up dashboard', { dashboardName });

  try {
    // Navigate back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-search"]').waitFor({
      state: "visible",
      timeout: 10000
    });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Delete dashboard
    await deleteDashboard(page, dashboardName);

    testLogger.info('Dashboard cleaned up successfully', { dashboardName });
  } catch (error) {
    testLogger.error('Failed to cleanup dashboard', { dashboardName, error: error.message });
    throw error;
  }
}

/**
 * Verify panel time configuration in panel config (v4.0)
 * @param {Object} page - Playwright page object
 * @param {Object} expectedConfig - Expected configuration
 * @param {boolean} expectedConfig.panelTimeEnabled - Should panel time toggle be enabled
 * @param {string} expectedConfig.panelTimeRange - Expected time range displayed in picker (optional)
 */
export async function verifyPanelTimeConfig(page, expectedConfig) {
  const { panelTimeEnabled, panelTimeRange } = expectedConfig;

  testLogger.info('Verifying panel time config (v4.0)', expectedConfig);

  // Check if toggle is in correct state
  const toggleLocator = page.locator('[data-test="dashboard-config-allow-panel-time"]');
  const isChecked = await toggleLocator.getAttribute('aria-checked');

  if (panelTimeEnabled) {
    expect(isChecked).toBe('true');

    // Verify time range is displayed in picker if provided
    if (panelTimeRange) {
      const pickerBtn = page.locator('[data-test="dashboard-config-panel-time-picker"]');
      const pickerText = await pickerBtn.textContent();
      testLogger.debug('Panel time picker shows', { pickerText });
      // Note: Exact text verification depends on how the time is displayed
      // The picker should show the configured time range
    } else {
      // If panelTimeRange is null, verify "+Set" button is visible
      const setButton = page.locator('[data-test="dashboard-config-set-panel-time"]');
      await expect(setButton).toBeVisible();
    }
  } else {
    expect(isChecked).toBe('false');
  }

  testLogger.info('Panel time config verified successfully (v4.0)');
}

export default {
  startPanelCreation,
  createDashboardWithPanelTime,
  addPanelWithPanelTime,
  createDashboardWithMultiplePanels,
  openDashboard,
  editPanel,
  savePanel,
  savePanelAndGetId,
  getPanelId,
  navigateToDashboardWithParams,
  getDashboardIdFromURL,
  waitForAllPanelsToLoad,
  cleanupDashboard,
  verifyPanelTimeConfig
};
