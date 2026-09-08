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
async function apiCall(page, method, path, body = null, baseUrlOverride = null) {
  // Ingestion can live on a different host from the UI (INGESTION_URL), so the
  // caller may override the base rather than assume ZO_BASE_URL serves both.
  const baseUrl = baseUrlOverride || process.env.ZO_BASE_URL;
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
 * Uses MOCK_WEBHOOK_URL if set, else example.com/webhook — a public, reserved
 * host that satisfies the SSRF guard without any third-party dependency.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} name - Destination name
 * @param {string} [template='Slack'] - Template type
 * @returns {Promise<{status: number, data: any}>}
 */
async function createMockDestination(page, name, template = 'Slack', opts = {}) {
  const org = getOrgName();
  // Defaults to example.com, matching the convention documented in
  // alerts-advanced.spec.js: it is IANA-reserved, resolves to a PUBLIC ip so
  // the SSRF guard accepts it, and is never actually delivered to — no
  // third-party dependency and no rate limit. Pointing at this instance's own
  // ingest instead fails on cloud/alpha, where the base URL is a private IP the
  // guard rejects, leaving the destination form open forever.
  //
  // MOCK_WEBHOOK_URL overrides it where loopback is allowlisted
  // (ZO_SSRF_ALLOW_LOOPBACK in CI); a self-ingest URL there turns a delivered
  // alert into a queryable receipt, which is what makes delivery assertable.
  const finalUrl = opts.url || process.env.MOCK_WEBHOOK_URL || 'https://example.com/webhook';
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
 * Run a SQL search and return the hits.
 * @param {import('@playwright/test').Page} page
 * @param {string} sql
 * @param {number} sinceSeconds how far back to search
 */
async function searchSql(page, sql, sinceSeconds = 259200) {
  const org = getOrgName();
  const end = Date.now() * 1000;
  const start = end - sinceSeconds * 1_000_000;
  const res = await apiCall(page, 'POST', `/api/${org}/_search?type=logs`, {
    query: { sql, start_time: start, end_time: end, size: 1000 },
  });
  return res.data?.hits || [];
}

/** True when a destination with this name exists. */
async function destinationExists(page, name) {
  const org = getOrgName();
  const res = await apiCall(page, 'GET', `/api/${org}/alerts/destinations`);
  const rows = Array.isArray(res.data) ? res.data : res.data?.list || [];
  return rows.some((r) => r.name === name);
}

/**
 * Seed a stream with a flat baseline plus a spike, backdated across `hours`.
 *
 * Anomaly training needs history: a model cannot be built from rows all stamped
 * "now", which is why the shared e2e_automate stream is unusable for this. The
 * spike sits in the most recent buckets so it falls inside the detection window.
 */
async function seedAnomalyStream(page, streamName, opts = {}) {
  const {
    // Stay inside ZO_INGEST_ALLOWED_UPTO (5 hours in CI) — rows backdated
    // further are silently dropped, and a 2-day seed at 5m buckets lands only
    // ~59 points, under the 100 the model needs to train.
    hours = 4,
    // 1-minute buckets so 4 hours still yields ~240 points.
    bucketSeconds = 60,
    baseline = 10,
    spikeValue = 120,
    // Wide enough that the model cannot dismiss it, and held back from the
    // newest buckets: the test spends ~30s in the wizard before detecting, so
    // a spike hard against the window edge drifts and can fall outside it.
    spikeBuckets = 15,
    spikeOffset = 10,
  } = opts;
  const org = getOrgName();
  const now = Math.floor(Date.now() / 1000);
  const total = Math.floor((hours * 3600) / bucketSeconds);
  const rows = [];
  for (let i = total; i > 0; i--) {
    const ts = (now - i * bucketSeconds) * 1_000_000;
    const inSpike = i > spikeOffset && i <= spikeOffset + spikeBuckets;
    const count = inSpike ? spikeValue : baseline;
    for (let n = 0; n < count; n++) {
      rows.push({ _timestamp: ts, level: 'info', job: 'anomaly_e2e', log: 'seeded event' });
    }
  }
  testLogger.info('Seeding anomaly stream', { streamName, rows: rows.length, hours, buckets: total });
  const base = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
  return apiCall(page, 'POST', `/api/${org}/${streamName}/_json`, rows, base);
}

/**
 * Wait until a freshly ingested stream is listed.
 *
 * Ingestion returns before the stream shows up in the schema list, so a wizard
 * opened immediately after seeding finds no such option in the stream picker.
 */
async function waitForStream(page, streamName, timeoutMs = 60000) {
  const org = getOrgName();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await apiCall(page, 'GET', `/api/${org}/streams?type=logs`);
    const names = (res.data?.list || []).map((x) => x.name);
    if (names.includes(streamName)) return true;
    await page.waitForTimeout(3000);
  }
  throw new Error(`Stream ${streamName} did not appear within ${timeoutMs}ms`);
}

/**
 * Create an anomaly config directly, for tests that need one to ACT on rather
 * than to create. Driving the wizard costs ~15s and couples every test to the
 * creation path; this is ~1s and lets them run in parallel, each owning its own
 * record instead of sharing one through a serial chain.
 *
 * @returns {Promise<string>} the new anomaly_id
 */
async function createAnomalyViaApi(page, name, opts = {}) {
  const org = getOrgName();
  const {
    streamName = 'e2e_automate',
    destinations = [],
    threshold = 97,
    histogramInterval = '5m',
  } = opts;
  const res = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, {
    alert_type: 'anomaly_detection',
    name,
    stream_name: streamName,
    stream_type: 'logs',
    enabled: true,
    folder_id: 'default',
    alert_destinations: destinations,
    tags: [],
    anomaly_config: {
      query_mode: 'filters',
      filters: [],
      custom_sql: null,
      detection_function: 'count(*)',
      histogram_interval: histogramInterval,
      schedule_interval: '10m',
      detection_window_seconds: 3600,
      training_window_days: 1,
      retrain_interval_days: 0,
      threshold,
      alert_enabled: destinations.length > 0,
    },
  });
  if (res.status !== 200) {
    throw new Error(`createAnomalyViaApi(${name}) failed ${res.status}: ${JSON.stringify(res.data)}`);
  }
  testLogger.info('Created anomaly via API', { name });
  return res.data.anomaly_id || res.data.id;
}

/**
 * Wait until a config is visible to the LIST endpoint.
 *
 * Creation returns before the record is queryable, so reloading the UI straight
 * after it can still render a list that does not contain it. Settling on the
 * API first separates backend consistency from the page's own caching.
 */
async function waitForAnomalyListed(page, name, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await listAnomalyDetections(page);
    if (rows.some((r) => r.name === name)) return true;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Anomaly ${name} was not listed by the API within ${timeoutMs}ms`);
}

/** Kick off model training for an anomaly config. */
async function triggerAnomalyTraining(page, anomalyId) {
  const org = getOrgName();
  return apiCall(page, 'POST', `/api/${org}/anomaly_detection/${anomalyId}/train`, {});
}

/** Poll until the model reports trained. Training is normally seconds. */
async function waitForAnomalyTrained(page, anomalyId, timeoutMs = 180000) {
  const org = getOrgName();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await apiCall(page, 'GET', `/api/${org}/anomaly_detection/${anomalyId}`);
    if (res.data?.is_trained) return res.data;
    if (res.data?.last_error) throw new Error(`Training failed: ${res.data.last_error}`);
    await page.waitForTimeout(5000);
  }
  throw new Error(`Model not trained within ${timeoutMs}ms`);
}

/**
 * Delete an alert template by name.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function deleteTemplate(page, name) {
  const org = getOrgName();
  testLogger.info('Deleting template via API', { name });
  return apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${name}`);
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
  deleteTemplate,
  destinationExists,
  searchSql,
  createAnomalyViaApi,
  waitForAnomalyListed,
  seedAnomalyStream,
  waitForStream,
  triggerAnomalyTraining,
  waitForAnomalyTrained,
  listAnomalyDetections,
  triggerAnomalyDetection,
  getAnomalyHistory,
  deleteAnomaly,
  cleanupTestAnomalies
};
