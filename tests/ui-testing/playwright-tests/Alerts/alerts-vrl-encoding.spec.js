/**
 * VRL Encoding E2E Tests
 *
 * Tests that VRL (Vector Remap Language) functions are correctly:
 * 1. Stored without double-encoding
 * 2. Displayed correctly in the UI (not URL-encoded)
 * 3. Sent correctly on updates (not double-encoded)
 *
 * Module: Alerts
 * Priority: P1
 * Tags: @vrl @alerts @encoding
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// TEST DATA CONFIGURATION
// ============================================================================

const STREAM_NAME = 'e2e_automate';

// Test VRL function - contains special chars that could be double-encoded
const TEST_VRL_FUNCTION = `.test_field = "hello world"
.encoded_chars = "test/path?query=value&other=123"
.special = "quotes\\"and\\nescapes"`;

/**
 * Generate unique per-test identifiers so tests can run in parallel
 */
function generateTestIds() {
  const runId = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);
  return {
    runId,
    templateName: `e2e_vrl_${runId}_tmpl`,
    destinationName: `e2e_vrl_${runId}_dest`,
    alertName: `e2e_vrl_test_${runId}`,
  };
}

// ============================================================================
// API HELPER FUNCTIONS
// ============================================================================

async function apiCall(page, method, path, body = null) {
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const headers = getAuthHeaders();

  return page.evaluate(async ({ url, method, headers, body }) => {
    const opts = {
      method,
      headers,
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  }, { url: `${baseUrl}${path}`, method, headers, body });
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

async function ensureTemplate(page, templateName) {
  const org = getOrgIdentifier();
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, {
    name: templateName,
    body: JSON.stringify({ text: "VRL Test Alert: {alert_name}" }),
    isDefault: false
  });
  testLogger.info('Created template', { name: templateName, status: resp.status });
  return resp.status === 200 || resp.status === 400 || resp.status === 409;
}

async function ensureDestination(page, destinationName, templateName) {
  const org = getOrgIdentifier();
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, {
    name: destinationName,
    url: 'https://httpbin.org/post',
    method: 'post',
    skip_tls_verify: false,
    template: templateName,
    headers: {}
  });
  testLogger.info('Created destination', { name: destinationName, status: resp.status });
  return resp.status === 200 || resp.status === 400 || resp.status === 409;
}

async function createAlertWithVrl(page, alertName, destinationName, runId) {
  const org = getOrgIdentifier();
  const vrlBase64 = Buffer.from(TEST_VRL_FUNCTION).toString('base64');

  const payload = {
    name: alertName,
    stream_type: 'logs',
    stream_name: STREAM_NAME,
    is_real_time: false,
    query_condition: {
      conditions: null,
      sql: `SELECT COUNT(*) as cnt FROM "${STREAM_NAME}"`,
      promql: null,
      type: 'sql',
      aggregation: null,
      vrl_function: vrlBase64
    },
    trigger_condition: {
      threshold: 1,
      operator: '>=',
      frequency: 1,
      silence: 0,
      period: 5,
      frequency_type: 'minutes'
    },
    destinations: [destinationName],
    enabled: false,
    description: `E2E VRL encoding test alert [${runId}]`,
    context_attributes: {}
  };

  const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, payload);
  testLogger.info('Created alert with VRL', {
    name: alertName,
    status: resp.status,
    response: JSON.stringify(resp.data)
  });
  resp.alertName = alertName;
  return resp;
}

async function getAlertByName(page, alertName, maxRetries = 3) {
  const org = getOrgIdentifier();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=default`);
    if (listResp.status === 200) {
      const alerts = listResp.data?.list || listResp.data || [];
      const alert = alerts.find(a => a.name === alertName);
      if (alert) {
        const alertId = alert.id || alert.alert_id;
        const detailResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts/${alertId}`);
        return { ...detailResp, alertId };
      }
    }
    if (attempt < maxRetries) {
      testLogger.info('Alert not found, retrying...', { attempt, alertName });
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { status: 404, data: null };
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

async function cleanup(page, alertId, destinationName, templateName) {
  const org = getOrgIdentifier();

  if (alertId) {
    const alertResp = await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${alertId}?folder=default`);
    testLogger.info('Deleted alert', { alertId, status: alertResp.status });
  }

  const destResp = await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${destinationName}`);
  testLogger.info('Deleted destination', { name: destinationName, status: destResp.status });

  const tmplResp = await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${templateName}`);
  testLogger.info('Deleted template', { name: templateName, status: tmplResp.status });
}

// ============================================================================
// TESTS
// ============================================================================

test.describe("VRL Encoding Tests @vrl @alerts", () => {
  // Parallel mode - each test uses its own unique identifiers
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  });

  test("VRL function should not be double-encoded in API @vrl @P1 @all @alerts", async ({ page }) => {
    test.setTimeout(120000);
    const ids = generateTestIds();
    let createdAlertId = null;

    try {
      testLogger.info('Setting up test infrastructure...', ids);
      expect(await ensureTemplate(page, ids.templateName)).toBe(true);
      expect(await ensureDestination(page, ids.destinationName, ids.templateName)).toBe(true);

      const createResp = await createAlertWithVrl(page, ids.alertName, ids.destinationName, ids.runId);
      expect(createResp.status).toBe(200);

      testLogger.info('Fetching alert to verify VRL encoding...');
      const getResp = await getAlertByName(page, ids.alertName);
      expect(getResp.status).toBe(200);
      createdAlertId = getResp.alertId;

      const vrlFromApi = getResp.data?.query_condition?.vrl_function;
      testLogger.info('VRL from API (base64)', { vrl: vrlFromApi });
      expect(vrlFromApi).toBeTruthy();

      const decodedVrl = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
      testLogger.info('VRL decoded', { decoded: decodedVrl });
      expect(decodedVrl).toContain('.test_field = "hello world"');
      expect(decodedVrl).toContain('.encoded_chars = "test/path?query=value&other=123"');

      testLogger.info('VRL encoding test passed - VRL correctly base64 encoded, no double-encoding');
    } finally {
      await cleanup(page, createdAlertId, ids.destinationName, ids.templateName);
    }
  });

  test.skip("VRL should display correctly in UI editor @vrl @P1 @all @alerts", async ({ page }) => {
    test.setTimeout(180000);
    const ids = generateTestIds();
    let createdAlertId = null;

    try {
      testLogger.info('Setting up test infrastructure...', ids);
      expect(await ensureTemplate(page, ids.templateName)).toBe(true);
      expect(await ensureDestination(page, ids.destinationName, ids.templateName)).toBe(true);

      const createResp = await createAlertWithVrl(page, ids.alertName, ids.destinationName, ids.runId);
      expect(createResp.status).toBe(200);

      const getResp = await getAlertByName(page, ids.alertName);
      expect(getResp.status).toBe(200);
      createdAlertId = getResp.alertId;

      // Navigate to alerts page and click edit from the list row
      await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

      await pm.alertsPage.searchAlert(ids.alertName);
      await pm.alertsPage.clickAlertEditButtonInList(ids.alertName);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      // Navigate to Advanced tab using page object
      const navResult = await pm.alertsPage.navigateToAdvancedTab();
      if (!navResult) {
        testLogger.warn('Could not navigate to VRL editor - wizard may not have loaded');
      }
      expect(navResult).toBe(true);

      // Verify VRL editor container is visible
      await pm.alertsPage.expectVrlEditorVisible();

      // Verify VRL content via API
      const verifyResp = await getAlertByName(page, ids.alertName);
      expect(verifyResp.status).toBe(200);
      const vrlFromApi = verifyResp.data?.query_condition?.vrl_function;
      expect(vrlFromApi).toBeTruthy();

      const decoded = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
      expect(decoded).not.toContain('%2F');
      expect(decoded).not.toContain('%3D');
      expect(decoded).not.toContain('%25');
      expect(decoded).toContain('test_field');
      expect(decoded).toContain('hello world');

      testLogger.info('VRL editor visible and API content verified', { decoded: decoded.substring(0, 100) });
    } finally {
      await cleanup(page, createdAlertId, ids.destinationName, ids.templateName);
    }
  });

  test.skip("VRL should not be double-encoded on alert update @vrl @P1 @all @alerts", async ({ page }) => {
    test.setTimeout(180000);
    const ids = generateTestIds();
    let createdAlertId = null;

    try {
      testLogger.info('Setting up test infrastructure...', ids);
      expect(await ensureTemplate(page, ids.templateName)).toBe(true);
      expect(await ensureDestination(page, ids.destinationName, ids.templateName)).toBe(true);

      const createResp = await createAlertWithVrl(page, ids.alertName, ids.destinationName, ids.runId);
      expect(createResp.status).toBe(200);

      const getResp = await getAlertByName(page, ids.alertName);
      expect(getResp.status).toBe(200);
      createdAlertId = getResp.alertId;

      // Navigate to alerts and edit from the list row
      await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

      await pm.alertsPage.searchAlert(ids.alertName);
      await pm.alertsPage.clickAlertEditButtonInList(ids.alertName);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      // Navigate to Advanced tab
      expect(await pm.alertsPage.navigateToAdvancedTab()).toBe(true);

      // Verify VRL editor is visible
      await pm.alertsPage.expectVrlEditorVisible();
      testLogger.info('VRL editor visible in edit mode');

      // Verify VRL content via API
      const verifyResp = await getAlertByName(page, ids.alertName);
      expect(verifyResp.status).toBe(200);
      const vrlFromApi = verifyResp.data?.query_condition?.vrl_function;
      expect(vrlFromApi).toBeTruthy();

      const decoded = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
      expect(decoded).not.toContain('%2F');
      expect(decoded).not.toContain('%3D');
      expect(decoded).not.toContain('%25');
      expect(decoded).not.toContain('%22');

      testLogger.info('VRL not double-encoded on update', { decoded: decoded.substring(0, 100) });
    } finally {
      await cleanup(page, createdAlertId, ids.destinationName, ids.templateName);
    }
  });

  test.skip("Backward compatibility - plain text VRL should be accepted or converted @vrl @P2 @all @alerts", async ({ page }) => {
    test.setTimeout(120000);
    const ids = generateTestIds();
    let createdAlertId = null;

    try {
      testLogger.info('Setting up test infrastructure...', ids);
      expect(await ensureTemplate(page, ids.templateName)).toBe(true);
      expect(await ensureDestination(page, ids.destinationName, ids.templateName)).toBe(true);

      const org = getOrgIdentifier();
      const plainTextAlertName = `e2e_vrl_plaintext_${ids.runId}`;
      const plainTextVrl = '.plain_text_vrl = "test"';

      const payload = {
        name: plainTextAlertName,
        stream_type: 'logs',
        stream_name: STREAM_NAME,
        is_real_time: false,
        query_condition: {
          conditions: null,
          sql: `SELECT COUNT(*) as cnt FROM "${STREAM_NAME}"`,
          promql: null,
          type: 'sql',
          aggregation: null,
          vrl_function: plainTextVrl
        },
        trigger_condition: {
          threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
        },
        destinations: [ids.destinationName],
        enabled: false,
        description: `Plain text VRL test [${ids.runId}]`,
        context_attributes: {}
      };

      const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, payload);
      testLogger.info('Create with plain text VRL', { status: resp.status, response: JSON.stringify(resp.data) });

      if (resp.status === 200) {
        createdAlertId = resp.data?.id;
        testLogger.info('API accepts plain text VRL (backward compatible)', { alertId: createdAlertId });

        const getResp = await getAlertByName(page, plainTextAlertName);
        expect(getResp.status).toBe(200);
        const vrlFromApi = getResp.data?.query_condition?.vrl_function;
        testLogger.info('VRL returned from API', { vrl: vrlFromApi });

        const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(vrlFromApi);
        if (isBase64) {
          const decoded = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
          expect(decoded).toContain('plain_text_vrl');
          testLogger.info('API converted plain text to base64');
        } else {
          expect(vrlFromApi).toContain('plain_text_vrl');
          testLogger.info('API stored as plain text');
        }
      } else if (resp.status === 400 && resp.data?.message?.includes('base64')) {
        testLogger.info('API requires base64 format (new format only)');
      } else {
        testLogger.error('Unexpected response', { status: resp.status, data: resp.data });
        expect([200, 400]).toContain(resp.status);
      }
    } finally {
      await cleanup(page, createdAlertId, ids.destinationName, ids.templateName);
    }
  });

  test.skip("Update alert - verify PUT request encoding @vrl @P1 @all @alerts", async ({ page }) => {
    test.setTimeout(180000);
    const ids = generateTestIds();
    let createdAlertId = null;
    let putCapture = null;

    try {
      testLogger.info('Setting up test infrastructure...', ids);
      expect(await ensureTemplate(page, ids.templateName)).toBe(true);
      expect(await ensureDestination(page, ids.destinationName, ids.templateName)).toBe(true);

      const createResp = await createAlertWithVrl(page, ids.alertName, ids.destinationName, ids.runId);
      expect(createResp.status).toBe(200);

      const getResp = await getAlertByName(page, ids.alertName);
      expect(getResp.status).toBe(200);
      createdAlertId = getResp.alertId;

      // Setup PUT request capture
      putCapture = pm.alertsPage.setupPutRequestCapture();

      // Navigate to alerts and edit from the list row
      await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

      await pm.alertsPage.searchAlert(ids.alertName);
      await pm.alertsPage.clickAlertEditButtonInList(ids.alertName);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      // Navigate through wizard steps and submit
      await pm.alertsPage.navigateThroughWizardSteps(5);

      const submitted = await pm.alertsPage.clickSubmitButton();
      expect(submitted).toBe(true);

      // Verify PUT request
      const capturedRequest = putCapture.getCaptured();
      expect(capturedRequest).toBeTruthy();

      testLogger.info('PUT Request Body (first 500 chars)', {
        body: capturedRequest.body?.substring(0, 500)
      });

      const isValid = pm.alertsPage.verifyPutRequestNotDoubleEncoded(capturedRequest);
      expect(isValid).toBe(true);

      testLogger.info('PUT request does not have double-encoded VRL');
    } finally {
      if (putCapture) putCapture.dispose();
      await cleanup(page, createdAlertId, ids.destinationName, ids.templateName);
    }
  });
});
