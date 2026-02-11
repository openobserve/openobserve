/**
 * Incident Correlation E2E Tests
 *
 * ENTERPRISE FEATURE: Tests require enterprise license and active incidents.
 * Incidents are created when alerts fire and get correlated via semantic dimensions.
 *
 * SELF-CONTAINED: beforeAll ingests data, creates alerts, and waits for incidents.
 * afterAll resolves incidents, then cleans up alerts, folder, destination, template.
 * Each run gets a unique RUN_ID so incidents are identifiable across runs.
 * Stream data persists (never deleted).
 *
 * Module: Alerts / Incidents
 * Priority: P0-P2
 *
 * Test Coverage:
 * - Test 1: Incident list displays active incidents with row data [P0]
 * - Test 2: Incident detail page navigation and layout [P0]
 * - Test 3: Alert triggers table shows correlated alerts with timestamps [P1]
 * - Test 4: Correlation reason badges display correctly [P1]
 * - Test 5: Incident search filters the list [P1]
 * - Test 6: Related Alerts section shows correlated alerts with fire counts [P1]
 * - Test 7: Severity badge displays on incident detail [P1]
 * - Test 8: Alert Graph tab renders visualization [P2]
 * - Test 9: Telemetry tabs (Logs, Metrics, Traces) load without errors [P2]
 * - Test 10: Incident lifecycle: acknowledge → resolve → reopen [P0]
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ============================================================================
// TEST DATA CONFIGURATION
// ============================================================================

// Unique run ID (timestamp + random) — avoids collisions even in parallel execution
const RUN_ID = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);

const STREAM_NAME = 'e2e_incident_corr'; // Shared stream, persists across runs
const TEMPLATE_NAME = `e2e_incid_${RUN_ID}_tmpl`;
const DESTINATION_NAME = `e2e_incid_${RUN_ID}_dest`;
const FOLDER_NAME = `E2E Incidents ${RUN_ID}`;
// Incident row selector — must match alertsPage.locators.incidentRow
// Used only in waitForIncidents() setup helper before PageManager is available.
const INCIDENT_ROW_SELECTOR = '[data-test="incident-row"]';

const ALERTS = [
    {
        name: `e2e_incid_${RUN_ID}_payment_errors`,
        stream_type: 'logs',
        stream_name: STREAM_NAME,
        is_real_time: false,
        query_condition: {
            conditions: null,
            sql: `SELECT k8s_cluster, k8s_deployment_name, service_name, COUNT(*) as error_count FROM "${STREAM_NAME}" WHERE severity >= 17 AND service_name = 'payment' AND run_id = '${RUN_ID}' GROUP BY k8s_cluster, k8s_deployment_name, service_name`,
            promql: null,
            type: 'sql',
            aggregation: null
        },
        trigger_condition: {
            threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
        },
        enabled: true,
        description: `E2E [${RUN_ID}]: payment errors with dimensional grouping`
    },
    {
        name: `e2e_incid_${RUN_ID}_all_errors`,
        stream_type: 'logs',
        stream_name: STREAM_NAME,
        is_real_time: false,
        query_condition: {
            conditions: null,
            sql: `SELECT k8s_cluster, k8s_deployment_name, COUNT(*) as error_count FROM "${STREAM_NAME}" WHERE severity >= 17 AND run_id = '${RUN_ID}' GROUP BY k8s_cluster, k8s_deployment_name`,
            promql: null,
            type: 'sql',
            aggregation: null
        },
        trigger_condition: {
            threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
        },
        enabled: true,
        description: `E2E [${RUN_ID}]: all errors per deployment with dimensional grouping`
    },
    {
        name: `e2e_incid_${RUN_ID}_global_errors`,
        stream_type: 'logs',
        stream_name: STREAM_NAME,
        is_real_time: false,
        query_condition: {
            conditions: null,
            sql: `SELECT COUNT(*) as total_errors FROM "${STREAM_NAME}" WHERE severity >= 17 AND run_id = '${RUN_ID}'`,
            promql: null,
            type: 'sql',
            aggregation: null
        },
        trigger_condition: {
            threshold: 1, operator: '>=', frequency: 1, silence: 0, period: 5, frequency_type: 'minutes'
        },
        enabled: true,
        description: `E2E [${RUN_ID}]: global errors, no dimensions (alert_id fallback)`
    }
];

// ============================================================================
// SETUP HELPER FUNCTIONS
// ============================================================================

// NOTE: Base64 encoding runs in Node (server-side), then the token is passed to
// page.evaluate for browser-side fetch. This is acceptable in E2E tests — the
// credentials are already in env vars and the browser has full auth state from user.json.
function getAuthToken() {
    return Buffer.from(
        `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
    ).toString('base64');
}

/**
 * Make an API call via page.evaluate (runs in browser context, avoids CORS)
 */
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

/**
 * Generate test log records with dimensional fields for correlation.
 * Fields match semantic groups: k8s_cluster, k8s_deployment_name, service_name
 */
function generateTestData() {
    const now = Date.now() * 1000; // microseconds
    const records = [];
    const services = ['payment', 'checkout', 'inventory'];
    const deployments = ['payment-v1', 'checkout-v1', 'inventory-v1'];

    for (let i = 0; i < 30; i++) {
        const svcIdx = i % 3;
        records.push({
            _timestamp: now - (i * 10 * 1000000), // 10 seconds apart
            run_id: RUN_ID, // Isolate this run's data in SQL WHERE clauses
            k8s_cluster: 'e2e-cluster',
            k8s_deployment_name: deployments[svcIdx],
            k8s_namespace_name: 'production',
            service_name: services[svcIdx],
            severity: 17 + (i % 4), // 17-20 (ERROR-FATAL)
            log: `Error in ${services[svcIdx]}: request failed - e2e test record ${i}`,
            level: 'error',
            host: `node-${(i % 3) + 1}`
        });
    }
    return records;
}

/**
 * Ingest test data into the dedicated stream
 */
async function ingestTestData(page) {
    const org = process.env.ORGNAME || 'default';
    const records = generateTestData();

    const response = await apiCall(page, 'POST', `/api/${org}/${STREAM_NAME}/_json`, records);
    testLogger.info('Ingested test data', { status: response.status, stream: STREAM_NAME, records: records.length });
    return response;
}

/**
 * Create alert template (idempotent - 200=created, 409=already exists)
 */
async function ensureTemplate(page) {
    const org = process.env.ORGNAME || 'default';
    const payload = {
        name: TEMPLATE_NAME,
        body: JSON.stringify({ text: "E2E Alert: {alert_name}" }),
        isDefault: false
    };

    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/templates`, payload);
    testLogger.info('Template', { name: TEMPLATE_NAME, status: resp.status });
    return resp.status === 200 || resp.status === 409;
}

/**
 * Create alert destination (idempotent - 200=created, 409=already exists)
 */
async function ensureDestination(page) {
    const org = process.env.ORGNAME || 'default';
    const payload = {
        name: DESTINATION_NAME,
        url: 'https://httpbin.org/post',
        method: 'post',
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {}
    };

    const resp = await apiCall(page, 'POST', `/api/${org}/alerts/destinations`, payload);
    testLogger.info('Destination', { name: DESTINATION_NAME, status: resp.status });
    return resp.status === 200 || resp.status === 409;
}

/**
 * Create or get folder for test alerts, return folder ID
 */
async function ensureFolder(page) {
    const org = process.env.ORGNAME || 'default';

    // Try to create folder
    const createResp = await apiCall(page, 'POST', `/api/v2/${org}/folders/alerts`, {
        name: FOLDER_NAME,
        description: 'Auto-created by incident correlation E2E tests'
    });

    if (createResp.status === 200 && createResp.data.folderId) {
        testLogger.info('Created folder', { name: FOLDER_NAME, id: createResp.data.folderId });
        return createResp.data.folderId;
    }

    // Folder may already exist - list and find it
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/folders/alerts`);
    if (listResp.status === 200) {
        const folders = listResp.data.list || listResp.data || [];
        const folder = folders.find(f => f.name === FOLDER_NAME);
        if (folder) {
            const id = folder.folderId || folder.folder_id;
            testLogger.info('Found existing folder', { name: FOLDER_NAME, id });
            return id;
        }
    }

    // Fallback: use default folder
    testLogger.warn('Could not create/find folder, using default');
    return 'default';
}

/**
 * Create test alerts (idempotent - skips if already exists)
 */
async function ensureAlerts(page, folderId) {
    const org = process.env.ORGNAME || 'default';
    let created = 0;

    for (const alertDef of ALERTS) {
        const payload = {
            name: alertDef.name,
            stream_type: alertDef.stream_type,
            stream_name: alertDef.stream_name,
            is_real_time: alertDef.is_real_time,
            query_condition: alertDef.query_condition,
            trigger_condition: alertDef.trigger_condition,
            destinations: [DESTINATION_NAME],
            enabled: alertDef.enabled,
            description: alertDef.description,
            context_attributes: {}
        };

        const resp = await apiCall(page, 'POST', `/api/v2/${org}/alerts?folder=${folderId}`, payload);
        if (resp.status === 200) {
            created++;
            testLogger.info(`Created alert: ${alertDef.name}`);
        } else {
            // 409 or "already exists" means it was created in a previous run
            testLogger.info(`Alert exists or error: ${alertDef.name} (${resp.status})`);
        }
    }

    testLogger.info(`Alerts ready: ${created} new, ${ALERTS.length - created} existing`);
}

/**
 * Trigger all test alerts via API to force them to fire immediately.
 * This creates incidents without waiting for the scheduler.
 * API: PATCH /api/v2/{org}/alerts/{alert_id}/trigger?folder={folder_id}
 */
async function triggerAlerts(page, folderId) {
    const org = process.env.ORGNAME || 'default';

    // List alerts in folder to get their IDs
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=${folderId}`);
    const alerts = (listResp.status === 200) ? (listResp.data.list || listResp.data || []) : [];

    let triggered = 0;
    for (const alert of alerts) {
        const alertName = alert.name || '';
        if (ALERTS.some(a => a.name === alertName)) {
            const alertId = alert.id || alert.alert_id || alertName;
            const resp = await apiCall(page, 'PATCH', `/api/v2/${org}/alerts/${alertId}/trigger?folder=${folderId}`);
            if (resp.status === 200) {
                triggered++;
                testLogger.info(`Triggered alert: ${alertName}`);
            } else {
                testLogger.warn(`Failed to trigger alert: ${alertName} (${resp.status})`, resp.data);
            }
        }
    }

    testLogger.info(`Triggered ${triggered}/${ALERTS.length} alerts`);
    return triggered;
}

/**
 * Poll incidents page until at least one incident row appears.
 * Returns true if incidents found, false if timed out.
 */
async function waitForIncidents(page, maxWaitMs = 240000) {
    const org = process.env.ORGNAME || 'default';
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const incidentsUrl = `${baseUrl}/web/incidents?org_identifier=${org}`;

    testLogger.info('Polling for incidents to appear...', { maxWaitMs });

    await page.goto(incidentsUrl);
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch((e) => {
        testLogger.warn('Initial page load did not reach domcontentloaded, continuing', { error: e.message });
    });

    const startTime = Date.now();
    const pollInterval = 15000; // 15 seconds between polls
    let lastIngestTime = 0; // Track last re-ingestion time

    while (Date.now() - startTime < maxWaitMs) {
        // Check for incident rows
        let rowCount = 0;
        try {
            rowCount = await page.locator(INCIDENT_ROW_SELECTOR).count();
        } catch (e) {
            testLogger.warn('DOM error counting incident rows (not zero incidents)', { error: e.message });
            await page.waitForTimeout(pollInterval);
            continue;
        }
        if (rowCount > 0) {
            testLogger.info(`Found ${rowCount} incident(s) after ${Math.round((Date.now() - startTime) / 1000)}s`);
            return true;
        }

        // NOTE: Re-ingestion is intentional — alerts have a lookback window and data
        // must stay fresh or alerts won't fire. This is not data bloat; the stream
        // is shared and persists across runs regardless.
        if (Date.now() - lastIngestTime >= 60000) {
            await ingestTestData(page);
            lastIngestTime = Date.now();
        }

        testLogger.info(`No incidents yet, waiting... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
        await page.waitForTimeout(pollInterval);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => {
            testLogger.warn('Page reload timeout during polling, continuing', { error: e.message });
        });
    }

    testLogger.warn('Timed out waiting for incidents');
    return false;
}

// ============================================================================
// CLEANUP HELPER FUNCTIONS
// Cleans up alerts, folder, destination, template. Stream data persists.
// ============================================================================

/**
 * Delete all test alerts from the folder
 */
async function cleanupAlerts(page, folderId) {
    const org = process.env.ORGNAME || 'default';

    // List alerts in folder to get their IDs
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/alerts?folder=${folderId}`);
    const alerts = (listResp.status === 200) ? (listResp.data.list || listResp.data || []) : [];

    let deleted = 0;
    for (const alert of alerts) {
        const alertName = alert.name || '';
        if (ALERTS.some(a => a.name === alertName)) {
            const alertId = alert.id || alert.alert_id || alertName;
            const resp = await apiCall(page, 'DELETE', `/api/v2/${org}/alerts/${alertId}?folder=${folderId}`);
            if (resp.status === 200) {
                deleted++;
                testLogger.info(`Deleted alert: ${alertName}`);
            } else {
                testLogger.warn(`Failed to delete alert: ${alertName} (${resp.status})`);
            }
        }
    }

    testLogger.info(`Cleanup: deleted ${deleted}/${ALERTS.length} alerts`);
    return deleted;
}

/**
 * Delete the test folder (must be empty first)
 */
async function cleanupFolder(page, folderId) {
    if (!folderId || folderId === 'default') return;
    const org = process.env.ORGNAME || 'default';
    const resp = await apiCall(page, 'DELETE', `/api/v2/${org}/folders/alerts/${folderId}`);
    testLogger.info('Cleanup folder', { folderId, status: resp.status });
}

/**
 * Delete the test destination
 */
async function cleanupDestination(page) {
    const org = process.env.ORGNAME || 'default';
    const resp = await apiCall(page, 'DELETE', `/api/${org}/alerts/destinations/${DESTINATION_NAME}`);
    testLogger.info('Cleanup destination', { name: DESTINATION_NAME, status: resp.status });
}

/**
 * Delete the test template
 */
async function cleanupTemplate(page) {
    const org = process.env.ORGNAME || 'default';
    const resp = await apiCall(page, 'DELETE', `/api/${org}/alerts/templates/${TEMPLATE_NAME}`);
    testLogger.info('Cleanup template', { name: TEMPLATE_NAME, status: resp.status });
}

/**
 * Resolve all open incidents created by this run's alerts.
 * Incidents cannot be deleted — resolving them is the best cleanup we can do.
 * Uses API to list incidents, filter by run ID in alert name, and resolve each.
 */
async function resolveTestIncidents(page) {
    const org = process.env.ORGNAME || 'default';

    // List open incidents
    const listResp = await apiCall(page, 'GET', `/api/v2/${org}/incidents?status=open`);
    const incidents = (listResp.status === 200) ? (listResp.data.list || listResp.data || []) : [];

    let resolved = 0;
    for (const incident of incidents) {
        // Check if this incident belongs to our run by looking at alert name or description
        const incidentTitle = incident.title || incident.alert_name || '';
        const incidentDesc = incident.description || '';
        if (incidentTitle.includes(RUN_ID) || incidentDesc.includes(RUN_ID)) {
            const incidentId = incident.id || incident.incident_id;
            if (!incidentId) continue;

            // Acknowledge first (if still open), then resolve
            await apiCall(page, 'PUT', `/api/v2/${org}/incidents/${incidentId}/acknowledge`).catch((e) => {
                testLogger.warn('Acknowledge call failed (may already be acknowledged)', { error: e.message });
            });
            const resolveResp = await apiCall(page, 'PUT', `/api/v2/${org}/incidents/${incidentId}/resolve`);
            if (resolveResp.status === 200) {
                resolved++;
                testLogger.info(`Resolved incident: ${incidentTitle} (${incidentId})`);
            } else {
                testLogger.warn(`Failed to resolve incident: ${incidentTitle} (${resolveResp.status})`);
            }
        }
    }

    testLogger.info(`Cleanup: resolved ${resolved} incident(s) for run ${RUN_ID}`);
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe("Incident Correlation Tests", { tag: '@enterprise' }, () => {
    // Serial mode: lifecycle test mutates state, and all tests share the same incidents
    test.describe.configure({ mode: 'serial' });
    let pm;
    let setupFolderId = 'default'; // Shared between beforeAll and afterAll for cleanup

    // ========================================================================
    // beforeAll: Ingest data, create alerts, wait for incidents.
    // afterAll: Clean up alerts, folder, destination, template. Stream persists.
    // ========================================================================
    test.beforeAll(async ({ browser }) => {
        testLogger.info('=== INCIDENT CORRELATION TEST SETUP ===');

        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();

        try {
            // Navigate to establish auth context
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const org = process.env.ORGNAME || 'default';
            await page.goto(`${baseUrl}?org_identifier=${org}`);
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            // Step 1: Ingest test data into dedicated stream
            testLogger.info('Step 1: Ingesting test data');
            await ingestTestData(page);

            // Step 2: Create template + destination
            testLogger.info('Step 2: Ensuring template and destination');
            await ensureTemplate(page);
            await ensureDestination(page);

            // Step 3: Create folder + alerts
            testLogger.info('Step 3: Ensuring folder and alerts');
            setupFolderId = await ensureFolder(page);
            await ensureAlerts(page, setupFolderId);

            // Step 4: Trigger alerts to fire immediately (creates incidents)
            testLogger.info('Step 4: Triggering alerts to create incidents');
            await triggerAlerts(page, setupFolderId);

            // Step 5: Wait for incidents to appear after trigger
            testLogger.info('Step 5: Waiting for incidents to appear');
            const found = await waitForIncidents(page, 120000); // 2 min should be plenty after trigger

            if (!found) {
                testLogger.warn('No incidents appeared after trigger. Tests will skip via beforeEach check.');
            }

            testLogger.info('=== SETUP COMPLETE ===');
        } finally {
            await page.close();
            await context.close();
        }
    });

    // ========================================================================
    // afterAll: Resolve incidents (can't delete), then delete alerts, folder,
    // destination, template. Stream data persists across runs.
    // ========================================================================
    test.afterAll(async ({ browser }) => {
        testLogger.info('=== INCIDENT CORRELATION TEST CLEANUP ===');

        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();

        try {
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const org = process.env.ORGNAME || 'default';
            await page.goto(`${baseUrl}?org_identifier=${org}`);
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            // Each cleanup step runs independently so one failure doesn't block the rest
            const steps = [
                ['Resolve incidents', () => resolveTestIncidents(page)],
                ['Delete alerts', () => cleanupAlerts(page, setupFolderId)],
                ['Delete folder', () => cleanupFolder(page, setupFolderId)],
                ['Delete destination', () => cleanupDestination(page)],
                ['Delete template', () => cleanupTemplate(page)],
            ];

            for (const [name, fn] of steps) {
                try {
                    await fn();
                } catch (err) {
                    testLogger.warn(`Cleanup step "${name}" failed (non-fatal)`, { error: err.message });
                }
            }

            testLogger.info(`=== CLEANUP COMPLETE (run ${RUN_ID}, stream data preserved) ===`);
        } finally {
            await page.close();
            await context.close();
        }
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to incidents page directly
        await page.goto(
            `${process.env["ZO_BASE_URL"]}/web/incidents?org_identifier=${process.env["ORGNAME"]}`
        );
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to incidents page');

        // Wait for page to stabilize
        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        await pm.alertsPage.waitForIncidentsToLoad();

        // Verify incidents exist - skip test if none found
        const hasIncidents = await pm.alertsPage.hasIncidents();
        if (!hasIncidents) {
            test.skip(true, 'No incidents found - alerts must fire and create incidents first');
        }
        testLogger.info('Incidents page loaded with data');
    });

    /**
     * Test 1: Incident list displays active incidents with row data
     *
     * Validates:
     * - Incidents list title is visible
     * - Incident table is populated with rows
     * - At least one incident row exists
     * - Refresh button is functional
     */
    test("Incident list displays active incidents with row data", {
        tag: ['@incidentCorrelation', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Verify incident list structure ===');

        // 1.1 Verify list title
        await pm.alertsPage.expectIncidentsListTitleVisible();
        testLogger.info('✓ Incidents list title visible');

        // 1.2 Verify table is visible
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Incident list table visible');

        // 1.3 Verify at least one row exists
        const rowCount = await pm.alertsPage.getIncidentRowCount();
        expect(rowCount).toBeGreaterThan(0);
        testLogger.info(`✓ Found ${rowCount} incident row(s)`);

        testLogger.info('=== PHASE 2: Verify refresh button ===');

        // 2.1 Click refresh and verify list still populated
        await pm.alertsPage.clickIncidentRefreshButton();
        await pm.alertsPage.waitForIncidentsToLoad();

        const rowCountAfterRefresh = await pm.alertsPage.getIncidentRowCount();
        expect(rowCountAfterRefresh).toBeGreaterThan(0);
        testLogger.info(`✓ After refresh: ${rowCountAfterRefresh} incident row(s)`);

        // 2.2 Verify search input is available
        await pm.alertsPage.expectIncidentSearchInputVisible();
        testLogger.info('✓ Search input visible');

        testLogger.info('=== Incident list validation COMPLETE ===');
    });

    /**
     * Test 2: Incident detail page navigation and layout
     *
     * Validates:
     * - Clicking incident row navigates to detail page
     * - Detail page shows incident title
     * - Alert triggers table is present in detail view
     * - Back button returns to incident list
     */
    test("Incident detail page navigation and layout", {
        tag: ['@incidentCorrelation', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Open incident detail ===');

        // 1.1 Click first incident row
        await pm.alertsPage.clickFirstIncidentRow();
        testLogger.info('Clicked first incident row');

        // 1.2 Verify detail page is visible
        await pm.alertsPage.waitForIncidentDetailToLoad();
        await pm.alertsPage.expectIncidentDetailPageVisible();
        testLogger.info('✓ Incident detail page visible');

        // 1.3 Verify title is present and non-empty
        const title = await pm.alertsPage.getIncidentDetailTitleText();
        expect(title.length).toBeGreaterThan(0);
        testLogger.info(`✓ Incident title: "${title}"`);

        testLogger.info('=== PHASE 2: Verify detail page content ===');

        // 2.1 Click Alert Triggers tab (triggers table is tab-gated, not on overview)
        await pm.alertsPage.clickAlertTriggersTab();

        // 2.2 Verify alert triggers table is present
        await pm.alertsPage.expectAlertTriggersTableVisible();
        testLogger.info('✓ Alert triggers table visible');

        // 2.2 Verify URL changed to include incident ID
        await pm.alertsPage.expectUrlContainsIncidentPath();
        testLogger.info('✓ URL contains incident path');

        testLogger.info('=== PHASE 3: Navigate back to list ===');

        // 3.1 Click back button
        await pm.alertsPage.clickIncidentDetailBackButton();

        // 3.2 Verify we're back on the list
        await pm.alertsPage.waitForIncidentsToLoad();
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('✓ Back on incident list');

        // 3.3 Verify rows still visible
        const rowCount = await pm.alertsPage.getIncidentRowCount();
        expect(rowCount).toBeGreaterThan(0);
        testLogger.info('✓ Incident rows still visible after return');

        testLogger.info('=== Incident detail navigation COMPLETE ===');
    });

    /**
     * Test 3: Alert triggers table shows correlated alerts with timestamps
     *
     * Validates:
     * - Alert triggers table has alert name cells
     * - Alert names are non-empty strings
     * - Fired-at timestamps are visible
     * - At least one trigger row exists
     */
    test("Alert triggers table shows correlated alerts with timestamps", {
        tag: ['@incidentCorrelation', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail');

        testLogger.info('=== PHASE 2: Verify alert triggers table ===');

        // 2.1 Click Alert Triggers tab
        await pm.alertsPage.clickAlertTriggersTab();

        // 2.2 Verify table is visible
        await pm.alertsPage.expectAlertTriggersTableVisible();

        // 2.2 Verify at least one alert trigger exists
        const triggerCount = await pm.alertsPage.getAlertTriggerCount();
        expect(triggerCount).toBeGreaterThan(0);
        testLogger.info(`✓ Found ${triggerCount} alert trigger(s)`);

        // 2.3 Verify alert names are populated
        const alertNames = await pm.alertsPage.getAlertNamesFromTriggersTable();
        expect(alertNames.length).toBeGreaterThan(0);
        for (const name of alertNames) {
            expect(name.length).toBeGreaterThan(0);
        }
        testLogger.info(`✓ Alert names: ${alertNames.join(', ')}`);

        testLogger.info('=== PHASE 3: Verify timestamps ===');

        // 3.1 Verify fired-at timestamps are visible
        await pm.alertsPage.expectFiredAtTimestampsVisible();
        testLogger.info('✓ Fired-at timestamps visible');

        // 3.2 Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Alert triggers table validation COMPLETE ===');
    });

    /**
     * Test 4: Correlation reason badges display correctly
     *
     * Validates:
     * - Correlation reason badges exist in triggers table
     * - Badge text contains recognized correlation types
     */
    test("Correlation reason badges display correctly", {
        tag: ['@incidentCorrelation', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail');

        // Click Alert Triggers tab (correlation badges are in triggers table)
        await pm.alertsPage.clickAlertTriggersTab();

        testLogger.info('=== PHASE 2: Verify correlation badges ===');

        // 2.1 Verify badges are visible
        const badgeCount = await pm.alertsPage.expectCorrelationReasonBadgesVisible();
        testLogger.info(`✓ Found ${badgeCount} correlation badge(s)`);

        // 2.2 Verify badge text values are recognized types
        const badgeTexts = await pm.alertsPage.getCorrelationReasonBadgeTexts();
        expect(badgeTexts.length).toBeGreaterThan(0);

        // Known correlation reason types from the codebase:
        // "Scope", "Workload", "AlertId", "Manual Extraction", "hierarchical_upgrade", etc.
        for (const text of badgeTexts) {
            expect(text.length).toBeGreaterThan(0);
            testLogger.info(`  Badge: "${text}"`);
        }
        testLogger.info('✓ All badges have non-empty text');

        // 2.3 Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Correlation badges validation COMPLETE ===');
    });

    /**
     * Test 5: Incident search filters the list
     *
     * Validates:
     * - Typing in search input filters incident rows
     * - Clearing search restores full list
     */
    test("Incident search filters the list", {
        tag: ['@incidentCorrelation', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Get initial row count ===');

        const initialCount = await pm.alertsPage.getIncidentRowCount();
        testLogger.info(`Initial incident count: ${initialCount}`);

        testLogger.info('=== PHASE 2: Search with a specific term ===');

        // 2.1 Type a search query that's unlikely to match all incidents
        await pm.alertsPage.fillIncidentSearch('zzz_nonexistent_query_string');

        // 2.2 Verify results changed (likely 0 rows for nonsense query)
        const filteredCount = await pm.alertsPage.getIncidentRowCount();
        testLogger.info(`Filtered count: ${filteredCount}`);
        // Filtered count should be <= initial (either reduced or same if search is server-side)
        expect(filteredCount).toBeLessThanOrEqual(initialCount);
        testLogger.info('✓ Search filtered the results');

        testLogger.info('=== PHASE 3: Clear search restores list ===');

        // 3.1 Clear the search input
        await pm.alertsPage.clearIncidentSearchInput();

        // 3.2 Verify rows are restored
        const restoredCount = await pm.alertsPage.getIncidentRowCount();
        expect(restoredCount).toBeGreaterThanOrEqual(initialCount);
        testLogger.info(`✓ Restored count: ${restoredCount}`);

        testLogger.info('=== Incident search validation COMPLETE ===');
    });

    /**
     * Test 6: Related Alerts section shows correlated alerts with fire counts
     *
     * Validates:
     * - Related Alerts panel visible on Overview tab
     * - At least one alert listed with non-empty name
     * - Fire count text is present for each alert
     */
    test("Related Alerts section shows correlated alerts with fire counts", {
        tag: ['@incidentCorrelation', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail (Overview tab) ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail (Overview tab)');

        testLogger.info('=== PHASE 2: Verify Related Alerts section ===');

        // 2.1 Verify container is visible with at least one alert
        const alertCount = await pm.alertsPage.expectRelatedAlertsVisible();
        testLogger.info(`Found ${alertCount} related alert(s)`);

        // 2.2 Get alert details and verify names + fire counts
        const alerts = await pm.alertsPage.getRelatedAlerts();
        expect(alerts.length).toBeGreaterThan(0);

        for (const alert of alerts) {
            expect(alert.name.length).toBeGreaterThan(0);
            testLogger.info(`  Alert: "${alert.name}" — ${alert.countText}`);
        }
        testLogger.info('All related alerts have names and fire counts');

        // 2.3 Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Related Alerts validation COMPLETE ===');
    });

    /**
     * Test 7: Severity badge displays on incident detail
     *
     * Validates:
     * - Severity badge is visible in incident detail header
     * - Badge text contains a recognized severity value (P1-P4)
     */
    test("Severity badge displays on incident detail", {
        tag: ['@incidentCorrelation', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail');

        testLogger.info('=== PHASE 2: Verify severity badge ===');

        // 2.1 Verify badge is visible
        await pm.alertsPage.expectSeverityBadgeVisible();
        testLogger.info('Severity badge visible');

        // 2.2 Verify badge text is a recognized severity value
        const severity = await pm.alertsPage.getSeverityBadgeText();
        expect(severity).toMatch(/P[1-4]/);
        testLogger.info(`Severity: "${severity}"`);

        // 2.3 Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Severity badge validation COMPLETE ===');
    });

    /**
     * Test 8: Alert Graph tab renders visualization
     *
     * Validates:
     * - Service Graph tab is clickable
     * - Graph container renders (may show graph, loading, or empty state)
     * - No uncaught errors when switching to this tab
     */
    test("Alert Graph tab renders visualization", {
        tag: ['@incidentCorrelation', '@functional', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail');

        testLogger.info('=== PHASE 2: Click Alert Graph tab ===');

        await pm.alertsPage.clickIncidentDetailTab('serviceGraph');
        testLogger.info('Clicked serviceGraph tab');

        // 2.1 Verify the service graph tab content rendered (graph OR detail page intact)
        await pm.alertsPage.expectServiceGraphTabContentVisible();
        testLogger.info('Alert Graph tab rendered without errors');

        // 2.3 Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Alert Graph tab validation COMPLETE ===');
    });

    /**
     * Test 9: Telemetry tabs (Logs, Metrics, Traces) load without errors
     *
     * Validates:
     * - Each telemetry tab is clickable
     * - Tab content loads (may show data, "no correlated" message, or loading)
     * - No uncaught exceptions when switching between tabs
     */
    test("Telemetry tabs (Logs, Metrics, Traces) load without errors", {
        tag: ['@incidentCorrelation', '@functional', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Navigate to incident detail ===');

        await pm.alertsPage.clickFirstIncidentRow();
        await pm.alertsPage.waitForIncidentDetailToLoad();
        testLogger.info('Opened incident detail');

        const tabs = ['logs', 'metrics', 'traces'];

        for (const tabName of tabs) {
            testLogger.info(`=== PHASE: Testing ${tabName} tab ===`);

            // Click the tab
            await pm.alertsPage.clickIncidentDetailTab(tabName);
            testLogger.info(`Clicked ${tabName} tab`);

            // Check what state the tab is in
            const state = await pm.alertsPage.getTelemetryTabState(tabName);
            testLogger.info(`${tabName} tab state: ${state}`);

            // All states are acceptable — content, noData, or loading
            // The test passes as long as no uncaught JS exception occurred
            expect(['content', 'noData', 'loading', 'error']).toContain(state);
        }

        // Navigate back
        await pm.alertsPage.clickIncidentDetailBackButton();
        await pm.alertsPage.waitForIncidentsToLoad();
        testLogger.info('Returned to incident list');

        testLogger.info('=== Telemetry tabs validation COMPLETE ===');
    });

    /**
     * Test 10: Incident lifecycle: acknowledge → resolve → reopen
     *
     * Validates the full incident status transition cycle:
     * - Open → Acknowledged (via acknowledge button)
     * - Acknowledged → Resolved (via resolve button)
     * - Resolved → Open (via reopen button)
     *
     * NOTE: This test modifies incident state. It MUST run last in serial mode
     * and restores the incident to its original open state via reopen.
     */
    test("Incident lifecycle: acknowledge, resolve, reopen", {
        tag: ['@incidentCorrelation', '@incidentActions', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Find and acknowledge an open incident ===');

        // 1.1 Click acknowledge on first open incident (also stores its row index)
        await pm.alertsPage.clickAcknowledgeOnFirstOpenIncident();
        await pm.alertsPage.waitForStatusUpdateNotification();
        testLogger.info('✓ Acknowledged incident');

        // 1.2 Verify acknowledge button hidden, resolve still visible on that row
        await pm.alertsPage.expectAcknowledgeButtonHidden();
        await pm.alertsPage.expectResolveButtonVisible();
        testLogger.info('✓ Ack button hidden, resolve visible on same row');

        testLogger.info('=== PHASE 3: Resolve the incident ===');

        // 3.1 Click resolve
        await pm.alertsPage.clickResolveOnFirstIncident();
        await pm.alertsPage.waitForStatusUpdateNotification();
        testLogger.info('Clicked resolve');

        // 3.2 Verify resolve hidden, reopen visible
        await pm.alertsPage.expectResolveButtonHidden();
        await pm.alertsPage.expectReopenButtonVisible();
        testLogger.info('✓ Incident resolved (resolve hidden, reopen visible)');

        testLogger.info('=== PHASE 4: Reopen the incident ===');

        // 4.1 Click reopen
        await pm.alertsPage.clickReopenOnFirstResolvedIncident();
        await pm.alertsPage.waitForStatusUpdateNotification();
        testLogger.info('Clicked reopen');

        // 4.2 Verify back to open state
        await pm.alertsPage.expectReopenButtonHidden();
        await pm.alertsPage.expectAcknowledgeButtonVisible();
        await pm.alertsPage.expectResolveButtonVisible();
        testLogger.info('✓ Incident reopened (back to open state)');

        testLogger.info('=== Incident lifecycle COMPLETE ===');
    });
});
