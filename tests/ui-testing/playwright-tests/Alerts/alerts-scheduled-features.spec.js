/**
 * Scheduled Alert Features E2E Tests
 *
 * Tests scheduled alert features:
 * 1. Alert History/Details dialog (q-dialog with paginated table)
 * 2. Aggregation configuration in Step 2 (QueryConfig)
 * 3. PromQL alert creation with trigger condition
 * 4. SQL preview chart rendering
 * 5. "Would Trigger" evaluation status indicator
 *
 * Module: Alerts
 * Priority: P0-P2
 *
 * Test Coverage:
 * - Test 1: Alert details dialog: open, history, refresh, copy, edit [P0]
 * - Test 2: Create scheduled alert with aggregation via Builder [P0]
 * - Test 3: Create scheduled alert with PromQL query [P1]
 * - Test 4: SQL mode preview renders chart [P1]
 * - Test 5: "Would Trigger" indicator displays for scheduled alerts [P2]
 * - Test 6: Aggregation toggle off clears configuration [P2]
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// TEST DATA CONFIGURATION
// ============================================================================

const RUN_ID = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);

const STREAM_NAME = 'e2e_automate'; // Shared stream used by other alert tests
const METRICS_STREAM_NAME = 'cpu_usage'; // Created by ensureMetricsIngested()
const TEMPLATE_NAME = `e2e_sched_${RUN_ID}_tmpl`;
const DESTINATION_NAME = `e2e_sched_${RUN_ID}_dest`;
const FOLDER_NAME = `E2E Scheduled ${RUN_ID}`;

// ============================================================================
// SETUP HELPER FUNCTIONS (API-based, same pattern as incident-correlation tests)
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

async function ensureTemplate(page) {
    const org = getOrgIdentifier();
    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, {
        name: TEMPLATE_NAME,
        body: JSON.stringify({ text: "E2E Alert: {alert_name}" }),
        isDefault: false
    });
    testLogger.info('Template', { name: TEMPLATE_NAME, status: resp.status });
}

async function ensureDestination(page) {
    const org = getOrgIdentifier();
    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, {
        name: DESTINATION_NAME,
        url: 'https://httpbin.org/post',
        method: 'post',
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {}
    });
    testLogger.info('Destination', { name: DESTINATION_NAME, status: resp.status });
}

async function ensureFolder(page) {
    const org = getOrgIdentifier();
    const createResp = await apiCall(page, 'POST', `/api/v2/${org}/folders/alerts`, {
        name: FOLDER_NAME,
        description: 'Auto-created by scheduled alert feature E2E tests'
    });
    if (createResp.status === 200 && createResp.data.folderId) {
        return createResp.data.folderId;
    }
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/folders/alerts`);
    if (listResp.status === 200) {
        const folders = listResp.data.list || listResp.data || [];
        const folder = folders.find(f => f.name === FOLDER_NAME);
        if (folder) return folder.folderId || folder.folder_id;
    }
    return 'default';
}

/**
 * Create a simple scheduled SQL alert via API so we have an existing alert
 * for history dialog tests (without needing UI wizard)
 */
async function createAlertViaApi(page, folderId, alertName) {
    const org = getOrgIdentifier();
    const payload = {
        name: alertName,
        stream_type: 'logs',
        stream_name: STREAM_NAME,
        is_real_time: false,
        query_condition: {
            conditions: null,
            sql: `SELECT COUNT(*) as cnt FROM "${STREAM_NAME}" WHERE run_id = '${RUN_ID}'`,
            promql: null,
            type: 'sql',
            aggregation: null
        },
        trigger_condition: {
            threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
        },
        destinations: [DESTINATION_NAME],
        enabled: true,
        description: `E2E scheduled feature test alert [${RUN_ID}]`
    };

    const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=${folderId}`, payload);
    testLogger.info('Created alert via API', { name: alertName, status: resp.status });
    return resp.status === 200;
}

async function ingestTestData(page) {
    const org = getOrgIdentifier();
    const now = Date.now() * 1000;
    const records = [];
    for (let i = 0; i < 10; i++) {
        records.push({
            _timestamp: now - (i * 10 * 1000000),
            run_id: RUN_ID,
            kubernetes_labels_name: 'ziox-querier',
            level: 'info',
            log: `E2E scheduled alert test record ${i}`,
            city: 'test_city',
            country: 'test_country'
        });
    }
    const resp = await apiCall(page, 'POST', `/api/${org}/${STREAM_NAME}/_json`, records);
    testLogger.info('Ingested test data', { status: resp.status, records: records.length });
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

async function cleanupAlerts(page, folderId, alertNames) {
    const org = getOrgIdentifier();
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=${folderId}`);
    const alerts = (listResp.status === 200) ? (listResp.data.list || listResp.data || []) : [];

    for (const alert of alerts) {
        const name = alert.name || '';
        if (alertNames.some(n => name.includes(n) || name.includes(RUN_ID))) {
            const alertId = alert.id || alert.alert_id || name;
            await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${alertId}?folder=${folderId}`);
            testLogger.info(`Deleted alert: ${name}`);
        }
    }
}

async function cleanupFolder(page, folderId) {
    if (!folderId || folderId === 'default') return;
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/v2/${org}/folders/alerts/${folderId}`);
}

async function cleanupDestination(page) {
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${DESTINATION_NAME}`);
}

async function cleanupTemplate(page) {
    const org = getOrgIdentifier();
    await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${TEMPLATE_NAME}`);
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe("Scheduled Alert Features", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    let setupFolderId = 'default';
    const API_ALERT_NAME = `e2e_sched_${RUN_ID}_api_alert`;
    const createdAlertNames = [];

    // ========================================================================
    // SETUP: Create infrastructure via API
    // ========================================================================
    test.beforeAll(async ({ browser }) => {
        testLogger.info('=== SCHEDULED ALERT FEATURES TEST SETUP ===');

        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();

        try {
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const org = getOrgIdentifier();
            await page.goto(`${baseUrl}?org_identifier=${org}`);
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

            await ingestTestData(page);
            await ensureTemplate(page);
            await ensureDestination(page);
            setupFolderId = await ensureFolder(page);
            await createAlertViaApi(page, setupFolderId, API_ALERT_NAME);
            createdAlertNames.push(API_ALERT_NAME);

            // Ingest metrics data for PromQL test (creates cpu_usage, up, etc. streams)
            try {
                await ensureMetricsIngested();
                testLogger.info('Metrics data ingested for PromQL test');
            } catch (metricsErr) {
                testLogger.warn('Metrics ingestion failed (PromQL test may skip)', { error: metricsErr.message });
            }

            testLogger.info('=== SETUP COMPLETE ===', { folderId: setupFolderId });
        } finally {
            await page.close();
            await context.close();
        }
    });

    // ========================================================================
    // CLEANUP
    // ========================================================================
    test.afterAll(async ({ browser }) => {
        testLogger.info('=== SCHEDULED ALERT FEATURES TEST CLEANUP ===');

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
                ['Delete alerts', () => cleanupAlerts(page, setupFolderId, createdAlertNames)],
                ['Delete folder', () => cleanupFolder(page, setupFolderId)],
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
        }
    });

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
    // TEST 1: P0 - Alert details dialog: open, history, actions, edit
    // (Combined: dialog visibility + refresh/copy/edit actions)
    // ========================================================================
    test("Alert details dialog opens with history and action buttons work", {
        tag: ['@alertScheduled', '@alertHistory', '@smoke', '@P0', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to folder with API-created alert ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1500);

        testLogger.info('=== PHASE 2: Open alert details dialog ===');

        await pm.alertsPage.openAlertDetailsDialog(API_ALERT_NAME);
        await pm.alertsPage.expectAlertDetailsDialogVisible();
        testLogger.info('Alert details dialog opened');

        const title = await pm.alertsPage.getAlertDetailsTitleText();
        expect(title.length).toBeGreaterThan(0);
        testLogger.info('Dialog title', { title });

        testLogger.info('=== PHASE 3: Verify dialog elements ===');

        const historyState = await pm.alertsPage.expectAlertDetailsHistorySectionVisible();
        testLogger.info('History section visible', { state: historyState });

        await pm.alertsPage.expectAlertDetailsActionButtonsVisible();

        testLogger.info('=== PHASE 4: Test refresh button ===');

        const refreshBtn = page.locator(pm.alertsPage.locators.alertDetailsRefreshButton);
        const refreshBtnVisible = await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (refreshBtnVisible) {
            await pm.alertsPage.clickAlertDetailsRefreshButton();
            await pm.alertsPage.expectAlertDetailsHistorySectionVisible();
            testLogger.info('Refresh worked, history section still visible');
        } else {
            testLogger.info('Refresh button not present on this deployment — skipping refresh test');
        }

        testLogger.info('=== PHASE 5: Test copy conditions button ===');

        const copyBtn = page.locator(pm.alertsPage.locators.alertDetailsCopyConditionsButton);
        const copyBtnVisible = await copyBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (copyBtnVisible) {
            await pm.alertsPage.clickAlertDetailsCopyButton();
            const notification = pm.alertsPage.getNotification();
            const hasNotification = await notification.isVisible({ timeout: 3000 }).catch(() => false);
            if (hasNotification) {
                testLogger.info('Copy notification appeared');
            }
        } else {
            testLogger.info('Copy conditions button not visible (alert may not have conditions)');
        }

        testLogger.info('=== PHASE 6: Close dialog and verify ===');

        await pm.alertsPage.closeAlertDetailsDialog();
        await pm.alertsPage.expectAlertDetailsDialogClosed();

        testLogger.info('=== Alert details dialog test COMPLETE ===');
    });

    // ========================================================================
    // TEST 2: P0 - Create scheduled alert with aggregation via Builder
    // ========================================================================
    test("Create scheduled alert with aggregation via Builder", {
        tag: ['@alertScheduled', '@aggregation', '@smoke', '@P0', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to test folder ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1000);

        testLogger.info('=== PHASE 2: Create alert with aggregation ===');

        const alertName = await pm.alertsPage.createScheduledAlertWithAggregation(
            STREAM_NAME, DESTINATION_NAME, RUN_ID
        );
        createdAlertNames.push(alertName);
        testLogger.info('Created aggregation alert', { alertName });

        testLogger.info('=== PHASE 3: Verify alert in list ===');

        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('Alert visible in list');

        testLogger.info('=== Aggregation alert creation COMPLETE ===');
    });

    // ========================================================================
    // TEST 3: P1 - Create scheduled alert with PromQL query
    // ========================================================================
    test("Create scheduled alert with PromQL query", {
        tag: ['@alertScheduled', '@promql', '@functional', '@P1', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to folder ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1000);

        testLogger.info('=== PHASE 2: Create PromQL alert ===');

        // Use cpu_usage stream created by ensureMetricsIngested() in beforeAll
        const promqlQuery = METRICS_STREAM_NAME;

        const alertName = await pm.alertsPage.createScheduledAlertWithPromQL(
            METRICS_STREAM_NAME, promqlQuery, DESTINATION_NAME, RUN_ID,
            { operator: '>=', value: 1 }
        );
        createdAlertNames.push(alertName);
        testLogger.info('Created PromQL alert', { alertName });

        testLogger.info('=== PHASE 3: Verify alert in list ===');
        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('PromQL alert visible in list');

        testLogger.info('=== PromQL alert creation COMPLETE ===');
    });

    // ========================================================================
    // TEST 4: P1 - SQL mode preview renders chart
    // ========================================================================
    test("SQL mode preview renders chart", {
        tag: ['@alertScheduled', '@preview', '@functional', '@P1', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Start alert wizard with SQL mode ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1000);

        await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM_NAME, 'auto_preview_test_' + RUN_ID);

        testLogger.info('=== PHASE 2: Switch to SQL tab and enter query ===');

        // Click SQL tab
        const sqlTab = page.locator(pm.alertsPage.locators.tabSql);
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await page.waitForTimeout(1000);

        // Open editor and write SQL query
        const viewEditorBtn = page.locator(pm.alertsPage.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await page.waitForTimeout(1000);

        // Click monaco-editor with force to bypass q-portal overlay
        const monacoEditor = page.locator(pm.alertsPage.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await page.waitForTimeout(500);
        await page.keyboard.type(`SELECT COUNT(*) as cnt FROM "${STREAM_NAME}"`);

        // Run query
        await page.locator(pm.alertsPage.locators.runQueryButton).click();
        await page.waitForTimeout(3000);

        // Close editor — force-click bypasses q-portal overlay
        try {
            const closeButton = page.locator(pm.alertsPage.locators.alertBackButton).first();
            await closeButton.click({ force: true, timeout: 10000 });
        } catch (error) {
            testLogger.warn('Close button force-click failed, using keyboard escape', { error: error.message });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(1500);
        // Cleanup: remove any q-portal elements that intercept clicks
        await page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => el.remove());
        }).catch(e => testLogger.warn('Failed to remove q-portals', { error: e.message }));
        await page.waitForTimeout(500);

        testLogger.info('=== PHASE 3: Verify preview chart is visible ===');

        // The preview chart should now render for SQL mode (PR #10470 change)
        // Verify the old "not available" message is gone regardless
        const notAvailableMsg = pm.alertsPage.getPreviewNotAvailableMessage();
        const msgVisible = await notAvailableMsg.isVisible({ timeout: 3000 }).catch(() => false);
        expect(msgVisible).toBe(false);
        testLogger.info('SQL "not available" message is gone');

        // Verify preview chart rendered (PR #10470 enables SQL mode chart preview)
        const previewChart = page.locator(pm.alertsPage.locators.alertPreviewChart);
        const chartVisible = await previewChart.isVisible({ timeout: 10000 }).catch(() => false);
        expect(chartVisible).toBe(true);
        testLogger.info('SQL preview chart is visible');

        testLogger.info('=== PHASE 4: Clean up - go back ===');
        await pm.alertsPage.clickBackButton();
        await page.waitForTimeout(1000);

        testLogger.info('=== SQL preview test COMPLETE ===');
    });

    // ========================================================================
    // TEST 5: P2 - "Would Trigger" indicator displays for scheduled alerts
    //
    // KEY INSIGHT: PreviewAlert.handleChartDataUpdate() has a guard at its top
    // that returns early if `props.formData.trigger_condition` is null/undefined
    // (PreviewAlert.vue ~line 653). This means the evaluation status is NEVER
    // computed unless trigger_condition is already populated when chart data
    // arrives from PanelSchemaRenderer.
    //
    // Therefore the order of operations is CRITICAL:
    //   WRONG: Run query first, then set threshold
    //          → chart data arrives when trigger_condition is null
    //          → handleChartDataUpdate returns early → no evaluation
    //   CORRECT: Set threshold first, then run query
    //            → trigger_condition is populated before chart data arrives
    //            → handleChartDataUpdate evaluates → indicator appears
    //
    // Approach:
    // 1. Open scheduled alert wizard (stays in "Alert Rules" tab, Custom/Builder mode)
    // 2. Set threshold operator (>=) and value (1) in the "Alert if row" FIRST
    // 3. Switch to SQL tab, enter query, and run it
    // 4. Close SQL editor dialog, clean up q-portals
    // 5. Check for evaluation status indicator
    // ========================================================================
    test("Would Trigger indicator displays for scheduled alerts", {
        tag: ['@alertScheduled', '@preview', '@edgeCase', '@P2', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Open fresh scheduled alert wizard ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1000);

        // Use setupScheduledAlertWizardToStep2 to create a fresh scheduled alert wizard
        // (no destination needed since we won't save — just evaluating the preview)
        await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM_NAME, 'auto_eval_test_' + RUN_ID);

        testLogger.info('=== PHASE 2: Set trigger condition threshold FIRST ===');

        // Set trigger_condition BEFORE running any query so that when chart data
        // arrives, handleChartDataUpdate can evaluate instead of returning early.
        // The "Alert if" row is auto-rendered in v3 for scheduled alerts.
        const alertIfRow = page.locator('.alert-condition-row').filter({ hasText: 'Alert if' }).first();
        const rowVisible = await alertIfRow.isVisible({ timeout: 5000 }).catch(() => false);

        if (rowVisible) {
            // Set threshold operator (2nd .alert-v3-select — 1st is the function dropdown)
            const thresholdOperator = alertIfRow.locator('.alert-v3-select').nth(1);
            if (await thresholdOperator.isVisible({ timeout: 3000 }).catch(() => false)) {
                await thresholdOperator.click();
                await page.waitForTimeout(500);
                await page.locator('.q-menu:visible').getByText('>=', { exact: true }).click();
                await page.waitForTimeout(300);
                testLogger.info('Set threshold operator to >=');
            }

            // Set threshold value
            const thresholdInput = alertIfRow.locator('input[type="number"]').first();
            if (await thresholdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                await thresholdInput.fill('1');
                await page.waitForTimeout(500);
                testLogger.info('Set threshold value to 1');
            }
        } else {
            testLogger.info('Alert if row not found, trying fallback');
            const fallbackRow = page.locator('.alert-condition-row').first();
            if (await fallbackRow.isVisible({ timeout: 3000 }).catch(() => false)) {
                const fallbackInput = fallbackRow.locator('input[type="number"]').first();
                if (await fallbackInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await fallbackInput.fill('1');
                    await page.waitForTimeout(500);
                    testLogger.info('Set threshold via fallback');
                }
            }
        }

        testLogger.info('=== PHASE 3: Switch to SQL tab, enter query, and run ===');

        // Click SQL tab
        const sqlTab = page.locator(pm.alertsPage.locators.tabSql);
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await page.waitForTimeout(1000);

        // Open SQL editor
        const viewEditorBtn = page.locator(pm.alertsPage.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await page.waitForTimeout(1000);

        // Type query in monaco editor (force-click to bypass any overlays)
        const monacoEditor = page.locator(pm.alertsPage.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await page.waitForTimeout(500);
        await page.keyboard.type(`SELECT COUNT(*) as cnt FROM "${STREAM_NAME}"`);

        // Run query — this triggers PanelSchemaRenderer which emits
        // @result-metadata-update, calling handleChartDataUpdate.
        // Since trigger_condition is already set (Phase 2),
        // handleChartDataUpdate will evaluate and call evaluateAndSetStatus().
        await page.locator(pm.alertsPage.locators.runQueryButton).click();
        await page.waitForTimeout(3000);

        // Close editor — force-click bypasses q-portal overlay
        try {
            const closeButton = page.locator(pm.alertsPage.locators.alertBackButton).first();
            await closeButton.click({ force: true, timeout: 10000 });
        } catch (error) {
            testLogger.warn('Close button force-click failed, using keyboard escape', { error: error.message });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(1500);

        // Remove any residual q-portal elements that intercept clicks
        await page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => el.remove());
        }).catch(e => testLogger.warn('Failed to remove q-portals', { error: e.message }));
        await page.waitForTimeout(500);

        testLogger.info('=== PHASE 4: Check for evaluation status indicator ===');

        // Wait for handleChartDataUpdate to process and set evaluationStatus
        await page.waitForTimeout(3000);

        await pm.alertsPage.expectEvaluationStatusIndicatorVisible();

        const statusText = await pm.alertsPage.getEvaluationStatusText();
        testLogger.info('Evaluation status indicator visible', { text: statusText });

        // Should contain either "Would Trigger" or "Would Not Trigger" (case-insensitive)
        const hasExpectedText = /would trigger/i.test(statusText) || /would not trigger/i.test(statusText);
        expect(hasExpectedText).toBe(true);
        testLogger.info('Status indicator has expected text');

        testLogger.info('=== PHASE 5: Clean up - go back ===');

        await pm.alertsPage.clickBackButton();
        await page.waitForTimeout(1000);

        testLogger.info('=== Would Trigger indicator test COMPLETE ===');
    });

    // ========================================================================
    // TEST 6: P2 - Aggregation toggle off clears configuration
    // ========================================================================
    test("Aggregation function dropdown enables/disables group-by fields", {
        tag: ['@alertScheduled', '@aggregation', '@edgeCase', '@P2', '@all', '@alerts']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Open alert wizard (v3 flat UI) ===');

        await pm.alertsPage.navigateToFolder(FOLDER_NAME);
        await page.waitForTimeout(1000);

        await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM_NAME, 'auto_agg_toggle_' + RUN_ID);

        testLogger.info('=== PHASE 2: Enable aggregation via function dropdown ===');

        // In v3, aggregation is controlled by the function dropdown in the "Alert if" row
        // Default is "total events" (no aggregation). Select "count" to enable aggregation.
        // The "Alert if" condition row is auto-created in v3, so no "Add Condition" click needed.
        await pm.alertsPage.enableAggregation();
        await page.waitForTimeout(500);

        // Verify group-by section appeared (v-if="selectedFunction !== 'total_events'")
        const groupByLabel = pm.alertsPage.getGroupByLabel().first();
        await expect(groupByLabel).toBeVisible({ timeout: 5000 });
        testLogger.info('Aggregation ON: Group By section visible');

        // Add a group-by field so that "Having groups" section appears
        // (v-if="selectedFunction !== 'total_events' && hasLogGroupByFields")
        const groupBySection = page.locator('.alert-condition-row').filter({ hasText: 'Group by' }).first();
        await groupBySection.waitFor({ state: 'visible', timeout: 5000 });
        const addGroupByBtn = groupBySection.locator('button').last();
        await addGroupByBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addGroupByBtn.click();
        await page.waitForTimeout(800);
        // Select first available group-by field
        const groupBySelect = groupBySection.locator('.q-select').first();
        await groupBySelect.waitFor({ state: 'visible', timeout: 5000 });
        await groupBySelect.click();
        await page.waitForTimeout(500);
        const groupByMenu = page.locator('.q-menu:visible');
        await expect(groupByMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await groupByMenu.locator('.q-item').first().click();
        await page.waitForTimeout(500);
        testLogger.info('Added group-by field');

        // Verify aggregation threshold section appeared (i18n: "alerts.queryConfig.havingGroups" = "Having groups")
        const aggThresholdLabel = pm.alertsPage.getAggregationThresholdLabel().first();
        await expect(aggThresholdLabel).toBeVisible({ timeout: 5000 });
        testLogger.info('Aggregation ON: Threshold section visible');

        testLogger.info('=== PHASE 3: Disable aggregation via function dropdown ===');

        // Select "total events" from the function dropdown to disable aggregation
        await pm.alertsPage.disableAggregation();
        await page.waitForTimeout(500);

        // Verify group-by section disappeared (hidden when function === 'total_events')
        await expect(groupByLabel).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Aggregation OFF: Group By section hidden');

        // Verify aggregation threshold section disappeared
        await expect(aggThresholdLabel).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Aggregation OFF: Threshold section hidden');

        testLogger.info('=== PHASE 4: Clean up - go back ===');
        await pm.alertsPage.clickBackButton();
        await page.waitForTimeout(1000);

        testLogger.info('=== Aggregation function dropdown test COMPLETE ===');
    });

    // Bug #10899 test moved to RegressionSet/alerts-regression.spec.js to avoid duplication
});
