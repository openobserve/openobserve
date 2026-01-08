const { expect } = require('@playwright/test');

// ============================================================================
// API Response Interception Utilities
// ============================================================================

/**
 * Waits for the values API response after field expansion.
 * @param {Page} page - Playwright page object
 * @param {number} [timeout=20000] - Timeout in milliseconds
 * @returns {Promise<Response|null>} The API response, or null on timeout
 * @example
 * const response = await waitForValuesApiResponse(page);
 * if (response) {
 *   console.log(`Status: ${response.status()}`);
 * }
 */
async function waitForValuesApiResponse(page, timeout = 20000) {
  try {
    return await page.waitForResponse(
      response => response.url().includes('/_values') && response.status() !== 0,
      { timeout }
    );
  } catch {
    return null;
  }
}

/**
 * Captures search API error responses.
 * Sets up a response listener to capture error details from search API calls.
 * @param {Page} page - Playwright page object
 * @returns {Promise<Object|null>} Returns captured error response body, or null if no error
 * @example
 * const errorCapture = captureSearchApiError(page);
 * await pm.logsPage.clickRefreshButton();
 * const error = await errorCapture.getError();
 */
function captureSearchApiError(page) {
  let errorResponse = null;

  const handler = async (response) => {
    if (response.url().includes('/_search') && response.status() !== 200) {
      try {
        errorResponse = await response.json();
      } catch {
        // Ignore JSON parse errors
      }
    }
  };

  page.on('response', handler);

  return {
    getError: async () => errorResponse,
    cleanup: () => page.off('response', handler)
  };
}

// ============================================================================
// Field Expansion Test Helper
// ============================================================================

/**
 * Helper function to expand a field and validate that values API does not return 400 error.
 * Used by Bug #7751 tests to reduce code duplication.
 *
 * This function now uses proper POM methods instead of direct page.locator() calls.
 *
 * @param {Page} page - Playwright page object
 * @param {PageManager} pm - Page Manager instance
 * @param {string} fieldName - Name of the field to expand
 * @param {Object} testLogger - Test logger instance
 * @returns {Promise<{apiStatus: number|null, valueCount: number}>} API status and field value count
 * @example
 * const result = await expandFieldAndValidate(page, pm, 'kubernetes_pod_name', testLogger);
 * expect(result.apiStatus).not.toBe(400);
 * expect(result.valueCount).toBeGreaterThanOrEqual(1);
 */
async function expandFieldAndValidate(page, pm, fieldName, testLogger) {
  // Search for the field first to make it visible in sidebar
  testLogger.info(`Searching for field: ${fieldName}`);
  await pm.logsPage.fillIndexFieldSearchInput(fieldName);

  // Wait for expand button to be visible (using POM method)
  testLogger.info(`Expanding field: ${fieldName}`);
  await pm.logsPage.waitForFieldExpandButtonVisible(fieldName);

  // Set up values API response waiter BEFORE clicking expand
  testLogger.info('Setting up values API listener');
  const valuesApiPromise = waitForValuesApiResponse(page);

  // Click expand button (using POM method)
  testLogger.info('Clicking expand to trigger values API call');
  await pm.logsPage.clickFieldExpandButton(fieldName);

  // Wait for values API response
  let apiStatus = null;
  const apiResponse = await valuesApiPromise;

  if (apiResponse) {
    apiStatus = apiResponse.status();
    testLogger.info(`✓ Values API responded with status: ${apiStatus}`);

    // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
    expect(apiStatus).not.toBe(400);
    testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
  } else {
    testLogger.warn('Values API response timeout');
  }

  // Wait for field expansion content to be visible (using POM method)
  await pm.logsPage.waitForFieldExpansionContent(fieldName);

  // Get expansion content text (using POM method)
  const contentText = await pm.logsPage.getFieldExpansionContent(fieldName);

  // Secondary assertion: NO 400 error in UI
  expect(contentText).not.toContain('400');
  expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
  testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

  // TERTIARY ASSERTION: Verify field values actually appear in dropdown (using POM methods)
  await pm.logsPage.waitForFieldValues(fieldName);
  const valueCount = await pm.logsPage.getFieldValuesCount(fieldName);

  expect(valueCount).toBeGreaterThanOrEqual(1);
  testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);

  return { apiStatus, valueCount };
}

module.exports = {
  waitForValuesApiResponse,
  captureSearchApiError,
  expandFieldAndValidate
};
