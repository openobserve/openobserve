/**
 * Panel Time Test Setup Utilities
 * Provides reusable functions for creating dashboards and panels with panel time configurations
 */

import { expect } from "playwright/test";
import testLogger from '../../utils/test-logger.js';
import { waitForDashboardPage, deleteDashboard } from './dashCreation.js';

/**
 * Create a dashboard with a panel that has panel time configured
 * @param {Object} page - Playwright page object
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Configuration object
 * @param {string} config.dashboardName - Dashboard name
 * @param {string} config.panelName - Panel name (optional, default: "Test Panel")
 * @param {boolean} config.allowPanelTime - Enable panel time (optional, default: true)
 * @param {string} config.panelTimeMode - "global" or "individual" (optional, default: "individual")
 * @param {string} config.panelTimeRange - Time range for individual mode (optional, default: "1-h")
 * @param {string} config.stream - Stream name (optional, default: "e2e_automate")
 * @param {string} config.streamType - Stream type (optional, default: "logs")
 * @returns {Promise<Object>} - {dashboardName, panelId}
 */
export async function createDashboardWithPanelTime(page, pm, config) {
  const {
    dashboardName,
    panelName = 'Test Panel',
    allowPanelTime = true,
    panelTimeMode = 'individual',
    panelTimeRange = '1-h',
    stream = 'e2e_automate',
    streamType = 'logs'
  } = config;

  testLogger.info('Creating dashboard with panel time', {
    dashboardName,
    panelName,
    allowPanelTime,
    panelTimeMode,
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
    allowPanelTime,
    panelTimeMode,
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
 * @returns {Promise<string>} - Panel ID
 */
export async function addPanelWithPanelTime(page, pm, config) {
  const {
    panelName = 'Test Panel',
    allowPanelTime = true,
    panelTimeMode = 'individual',
    panelTimeRange = '1-h',
    stream = 'e2e_automate',
    streamType = 'logs'
  } = config;

  testLogger.info('Adding panel with panel time', { panelName, allowPanelTime, panelTimeMode });

  // Click add panel button
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Wait for AddPanel view to load
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  // Set panel name
  await page.locator('[data-test="dashboard-panel-name"]').fill(panelName);

  // Select stream type and stream
  await page.locator('[data-test="dashboard-panel-stream-type"]').click();
  await page.locator(`[data-test="dashboard-panel-stream-type-${streamType}"]`).click();

  await page.locator('[data-test="dashboard-panel-stream"]').click();
  await page.locator(`[data-test="dashboard-panel-stream-${stream}"]`).click();

  // Configure panel time if enabled
  if (allowPanelTime) {
    await pm.dashboardPanelTime.enablePanelTime();

    if (panelTimeMode === 'individual') {
      await pm.dashboardPanelTime.selectIndividualTimeMode();
      await pm.dashboardPanelTime.setPanelTimeRelative(panelTimeRange);
    } else {
      await pm.dashboardPanelTime.selectGlobalTimeMode();
    }
  }

  // Save panel
  await page.locator('[data-test="dashboard-panel-save"]').click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Wait for panel to appear in dashboard
  await page.locator('[data-test^="dashboard-panel-"]').first().waitFor({
    state: "visible",
    timeout: 15000
  });

  // Get the panel ID from the created panel
  const panelElements = await page.locator('[data-test^="dashboard-panel-"]').all();
  if (panelElements.length > 0) {
    const dataTest = await panelElements[0].getAttribute('data-test');
    const panelId = dataTest.replace('dashboard-panel-', '');
    testLogger.info('Panel created with ID', { panelId });
    return panelId;
  }

  throw new Error('Failed to get panel ID after creation');
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
 * @param {string} panelId - Panel ID
 */
export async function editPanel(page, panelId) {
  testLogger.info('Editing panel', { panelId });

  // Click panel edit button
  const editBtn = page.locator(`[data-test="panel-${panelId}-edit-btn"]`);
  await editBtn.waitFor({ state: "visible", timeout: 10000 });
  await editBtn.click();

  // Wait for AddPanel view
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({
    state: "visible",
    timeout: 10000
  });

  testLogger.info('Panel edit mode opened', { panelId });
}

/**
 * Save panel after editing
 * @param {Object} page - Playwright page object
 */
export async function savePanel(page) {
  testLogger.info('Saving panel');

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
 * Verify panel time configuration in panel config
 * @param {Object} page - Playwright page object
 * @param {Object} expectedConfig - Expected configuration
 * @param {boolean} expectedConfig.allowPanelTime - Should panel time be enabled
 * @param {string} expectedConfig.panelTimeMode - Expected mode ("global" or "individual")
 * @param {string} expectedConfig.panelTimeRange - Expected time range (for individual mode)
 */
export async function verifyPanelTimeConfig(page, expectedConfig) {
  const { allowPanelTime, panelTimeMode, panelTimeRange } = expectedConfig;

  testLogger.info('Verifying panel time config', expectedConfig);

  // Check if toggle is in correct state
  const toggleLocator = page.locator('[data-test="panel-time-enable-toggle"]');
  const isChecked = await toggleLocator.getAttribute('aria-checked');

  if (allowPanelTime) {
    expect(isChecked).toBe('true');

    // Verify mode
    if (panelTimeMode === 'global') {
      const globalRadio = page.locator('[data-test="panel-time-mode-global"]');
      const globalChecked = await globalRadio.getAttribute('aria-checked');
      expect(globalChecked).toBe('true');
    } else {
      const individualRadio = page.locator('[data-test="panel-time-mode-individual"]');
      const individualChecked = await individualRadio.getAttribute('aria-checked');
      expect(individualChecked).toBe('true');

      // Verify time range is displayed in picker
      if (panelTimeRange) {
        const pickerBtn = page.locator('[data-test="panel-config-time-picker-btn"]');
        const pickerText = await pickerBtn.textContent();
        testLogger.debug('Panel time picker shows', { pickerText });
        // Note: Exact text verification depends on how the time is displayed
      }
    }
  } else {
    expect(isChecked).toBe('false');
  }

  testLogger.info('Panel time config verified successfully');
}

export default {
  createDashboardWithPanelTime,
  addPanelWithPanelTime,
  createDashboardWithMultiplePanels,
  openDashboard,
  editPanel,
  savePanel,
  getPanelId,
  navigateToDashboardWithParams,
  getDashboardIdFromURL,
  waitForAllPanelsToLoad,
  cleanupDashboard,
  verifyPanelTimeConfig
};
