const testLogger = require('./test-logger.js');
const logsdata = require("../../../test-data/logs_data.json");

/**
 * Ingest test data into a stream via API using Node.js context (secure)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream to ingest data into (default: "e2e_automate")
 * @returns {Promise<object>} - API response
 */
async function ingestTestData(page, streamName = "e2e_automate") {
  const orgId = process.env["ORGNAME"];
  const headers = getHeaders();
  const baseUrl = process.env.INGESTION_URL.endsWith('/')
    ? process.env.INGESTION_URL.slice(0, -1)
    : process.env.INGESTION_URL;

  try {
    const response = await page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
      headers: headers,
      data: logsdata
    });

    const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
    testLogger.debug('Test data ingestion response', { response: responseData, streamName });
    return responseData;
  } catch (e) {
    testLogger.debug('Test data ingestion error', { error: e.message, streamName });
    return { error: e.message };
  }
}

/**
 * Generates authentication headers for API requests.
 * Extracted from regression tests for reusability.
 *
 * SECURITY NOTE: Credentials are created in Node.js context and passed to
 * Playwright's page.request API which keeps them server-side. They are NOT
 * exposed to browser context or logged. Only response data is logged.
 *
 * @returns {Object} Headers object with Basic Authentication and Content-Type
 * @example
 * const headers = getHeaders();
 * // Returns: { Authorization: "Basic ...", Content-Type: "application/json" }
 */
function getHeaders() {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  return {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
}

/**
 * Constructs the ingestion URL for a specific stream.
 * @param {string} orgId - The organization ID
 * @param {string} streamName - The name of the stream to ingest data into
 * @returns {string} The complete ingestion URL
 * @example
 * const url = getIngestionUrl("default", "my_stream");
 * // Returns: "http://localhost:5080/api/default/my_stream/_json"
 */
function getIngestionUrl(orgId, streamName) {
  return `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
}

/**
 * Sends an ingestion request using page.request API (secure, keeps credentials in Node.js context).
 * @param {Page} page - Playwright page object
 * @param {string} url - The ingestion URL
 * @param {Object} payload - The data payload to ingest
 * @param {Object} headers - Request headers including authentication
 * @returns {Promise<Object>} The API response
 * @example
 * const response = await sendRequest(page, url, { log: "test" }, headers);
 * // Returns: { code: 200, status: [{ name: "stream", successful: 1 }] }
 */
async function sendRequest(page, url, payload, headers) {
  try {
    const response = await page.request.post(url, {
      headers: headers,
      data: payload
    });
    return await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
  } catch (e) {
    testLogger.debug('sendRequest error', { error: e.message, url });
    return { error: e.message };
  }
}

/**
 * Ingest custom data into a stream via API using Node.js context (secure)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream to ingest data into
 * @param {Array} data - Array of log records to ingest
 * @returns {Promise<object>} - API response with status and data
 */
async function ingestCustomData(page, streamName, data) {
  const orgId = process.env["ORGNAME"];
  const headers = getHeaders();
  const baseUrl = process.env.INGESTION_URL.endsWith('/')
    ? process.env.INGESTION_URL.slice(0, -1)
    : process.env.INGESTION_URL;

  try {
    // Use Playwright's request API to keep credentials in Node.js context
    const response = await page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
      headers: headers,
      data: data
    });

    let responseData = null;
    try {
      responseData = await response.json();
    } catch (e) {
      responseData = { error: 'Failed to parse JSON response' };
    }

    testLogger.debug('Custom data ingestion response', { status: response.status(), streamName });
    return {
      status: response.status(),
      data: responseData
    };
  } catch (e) {
    testLogger.debug('Custom data ingestion error', { error: e.message, streamName });
    return {
      status: 500,
      data: { error: e.message }
    };
  }
}

/**
 * Enable log patterns extraction on a stream via API using Node.js context (secure)
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream
 * @returns {Promise<object>} - API response with status and data
 */
async function enableLogPatternsExtraction(page, streamName) {
  const orgId = process.env["ORGNAME"];
  const headers = getHeaders();
  const baseUrl = process.env.INGESTION_URL.endsWith('/')
    ? process.env.INGESTION_URL.slice(0, -1)
    : process.env.INGESTION_URL;

  const settingsPayload = {
    enable_log_patterns_extraction: true
  };

  try {
    // Use Playwright's request API to keep credentials in Node.js context
    const response = await page.request.put(`${baseUrl}/api/${orgId}/streams/${streamName}/settings?type=logs`, {
      headers: headers,
      data: settingsPayload
    });

    let responseData = null;
    try {
      responseData = await response.json();
    } catch (e) {
      responseData = { error: 'Failed to parse JSON response' };
    }

    testLogger.debug('Enable log patterns extraction response', { status: response.status(), streamName, data: responseData });
    return {
      status: response.status(),
      data: responseData
    };
  } catch (e) {
    testLogger.debug('Enable log patterns extraction error', { error: e.message, streamName });
    return {
      status: 500,
      data: { error: e.message }
    };
  }
}

/**
 * Wait for stream data to be indexed by polling the search API
 * Replaces arbitrary waitForTimeout with explicit condition check
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream to check
 * @param {number} expectedMinCount - Minimum expected record count (default: 1)
 * @param {number} maxWaitMs - Maximum wait time in ms (default: 30000)
 * @param {number} pollIntervalMs - Polling interval in ms (default: 2000)
 * @returns {Promise<boolean>} - True if data found, false if timed out
 */
async function waitForStreamData(page, streamName, expectedMinCount = 1, maxWaitMs = 30000, pollIntervalMs = 2000) {
  const orgId = process.env["ORGNAME"];
  const headers = getHeaders();
  const baseUrl = process.env.INGESTION_URL.endsWith('/')
    ? process.env.INGESTION_URL.slice(0, -1)
    : process.env.INGESTION_URL;

  const startTime = Date.now();
  const endTime = Date.now() * 1000; // microseconds
  const startTimeUs = (Date.now() - 3600000) * 1000; // 1 hour ago in microseconds

  const searchPayload = {
    query: {
      sql: `SELECT COUNT(*) as count FROM "${streamName}"`,
      start_time: startTimeUs,
      end_time: endTime,
      from: 0,
      size: 1
    }
  };

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await page.request.post(`${baseUrl}/api/${orgId}/_search?type=logs`, {
        headers: headers,
        data: searchPayload
      });

      if (response.status() === 200) {
        const data = await response.json().catch(() => null);
        const count = data?.hits?.[0]?.count || data?.total || 0;

        if (count >= expectedMinCount) {
          testLogger.debug('Stream data indexed', { streamName, count, waitedMs: Date.now() - startTime });
          return true;
        }
        testLogger.debug('Polling for stream data', { streamName, currentCount: count, expectedMinCount });
      }
    } catch (e) {
      testLogger.debug('Stream data poll error', { error: e.message, streamName });
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  testLogger.warn('Stream data poll timed out', { streamName, maxWaitMs });
  return false;
}

module.exports = {
  ingestTestData,
  getHeaders,
  getIngestionUrl,
  sendRequest,
  ingestCustomData,
  enableLogPatternsExtraction,
  waitForStreamData
};
