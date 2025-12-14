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

module.exports = { ingestTestData };
