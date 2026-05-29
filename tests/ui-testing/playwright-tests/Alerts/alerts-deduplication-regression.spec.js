/**
 * Deduplication Regression Tests
 *
 * REGRESSION TEST: Verifies the fix for the bug where removing all fingerprint fields
 * from an alert would not set deduplication.enabled to false, causing unexpected behavior.
 *
 * Bug description:
 * - When adding fingerprint fields: correctly sets enabled: true, fingerprint_fields: [...]
 * - When removing all fields: sets fingerprint_fields: [] but INCORRECTLY kept enabled: true
 * - This caused the backend to attempt deduplication without proper fingerprint configuration
 *
 * Test Coverage:
 * - Test 1: Create alert with fingerprint fields via API
 * - Test 2: Edit alert via UI, remove all fingerprint fields
 * - Test 3: Verify API payload has enabled: false (regression check)
 *
 * Module: Alerts / Deduplication
 * Priority: P0 (Regression)
 * Tags: @regression, @deduplication, @enterprise
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Test configuration
const TEST_STREAM = 'e2e_automate';
const NETWORK_IDLE_TIMEOUT_MS = 30000;

test.describe("Deduplication Regression Tests", {
    tag: ['@regression', '@deduplication', '@enterprise', '@alerts']
}, () => {
    let pm;
    let alertName;
    let templateName;
    let destinationName;
    let uniqueSuffix;
    let orgId;
    let createdAlertId; // Track for cleanup

    test.beforeAll(async ({ browser }) => {
        // Get org identifier inside beforeAll to ensure env vars are available
        orgId = getOrgIdentifier();

        // Generate unique suffix for this test run
        uniqueSuffix = `dedup_reg_${Date.now().toString(36).slice(-6)}`;
        templateName = `auto_tmpl_${uniqueSuffix}`;
        destinationName = `auto_dest_${uniqueSuffix}`;
        alertName = `auto_dedup_alert_${uniqueSuffix}`;

        testLogger.info('Starting deduplication regression test suite', { uniqueSuffix, orgId });
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
    });

    test("REGRESSION: Removing fingerprint fields should disable deduplication", async ({ page }) => {
        /**
         * This is the main regression test for the bug where:
         * - Removing all fingerprint fields did NOT set enabled: false
         *
         * Test flow:
         * 1. Create template, destination, alert via API (fast setup)
         * 2. Navigate to alerts UI
         * 3. Edit alert, REMOVE all fingerprint fields via UI
         * 4. Intercept API call and verify payload has enabled: false
         * 5. Verify saved alert reflects disabled deduplication
         */

        testLogger.info('=== REGRESSION TEST: Fingerprint fields removal ===');

        // ==================== SETUP VIA API ====================

        // First, ensure the test stream exists by ingesting minimal data
        const testData = [
            {
                _timestamp: Date.now() * 1000,
                log: "test dedup regression data",
                host: "test-host",
                service: "test-service"
            }
        ];
        const ingestResp = await page.request.post(
            `${process.env.ZO_BASE_URL}/api/${orgId}/${TEST_STREAM}/_json`,
            {
                data: testData,
                headers: { "Content-Type": "application/json" }
            }
        );
        if (!ingestResp.ok()) {
            testLogger.warn('Data ingestion failed (stream may already exist)', {
                status: ingestResp.status()
            });
        } else {
            testLogger.info('Test data ingested to ensure stream exists', { stream: TEST_STREAM });
        }

        // Create template
        const templatePayload = {
            name: templateName,
            body: '{"text": "Alert: {alert_name}"}'
        };
        const templateResp = await page.request.post(
            `${process.env.ZO_BASE_URL}/api/${orgId}/alerts/templates`,
            { data: templatePayload }
        );
        expect(templateResp.ok()).toBeTruthy();
        testLogger.info('Template created via API', { templateName });

        // Create destination
        // Use localhost mock URL to avoid external network dependencies in CI
        const webhookUrl = process.env.WEBHOOK_URL || `http://localhost:5080/api/${orgId}/mock-webhook`;
        const destPayload = {
            name: destinationName,
            url: webhookUrl,
            method: "post",
            skip_tls_verify: true,
            template: templateName,
            headers: {}
        };
        const destResp = await page.request.post(
            `${process.env.ZO_BASE_URL}/api/${orgId}/alerts/destinations`,
            { data: destPayload }
        );
        expect(destResp.ok()).toBeTruthy();
        testLogger.info('Destination created via API', { destinationName });

        // Create alert with deduplication enabled
        const alertPayload = {
            name: alertName,
            row_template: templateName,
            stream_type: "logs",
            stream_name: TEST_STREAM,
            is_real_time: false,
            query_condition: {
                conditions: [{ column: "log", operator: "=", value: "test", id: `cond_${uniqueSuffix}` }],
                type: "custom",
                sql: "",
                promql: ""
            },
            trigger_condition: {
                period: 5,
                operator: ">=",
                frequency: 1,
                threshold: 1,
                silence: 0,
                frequency_type: "minutes"
            },
            destinations: [destinationName],
            enabled: true,
            deduplication: {
                enabled: true,
                fingerprint_fields: ["log"],  // Fingerprint field to be removed via UI
                time_window_minutes: 15
            }
        };

        const alertResp = await page.request.post(
            `${process.env.ZO_BASE_URL}/api/v2/${orgId}/alerts`,
            { data: alertPayload }
        );

        testLogger.info('Alert creation response', {
            status: alertResp.status(),
            ok: alertResp.ok()
        });

        if (!alertResp.ok()) {
            const errorText = await alertResp.text();
            testLogger.error('Failed to create alert', { errorText });
        }

        expect(alertResp.ok()).toBeTruthy();
        testLogger.info('Alert created via API with deduplication enabled', { alertName });

        // ==================== VERIFY INITIAL STATE ====================
        // First, list all alerts to find our alert
        const listAlertsUrl = `${process.env.ZO_BASE_URL}/api/v2/${orgId}/alerts`;
        testLogger.info('Listing all alerts to find created alert', { url: listAlertsUrl });

        const listResponse = await page.request.get(listAlertsUrl);
        testLogger.info('List alerts response', { status: listResponse.status() });

        let initialAlertData = null;
        let alertId = null;

        if (listResponse.ok()) {
            const listData = await listResponse.json();

            // Handle different response formats
            const allAlerts = Array.isArray(listData) ? listData : (listData?.list || listData?.alerts || listData?.data || []);
            testLogger.info('Total alerts found', { count: allAlerts?.length || 0 });

            // Find our alert in the list to get its ID
            if (Array.isArray(allAlerts)) {
                const ourAlert = allAlerts.find(a => a.name === alertName);
                if (ourAlert) {
                    alertId = ourAlert.alert_id;
                    createdAlertId = alertId; // Store for cleanup in afterAll
                    testLogger.info('Found alert in list', {
                        name: ourAlert.name,
                        alert_id: alertId
                    });
                } else {
                    testLogger.warn('Alert not found in list', { alertName });
                }
            }
        }

        expect(alertId).not.toBeNull();

        // Fetch full alert details using alert_id
        const getAlertUrl = `${process.env.ZO_BASE_URL}/api/v2/${orgId}/alerts/${alertId}`;
        testLogger.info('Fetching full alert details', { url: getAlertUrl });

        const getAlertResponse = await page.request.get(getAlertUrl);
        testLogger.info('GET alert response', { status: getAlertResponse.status() });

        expect(getAlertResponse.ok()).toBeTruthy();
        initialAlertData = await getAlertResponse.json();

        testLogger.info('Initial alert state', {
            deduplication: initialAlertData.deduplication
        });

        // Verify initial state has dedup enabled with fingerprint fields
        expect(initialAlertData.deduplication).toBeDefined();
        expect(initialAlertData.deduplication.enabled).toBe(true);
        expect(initialAlertData.deduplication.fingerprint_fields).toContain('log');

        // ==================== NAVIGATE TO ALERTS UI ====================
        const alertsUrl = `${process.env.ZO_BASE_URL}/web/alerts?org_identifier=${orgId}`;
        await page.goto(alertsUrl);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        // Wait for the alert list page chrome to mount via PO factory landmark.
        await pm.alertsPage.waitForAlertListReady(NETWORK_IDLE_TIMEOUT_MS);

        testLogger.info('Navigated to alerts page');

        // ==================== EDIT ALERT TO REMOVE FINGERPRINT FIELDS ====================
        testLogger.info('Editing alert to remove fingerprint fields...');

        // Set up request interception to capture the PUT payload
        // Note: PUT endpoint uses alertId, not alertName
        let capturedPutPayload = null;

        await page.route(`**/api/v2/${orgId}/alerts/**`, async (route) => {
            const request = route.request();
            if (request.method() === 'PUT' && request.url().includes(alertId)) {
                capturedPutPayload = request.postDataJSON();
                testLogger.info('Captured PUT payload', {
                    url: request.url(),
                    deduplication: capturedPutPayload?.deduplication
                });
            }
            await route.continue();
        });

        // Search for the alert via PO (locator hoisted into AlertManagement)
        await pm.alertsPage.searchAlert(alertName);

        // Open the alert edit screen (clicks the update pencil button by alert name)
        await pm.alertsPage.openAlertEditByName(alertName);
        testLogger.info('Opened alert for editing');

        // v3 wizard: layout is single-pane with tabs (`condition` / `advanced`).
        // Deduplication section is rendered inside the `advanced` tab.
        await pm.alertsPage.openAdvancedTab();
        testLogger.info('Switched to Advanced tab — deduplication panel ready');

        // Sanity check: dedup OSelect should report the seeded `log` fingerprint field.
        const initialSelection = await pm.alertsPage.getSelectedFingerprintFields();
        testLogger.info('Initial fingerprint selection (UI)', { initialSelection });
        expect(initialSelection).toContain('log');

        // Remove all fingerprint field selections via the OSelect popover.
        const removedCount = await pm.alertsPage.removeAllFingerprintFields();
        expect(removedCount).toBeGreaterThan(0);
        testLogger.info('Chip removal complete', { removedCount });

        // Verify trigger reports empty selection before saving.
        const postRemoval = await pm.alertsPage.getSelectedFingerprintFields();
        expect(postRemoval.length).toBe(0);

        // Submit the alert edit (Save) and wait for success toast.
        await pm.alertsPage.submitAlertEdit();
        testLogger.info('Alert updated successfully');

        // ==================== VERIFY - The Critical Assertion ====================
        // This is the regression check: when fingerprint_fields is empty, enabled MUST be false

        // IMPORTANT: Test MUST fail if we couldn't capture the PUT payload
        // This ensures we're actually testing the regression, not silently passing
        expect(capturedPutPayload).not.toBeNull();

        const dedup = capturedPutPayload.deduplication || {};

        testLogger.info('=== REGRESSION CHECK ===', {
            enabled: dedup.enabled,
            fingerprint_fields: dedup.fingerprint_fields
        });

        // THE KEY ASSERTION: enabled should be false when fingerprint_fields is empty
        // This is the actual regression test - we ALWAYS verify this
        const hasEmptyFields = dedup.fingerprint_fields?.length === 0 || !dedup.fingerprint_fields;
        if (hasEmptyFields) {
            expect(dedup.enabled).toBe(false);
            testLogger.info('REGRESSION TEST PASSED: enabled is false when fingerprint_fields is empty');
        } else {
            // If fingerprint_fields is not empty, the UI didn't remove them properly
            // Use explicit fail with descriptive message
            testLogger.error('Fingerprint fields were not removed by UI', { fingerprint_fields: dedup.fingerprint_fields });
            throw new Error(`UI failed to remove fingerprint fields. Expected empty array, got: ${JSON.stringify(dedup.fingerprint_fields)}`);
        }

        // ==================== Double-check via API ====================
        // Use the same alert_id to fetch updated details
        testLogger.info('Fetching final alert state', { alertId });
        const finalGetResponse = await page.request.get(
            `${process.env.ZO_BASE_URL}/api/v2/${orgId}/alerts/${alertId}`
        );

        testLogger.info('Final GET response', { status: finalGetResponse.status(), ok: finalGetResponse.ok() });

        expect(finalGetResponse.ok()).toBeTruthy();
        const finalAlertData = await finalGetResponse.json();

        testLogger.info('Final alert data keys', { keys: Object.keys(finalAlertData) });

        testLogger.info('Final alert state', {
            deduplication: finalAlertData.deduplication
        });

        // Final verification - deduplication should be disabled
        // Acceptable states when fingerprint fields are removed:
        // 1. deduplication object is undefined/null (completely disabled)
        // 2. deduplication.enabled is false
        // 3. deduplication.fingerprint_fields is empty/null

        const finalDedup = finalAlertData.deduplication;

        if (!finalDedup) {
            // Case 1: deduplication object is completely removed - this is acceptable
            testLogger.info('=== REGRESSION TEST PASSED ===');
            testLogger.info('Deduplication object is null/undefined - deduplication is disabled');
        } else if (!finalDedup.fingerprint_fields || finalDedup.fingerprint_fields.length === 0) {
            // Case 2: fingerprint_fields is empty - enabled should be false
            expect(finalDedup.enabled).toBe(false);
            testLogger.info('=== REGRESSION TEST PASSED ===');
            testLogger.info('Deduplication is correctly disabled when fingerprint_fields is empty');
        } else {
            // Fingerprint fields are still present - this shouldn't happen after we removed them
            testLogger.warn('Fingerprint fields still present', {
                fingerprint_fields: finalDedup.fingerprint_fields,
                enabled: finalDedup.enabled
            });
            // Fail the test - fields should have been removed
            expect(finalDedup.fingerprint_fields.length).toBe(0);
        }
    });

    test.afterAll(async ({ browser }) => {
        // Cleanup via API - delete created resources
        testLogger.info('Cleaning up test resources...', { uniqueSuffix });

        // Create a new context for cleanup API calls
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // Delete alert if created
            if (createdAlertId) {
                const alertResp = await page.request.delete(
                    `${process.env.ZO_BASE_URL}/api/v2/${orgId}/alerts/${createdAlertId}`
                );
                testLogger.info('Deleted alert', { alertId: createdAlertId, status: alertResp.status() });
            }

            // Delete destination
            if (destinationName) {
                const destResp = await page.request.delete(
                    `${process.env.ZO_BASE_URL}/api/${orgId}/alerts/destinations/${destinationName}`
                );
                testLogger.info('Deleted destination', { destinationName, status: destResp.status() });
            }

            // Delete template
            if (templateName) {
                const tmplResp = await page.request.delete(
                    `${process.env.ZO_BASE_URL}/api/${orgId}/alerts/templates/${templateName}`
                );
                testLogger.info('Deleted template', { templateName, status: tmplResp.status() });
            }
        } catch (error) {
            testLogger.warn('Cleanup error (non-fatal)', { error: error.message });
        } finally {
            await context.close();
        }

        testLogger.info('Deduplication regression tests completed', { uniqueSuffix });
    });
});
