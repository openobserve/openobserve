const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const STREAM_NAME = 'e2e_automate';

// ============================================================================
// API HELPERS
// ============================================================================

async function apiCall(page, method, path, body = null) {
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const headers = getAuthHeaders();
  return page.evaluate(async ({ url, method, headers, body }) => {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  }, { url: `${baseUrl}${path}`, method, headers, body });
}

async function ensureTemplate(page, templateName) {
  const org = getOrgIdentifier();
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, {
    name: templateName,
    body: JSON.stringify({ text: 'Alert triggered: {alert_name}' }),
    isDefault: false
  });
  testLogger.info('Created alert template', { templateName, status: resp.status });
  if (resp.status !== 200 && resp.status !== 409) {
    throw new Error(`ensureTemplate: unexpected status ${resp.status} for "${templateName}" — ${JSON.stringify(resp.data)}`);
  }
  return true;
}

async function ensureDestination(page, destinationName, templateName) {
  const org = getOrgIdentifier();
  const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, {
    name: destinationName,
    url: 'https://httpbin.org/post',
    method: 'post',
    skip_tls_verify: true,
    template: templateName,
    headers: {}
  });
  testLogger.info('Created alert destination', { destinationName, status: resp.status });
  if (resp.status !== 200 && resp.status !== 409) {
    throw new Error(`ensureDestination: unexpected status ${resp.status} for "${destinationName}" — ${JSON.stringify(resp.data)}`);
  }
  return true;
}

async function createHistoryTestAlert(page, alertName, destinationName) {
  const org = getOrgIdentifier();
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
      vrl_function: null
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
    enabled: true,
    description: 'Alert history E2E test',
    context_attributes: {}
  };
  const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=default`, payload);
  testLogger.info('Created alert via API', { alertName, status: resp.status });
  return resp;
}

async function getAlertId(page, alertName) {
  const org = getOrgIdentifier();
  const resp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=default`);
  if (resp.status === 200) {
    const alerts = resp.data?.list || [];
    const alert = alerts.find(a => a.name === alertName);
    return alert?.alert_id || alert?.id || null;
  }
  return null;
}

async function deleteTestAlert(page, alertName) {
  const alertId = await getAlertId(page, alertName);
  if (alertId) {
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${alertId}?folder=default`);
    testLogger.info('Deleted test alert via API', { alertName, alertId });
  }
}

// ============================================================================
// TESTS
// ============================================================================

test.describe("Alert History Page", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.alertHistoryPage.navigate();
    testLogger.info('Test setup completed');
  });

  // ===== P0: SMOKE TESTS =====

  test("P0: Page loads with title and all controls visible", {
    tag: ['@alertHistory', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying alert history page title and all controls are visible');
    await pm.alertHistoryPage.expectPageTitleVisible();
    await pm.alertHistoryPage.expectBackBtnVisible();
    await pm.alertHistoryPage.expectDatePickerVisible();
    await pm.alertHistoryPage.expectSearchSelectVisible();
    await pm.alertHistoryPage.expectManualSearchBtnVisible();
    await pm.alertHistoryPage.expectRefreshBtnVisible();
    testLogger.info('All controls are visible on the alert history page');
  });

  test("P0: Back button returns to alerts list", {
    tag: ['@alertHistory', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Clicking back button from alert history page');
    await pm.alertHistoryPage.clickBack();
    testLogger.info('Verifying navigation returned to the alerts list page');
    await pm.alertsPage.expectAlertListPageVisible();
    testLogger.info('Successfully returned to alerts list');
  });

  // ===== P1: FUNCTIONAL TESTS =====

  test("P1: Table renders after manual search", {
    tag: ['@alertHistory', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Triggering manual search on alert history page');
    await pm.alertHistoryPage.clickManualSearch();
    testLogger.info('Verifying table or empty-state is displayed after search');
    await pm.alertHistoryPage.expectTableOrEmptyStateVisible();
    testLogger.info('Table or empty-state rendered correctly after manual search');
  });

  test("P1: Refresh button reloads data without error", {
    tag: ['@alertHistory', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Clicking refresh button on alert history page');
    await pm.alertHistoryPage.clickRefresh();
    testLogger.info('Verifying page remains on alert history after refresh');
    await pm.alertHistoryPage.expectPageTitleVisible();
    await pm.alertHistoryPage.expectManualSearchBtnVisible();
    testLogger.info('Page remained stable after refresh');
  });

  test("P1: Alert history populates after triggering alert and view details works", {
    tag: ['@alertHistory', '@functional', '@P1']
  }, async ({ page }) => {
    const ts = Date.now();
    const alertName = `e2e_hist_${ts}`;
    const templateName = `e2e_hist_tmpl_${ts}`;
    const destinationName = `e2e_hist_dest_${ts}`;

    testLogger.info('Creating template and destination for alert', { templateName, destinationName });
    await ensureTemplate(page, templateName);
    await ensureDestination(page, destinationName, templateName);

    testLogger.info('Creating alert via API', { alertName });
    const createResp = await createHistoryTestAlert(page, alertName, destinationName);
    if (createResp.status !== 200) {
      throw new Error(`Failed to create alert via API: status ${createResp.status} — ${JSON.stringify(createResp.data)}`);
    }

    testLogger.info('Triggering alert manually via UI', { alertName });
    await pm.alertsPage.triggerAlertManually(alertName);

    testLogger.info('Navigating to alert history page');
    await pm.alertHistoryPage.navigate();

    testLogger.info('Selecting alert in search dropdown', { alertName });
    await pm.alertHistoryPage.selectAlert(alertName);

    testLogger.info('Clicking manual search and polling for history rows');
    await pm.alertHistoryPage.clickManualSearch();
    let rowCount = await pm.alertHistoryPage.getTableRowCount();
    for (let attempt = 0; attempt < 4 && rowCount === 0; attempt++) {
      await page.waitForTimeout(5000);
      await pm.alertHistoryPage.clickRefresh();
      await pm.alertHistoryPage.clickManualSearch();
      rowCount = await pm.alertHistoryPage.getTableRowCount();
      testLogger.info(`History poll attempt ${attempt + 1}: ${rowCount} rows`);
    }
    testLogger.info('Asserting history rows are present');
    await pm.alertHistoryPage.expectTableHasRows();

    testLogger.info('Clicking view details on first history row');
    await pm.alertHistoryPage.clickViewDetails(0);

    testLogger.info('Verifying details dialog is visible');
    await pm.alertHistoryPage.expectDetailsDialogVisible();

    testLogger.info('Alert history populated and view details works');

    // Cleanup
    const org = getOrgIdentifier();
    await deleteTestAlert(page, alertName);
    await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${destinationName}`);
    await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${templateName}`);
    testLogger.info('Cleaned up alert, destination, and template');
  });

  // ===== P2: EDGE CASE TESTS =====

  test("P2: Table shows empty state when alert has no history", {
    tag: ['@alertHistory', '@edge', '@P2']
  }, async ({ page }) => {
    const ts = Date.now();
    const alertName = `e2e_hist_empty_${ts}`;
    const templateName = `e2e_empty_tmpl_${ts}`;
    const destinationName = `e2e_empty_dest_${ts}`;
    const org = getOrgIdentifier();

    testLogger.info('Creating alert with no history to guarantee empty results', { alertName });
    await ensureTemplate(page, templateName);
    await ensureDestination(page, destinationName, templateName);
    const createResp = await createHistoryTestAlert(page, alertName, destinationName);
    if (createResp.status !== 200) {
      throw new Error(`Setup: failed to create alert: status ${createResp.status} — ${JSON.stringify(createResp.data)}`);
    }

    testLogger.info('Navigating to alert history and searching for the untriggered alert');
    await pm.alertHistoryPage.navigate();
    await pm.alertHistoryPage.selectAlert(alertName);
    await pm.alertHistoryPage.clickManualSearch();

    testLogger.info('Verifying empty state is shown for alert with no history');
    await pm.alertHistoryPage.expectEmptyStateVisible();

    // Cleanup
    await deleteTestAlert(page, alertName);
    await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${destinationName}`);
    await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${templateName}`);
    testLogger.info('Cleaned up alert, destination, and template');
  });
});
