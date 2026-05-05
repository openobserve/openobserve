/**
 * Variable Testing Helper Utilities
 * Provides common methods for variable API monitoring, assertions, and state validation
 */

import testLogger from './test-logger.js';

/**
 * Monitor variable values API calls and track completion
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {number} options.expectedCount - Expected number of API calls (default: 1)
 * @param {number} options.timeout - Timeout in milliseconds (default: 15000)
 * @returns {Promise<Object>} - {success, actualCount, calls, timedOut}
 */
export async function monitorVariableAPICalls(page, options = {}) {
  const { expectedCount = 1, timeout = 15000, matchFn = null } = options;
  const startTime = Date.now();
  const apiCalls = [];
  const handledRequests = new Set(); // Track request objects handled by requestHandler
  let matchedCount = 0;
  let resolved = false;

  return new Promise((resolve) => {
    const doResolve = (result) => {
      if (resolved) return;
      resolved = true;
      page.off('request', requestHandler);
      page.off('response', responseHandler);
      resolve(result);
    };

    // Helper: extract stream/field from URL and POST body
    const parseCallInfo = (url, postDataStr) => {
      const streamMatch = url.match(/\/api\/[^/]+\/([^/]+)\/_values_stream/);
      const fieldsMatch = url.match(/[?&]fields=([^&]+)/);
      let stream = streamMatch ? decodeURIComponent(streamMatch[1]) : null;
      let field = fieldsMatch ? decodeURIComponent(fieldsMatch[1]) : null;

      let requestBody = null;
      try {
        if (postDataStr) {
          requestBody = JSON.parse(postDataStr);
          if (!stream && requestBody.stream_name) {
            stream = requestBody.stream_name;
          }
          if (!field && requestBody.fields && requestBody.fields.length > 0) {
            field = requestBody.fields.join(',');
          }
        }
      } catch (_e) { /* POST body might not be JSON */ }

      return { stream, field, requestBody };
    };

    const processCall = (callInfo) => {
      apiCalls.push(callInfo);
      const matches = matchFn ? matchFn(callInfo) : true;

      testLogger.info(
        `Variable API call ${apiCalls.length} (matched=${matchedCount}/${expectedCount}): ` +
        `status=${callInfo.status} stream=${callInfo.stream} field=${callInfo.field} ` +
        `matches=${matches} source=${callInfo.source}`
      );

      if (callInfo.completed && matches) {
        matchedCount++;
        if (matchedCount >= expectedCount) {
          doResolve({
            success: true,
            actualCount: apiCalls.length,
            matchedCount,
            calls: apiCalls,
            timedOut: false,
            totalDuration: Date.now() - startTime
          });
        }
      }
    };

    // Primary listener: 'request' event fires immediately when fetch() is called.
    // This reliably captures SSE/streaming requests (text/event-stream) where the
    // 'response' event may never fire or response.text() hangs indefinitely.
    const requestHandler = (request) => {
      if (resolved) return;
      const url = request.url();

      if (url.includes('_values_stream') || url.includes('/values')) {
        try {
          const { stream, field, requestBody } = parseCallInfo(url, request.postData());

          // Mark this request as handled so responseHandler won't double-count it
          handledRequests.add(request);

          processCall({
            url,
            status: 0, // Not yet known from request alone
            stream,
            field,
            requestBody,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
            completed: true, // Request was sent — sufficient for cascade verification
            hasData: true,
            source: 'request',
          });
        } catch (error) {
          testLogger.debug(`Error processing request for ${url}: ${error.message}`);
        }
      }
    };

    // Secondary listener: only fires for requests NOT already handled by requestHandler.
    // This covers edge cases where the request event was missed.
    const responseHandler = async (response) => {
      if (resolved) return;
      const url = response.url();

      if (url.includes('_values_stream') || url.includes('/values')) {
        // Skip if requestHandler already processed this same request object
        if (handledRequests.has(response.request())) return;

        try {
          const status = response.status();
          let body = '';
          try {
            body = await Promise.race([
              response.text(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Body read timeout')), 5000)
              )
            ]);
          } catch (_bodyErr) {
            return;
          }

          const { stream, field, requestBody } = parseCallInfo(
            url, response.request().postData()
          );

          processCall({
            url,
            status,
            stream,
            field,
            requestBody,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
            completed: body.includes('[[DONE]]') || body.includes('"type":"end"'),
            hasData: body.length > 0,
            source: 'response',
          });
        } catch (error) {
          testLogger.debug(`Error processing response for ${url}: ${error.message}`);
        }
      }
    };

    page.on('request', requestHandler);
    page.on('response', responseHandler);

    setTimeout(() => {
      testLogger.warn(`Variable API monitoring timed out: ${apiCalls.length} calls, ${matchedCount}/${expectedCount} matched`);
      doResolve({
        success: matchedCount >= expectedCount,
        actualCount: apiCalls.length,
        matchedCount,
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
      // OButton exposes variant via data-o2-variant attribute
      const variant = await refreshBtn.getAttribute('data-o2-variant');
      return variant === 'warning';
    } else {
      const panelRefreshBtn = page.locator('[data-test="dashboard-panel-refresh-panel-btn"]');
      const variant = await panelRefreshBtn.getAttribute('data-o2-variant');
      return variant === 'warning';
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
