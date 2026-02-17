const testLogger = require('./test-logger.js');
const logsdata = require("../../../test-data/logs_data.json");

/**
 * Ingest test data into a stream via API
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamName - Name of the stream to ingest data into (default: "e2e_automate")
 * @returns {Promise<object>} - API response
 */
async function ingestTestData(page, streamName = "e2e_automate") {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });

  testLogger.debug('Test data ingestion response', { response, streamName });
  return response;
}

/**
 * Generates authentication headers for API requests.
 * Extracted from regression tests for reusability.
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
 * Sends an ingestion request via page.evaluate to bypass CORS restrictions.
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
  return await page.evaluate(async ({ url, headers, payload }) => {
    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    return await fetchResponse.json();
  }, { url, headers, payload });
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

module.exports = {
  ingestTestData,
  getHeaders,
  getIngestionUrl,
  sendRequest,
  ingestCustomData,
  enableLogPatternsExtraction
};
