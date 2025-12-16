/**
 * Utility functions for Traces tests
 * Following the pattern from Logs tests for consistency
 */

const testLogger = require('../../utils/test-logger.js');

/**
 * Navigate to traces page with proper organization
 * @param {Page} page - Playwright page object
 * @param {string} orgName - Organization name
 */
async function navigateToTraces(page, orgName = null) {
  const org = orgName || process.env["ORGNAME"] || 'default';
  const baseUrl = (process.env["ZO_BASE_URL"] || '').replace(/\/+$/, '');
  const tracesUrl = `${baseUrl}/web/traces?org_identifier=${org}`;

  testLogger.debug('Navigating to traces', { url: tracesUrl });
  await page.goto(tracesUrl);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

/**
 * Select trace stream and wait for it to load
 * @param {TracesPage} tracesPage - Traces page object
 * @param {string} streamName - Stream name to select
 */
async function selectTraceStream(tracesPage, streamName = 'default') {
  const page = tracesPage.page;
  const streamSelector = page.locator(tracesPage.streamSelect);

  if (await streamSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tracesPage.selectTraceStream(streamName);
    testLogger.debug('Stream selected', { streamName });
    // Wait for stream selection to take effect
    await page.waitForTimeout(2000);
  }
}

/**
 * Set time range for trace visibility (traces require last 15 mins)
 * @param {Page} page - Playwright page object
 * @param {TracesPage} tracesPage - Traces page object
 */
async function setTraceTimeRange(page, tracesPage) {
  await page.locator(tracesPage.dateTimeButton).click();
  await page.locator('[data-test="date-time-relative-15-m-btn"]').click();
  await page.waitForTimeout(1000); // Wait for time range to apply
  testLogger.debug('Time range set to last 15 minutes');
}

/**
 * Run trace search and wait for results
 * @param {Page} page - Playwright page object
 * @param {TracesPage} tracesPage - Traces page object
 */
async function runTraceSearch(page, tracesPage) {
  await tracesPage.runTraceSearch();
  await page.waitForTimeout(3000); // Wait for results to load
  testLogger.debug('Trace search executed');
}

/**
 * Setup trace search with stream and time range
 * Common pattern for most trace tests
 * @param {Page} page - Playwright page object
 * @param {TracesPage} tracesPage - Traces page object
 * @param {string} streamName - Stream name to select
 */
async function setupTraceSearch(page, tracesPage, streamName = 'default') {
  await selectTraceStream(tracesPage, streamName);
  await setTraceTimeRange(page, tracesPage);
  await runTraceSearch(page, tracesPage);
}

/**
 * Enter query in the query editor
 * @param {Page} page - Playwright page object
 * @param {string} query - Query to enter
 */
async function enterTraceQuery(page, query) {
  const queryEditor = page.locator('[data-test="query-editor"]');

  if (await queryEditor.isVisible({ timeout: 5000 }).catch(() => false)) {
    await queryEditor.click();

    const viewLines = page.locator('.view-lines');
    if (await viewLines.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewLines.click();
      await page.waitForTimeout(500);

      // Clear existing content
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');

      // Type new query
      await page.keyboard.type(query);
      await page.waitForTimeout(500);

      testLogger.debug('Query entered', { query });
    }
  }
}

/**
 * Check if trace results are available with retry logic
 * @param {Page} page - Playwright page object
 * @param {number} maxRetries - Maximum number of retries
 * @returns {boolean} True if results are available
 */
async function hasTraceResults(page, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      testLogger.debug(`Retry attempt ${attempt} for checking trace results`);
      await page.waitForTimeout(1000);
    }

    const hasResults = await page.locator('[data-test="traces-search-result-item"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasTableResults = await page.locator('tbody tr').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasSpanInfo = await page.getByText(/Spans\s*:\s*\d+/).first().isVisible({ timeout: 5000 }).catch(() => false);

    if (hasResults || hasTableResults || hasSpanInfo) {
      return true;
    }

    // Check if still loading
    const isLoading = await page.locator('[data-test*="loading"]').isVisible({ timeout: 1000 }).catch(() => false) ||
                     await page.locator('.q-spinner').isVisible({ timeout: 1000 }).catch(() => false);

    if (isLoading) {
      testLogger.debug('Results still loading, waiting...');
      await page.waitForTimeout(2000);
    }
  }

  return false;
}

/**
 * Check for error traces in results
 * @param {Page} page - Playwright page object
 * @returns {Locator} Locator for error traces
 */
function getErrorTraces(page) {
  return page.getByText(/Errors\s*:\s*[1-9]\d*/);
}

/**
 * Reset all filters in trace search
 * @param {Page} page - Playwright page object
 */
async function resetTraceFilters(page) {
  const resetButton = page.locator('[data-test="traces-search-bar-reset-filters-btn"]');

  if (await resetButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await resetButton.click();
    await page.waitForTimeout(1000);
    testLogger.debug('Trace filters reset');
  }
}

/**
 * Click on first trace result
 * @param {Page} page - Playwright page object
 */
async function clickFirstTraceResult(page) {
  // Try multiple selectors for trace results
  const traceText = page.getByText(/Spans\s*:\s*\d+/);
  const traceItem = page.locator('[data-test="traces-search-result-item"]').first();
  const tableRow = page.locator('tbody tr').first();

  if (await traceText.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await traceText.first().click();
    testLogger.debug('Clicked on trace with span info');
  } else if (await traceItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await traceItem.click();
    testLogger.debug('Clicked on trace result item');
  } else if (await tableRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tableRow.click();
    testLogger.debug('Clicked on table row');
  }

  // Wait for navigation/details to load
  await page.waitForTimeout(2000);
}

/**
 * Expand field in field list
 * @param {Page} page - Playwright page object
 * @param {string} fieldName - Name of field to expand
 */
async function expandTraceField(page, fieldName) {
  const expandButton = page.getByRole('button', { name: new RegExp(`Expand.*${fieldName}`, 'i') });

  if (await expandButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandButton.click();
    await page.waitForTimeout(1000);
    testLogger.debug('Field expanded', { fieldName });
    return true;
  }

  return false;
}

/**
 * Select field value after expanding
 * @param {Page} page - Playwright page object
 * @param {string} fieldName - Name of field
 * @param {string} value - Value to select
 */
async function selectFieldValue(page, fieldName, value) {
  const fieldValue = page.locator('div').filter({ hasText: new RegExp(`^${fieldName}='${value}'`) }).first();

  if (await fieldValue.isVisible({ timeout: 3000 }).catch(() => false)) {
    await fieldValue.click();
    await page.waitForTimeout(1000);
    testLogger.debug('Field value selected', { fieldName, value });
    return true;
  }

  return false;
}

/**
 * Wait for search to complete with proper error handling
 * @param {Page} page - Playwright page object
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Object} Search result status
 */
async function waitForSearchCompletion(page, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check for various completion states
    const hasResults = await page.locator('[data-test="traces-search-result-item"]').first().isVisible({ timeout: 500 }).catch(() => false);
    const hasTableResults = await page.locator('tbody tr').first().isVisible({ timeout: 500 }).catch(() => false);
    const hasSpanInfo = await page.getByText(/Spans\s*:\s*\d+/).first().isVisible({ timeout: 500 }).catch(() => false);
    const hasNoResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible({ timeout: 500 }).catch(() => false);
    const hasError = await page.locator('[data-test="logs-search-error-message"]').isVisible({ timeout: 500 }).catch(() => false);

    if (hasResults || hasTableResults || hasSpanInfo || hasNoResults || hasError) {
      const status = {
        completed: true,
        hasResults: hasResults || hasTableResults || hasSpanInfo,
        noResults: hasNoResults,
        error: hasError,
        duration: Date.now() - startTime
      };

      if (hasError) {
        const errorText = await page.locator('[data-test="logs-search-error-message"]').textContent().catch(() => '');
        status.errorMessage = errorText;
      }

      testLogger.debug('Search completed', status);
      return status;
    }

    // Check if still loading
    const isLoading = await page.locator('[data-test*="loading"]').isVisible({ timeout: 500 }).catch(() => false) ||
                     await page.locator('.q-spinner').isVisible({ timeout: 500 }).catch(() => false);

    if (isLoading) {
      testLogger.debug('Search in progress...');
    }

    await page.waitForTimeout(500);
  }

  return {
    completed: false,
    timeout: true,
    duration: timeout
  };
}

/**
 * Safely interact with trace results
 * @param {Page} page - Playwright page object
 * @param {Function} action - Action to perform on results
 * @returns {*} Result of the action
 */
async function withTraceResults(page, action) {
  try {
    const hasResults = await hasTraceResults(page);

    if (!hasResults) {
      testLogger.debug('No trace results available for action');
      return null;
    }

    return await action();
  } catch (error) {
    testLogger.error('Error during trace result action', { error: error.message });
    return null;
  }
}

/**
 * Get trace count from results
 * @param {Page} page - Playwright page object
 * @returns {number} Number of visible traces
 */
async function getTraceCount(page) {
  const resultItems = await page.locator('[data-test="traces-search-result-item"]').count().catch(() => 0);
  const tableRows = await page.locator('tbody tr').count().catch(() => 0);
  const spanTexts = await page.getByText(/Spans\s*:\s*\d+/).count().catch(() => 0);

  return Math.max(resultItems, tableRows, spanTexts);
}

module.exports = {
  navigateToTraces,
  selectTraceStream,
  setTraceTimeRange,
  runTraceSearch,
  setupTraceSearch,
  enterTraceQuery,
  hasTraceResults,
  getErrorTraces,
  resetTraceFilters,
  clickFirstTraceResult,
  expandTraceField,
  selectFieldValue,
  waitForSearchCompletion,
  withTraceResults,
  getTraceCount
};