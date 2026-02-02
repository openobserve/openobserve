/**
 * Panel Time Testing Helper Utilities
 * Provides common methods for panel time API monitoring, assertions, and state validation
 */

import testLogger from './test-logger.js';

/**
 * Monitor panel data API calls (query endpoint)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {number} options.expectedCount - Expected number of API calls (default: 1)
 * @param {number} options.timeout - Timeout in milliseconds (default: 15000)
 * @param {string} options.panelId - Optional panel ID to filter specific panel calls
 * @returns {Promise<Object>} - {success, actualCount, calls, timedOut}
 */
export async function monitorPanelDataAPICalls(page, options = {}) {
  const { expectedCount = 1, timeout = 15000, panelId = null } = options;
  const startTime = Date.now();
  const apiCalls = [];

  return new Promise((resolve) => {
    const responseHandler = async (response) => {
      const url = response.url();

      // Match query endpoints that panels use to fetch data
      if (url.includes('/query') || url.includes('/_search')) {
        try {
          const status = response.status();
          const callInfo = {
            url,
            status,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
            panelId: panelId || 'unknown',
          };

          apiCalls.push(callInfo);

          testLogger.info(`Panel data API call ${apiCalls.length}/${expectedCount}: ${status}`);

          if (apiCalls.length >= expectedCount) {
            page.off('response', responseHandler);
            resolve({
              success: true,
              actualCount: apiCalls.length,
              calls: apiCalls,
              timedOut: false,
              totalDuration: Date.now() - startTime
            });
          }
        } catch (error) {
          testLogger.debug(`Error reading response: ${error.message}`);
        }
      }
    };

    page.on('response', responseHandler);

    setTimeout(() => {
      page.off('response', responseHandler);
      testLogger.warn(`Panel data API monitoring timed out: ${apiCalls.length}/${expectedCount} calls completed`);
      resolve({
        success: apiCalls.length >= expectedCount,
        actualCount: apiCalls.length,
        calls: apiCalls,
        timedOut: true,
        totalDuration: timeout
      });
    }, timeout);
  });
}

/**
 * Assert that API calls were triggered successfully
 * @param {Object} result - Result from monitorPanelDataAPICalls
 * @param {Object} expectations - Expected values
 */
export function assertPanelDataAPITriggered(result, expectations = {}) {
  const {
    success = true,
    minCalls = 1,
    maxDuration = 10000
  } = expectations;

  if (success) {
    if (!result.success) {
      throw new Error(`Expected API calls to succeed, but got ${result.actualCount} calls`);
    }
    if (result.actualCount < minCalls) {
      throw new Error(`Expected at least ${minCalls} API calls, got ${result.actualCount}`);
    }
  }

  if (maxDuration && result.totalDuration > maxDuration) {
    testLogger.warn(`API calls took ${result.totalDuration}ms, expected max ${maxDuration}ms`);
  }
}

/**
 * Wait for URL to contain specific panel time parameter
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {string} expectedValue - Expected time value (e.g., "1h", "7d")
 * @param {number} timeout - Timeout in milliseconds
 */
export async function waitForPanelTimeInURL(page, panelId, expectedValue, timeout = 5000) {
  const startTime = Date.now();
  const expectedParam = `panel-time-${panelId}=${expectedValue}`;

  while (Date.now() - startTime < timeout) {
    const url = page.url();
    if (url.includes(expectedParam)) {
      return true;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`URL did not contain ${expectedParam} within ${timeout}ms. Current URL: ${page.url()}`);
}

/**
 * Wait for panel time parameter to be removed from URL
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {number} timeout - Timeout in milliseconds
 */
export async function waitForPanelTimeRemovedFromURL(page, panelId, timeout = 5000) {
  const startTime = Date.now();
  const paramPrefix = `panel-time-${panelId}`;

  while (Date.now() - startTime < timeout) {
    const url = page.url();
    if (!url.includes(paramPrefix)) {
      return true;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`URL still contains ${paramPrefix} after ${timeout}ms. Current URL: ${page.url()}`);
}

/**
 * Get panel time value from URL
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @returns {Object|null} - {type: 'relative'|'absolute', value: string, from: number, to: number}
 */
export function getPanelTimeFromURL(page, panelId) {
  const url = new URL(page.url());
  const relativeParam = url.searchParams.get(`panel-time-${panelId}`);
  const fromParam = url.searchParams.get(`panel-time-${panelId}-from`);
  const toParam = url.searchParams.get(`panel-time-${panelId}-to`);

  if (relativeParam) {
    return {
      type: 'relative',
      value: relativeParam
    };
  }

  if (fromParam && toParam) {
    return {
      type: 'absolute',
      from: parseInt(fromParam),
      to: parseInt(toParam)
    };
  }

  return null;
}

/**
 * Verify that panel data has NOT refreshed (no API calls made)
 * This is used to verify that data doesn't refresh before Apply is clicked
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} waitTime - Time to wait in milliseconds (default: 2000)
 * @returns {Promise<boolean>} - true if no API calls detected
 */
export async function verifyNoDataRefresh(page, waitTime = 2000) {
  let apiCallDetected = false;

  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('/query') || url.includes('/_search')) {
      apiCallDetected = true;
    }
  };

  page.on('response', responseHandler);

  await new Promise(resolve => setTimeout(resolve, waitTime));

  page.off('response', responseHandler);

  if (apiCallDetected) {
    throw new Error('Unexpected API call detected - panel should not refresh yet');
  }

  return true;
}

/**
 * Wait for panel to start loading (loading indicator appears)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {number} timeout - Timeout in milliseconds
 */
export async function waitForPanelLoadStart(page, panelId, timeout = 5000) {
  const loadingSelector = `[data-test="panel-${panelId}-loading"]`;
  try {
    await page.waitForSelector(loadingSelector, { state: "visible", timeout });
    return true;
  } catch (error) {
    testLogger.debug(`Panel ${panelId} loading indicator did not appear within ${timeout}ms`);
    return false;
  }
}

/**
 * Create a dashboard with panel time configuration for testing
 * @param {Object} pm - PageManager instance
 * @param {Object} config - Configuration object
 * @param {string} config.dashboardName - Dashboard name
 * @param {string} config.panelName - Panel name
 * @param {boolean} config.allowPanelTime - Enable panel time
 * @param {string} config.panelTimeMode - "global" or "individual"
 * @param {string} config.panelTimeRange - Time range (e.g., "1-h")
 */
export async function createDashboardWithPanelTime(pm, config) {
  const {
    dashboardName,
    panelName = 'Test Panel',
    allowPanelTime = true,
    panelTimeMode = 'individual',
    panelTimeRange = '1-h'
  } = config;

  const page = pm.page;

  // Create dashboard
  await pm.dashboardList.menuItem("dashboards-item");
  await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);

  // Wait for add panel button
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible", timeout: 10000 });
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();

  // Wait for AddPanel view
  await page.locator('[data-test="dashboard-panel-name"]').waitFor({ state: "visible", timeout: 10000 });

  // Configure panel basics
  await page.locator('[data-test="dashboard-panel-name"]').fill(panelName);

  // Enable panel time if requested
  if (allowPanelTime) {
    await pm.dashboardPanelTime.enablePanelTime();

    if (panelTimeMode === 'individual') {
      await pm.dashboardPanelTime.selectIndividualTimeMode();
      await pm.dashboardPanelTime.setPanelTimeRelative(panelTimeRange);
    } else {
      await pm.dashboardPanelTime.selectGlobalTimeMode();
    }
  }

  // Add a basic query (required for panel to be valid)
  await page.locator('[data-test="dashboard-panel-query-editor"]').click();
  await page.locator('[data-test="dashboard-panel-query-editor"]').fill('SELECT * FROM logs');

  // Save panel
  await page.locator('[data-test="dashboard-panel-save"]').click();
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  return dashboardName;
}

/**
 * Get the panel ID from a panel element
 * @param {import('@playwright/test').Page} page - Playwright page object
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

  // Extract panel ID from data-test attribute (format: "dashboard-panel-{id}")
  const match = dataTest.match(/dashboard-panel-(.+)/);
  if (match) {
    return match[1];
  }

  throw new Error('Could not extract panel ID from panel element');
}

/**
 * Parse time range display text to standard format
 * @param {string} displayText - Display text from time picker (e.g., "Last 1 hour", "Last 7 days")
 * @returns {string} - Standard format (e.g., "1h", "7d")
 */
export function parseTimeDisplayText(displayText) {
  const text = displayText.toLowerCase().trim();

  const patterns = [
    { regex: /(\d+)\s*minute?s?/, unit: 'm' },
    { regex: /(\d+)\s*hour?s?/, unit: 'h' },
    { regex: /(\d+)\s*day?s?/, unit: 'd' },
    { regex: /(\d+)\s*week?s?/, unit: 'w' },
    { regex: /(\d+)\s*month?s?/, unit: 'M' },
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      return `${match[1]}${pattern.unit}`;
    }
  }

  return text;
}

/**
 * Verify URL has NOT updated (no changes to URL)
 * This captures the URL before an action and verifies it hasn't changed
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} originalURL - The original URL to compare against
 */
export function verifyURLUnchanged(page, originalURL) {
  const currentURL = page.url();
  if (currentURL !== originalURL) {
    throw new Error(`URL changed unexpectedly. Expected: ${originalURL}, Got: ${currentURL}`);
  }
}

/**
 * Wait for network idle with custom timeout
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} timeout - Timeout in milliseconds
 */
export async function waitForNetworkIdle(page, timeout = 3000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    testLogger.debug('Network did not become idle within timeout');
  });
}
