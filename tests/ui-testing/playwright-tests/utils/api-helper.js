/**
 * API Helper - Shared utility for making authenticated API calls in Playwright tests
 *
 * This helper provides a consistent way to make API calls from tests,
 * using environment variables for authentication (no hardcoded credentials).
 */

const testLogger = require('./test-logger.js');

/**
 * Make an authenticated API call using the page's evaluate context
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - API path (e.g., '/api/org/alerts')
 * @param {Object|null} body - Request body (optional)
 * @returns {Promise<{status: number, data: any}>} - Response object
 * @throws {Error} - If required environment variables are missing
 */
async function apiCall(page, method, path, body = null) {
  const baseUrl = process.env.ZO_BASE_URL;
  const email = process.env.ZO_ROOT_USER_EMAIL;
  const password = process.env.ZO_ROOT_USER_PASSWORD;

  if (!baseUrl || !email || !password) {
    throw new Error('Required environment variables missing: ZO_BASE_URL, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD');
  }

  const authToken = Buffer.from(`${email}:${password}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${authToken}`,
    'Content-Type': 'application/json'
  };

  return page.evaluate(async ({ url, method, headers, body }) => {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  }, { url: `${baseUrl}${path}`, method, headers, body });
}

/**
 * Get the organization name from environment
 * @returns {string} - Organization name
 * @throws {Error} - If ORGNAME environment variable is missing
 */
function getOrgName() {
  const org = process.env.ORGNAME;
  if (!org) {
    throw new Error('Required environment variable missing: ORGNAME');
  }
  return org;
}

/**
 * Create a test destination via API (useful for CI/CD testing)
 *
 * Uses MOCK_WEBHOOK_URL env var if set, otherwise falls back to httpbin.org/post
 * which requires outbound internet connectivity.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} name - Destination name
 * @param {string} [template='Slack'] - Template type
 * @returns {Promise<{status: number, data: any}>}
 */
async function createMockDestination(page, name, template = 'Slack') {
  const org = getOrgName();
  // Use MOCK_WEBHOOK_URL if set, otherwise fall back to httpbin.org
  const finalUrl = process.env.MOCK_WEBHOOK_URL || 'https://httpbin.org/post';
  const payload = {
    name,
    template,
    url: finalUrl,
    method: "post",
    headers: {},
    skip_tls_verify: false
  };

  testLogger.info('Creating mock destination via API', { name, template, webhookUrl: finalUrl });
  return apiCall(page, 'POST', `/api/${org}/alerts/destinations`, payload);
}

/**
 * Delete a destination via API
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} name - Destination name to delete
 * @returns {Promise<{status: number, data: any}>}
 */
async function deleteDestination(page, name) {
  const org = getOrgName();
  testLogger.info('Deleting destination via API', { name });
  return apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${name}`);
}

/**
 * List anomaly detections via API
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<Array>} - Array of anomaly detection configs
 */
async function listAnomalyDetections(page) {
  const org = getOrgName();
  const result = await apiCall(page, 'GET', `/api/${org}/anomaly_detection`);
  return result.data?.configs || result.data || [];
}

/**
 * Trigger anomaly detection via API
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} anomalyId - Anomaly ID to trigger
 * @returns {Promise<{status: number, data: any}>}
 */
async function triggerAnomalyDetection(page, anomalyId) {
  const org = getOrgName();
  testLogger.info('Triggering anomaly detection via API', { anomalyId });
  return apiCall(page, 'POST', `/api/${org}/anomaly_detection/${anomalyId}/detect`, {});
}

/**
 * Get anomaly detection history via API
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} anomalyId - Anomaly ID
 * @param {number} [limit=5] - Number of history entries to fetch
 * @returns {Promise<{status: number, data: any}>}
 */
async function getAnomalyHistory(page, anomalyId, limit = 5) {
  const org = getOrgName();
  return apiCall(page, 'GET', `/api/${org}/anomaly_detection/${anomalyId}/history?limit=${limit}`);
}

/**
 * Delete an anomaly detection via API
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} anomalyId - Anomaly ID to delete
 * @returns {Promise<{status: number, data: any}>}
 */
async function deleteAnomaly(page, anomalyId) {
  const org = getOrgName();
  testLogger.info('Deleting anomaly via API', { anomalyId });
  return apiCall(page, 'DELETE', `/api/${org}/anomaly_detection/${anomalyId}`);
}

/**
 * Clean up test anomalies by name pattern
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} namePattern - Pattern to match anomaly names (e.g., 'E2E_Anomaly')
 * @returns {Promise<number>} - Number of anomalies deleted
 */
async function cleanupTestAnomalies(page, namePattern) {
  testLogger.info('Cleaning up test anomalies', { namePattern });

  const anomalies = await listAnomalyDetections(page);
  const testAnomalies = anomalies.filter(a => a.name && a.name.includes(namePattern));

  testLogger.info(`Found ${testAnomalies.length} test anomalies to clean up`);

  let deleted = 0;
  for (const anomaly of testAnomalies) {
    const id = anomaly.anomaly_id || anomaly.id;
    if (id) {
      const result = await deleteAnomaly(page, id);
      if (result.status === 200 || result.status === 404) {
        deleted++;
      }
    }
  }

  return deleted;
}

module.exports = {
  apiCall,
  getOrgName,
  createMockDestination,
  deleteDestination,
  listAnomalyDetections,
  triggerAnomalyDetection,
  getAnomalyHistory,
  deleteAnomaly,
  cleanupTestAnomalies
};
