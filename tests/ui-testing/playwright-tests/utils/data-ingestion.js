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

module.exports = { ingestTestData, getHeaders, getIngestionUrl, sendRequest };
