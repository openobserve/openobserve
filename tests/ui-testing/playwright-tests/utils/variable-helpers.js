/**
 * Variable Testing Helper Utilities
 * Provides common methods for variable API monitoring, assertions, and state validation
 */

const testLogger = require('./test-logger.js');

/**
 * Monitor variable values API calls and track completion
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {number} options.expectedCount - Expected number of API calls (default: 1)
 * @param {number} options.timeout - Timeout in milliseconds (default: 15000)
 * @returns {Promise<Object>} - {success, actualCount, calls, timedOut}
 */
export async function monitorVariableAPICalls(page, options = {}) {
  const { expectedCount = 1, timeout = 15000 } = options;
  const startTime = Date.now();
  const apiCalls = [];

  return new Promise((resolve) => {
    const responseHandler = async (response) => {
      const url = response.url();

      if (url.includes('_values_stream') || url.includes('/values')) {
        try {
          const body = await response.text();
          const status = response.status();

          const callInfo = {
            url,
            status,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
            completed: body.includes('[[DONE]]') || body.includes('"type":"end"'),
            hasData: body.length > 0,
          };

          apiCalls.push(callInfo);

          testLogger.info(`Variable API call ${apiCalls.length}/${expectedCount}: ${status} - ${callInfo.completed ? 'Completed' : 'Incomplete'}`);

          if (callInfo.completed && apiCalls.length >= expectedCount) {
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
          testLogger.debug(`Error reading response body: ${error.message}`);
        }
      }
    };

    page.on('response', responseHandler);

    setTimeout(() => {
      page.off('response', responseHandler);
      testLogger.warn(`Variable API monitoring timed out: ${apiCalls.length}/${expectedCount} calls completed`);
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
 * Wait for variable to load by checking its state
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} variableName - Variable name
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - {success, state, error}
 */
export async function waitForVariableToLoad(page, variableName, options = {}) {
  const { timeout = 10000 } = options;

  try {
    // Wait for variable to be visible
    await page.locator(`[data-test="dashboard-variable-${variableName}"]`).waitFor({
      state: 'visible',
      timeout
    });

    // Check if variable has error state
    const hasError = await page.locator(`[data-test="dashboard-variable-${variableName}-error"]`).isVisible().catch(() => false);

    if (hasError) {
      return { success: false, state: 'error', error: 'Variable shows error state' };
    }

    // Check if variable is still loading
    const isLoading = await page.locator(`[data-test="dashboard-variable-${variableName}-loading"]`).isVisible().catch(() => false);

    if (isLoading) {
      // Wait for loading to finish
      await page.locator(`[data-test="dashboard-variable-${variableName}-loading"]`).waitFor({
        state: 'hidden',
        timeout
      });
    }

    return { success: true, state: 'loaded', error: null };
  } catch (error) {
    return { success: false, state: 'timeout', error: error.message };
  }
}

/**
 * Verify variable API was called when clicking dropdown
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Function} action - Action to trigger API call (e.g., clicking dropdown)
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>}
 */
export async function verifyVariableAPITriggered(page, action, options = {}) {
  const { timeout = 10000 } = options;
  let apiCalled = false;

  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('_values_stream') || url.includes('/values')) {
      apiCalled = true;
      testLogger.info(`Variable API triggered: ${url}`);
    }
  };

  page.on('response', responseHandler);

  try {
    await action();
    await page.waitForTimeout(timeout);
  } finally {
    page.off('response', responseHandler);
  }

  return apiCalled;
}

/**
 * Check if refresh button indicates changes are pending
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} level - 'global' or panel ID
 * @returns {Promise<boolean>}
 */
export async function hasRefreshIndicator(page, level = 'global') {
  try {
    if (level === 'global') {
      const refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
      // Check if button has warning color class
      // When Quasar applies :color="warning" with :outline="false", it adds q-btn--warning class
      // When :outline="true", it's just an outlined button with no warning
      const classList = await refreshBtn.getAttribute('class');
      // Check for Quasar warning classes (q-btn--warning) or custom refresh indicator classes
      return classList && (
        classList.includes('q-btn--warning') ||
        classList.includes('bg-warning') ||
        classList.includes('text-warning') ||
        classList.includes('refresh-needed') ||
        classList.includes('needs-refresh') ||
        classList.includes('highlighted')
      );
    } else {
      const panelRefreshBtn = page.locator(`[data-panel="dashboard-panel-refresh-panel-btn"]`);
      const classList = await panelRefreshBtn.getAttribute('class');
      return classList && (
        classList.includes('q-btn--warning') ||
        classList.includes('bg-warning') ||
        classList.includes('text-warning') ||
        classList.includes('refresh-needed') ||
        classList.includes('needs-refresh') ||
        classList.includes('highlighted')
      );
    }
  } catch (error) {
    testLogger.debug(`Error checking refresh indicator: ${error.message}`);
    return false;
  }
}

/**
 * Verify panel shows refresh needed indicator
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @returns {Promise<boolean>}
 */
export async function panelNeedsRefresh(page, panelId) {
  try {
    const warningIcon = page.locator(`[data-test="dashboard-panel-refresh-panel-btn"]`);
    return await warningIcon.isVisible({ timeout: 3000 });
  } catch {
    return false;
  }
}

/**
 * Track panel reload by monitoring query API calls
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} panelId - Panel ID
 * @param {Function} action - Action that triggers panel reload
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} - {reloaded, queryCount}
 */
export async function trackPanelReload(page, panelId, action, timeout = 10000) {
  const queryCalls = [];
  const startTime = Date.now();

  const responseHandler = async (response) => {
    const url = response.url();
    if (url.includes('_search') || url.includes('_multi_search')) {
      queryCalls.push({
        url,
        timestamp: Date.now(),
        panelId: extractPanelIdFromURL(url)
      });
      testLogger.info(`Panel query detected: ${queryCalls.length} calls`);
    }
  };

  page.on('response', responseHandler);

  try {
    await action();
    await page.waitForTimeout(timeout);
  } finally {
    page.off('response', responseHandler);
  }

  return {
    reloaded: queryCalls.length > 0,
    queryCount: queryCalls.length,
    calls: queryCalls,
    duration: Date.now() - startTime
  };
}

/**
 * Extract panel ID from URL (helper function)
 */
function extractPanelIdFromURL(url) {
  const match = url.match(/panelId=([^&]+)/);
  return match ? match[1] : null;
}

/**
 * Verify variable value persists across tab switches
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} variableName - Variable name
 * @param {string} tabId - Tab ID
 * @param {string} expectedValue - Expected value
 * @returns {Promise<boolean>}
 */
export async function verifyVariableValuePersists(page, variableName, tabId, expectedValue) {
  try {
    // Switch to the tab
    await page.locator(`[data-test="dashboard-tab-${tabId}"]`).click();
    await page.waitForTimeout(1000);

    // Get variable value
    const variableInput = page.locator(`[data-test="dashboard-variable-${variableName}"] input`);
    const actualValue = await variableInput.inputValue();

    testLogger.info(`Variable ${variableName} in tab ${tabId}: expected="${expectedValue}", actual="${actualValue}"`);

    return actualValue === expectedValue;
  } catch (error) {
    testLogger.error(`Error verifying variable value: ${error.message}`);
    return false;
  }
}

/**
 * Verify variable loading sequence with dependencies
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Array} variableNames - Array of variable names in expected load order
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} - {success, loadOrder, errors}
 */
export async function verifyVariableLoadSequence(page, variableNames, timeout = 20000) {
  const loadOrder = [];
  const errors = [];
  const startTime = Date.now();

  const responseHandler = async (response) => {
    const url = response.url();

    if (url.includes('_values_stream') || url.includes('/values')) {
      try {
        const body = await response.text();
        if (body.includes('[[DONE]]') || body.includes('"type":"end"')) {
          // Extract variable name from URL if possible
          const variableName = extractVariableNameFromURL(url);
          if (variableName && variableNames.includes(variableName)) {
            loadOrder.push({
              name: variableName,
              timestamp: Date.now(),
              order: loadOrder.length + 1,
              duration: Date.now() - startTime
            });
            testLogger.info(`Variable ${variableName} loaded (${loadOrder.length}/${variableNames.length})`);
          }
        }
      } catch (error) {
        errors.push({ error: error.message, timestamp: Date.now() });
      }
    }
  };

  page.on('response', responseHandler);

  try {
    await page.waitForTimeout(timeout);
  } finally {
    page.off('response', responseHandler);
  }

  return {
    success: loadOrder.length === variableNames.length,
    loadOrder,
    errors,
    totalDuration: Date.now() - startTime
  };
}

/**
 * Extract variable name from URL (helper function)
 */
function extractVariableNameFromURL(url) {
  const match = url.match(/variable=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Verify URL contains correct variable parameters
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} expectedVariables - Expected variables {name: value, ...}
 * @param {string} scope - 'global', 'tab', or 'panel'
 * @param {string} scopeId - Tab or panel ID (if applicable)
 * @returns {Promise<boolean>}
 */
export async function verifyVariablesInURL(page, expectedVariables, scope = 'global', scopeId = null) {
  const currentURL = page.url();

  for (const [name, value] of Object.entries(expectedVariables)) {
    let expectedParam;

    if (scope === 'global') {
      expectedParam = `v-${name}=${encodeURIComponent(value)}`;
    } else if (scope === 'tab') {
      expectedParam = `v-${name}.t.${scopeId}=${encodeURIComponent(value)}`;
    } else if (scope === 'panel') {
      expectedParam = `v-${name}.p.${scopeId}=${encodeURIComponent(value)}`;
    }

    if (!currentURL.includes(expectedParam)) {
      testLogger.error(`URL missing expected parameter: ${expectedParam}`);
      testLogger.debug(`Current URL: ${currentURL}`);
      return false;
    }
  }

  return true;
}

/**
 * Wait for all panels to finish loading
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} panelCount - Expected number of panels
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function waitForAllPanelsToLoad(page, panelCount, timeout = 30000) {
  const startTime = Date.now();

  try {
    await page.waitForFunction(
      (count) => {
        const loadedPanels = document.querySelectorAll('[data-test*="dashboard-panel-"][data-state="loaded"]');
        return loadedPanels.length >= count;
      },
      panelCount,
      { timeout, polling: 500 }
    );

    testLogger.info(`All ${panelCount} panels loaded in ${Date.now() - startTime}ms`);
    return true;
  } catch (error) {
    testLogger.error(`Panels failed to load within ${timeout}ms`);
    return false;
  }
}

/**
 * Assert variable API loading states
 * @param {Object} monitorResult - Result from monitorVariableAPICalls
 * @param {Object} expectations - {success: true, minCalls: 1, maxDuration: 10000}
 * @throws {Error} if expectations are not met
 */
export function assertVariableAPILoading(monitorResult, expectations = {}) {
  const {
    success = true,
    minCalls = 1,
    maxDuration = 15000,
    shouldTimeout = false
  } = expectations;

  if (expectations.success !== undefined && monitorResult.success !== success) {
    throw new Error(`Expected success=${success}, got ${monitorResult.success}`);
  }

  if (monitorResult.actualCount < minCalls) {
    throw new Error(`Expected at least ${minCalls} API calls, got ${monitorResult.actualCount}`);
  }

  if (monitorResult.totalDuration > maxDuration) {
    throw new Error(`Loading took ${monitorResult.totalDuration}ms, expected < ${maxDuration}ms`);
  }

  if (shouldTimeout !== monitorResult.timedOut) {
    throw new Error(`Expected timedOut=${shouldTimeout}, got ${monitorResult.timedOut}`);
  }

  testLogger.info(`Variable API assertion passed: ${monitorResult.actualCount} calls in ${monitorResult.totalDuration}ms`);
}

module.exports = {
  monitorVariableAPICalls,
  waitForVariableToLoad,
  verifyVariableAPITriggered,
  hasRefreshIndicator,
  panelNeedsRefresh,
  trackPanelReload,
  verifyVariableValuePersists,
  verifyVariableLoadSequence,
  verifyVariablesInURL,
  waitForAllPanelsToLoad,
  assertVariableAPILoading
};
