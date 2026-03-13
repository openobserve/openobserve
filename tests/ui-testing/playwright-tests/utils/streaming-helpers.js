const testLogger = require('./test-logger.js');

/**
 * Streaming API helper utilities for Playwright E2E tests.
 * These helpers ensure that streaming API calls complete before proceeding with assertions.
 *
 * Usage:
 * ```javascript
 * import { waitForStreamComplete, waitForValuesStreamComplete, waitForTableWithData } from '../utils/streaming-helpers.js';
 *
 * // Wait for a streaming API to complete
 * const streamPromise = waitForStreamComplete(page);
 * await someAction();
 * await streamPromise;
 *
 * // Wait for values stream to complete
 * const valuesStreamPromise = waitForValuesStreamComplete(page);
 * await page.click('#field-dropdown');
 * await valuesStreamPromise;
 *
 * // Wait for table to have data
 * await waitForTableWithData(page);
 * ```
 */

/**
 * Waits for a streaming API call to complete by listening for response bodies
 * that contain the '[[DONE]]' or 'end' markers indicating stream completion.
 *
 * This helper monitors all OpenObserve streaming endpoints and resolves when
 * the streaming response includes completion markers.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @param {number} timeout - Maximum time to wait in milliseconds (default: 15000)
 * @returns {Promise<void>} Resolves when stream completes or times out
 *
 * @example
 * // Start listening before triggering the request
 * const streamPromise = waitForStreamComplete(page);
 * await page.click('#apply-button');
 * await streamPromise; // Wait for streaming to finish
 */
export async function waitForStreamComplete(page, timeout = 15000) {
  return Promise.race([
    new Promise((resolve) => {
      const responseHandler = async (response) => {
        const url = response.url();

        // Check if this is a streaming API endpoint
        if (url.includes('_search_stream') ||
            url.includes('_histogram_stream') ||
            url.includes('_values_stream') ||
            url.includes('_search_multi_stream') ||
            url.includes('_pagecount_stream')) {

          try {
            // Read the response body as text
            const body = await response.text();

            // Check if stream has completed with [[DONE]] or end marker
            if (body.includes('[[DONE]]') || body.includes('"type":"end"')) {
              testLogger.info(`Stream completed for: ${url.split('/').pop()}`);
              page.off('response', responseHandler);
              resolve();
            }
          } catch (error) {
            // Response body might not be available or already consumed
            testLogger.debug(`Could not read response body: ${error.message}`);
          }
        }
      };

      page.on('response', responseHandler);

      // Clean up listener if it somehow doesn't resolve
      setTimeout(() => {
        page.off('response', responseHandler);
      }, timeout + 1000);
    }),
    new Promise((resolve) => {
      setTimeout(() => {
        testLogger.warn('Stream wait timeout - continuing anyway');
        resolve();
      }, timeout);
    })
  ]);
}

/**
 * Waits for a values stream API call to complete by listening for the 'data: [[DONE]]' marker.
 * This is specifically designed for the _values_stream endpoint.
 *
 * The function monitors the _values_stream endpoint and resolves when it receives
 * the completion marker 'data: [[DONE]]' in the response body.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @param {number} timeout - Maximum time to wait in milliseconds (default: 15000)
 * @returns {Promise<void>} Resolves when values stream completes or times out
 *
 * @example
 * // Start listening before triggering the request
 * const streamPromise = waitForValuesStreamComplete(page);
 * await page.click('#field-dropdown');
 * await streamPromise; // Wait for values streaming to finish
 */
export async function waitForValuesStreamComplete(page, timeout = 15000) {
  return Promise.race([
    new Promise((resolve) => {
      const responseHandler = async (response) => {
        const url = response.url();

        // Check if this is a values stream endpoint
        if (url.includes('_values_stream')) {

          try {
            // Read the response body as text
            const body = await response.text();

            // Check if stream has completed with 'data: [[DONE]]' marker
            if (body.includes('data: [[DONE]]')) {
              testLogger.info(`Values stream completed for: ${url.split('/').pop()}`);
              page.off('response', responseHandler);
              resolve();
            }
          } catch (error) {
            // Response body might not be available or already consumed
            testLogger.debug(`Could not read response body: ${error.message}`);
          }
        }
      };

      page.on('response', responseHandler);

      // Clean up listener if it somehow doesn't resolve
      setTimeout(() => {
        page.off('response', responseHandler);
      }, timeout + 1000);
    }),
    new Promise((resolve) => {
      setTimeout(() => {
        testLogger.warn('Values stream wait timeout - continuing anyway');
        resolve();
      }, timeout);
    })
  ]);
}

/**
 * Waits for the table to have data rows before proceeding.
 * This ensures the table has been populated with actual data from the stream.
 *
 * The function checks for:
 * - Table element exists
 * - At least one row with data
 * - Cells contain meaningful content (not empty, '-', or 'N/A')
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @param {Object} options - Configuration options
 * @param {string} options.selector - Table selector (default: '[data-test="dashboard-panel-table"]')
 * @param {number} options.timeout - Maximum time to wait in milliseconds (default: 10000)
 * @param {number} options.minRows - Minimum number of rows with data required (default: 1)
 * @returns {Promise<void>}
 *
 * @example
 * // Wait for default table
 * await waitForTableWithData(page);
 *
 * // Wait for specific table with custom options
 * await waitForTableWithData(page, {
 *   selector: '[data-test="my-custom-table"]',
 *   timeout: 5000,
 *   minRows: 3
 * });
 */
export async function waitForTableWithData(page, options = {}) {
  const {
    selector = '[data-test="dashboard-panel-table"]',
    timeout = 10000,
    minRows = 1
  } = options;

  await page.waitForFunction(
    ({ selector, minRows }) => {
      const table = document.querySelector(selector);
      if (!table) return false;

      const rows = table.querySelectorAll('tbody tr');
      if (rows.length === 0) return false;

      // Count rows with actual data
      let rowsWithData = 0;
      for (let i = 0; i < rows.length && rowsWithData < minRows; i++) {
        const cells = rows[i].querySelectorAll('td');
        const hasData = Array.from(cells).some(cell => {
          const text = cell.textContent.trim();
          return text !== '' && text !== '-' && text !== 'N/A';
        });
        if (hasData) rowsWithData++;
      }

      return rowsWithData >= minRows;
    },
    { selector, minRows },
    { timeout, polling: 200 }
  );

  // Add a small buffer to ensure rendering is complete
  await page.waitForTimeout(300);
}

/**
 * Waits for multiple streaming API calls to complete.
 * Useful when a single action triggers multiple streaming endpoints.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @param {number} expectedCount - Number of streaming calls to wait for
 * @param {number} timeout - Maximum time to wait in milliseconds (default: 20000)
 * @returns {Promise<number>} Returns the number of completed streams
 *
 * @example
 * const streamPromise = waitForMultipleStreams(page, 2);
 * await page.click('#apply-with-multiple-charts');
 * const completedCount = await streamPromise;
 * console.log(`${completedCount} streams completed`);
 */
export async function waitForMultipleStreams(page, expectedCount, timeout = 20000) {
  return new Promise((resolve) => {
    const completedStreams = new Set();
    const startTime = Date.now();

    const responseHandler = async (response) => {
      const url = response.url();

      // Check if this is a streaming API endpoint
      if (url.includes('_search_stream') ||
          url.includes('_histogram_stream') ||
          url.includes('_values_stream') ||
          url.includes('_search_multi_stream') ||
          url.includes('_pagecount_stream')) {

        try {
          const body = await response.text();

          if (body.includes('[[DONE]]') || body.includes('"type":"end"')) {
            completedStreams.add(url);
            testLogger.info(`Stream ${completedStreams.size}/${expectedCount} completed`);

            if (completedStreams.size >= expectedCount) {
              page.off('response', responseHandler);
              resolve(completedStreams.size);
            }
          }
        } catch (error) {
          testLogger.debug(`Could not read response body: ${error.message}`);
        }
      }
    };

    page.on('response', responseHandler);

    // Timeout handler
    setTimeout(() => {
      page.off('response', responseHandler);
      testLogger.warn(`Multiple streams timeout: got ${completedStreams.size}/${expectedCount} streams`);
      resolve(completedStreams.size);
    }, timeout);
  });
}

/**
 * Waits for chart/visualization to have rendered data.
 * This is useful for various chart types beyond tables.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @param {Object} options - Configuration options
 * @param {string} options.chartType - Chart type: 'line', 'bar', 'area', 'pie', 'scatter', etc. (default: 'line')
 * @param {number} options.timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns {Promise<void>}
 *
 * @example
 * await waitForChartWithData(page, { chartType: 'bar' });
 */
export async function waitForChartWithData(page, options = {}) {
  const {
    chartType = 'line',
    timeout = 10000
  } = options;

  await page.waitForFunction(
    (chartType) => {
      // Check for Plotly charts (used in OpenObserve)
      const plotlyChart = document.querySelector('.plotly');
      if (!plotlyChart) return false;

      // Check if chart has data points rendered
      const hasData = plotlyChart.querySelector('.trace') !== null ||
                     plotlyChart.querySelector('path.point') !== null ||
                     plotlyChart.querySelector('g.points') !== null ||
                     plotlyChart.querySelector('.bar') !== null;

      return hasData;
    },
    chartType,
    { timeout, polling: 200 }
  );

  // Add a small buffer to ensure rendering is complete
  await page.waitForTimeout(300);
}

/**
 * Helper to track streaming API responses for debugging purposes.
 * Returns a function to get the collected responses.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page object
 * @returns {Function} Function that returns array of tracked responses
 *
 * @example
 * const getResponses = trackStreamingResponses(page);
 * await someAction();
 * const responses = getResponses();
 * console.log(`Captured ${responses.length} streaming responses`);
 */
export function trackStreamingResponses(page) {
  const responses = [];

  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('_search_stream') ||
        url.includes('_histogram_stream') ||
        url.includes('_values_stream') ||
        url.includes('_search_multi_stream') ||
        url.includes('_pagecount_stream')) {

      responses.push({
        url,
        status: response.status(),
        timestamp: Date.now(),
        endpoint: url.split('/').pop().split('?')[0]
      });
    }
  });

  return () => responses;
}
