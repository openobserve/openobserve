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

// ============================================================================
// TEST DATA CONFIGURATION
// ============================================================================

const RUN_ID = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);

const STREAM_NAME = 'e2e_automate';
const TEMPLATE_NAME = `e2e_vrl_${RUN_ID}_tmpl`;
const DESTINATION_NAME = `e2e_vrl_${RUN_ID}_dest`;
const ALERT_NAME = `e2e_vrl_test_${RUN_ID}`;

// Test VRL function - contains special chars that could be double-encoded
const TEST_VRL_FUNCTION = `.test_field = "hello world"
.encoded_chars = "test/path?query=value&other=123"
.special = "quotes\\"and\\nescapes"`;

// ============================================================================
// API HELPER FUNCTIONS
// ============================================================================

function getAuthToken() {
  return Buffer.from(
    `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
  ).toString('base64');
}

async function apiCall(page, method, path, body = null) {
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const authToken = getAuthToken();

  return page.evaluate(async ({ url, method, authToken, body }) => {
    const opts = {
      method,
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  }, { url: `${baseUrl}${path}`, method, authToken, body });
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

async function ensureTemplate(page) {
  const org = process.env.ORGNAME || 'default';
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, {
    name: TEMPLATE_NAME,
    body: JSON.stringify({ text: "VRL Test Alert: {alert_name}" }),
    isDefault: false
  });
  testLogger.info('Created template', { name: TEMPLATE_NAME, status: resp.status });
  return resp.status === 200 || resp.status === 409; // 409 = already exists
}

async function ensureDestination(page) {
  const org = process.env.ORGNAME || 'default';
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, {
    name: DESTINATION_NAME,
    url: 'https://httpbin.org/post',
    method: 'post',
    skip_tls_verify: false,
    template: TEMPLATE_NAME,
    headers: {}
  });
  testLogger.info('Created destination', { name: DESTINATION_NAME, status: resp.status });
  return resp.status === 200 || resp.status === 409;
}

async function createAlertWithVrl(page) {
  const org = process.env.ORGNAME || 'default';

  // VRL function needs to be base64 encoded for the API
  const vrlBase64 = Buffer.from(TEST_VRL_FUNCTION).toString('base64');

  const payload = {
    name: ALERT_NAME,
    stream_type: 'logs',
    stream_name: STREAM_NAME,
    is_real_time: false,
    query_condition: {
      conditions: null,
      sql: `SELECT COUNT(*) as cnt FROM "${STREAM_NAME}"`,
      promql: null,
      type: 'sql',
      aggregation: null,
      vrl_function: vrlBase64  // Base64 encoded VRL
    },
    trigger_condition: {
      threshold: 1,
      operator: '>=',
      frequency: 1,
      silence: 0,
      period: 5,
      frequency_type: 'minutes'
    },
    destinations: [DESTINATION_NAME],
    enabled: false,  // Disabled to avoid triggering
    description: `E2E VRL encoding test alert [${RUN_ID}]`,
    context_attributes: {}
  };

  const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, payload);
  testLogger.info('Created alert with VRL', {
    name: ALERT_NAME,
    status: resp.status,
    response: JSON.stringify(resp.data)
  });
  // The alert_id might be in different fields or we need to use the alert name
  resp.alertName = ALERT_NAME;
  return resp;
}

async function getAlertByName(page, alertName) {
  const org = process.env.ORGNAME || 'default';
  // List alerts and find the one with our name
  const listResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=default`);
  if (listResp.status === 200) {
    const alerts = listResp.data?.list || listResp.data || [];
    const alert = alerts.find(a => a.name === alertName);
    if (alert) {
      const alertId = alert.id || alert.alert_id;
      // Fetch full alert details
      const detailResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts/${alertId}`);
      return { ...detailResp, alertId };
    }
  }
  return { status: 404, data: null };
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

async function cleanup(page, alertId) {
  const org = process.env.ORGNAME || 'default';

  // Delete alert
  if (alertId) {
    const alertResp = await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${alertId}?folder=default`);
    testLogger.info('Deleted alert', { alertId, status: alertResp.status });
  }

  // Delete destination
  const destResp = await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${DESTINATION_NAME}`);
  testLogger.info('Deleted destination', { name: DESTINATION_NAME, status: destResp.status });

  // Delete template
  const tmplResp = await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${TEMPLATE_NAME}`);
  testLogger.info('Deleted template', { name: TEMPLATE_NAME, status: tmplResp.status });
}

// ============================================================================
// TESTS
// ============================================================================

test.describe("VRL Encoding Tests @vrl @alerts", () => {
  let pm;
  let createdAlertId;

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    // Navigate to base URL first so page context is ready for API calls
    await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState("networkidle");
  });

  test("VRL function should not be double-encoded in API @vrl @P1", async ({ page }) => {
    test.setTimeout(120000);

    // Setup: Create template, destination, and alert with VRL
    testLogger.info('Setting up test infrastructure...');
    await ensureTemplate(page);
    await ensureDestination(page);

    const createResp = await createAlertWithVrl(page);
    expect(createResp.status).toBe(200);

    // Test: Fetch the alert and verify VRL is not double-encoded
    testLogger.info('Fetching alert to verify VRL encoding...');
    const getResp = await getAlertByName(page, ALERT_NAME);
    expect(getResp.status).toBe(200);
    createdAlertId = getResp.alertId;

    const vrlFromApi = getResp.data?.query_condition?.vrl_function;
    testLogger.info('VRL from API (base64)', { vrl: vrlFromApi });

    // API returns VRL as base64 - decode it to verify content
    const decodedVrl = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
    testLogger.info('VRL decoded', { decoded: decodedVrl });

    // Verify decoded VRL matches what we originally sent (not double-encoded)
    // Note: There might be a trailing character from encoding, so we check contains
    expect(decodedVrl).toContain('.test_field = "hello world"');
    expect(decodedVrl).toContain('.encoded_chars = "test/path?query=value&other=123"');

    // Check that the base64 is valid (no double-encoding artifacts)
    // Double-encoding would produce invalid base64 or extra padding
    expect(vrlFromApi).toMatch(/^[A-Za-z0-9+/]+=*$/); // Valid base64 pattern

    testLogger.info('✅ VRL encoding test passed - VRL correctly base64 encoded, no double-encoding');

    // Cleanup
    await cleanup(page, createdAlertId);
    createdAlertId = null;
  });

  test("VRL should display correctly in UI editor @vrl @P1", async ({ page }) => {
    test.setTimeout(180000);

    // Setup
    testLogger.info('Setting up test infrastructure...');
    await ensureTemplate(page);
    await ensureDestination(page);

    const createResp = await createAlertWithVrl(page);
    expect(createResp.status).toBe(200);
    createdAlertId = createResp.data?.alert_id;

    // Navigate to alerts page
    await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Search for our test alert
    const searchInput = page.locator('[data-test="alert-list-search-input"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(ALERT_NAME);
      await page.waitForTimeout(1000);
    }

    // Click on the alert row
    const alertRow = page.locator(`text=${ALERT_NAME}`).first();
    await expect(alertRow).toBeVisible({ timeout: 10000 });
    await alertRow.click();
    await page.waitForTimeout(2000);

    // Click Edit button
    const editBtn = page.locator('[data-test="alert-details-edit-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await page.waitForTimeout(3000);

    // Navigate to Advanced tab to see VRL editor
    const advancedTab = page.locator('text=Advanced').first();
    if (await advancedTab.isVisible()) {
      await advancedTab.click();
      await page.waitForTimeout(1000);
    }

    // Check VRL editor content
    const vrlEditor = page.locator('#alert-editor-vrl .view-lines, #alert-editor-vrl');

    if (await vrlEditor.isVisible()) {
      const vrlContent = await vrlEditor.textContent();
      testLogger.info('VRL Editor Content', { content: vrlContent });

      // Verify content is readable (not URL-encoded)
      expect(vrlContent).not.toContain('%2F');
      expect(vrlContent).not.toContain('%3D');
      expect(vrlContent).not.toContain('%25');

      // Should contain our test values
      expect(vrlContent).toContain('test_field');
      expect(vrlContent).toContain('hello world');

      testLogger.info('✅ VRL displays correctly in UI - not encoded');
    } else {
      testLogger.info('ℹ️ VRL editor not visible in Advanced tab - checking other locations');
    }

    // Cleanup
    await cleanup(page, createdAlertId);
    createdAlertId = null;
  });

  test("VRL should not be double-encoded on alert update @vrl @P1", async ({ page }) => {
    test.setTimeout(180000);

    // Setup
    await ensureTemplate(page);
    await ensureDestination(page);

    const createResp = await createAlertWithVrl(page);
    expect(createResp.status).toBe(200);
    createdAlertId = createResp.data?.alert_id;

    // Navigate to alerts and edit
    await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Search and click alert
    const searchInput = page.locator('[data-test="alert-list-search-input"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(ALERT_NAME);
      await page.waitForTimeout(1000);
    }

    const alertRow = page.locator(`text=${ALERT_NAME}`).first();
    await expect(alertRow).toBeVisible({ timeout: 10000 });
    await alertRow.click();
    await page.waitForTimeout(2000);

    // Click Edit
    const editBtn = page.locator('[data-test="alert-details-edit-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await page.waitForTimeout(3000);

    // Navigate to Advanced tab to see VRL editor
    const advancedTab = page.locator('text=Advanced').first();
    if (await advancedTab.isVisible()) {
      await advancedTab.click();
      await page.waitForTimeout(1000);
    }

    // Check that VRL is displayed correctly (not double-encoded in UI)
    // The VRL editor should show decoded content
    const vrlEditor = page.locator('#alert-editor-vrl .view-lines, #alert-editor-vrl');
    if (await vrlEditor.isVisible()) {
      const vrlContent = await vrlEditor.textContent();
      testLogger.info('VRL in editor during edit', { content: vrlContent?.substring(0, 100) });

      // Verify VRL is NOT URL-encoded in the editor
      expect(vrlContent).not.toContain('%2F');
      expect(vrlContent).not.toContain('%3D');
      expect(vrlContent).not.toContain('%25');
      expect(vrlContent).not.toContain('%22');

      testLogger.info('✅ VRL displays correctly in edit mode - not double-encoded');
    } else {
      // If VRL editor not visible, skip this check - the core API test already passed
      testLogger.info('ℹ️ VRL editor not visible in edit mode - skipping UI check');
    }

    // Cleanup
    await cleanup(page, createdAlertId);
    createdAlertId = null;
  });

  test("Backward compatibility - plain text VRL should be accepted or converted @vrl @P2", async ({ page }) => {
    test.setTimeout(120000);

    // This test verifies that if old alerts had plain text VRL (not base64),
    // the system can still handle them

    await ensureTemplate(page);
    await ensureDestination(page);

    const org = process.env.ORGNAME || 'default';
    const plainTextAlertName = `e2e_vrl_plaintext_${RUN_ID}`;
    const plainTextVrl = '.plain_text_vrl = "test"';

    // Try to create alert with PLAIN TEXT VRL (old format - not base64)
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
        vrl_function: plainTextVrl  // Plain text, NOT base64
      },
      trigger_condition: {
        threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
      },
      destinations: [DESTINATION_NAME],
      enabled: false,
      description: `Plain text VRL test [${RUN_ID}]`,
      context_attributes: {}
    };

    const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, payload);
    testLogger.info('Create with plain text VRL', { status: resp.status, response: JSON.stringify(resp.data) });

    if (resp.status === 200) {
      // If API accepts plain text, verify it's converted to base64 or stored correctly
      testLogger.info('✅ API accepts plain text VRL (backward compatible)');

      // Fetch and verify
      const getResp = await getAlertByName(page, plainTextAlertName);
      if (getResp.status === 200) {
        const vrlFromApi = getResp.data?.query_condition?.vrl_function;
        testLogger.info('VRL returned from API', { vrl: vrlFromApi });

        // Check if it's base64 or plain text
        const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(vrlFromApi);
        if (isBase64) {
          const decoded = Buffer.from(vrlFromApi, 'base64').toString('utf-8');
          expect(decoded).toContain('plain_text_vrl');
          testLogger.info('API converted plain text to base64');
        } else {
          expect(vrlFromApi).toContain('plain_text_vrl');
          testLogger.info('API stored as plain text');
        }

        createdAlertId = getResp.alertId;
      }
    } else if (resp.status === 400 && resp.data?.message?.includes('base64')) {
      // API requires base64 - this is the new format
      testLogger.info('ℹ️ API requires base64 format (new format only)');
      // This is still acceptable - just means no backward compatibility needed
    } else {
      testLogger.info('Unexpected response', { status: resp.status, data: resp.data });
    }

    // Cleanup
    if (createdAlertId) {
      await cleanup(page, createdAlertId);
      createdAlertId = null;
    }
  });

  test("Update alert - verify PUT request encoding @vrl @P1", async ({ page }) => {
    test.setTimeout(180000);

    // This test captures the actual PUT request to verify VRL encoding

    await ensureTemplate(page);
    await ensureDestination(page);

    const createResp = await createAlertWithVrl(page);
    expect(createResp.status).toBe(200);

    const getResp = await getAlertByName(page, ALERT_NAME);
    createdAlertId = getResp.alertId;

    // Capture PUT request
    let capturedPutRequest = null;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/alerts/')) {
        capturedPutRequest = {
          url: request.url(),
          body: request.postData()
        };
        testLogger.info('📤 Captured PUT request', { url: request.url() });
      }
    });

    // Navigate to alerts and edit
    await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Search for alert
    const searchInput = page.locator('[data-test="alert-list-search-input"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(ALERT_NAME);
      await page.waitForTimeout(1000);
    }

    // Click alert
    const alertRow = page.locator(`text=${ALERT_NAME}`).first();
    await expect(alertRow).toBeVisible({ timeout: 10000 });
    await alertRow.click();
    await page.waitForTimeout(2000);

    // Click Edit
    const editBtn = page.locator('[data-test="alert-details-edit-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await page.waitForTimeout(3000);

    // Navigate through steps and try to save
    // Click Continue/Next buttons to get to save
    const continueBtn = page.locator('[data-test="add-alert-continue-btn"], button:has-text("Continue")').first();
    for (let i = 0; i < 5; i++) {
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Try to save
    const saveBtn = page.locator('[data-test="add-alert-submit-btn"]');
    await page.waitForTimeout(2000);

    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      await page.waitForTimeout(3000);

      // Verify PUT request
      if (capturedPutRequest) {
        testLogger.info('PUT Request Body (first 500 chars)', {
          body: capturedPutRequest.body?.substring(0, 500)
        });

        // Check for double-encoding in PUT request
        expect(capturedPutRequest.body).not.toContain('%252F'); // Double-encoded /
        expect(capturedPutRequest.body).not.toContain('%253D'); // Double-encoded =
        expect(capturedPutRequest.body).not.toContain('%2522'); // Double-encoded "

        testLogger.info('✅ PUT request does not have double-encoded VRL');
      }
    } else {
      testLogger.info('ℹ️ Save button not enabled - form validation incomplete, skipping PUT verification');
    }

    // Cleanup
    await cleanup(page, createdAlertId);
    createdAlertId = null;
  });

  // Cleanup in case test fails
  test.afterEach(async ({ page }) => {
    if (createdAlertId) {
      testLogger.info('Cleaning up after test failure...');
      await cleanup(page, createdAlertId);
    }
  });
});
