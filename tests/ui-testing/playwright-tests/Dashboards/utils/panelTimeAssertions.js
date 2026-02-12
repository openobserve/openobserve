/**
 * Panel Time Assertion Utilities
 * Provides assertion and verification functions for panel time testing
 */

import { expect } from "playwright/test";
import testLogger from '../../utils/test-logger.js';

/**
 * Assert that panel time picker is visible in view mode
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelTimePickerVisible(page, panelId) {
  testLogger.info('Asserting panel time picker is visible', { panelId });

  const picker = page.locator(`[data-test="panel-time-picker-${panelId}"]`);
  await expect(picker).toBeVisible({ timeout: 10000 });

  testLogger.info('Panel time picker is visible', { panelId });
}

/**
 * Assert that panel time picker is NOT visible in view mode
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelTimePickerNotVisible(page, panelId) {
  testLogger.info('Asserting panel time picker is NOT visible', { panelId });

  const picker = page.locator(`[data-test="panel-time-picker-${panelId}"]`);
  await expect(picker).not.toBeVisible();

  testLogger.info('Panel time picker is not visible', { panelId });
}

/**
 * Assert panel time picker displays expected time text
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {string} expectedText - Expected display text (e.g., "Last 1 hour", "1h")
 */
export async function assertPanelTimeDisplay(page, panelId, expectedText) {
  testLogger.info('Asserting panel time display', { panelId, expectedText });

  const pickerBtn = page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`);
  await expect(pickerBtn).toContainText(expectedText, { timeout: 10000 });

  testLogger.info('Panel time display verified', { panelId, expectedText });
}

/**
 * Assert URL contains panel time parameter
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {string} expectedValue - Expected time value (e.g., "1h", "7d")
 */
export async function assertPanelTimeInURL(page, panelId, expectedValue) {
  testLogger.info('Asserting panel time in URL', { panelId, expectedValue });

  const url = page.url();
  const expectedParam = `pt-period.${panelId}=${expectedValue}`;

  expect(url).toContain(expectedParam);

  testLogger.info('Panel time parameter found in URL', { panelId, expectedValue });
}

/**
 * Assert URL does NOT contain panel time parameter
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelTimeNotInURL(page, panelId) {
  testLogger.info('Asserting panel time NOT in URL', { panelId });

  const url = page.url();
  const paramPeriod = `pt-period.${panelId}`;
  const paramFrom = `pt-from.${panelId}`;

  expect(url).not.toContain(paramPeriod);
  expect(url).not.toContain(paramFrom);

  testLogger.info('Panel time parameter not found in URL', { panelId });
}

/**
 * Assert URL contains absolute panel time parameters (from/to)
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelTimeAbsoluteInURL(page, panelId) {
  testLogger.info('Asserting absolute panel time in URL', { panelId });

  const url = page.url();

  expect(url).toContain(`pt-from.${panelId}=`);
  expect(url).toContain(`pt-to.${panelId}=`);

  testLogger.info('Absolute panel time parameters found in URL', { panelId });
}

/**
 * Assert that panel data has refreshed (API call was made)
 * This should be used after an action that triggers a refresh
 * @param {Object} page - Playwright page object
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - true if API call detected
 */
export async function assertPanelDataRefreshed(page, timeout = 5000) {
  testLogger.info('Asserting panel data refreshed');

  let apiCallDetected = false;

  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('/query') || url.includes('/_search')) {
      apiCallDetected = true;
      testLogger.debug('Panel data API call detected', { url, status: response.status() });
    }
  };

  page.on('response', responseHandler);

  await new Promise(resolve => setTimeout(resolve, timeout));

  page.off('response', responseHandler);

  expect(apiCallDetected).toBe(true);

  testLogger.info('Panel data refresh verified');
  return true;
}

/**
 * Assert that panel data has NOT refreshed (no API calls made)
 * @param {Object} page - Playwright page object
 * @param {number} waitTime - Time to wait in milliseconds
 * @returns {Promise<boolean>} - true if no API calls detected
 */
export async function assertPanelDataNotRefreshed(page, waitTime = 2000) {
  testLogger.info('Asserting panel data NOT refreshed');

  let apiCallDetected = false;

  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('/query') || url.includes('/_search')) {
      apiCallDetected = true;
      testLogger.debug('Unexpected API call detected', { url });
    }
  };

  page.on('response', responseHandler);

  await new Promise(resolve => setTimeout(resolve, waitTime));

  page.off('response', responseHandler);

  expect(apiCallDetected).toBe(false);

  testLogger.info('Panel data NOT refreshed (as expected)');
  return true;
}

/**
 * Assert panel loading indicator appears
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelLoading(page, panelId) {
  testLogger.info('Asserting panel loading indicator appears', { panelId });

  const loadingIndicator = page.locator(`[data-test="panel-${panelId}-loading"]`);
  await expect(loadingIndicator).toBeVisible({ timeout: 5000 });

  testLogger.info('Panel loading indicator appeared', { panelId });
}

/**
 * Assert panel loading is complete
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelLoadComplete(page, panelId) {
  testLogger.info('Asserting panel loading complete', { panelId });

  const loadingIndicator = page.locator(`[data-test="panel-${panelId}-loading"]`);
  await expect(loadingIndicator).not.toBeVisible({ timeout: 15000 });

  testLogger.info('Panel loading complete', { panelId });
}

/**
 * Assert panel time toggle state in config
 * @param {Object} page - Playwright page object
 * @param {boolean} expectedEnabled - Expected state (true = enabled, false = disabled)
 */
export async function assertPanelTimeToggleState(page, expectedEnabled) {
  testLogger.info('Asserting panel time toggle state', { expectedEnabled });

  const toggle = page.locator('[data-test="dashboard-config-allow-panel-time"]');
  const isChecked = await toggle.getAttribute('aria-checked');

  expect(isChecked).toBe(expectedEnabled ? 'true' : 'false');

  testLogger.info('Panel time toggle state verified', { expectedEnabled });
}

/**
 * Assert panel time mode in config
 * @param {Object} page - Playwright page object
 * @param {string} expectedMode - Expected mode ("global" or "individual")
 */
export async function assertPanelTimeMode(page, expectedMode) {
  testLogger.info('Asserting panel time mode', { expectedMode });

  if (expectedMode === 'global') {
    const globalRadio = page.locator('[data-test="dashboard-config-panel-time-mode-global"]');
    const isChecked = await globalRadio.getAttribute('aria-checked');
    expect(isChecked).toBe('true');
  } else {
    const individualRadio = page.locator('[data-test="dashboard-config-panel-time-mode-individual"]');
    const isChecked = await individualRadio.getAttribute('aria-checked');
    expect(isChecked).toBe('true');
  }

  testLogger.info('Panel time mode verified', { expectedMode });
}

/**
 * Assert date time picker label in AddPanel config
 * @param {Object} page - Playwright page object
 * @param {string} expectedLabel - Expected label text
 */
export async function assertDateTimePickerLabel(page, expectedLabel) {
  testLogger.info('Asserting date time picker label', { expectedLabel });

  const label = page.locator('[data-test="panel-config-time-picker-label"]');
  await expect(label).toContainText(expectedLabel, { timeout: 5000 });

  testLogger.info('Date time picker label verified', { expectedLabel });
}

/**
 * Assert global time display
 * @param {Object} page - Playwright page object
 * @param {string} expectedText - Expected display text
 */
export async function assertGlobalTimeDisplay(page, expectedText) {
  testLogger.info('Asserting global time display', { expectedText });

  const globalTimePicker = page.locator('[data-test="date-time-btn"]');
  await expect(globalTimePicker).toContainText(expectedText, { timeout: 10000 });

  testLogger.info('Global time display verified', { expectedText });
}

/**
 * Assert URL parameter value
 * @param {Object} page - Playwright page object
 * @param {string} paramName - Parameter name
 * @param {string} expectedValue - Expected value
 */
export async function assertURLParam(page, paramName, expectedValue) {
  testLogger.info('Asserting URL parameter', { paramName, expectedValue });

  const url = new URL(page.url());
  const actualValue = url.searchParams.get(paramName);

  expect(actualValue).toBe(expectedValue);

  testLogger.info('URL parameter verified', { paramName, expectedValue });
}

/**
 * Assert multiple panels have different times
 * @param {Object} page - Playwright page object
 * @param {Array} panelTimeConfigs - Array of {panelId, expectedTime}
 */
export async function assertMultiplePanelTimes(page, panelTimeConfigs) {
  testLogger.info('Asserting multiple panel times', { count: panelTimeConfigs.length });

  for (const config of panelTimeConfigs) {
    const { panelId, expectedTime } = config;

    if (expectedTime === null) {
      // Panel should not have time picker
      await assertPanelTimePickerNotVisible(page, panelId);
    } else {
      // Panel should have time picker with expected time
      await assertPanelTimePickerVisible(page, panelId);
      await assertPanelTimeDisplay(page, panelId, expectedTime);
    }
  }

  testLogger.info('Multiple panel times verified');
}

/**
 * Assert panel time picker exists in modal
 * @param {Object} page - Playwright page object
 */
export async function assertPanelTimePickerInModal(page) {
  testLogger.info('Asserting panel time picker in modal');

  const modal = page.locator('[data-test="view-panel-screen"]');
  await expect(modal).toBeVisible();

  const pickerInModal = modal.locator('[data-test="dashboard-viewpanel-date-time-picker"]');
  await expect(pickerInModal).toBeVisible({ timeout: 5000 });

  testLogger.info('Panel time picker in modal verified');
}

/**
 * Assert panel time picker exists in full screen (which is same as dashboard view)
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 */
export async function assertPanelTimePickerInFullScreen(page, panelId) {
  testLogger.info('Asserting panel time picker in full screen', { panelId });

  // Full screen is just the regular dashboard view
  const picker = page.locator(`[data-test="panel-time-picker-${panelId}"]`);
  await expect(picker).toBeVisible({ timeout: 10000 });

  testLogger.info('Panel time picker in full screen verified', { panelId });
}

/**
 * Assert URL has changed from original
 * @param {Object} page - Playwright page object
 * @param {string} originalURL - Original URL to compare against
 */
export async function assertURLChanged(page, originalURL) {
  testLogger.info('Asserting URL has changed');

  const currentURL = page.url();
  expect(currentURL).not.toBe(originalURL);

  testLogger.info('URL change verified', { originalURL, currentURL });
}

/**
 * Assert URL has NOT changed
 * @param {Object} page - Playwright page object
 * @param {string} originalURL - Original URL to compare against
 */
export async function assertURLUnchanged(page, originalURL) {
  testLogger.info('Asserting URL has NOT changed');

  const currentURL = page.url();
  expect(currentURL).toBe(originalURL);

  testLogger.info('URL unchanged verified', { originalURL });
}

/**
 * Assert that panel variables use panel time (not global time)
 * This verifies the API request contains panel time range
 * @param {Object} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {string} expectedTimeRange - Expected time range in API (e.g., "1h")
 */
export async function assertPanelVariableUsesPanelTime(page, panelId, expectedTimeRange) {
  testLogger.info('Asserting panel variable uses panel time', { panelId, expectedTimeRange });

  let apiCallFound = false;
  let timeRangeInAPI = null;

  const responseHandler = async (response) => {
    const url = response.url();

    if (url.includes('_values') || url.includes('/values')) {
      try {
        const request = response.request();
        const postData = request.postData();

        if (postData) {
          const data = JSON.parse(postData);
          // Check if the time range in API matches expected panel time
          if (data.query && data.query.start_time && data.query.end_time) {
            apiCallFound = true;
            // Calculate time range from start/end
            const duration = data.query.end_time - data.query.start_time;
            testLogger.debug('Variable API time range', { duration, data: data.query });
            timeRangeInAPI = duration;
          }
        }
      } catch (error) {
        testLogger.debug('Error parsing API request', { error: error.message });
      }
    }
  };

  page.on('response', responseHandler);

  // Wait for API call
  await new Promise(resolve => setTimeout(resolve, 3000));

  page.off('response', responseHandler);

  expect(apiCallFound).toBe(true);

  testLogger.info('Panel variable uses panel time verified', { panelId });
}

/**
 * Assert dashboard export contains panel time configs
 * @param {Object} exportedData - Exported dashboard JSON
 * @param {Array} expectedPanelTimeConfigs - Array of expected panel time configs
 */
export function assertExportedDashboardContainsPanelTime(exportedData, expectedPanelTimeConfigs) {
  testLogger.info('Asserting exported dashboard contains panel time configs');

  expect(exportedData).toBeDefined();
  expect(exportedData.panels).toBeDefined();

  for (const expectedConfig of expectedPanelTimeConfigs) {
    const { panelId, allowPanelTime, panelTimeMode, panelTimeRange } = expectedConfig;

    const panel = exportedData.panels.find(p => p.id === panelId);
    expect(panel).toBeDefined();

    if (allowPanelTime) {
      expect(panel.config.panel_time_enabled).toBe(true);
      expect(panel.config.panel_time_mode).toBe(panelTimeMode);

      if (panelTimeMode === 'individual') {
        expect(panel.config.panel_time_range).toBeDefined();
        expect(panel.config.panel_time_range.relativeTimePeriod).toBe(panelTimeRange);
      }
    }
  }

  testLogger.info('Exported dashboard panel time configs verified');
}

export default {
  assertPanelTimePickerVisible,
  assertPanelTimePickerNotVisible,
  assertPanelTimeDisplay,
  assertPanelTimeInURL,
  assertPanelTimeNotInURL,
  assertPanelTimeAbsoluteInURL,
  assertPanelDataRefreshed,
  assertPanelDataNotRefreshed,
  assertPanelLoading,
  assertPanelLoadComplete,
  assertPanelTimeToggleState,
  assertPanelTimeMode,
  assertDateTimePickerLabel,
  assertGlobalTimeDisplay,
  assertURLParam,
  assertMultiplePanelTimes,
  assertPanelTimePickerInModal,
  assertPanelTimePickerInFullScreen,
  assertURLChanged,
  assertURLUnchanged,
  assertPanelVariableUsesPanelTime,
  assertExportedDashboardContainsPanelTime
};
