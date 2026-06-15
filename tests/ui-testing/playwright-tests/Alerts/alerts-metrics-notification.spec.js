/**
 * Metrics Alert -> Notification E2E Test
 *
 * Verifies the full alert chain for metrics streams:
 *   Template -> Destination -> Alert (PromQL) -> Trigger
 *
 * Self-contained for CI/CD: ingests its own metrics data, creates the alert
 * on a known stream, polls for trigger, and verifies history in the UI.
 *
 * Module: Alerts
 * Priority: P1
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { WebhookCapture } = require('../utils/webhook-capture.js');

// ============================================================================
// TEST DATA CONFIGURATION
// ============================================================================

const RUN_ID = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);

const METRICS_STREAM_NAME = 'cpu_usage'; // Created by ensureMetricsIngested()
const TEMPLATE_NAME = `e2e_metrics_${RUN_ID}_tmpl`;
const DESTINATION_NAME = `e2e_metrics_${RUN_ID}_dest`;
const ALERT_NAME = `e2e_metrics_${RUN_ID}_alert`;

const TEMPLATE_BODY = JSON.stringify({
    text: "{alert_name} is active. Stream: {stream_name}. Triggered: {alert_trigger_time_str}. Value: {alert_agg_value}. URL: {alert_url}"
});

const webhookCapture = new WebhookCapture();
let DESTINATION_URL = 'https://httpbin.org/post'; // Fallback if webhook mock can't start

let ALERT_ID = null; // Cached after creation to avoid redundant list+detail API calls

// ============================================================================
// API HELPERS
// ============================================================================

async function apiCall(page, method, path, body = null) {
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const headers = getAuthHeaders();

    const result = await page.evaluate(async ({ url, method, headers, body }) => {
        const opts = {
            method,
            headers,
        };
        if (body) opts.body = JSON.stringify(body);
        const resp = await fetch(url, opts);
        const data = await resp.json().catch(() => ({}));
        return { status: resp.status, data };
    }, { url: `${baseUrl}${path}`, method, headers, body });

    if (result.status < 200 || result.status >= 300) {
        throw new Error(`API call failed: ${method} ${path} returned ${result.status}: ${JSON.stringify(result.data)}`);
    }
    return result;
}

async function ensureTemplate(page) {
    const org = getOrgIdentifier();
    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, {
        name: TEMPLATE_NAME,
        body: TEMPLATE_BODY,
        isDefault: false
    });
    testLogger.info('Template', { name: TEMPLATE_NAME, status: resp.status });
}

async function ensureDestination(page) {
    const org = getOrgIdentifier();
    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, {
        name: DESTINATION_NAME,
        url: DESTINATION_URL,
        method: 'post',
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {}
    });
    testLogger.info('Destination', { name: DESTINATION_NAME, status: resp.status, url: DESTINATION_URL });
}

async function createMetricsAlert(page) {
    const org = getOrgIdentifier();
    const payload = {
        name: ALERT_NAME,
        stream_type: 'metrics',
        stream_name: METRICS_STREAM_NAME,
        is_real_time: false,
        query_condition: {
            type: 'promql',
            promql: METRICS_STREAM_NAME,
            promql_condition: {
                column: 'value',
                operator: '>=',
                value: 0,
                ignore_case: false
            }
        },
        trigger_condition: {
            period: 5,
            operator: '>=',
            threshold: 1,
            frequency: 1,
            frequency_type: 'minutes',
            silence: 10,
            timezone: 'UTC',
            align_time: true
        },
        destinations: [DESTINATION_NAME],
        enabled: true,
        description: `E2E metrics notification test [${RUN_ID}]`
    };

    const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts`, payload);
    testLogger.info('Alert created', { name: ALERT_NAME, status: resp.status });
    ALERT_ID = resp.data?.id || resp.data?.alert_id || null;
    return ALERT_ID;
}

async function getAlertState(page) {
    if (!ALERT_ID) return null;
    const org = getOrgIdentifier();

    const detailResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts/${ALERT_ID}`);
    if (detailResp.status !== 200) return null;

    const d = detailResp.data;
    return {
        id: ALERT_ID,
        enabled: d.enabled,
        last_triggered_at: d.last_triggered_at,
        last_satisfied_at: d.last_satisfied_at,
        // API returns microseconds; divide by 1000 for JS Date (ms)
        triggered: d.last_triggered_at ? new Date(d.last_triggered_at / 1000) : null,
        satisfied: d.last_satisfied_at ? new Date(d.last_satisfied_at / 1000) : null,
    };
}

async function pollForAlertCondition(page, timeoutMs = 300000, intervalMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastState = null;

    while (Date.now() < deadline) {
        lastState = await getAlertState(page);
        if (lastState?.last_satisfied_at) {
            testLogger.info('Alert condition satisfied', { state: lastState });
            return lastState;
        }
        testLogger.info('Waiting for alert condition to be satisfied...', {
            last_satisfied_at: lastState?.last_satisfied_at || null,
            remainingMs: deadline - Date.now()
        });
        await new Promise(r => setTimeout(r, intervalMs));
    }

    throw new Error(`Alert condition was not satisfied within ${timeoutMs}ms. Last state: ${JSON.stringify(lastState)}`);
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

async function cleanupAlert(page) {
    if (!ALERT_ID) return;
    const org = getOrgIdentifier();
    // Verify ownership before deleting: re-fetch and check description
    try {
        const detailResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts/${ALERT_ID}`);
        const desc = detailResp.data?.description || '';
        if (!desc.includes(RUN_ID)) {
            testLogger.warn('Skipping alert deletion — description does not match RUN_ID', { alertId: ALERT_ID, desc });
            return;
        }
    } catch {
        testLogger.warn('Could not verify alert ownership, skipping deletion', { alertId: ALERT_ID });
        return;
    }
    await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${ALERT_ID}`);
    testLogger.info('Alert deleted', { name: ALERT_NAME });
}

async function cleanupDestination(page) {
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${DESTINATION_NAME}`);
    testLogger.info('Destination deleted', { name: DESTINATION_NAME });
}

async function cleanupTemplate(page) {
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${TEMPLATE_NAME}`);
    testLogger.info('Template deleted', { name: TEMPLATE_NAME });
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe("Metrics Alert Notification Chain", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    // ========================================================================
    // SETUP: Create template -> destination -> alert via API, then ingest data
    // ========================================================================
    test.beforeAll(async ({ browser }) => {
        testLogger.info('=== METRICS NOTIFICATION TEST SETUP ===');

        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();

        try {
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const org = getOrgIdentifier();
            await page.goto(`${baseUrl}?org_identifier=${org}`);
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

            // Start webhook capture server so the backend can POST notifications
            // to localhost and we can assert on the rendered payload.
            // Only works when backend runs locally (CI / local dev).
            if (baseUrl.includes('localhost')) {
                await webhookCapture.start();
                DESTINATION_URL = `http://localhost:${webhookCapture.port}/webhook`;
                testLogger.info('Webhook capture server started', { port: webhookCapture.port });
            } else {
                testLogger.warn('Backend is remote — webhook capture disabled, using httpbin fallback');
            }

            await ensureTemplate(page);
            await ensureDestination(page);

            // Ingest metrics first so the stream exists before alert creation references it
            await ensureMetricsIngested();
            testLogger.info('Metrics data ingested for alert test');

            await createMetricsAlert(page);

            testLogger.info('=== SETUP COMPLETE ===');
        } finally {
            await page.close();
            await context.close();
        }
    });

    // ========================================================================
    // CLEANUP: Delete alert -> destination -> template
    // ========================================================================
    test.afterAll(async ({ browser }) => {
        testLogger.info('=== METRICS NOTIFICATION TEST CLEANUP ===');

        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();

        try {
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const org = getOrgIdentifier();
            await page.goto(`${baseUrl}?org_identifier=${org}`);
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

            const steps = [
                ['Delete alert', () => cleanupAlert(page)],
                ['Delete destination', () => cleanupDestination(page)],
                ['Delete template', () => cleanupTemplate(page)],
            ];

            for (const [name, fn] of steps) {
                try { await fn(); } catch (err) {
                    testLogger.warn(`Cleanup "${name}" failed (non-fatal)`, { error: err.message });
                }
            }

            testLogger.info('=== CLEANUP COMPLETE ===');
        } finally {
            await page.close();
            await context.close();
            await webhookCapture.stop();
        }
    });

    // ========================================================================
    // BEFORE EACH: Navigate to alerts page
    // ========================================================================
    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to alerts page
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = getOrgIdentifier();
        await page.goto(`${baseUrl}/web/alerts?org_identifier=${org}`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        testLogger.info('Navigated to alerts page');
    });

    // ========================================================================
    // TEST 1: Metrics PromQL alert triggers and appears in history [P1]
    // ========================================================================
    test("Metrics PromQL alert triggers and appears in history", {
        tag: ['@metricsAlert', '@notification', '@P1', '@all', '@alerts'],
        timeout: 360000
    }, async ({ page }) => {
        test.slow();

        testLogger.info('=== PHASE 1: Verify alert exists in list ===');
        await pm.alertsPage.searchAlert(ALERT_NAME);
        // Use getByText instead of verifyAlertCreated's getByRole('cell') —
        // Quasar QTable cells are unreliable with ARIA role matching.
        await expect(page.getByText(ALERT_NAME).first()).toBeVisible({ timeout: 15000 });
        testLogger.info('Alert found in list', { name: ALERT_NAME });

        testLogger.info('=== PHASE 2: Poll for alert to trigger ===');
        const alertState = await pollForAlertCondition(page, 300000, 15000);
        expect(alertState.last_satisfied_at, 'Alert condition should be satisfied').toBeTruthy();
        testLogger.info('Alert condition satisfied', {
            triggered: alertState.triggered?.toISOString(),
            satisfied: alertState.satisfied?.toISOString()
        });

        testLogger.info('=== PHASE 3: Verify alert history shows trigger status ===');
        await pm.alertsPage.openAlertDetailsDialog(ALERT_NAME);
        await pm.alertsPage.expectAlertDetailsDialogVisible();
        testLogger.info('Alert details dialog opened');

        const historyVisible = await pm.alertsPage.expectAlertDetailsHistorySectionVisible();
        expect(historyVisible, 'Alert history section should be visible').toBeTruthy();

        const historyRows = page.locator(pm.alertsPage.locators.alertDetailsHistoryTable + ' tbody tr');
        const rowCount = await historyRows.count();
        expect(rowCount, 'Alert history should have at least one entry').toBeGreaterThan(0);
        testLogger.info('Alert history rows', { count: rowCount });

        testLogger.info('=== PHASE 4: Verify action buttons and close ===');
        await pm.alertsPage.expectAlertDetailsActionButtonsVisible();

        await pm.alertsPage.closeAlertDetailsDialog();

        testLogger.info('=== METRICS NOTIFICATION TEST COMPLETE ===');
    });

    // ========================================================================
    // TEST 2: Template body contains expected alert variables [P2]
    // ========================================================================
    test("Template body contains alert variables", {
        tag: ['@metricsAlert', '@templates', '@P2', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to templates and find test template ===');

        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = getOrgIdentifier();
        await page.goto(`${baseUrl}/web/settings/templates?org_identifier=${org}`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

        await pm.alertsPage.searchTemplate(TEMPLATE_NAME);
        await page.waitForTimeout(1000);

        const templateRow = page.getByText(TEMPLATE_NAME);
        await expect(templateRow, 'Test template should be visible').toBeVisible({ timeout: 10000 });

        testLogger.info('=== PHASE 2: Open template editor and verify variables ===');

        await pm.alertsPage.clickTemplateUpdateButton(TEMPLATE_NAME);
        await page.waitForTimeout(2000);

        const bodyValue = await page.evaluate(() => {
            const editors = window.monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });
        testLogger.info('Template body read from Monaco', { bodyLength: bodyValue?.length });
        expect(bodyValue, 'Template body should contain alert_url variable').toContain('{alert_url}');
        expect(bodyValue, 'Template body should contain alert_name variable').toContain('{alert_name}');
        expect(bodyValue, 'Template body should contain stream_name variable').toContain('{stream_name}');

        testLogger.info('=== PHASE 3: Navigate back to templates list ===');

        await page.goto(`${baseUrl}/web/settings/templates?org_identifier=${org}`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

        testLogger.info('=== TEMPLATE VERIFICATION COMPLETE ===');
    });

    // ========================================================================
    // TEST 3: Manual trigger from UI sends notification [P1]
    // ========================================================================
    test("Manual trigger sends notification from alert list", {
        tag: ['@metricsAlert', '@trigger', '@P1', '@all', '@alerts']
    }, async ({ page }) => {
        webhookCapture.clear(); // Clear any payloads from scheduled triggers

        testLogger.info('=== PHASE 1: Trigger alert manually via more-options menu ===');

        const triggered = await pm.alertsPage.triggerAlertManually(ALERT_NAME);
        expect(triggered, 'Manual trigger should succeed (API response or toast)').toBe(true);
        testLogger.info('Manual trigger API call succeeded');

        testLogger.info('=== PHASE 2: Verify trigger recorded in alert history ===');
        await pm.alertsPage.openAlertDetailsDialog(ALERT_NAME);
        await pm.alertsPage.expectAlertDetailsDialogVisible();

        const historyVisible = await pm.alertsPage.expectAlertDetailsHistorySectionVisible();
        expect(historyVisible, 'Alert history section should be visible').toBeTruthy();

        const historyRows = page.locator(pm.alertsPage.locators.alertDetailsHistoryTable + ' tbody tr');
        const rowCount = await historyRows.count();
        expect(rowCount, 'Alert history should have a manual trigger entry').toBeGreaterThan(0);
        testLogger.info('Manual trigger history entry verified', { rowCount });

        await pm.alertsPage.closeAlertDetailsDialog();

        testLogger.info('=== PHASE 3: Verify webhook notification payload ===');
        if (webhookCapture.port > 0) {
            // Wait up to 10s for the backend to POST to the capture server
            await expect(async () => {
                const payload = webhookCapture.getLatestPayload();
                expect(payload, 'Webhook should have received a POST').not.toBeNull();
                expect(payload.method, 'Should be a POST request').toBe('POST');
                expect(payload.body, 'Payload should have a body').toBeTruthy();
            }).toPass({ timeout: 10000, intervals: [500] });

            const captured = webhookCapture.getLatestPayload();
            const notificationText = captured.body?.text || '';

            testLogger.info('Captured webhook payload', {
                method: captured.method,
                bodyKeys: Object.keys(captured.body || {}),
                textPreview: notificationText.substring(0, 120),
            });

            // Verify template variables were substituted (no raw {placeholders} in output)
            expect(notificationText, 'Notification should contain alert name').toContain(ALERT_NAME);
            expect(notificationText, 'Notification should contain stream name').toContain(METRICS_STREAM_NAME);
            expect(notificationText, 'Notification should not contain unreplaced {alert_name}').not.toContain('{alert_name}');
            expect(notificationText, 'Notification should not contain unreplaced {stream_name}').not.toContain('{stream_name}');
            expect(notificationText, 'Notification should not contain unreplaced {alert_url}').not.toContain('{alert_url}');
            // {alert_agg_value} is not substituted on manual triggers — PATCH /trigger
            // skips query evaluation, so the aggregation value is not available.

            testLogger.info('Webhook notification payload verified');

            testLogger.info('=== PHASE 4: Verify alert_url redirects to metrics page ===');
            // Extract the rendered alert_url from the notification text
            const urlMatch = notificationText.match(/https?:\/\/\S+/);
            expect(urlMatch, 'Notification should contain a clickable alert_url').not.toBeNull();
            const alertUrl = urlMatch[0];
            testLogger.info('Navigating to alert_url', { url: alertUrl });

            // Navigate to the alert_url — if it's a short URL, the browser
            // follows the redirect chain and lands on the full metrics page.
            const response = await page.goto(alertUrl);
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            // Verify we landed on the metrics page
            await expect(pm.metricsPage.metricsPageIndicator,
                'Should be on the metrics page').toBeVisible({ timeout: 15000 });
            await expect(page,
                'URL should be /web/metrics after redirect').toHaveURL(/\/web\/metrics/);

            // Verify the stream name is shown (query context loaded)
            await expect(page.getByText(METRICS_STREAM_NAME).first(),
                'Metrics page should show the stream name').toBeVisible({ timeout: 10000 });

            // Verify data loaded — the Run Query button is no longer in loading state
            await expect(page.locator(pm.metricsPage.applyButton),
                'Metrics page should have Run Query button').toBeVisible({ timeout: 10000 });

            testLogger.info('alert_url redirects to metrics page with data loaded');
        } else {
            testLogger.warn('Webhook capture not active — skipping payload verification');
        }

        testLogger.info('Manual trigger test complete');
    });
});
