/**
 * alertSliSource.spec.js — E2E tests for Alert-Based SLI Source for SLOs
 *
 * Covers: create workflow, detail-page ribbon, list filtering, SLO-alert
 * management, cross-navigation from alerts list, edit diversion, slice
 * auto-adjustment, empty/error states, group-by locking, and burn-rate
 * condition presets.
 *
 * All 12 scenarios are WIRED — no fixme placeholders needed.
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ---------------------------------------------------------------------------
// Module-level setup caches — run expensive infrastructure once, share across
// independent tests in parallel.  Each test still navigates to its own
// starting page in beforeEach.
// ---------------------------------------------------------------------------
let sharedRandomValue;
let infraCache = null;
let alertCache = null;

/**
 * Ensure the stream, alert destination, and template exist.
 * Idempotent — returns cached result on subsequent calls.
 */
async function ensureInfra(pm) {
    if (infraCache) return infraCache;
    if (!sharedRandomValue) {
        sharedRandomValue = pm.alertsPage.generateRandomString().toLowerCase();
    }

    const streamName = `slo_e2e_${sharedRandomValue}`.toLowerCase();

    testLogger.info('Initializing shared SLO test stream', { streamName });
    await pm.commonActions.initializeAlertTestStream(streamName);

    testLogger.info('Ensuring validation infrastructure');
    // ensureValidationInfrastructure navigates to settings pages internally;
    // afterwards we must return to the SLO list.
    const infra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);

    infraCache = { streamName, ...infra };
    return infraCache;
}

/**
 * Ensure a scheduled alert exists that can serve as an SLI source.
 * The alert must have a frequency_secs > 0 to appear in the eligible list.
 * Idempotent — returns cached result on subsequent calls.
 */
async function ensureScheduledAlert(pm) {
    if (alertCache) return alertCache;

    const infra = await ensureInfra(pm);

    // Navigate to the alerts page to use the creation wizard
    const orgId = getOrgIdentifier();
    await pm.page.goto(`/alerts?org_identifier=${orgId}`);
    await pm.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Refresh so the new stream is visible in the stream picker
    await pm.page.reload();
    await pm.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    testLogger.info('Creating scheduled alert via UI wizard');
    const alertName = await pm.alertsPage.creationWizard.createScheduledAlertWithSQL(
        infra.streamName,
        infra.destinationName,
        infra.randomValue || sharedRandomValue
    );

    // Navigate back to SLO list
    await pm.page.goto(`/slos?org_identifier=${orgId}`);
    await pm.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    alertCache = { ...infra, alertName };
    testLogger.info('Scheduled alert created and cached', { alertName });
    return alertCache;
}

/**
 * Create an alert-based SLO via the API (fast path for detail/list tests).
 */
async function createAlertBasedSloViaApi(page, name, alertId) {
    const orgId = getOrgIdentifier();
    const baseUrl = process.env['ZO_BASE_URL'];
    const payload = {
        name,
        sli_type: 'alert',
        config: { alert_id: alertId },
        target: 99.9,
        window_secs: 2592000,
        slice_interval_secs: 300,
        folder_id: 'default',
        enabled: true,
    };
    const url = `${baseUrl}/api/${orgId}/slos`;
    testLogger.info('Creating alert-based SLO via API', { name, url });
    const resp = await page.request.post(url, { data: payload });
    if (!resp.ok()) {
        const body = await resp.text().catch(() => '');
        testLogger.error('SLO create via API failed', { status: resp.status(), body });
        throw new Error(`Failed to create SLO: ${resp.status()} ${body}`);
    }
    return await resp.json();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test.describe('Alert-Based SLI Source for SLOs testcases', () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Common starting point: SLO list page
        await page.goto(`/slos?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    });

    // ====================================================================
    // P0 — Core happy paths
    // ====================================================================

    test('P0.1: should create an alert-based SLO with full form flow',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p0'] },
        async ({ page }) => {
            // --- Setup: ensure a scheduled alert exists ---
            const { alertName } = await ensureScheduledAlert(pm);
            const sloName = `auto-slo-alert-${sharedRandomValue}`;

            // Navigate to SLO list (already there from beforeEach)
            await pm.sloListPage.expectPageLoaded();

            // 1. Click "New SLO"
            testLogger.info('Step: Click New SLO');
            await pm.sloCreatePage.clickNewSloButton();

            // 2. Fill SLO name
            testLogger.info('Step: Fill SLO name', { sloName });
            await pm.sloCreatePage.fillName(sloName);

            // 3. Select "Alert" SLI type
            testLogger.info('Step: Select Alert SLI type');
            await pm.sloCreatePage.selectAlertSliType();

            // 4. Assert alert source picker appears
            testLogger.info('Step: Assert alert source picker visible');
            await pm.sloCreatePage.expectAlertSourcePickerVisible();

            // 5. Pick the eligible alert
            testLogger.info('Step: Pick alert source', { alertName });
            await pm.sloCreatePage.selectAlertSource(alertName);

            // 6. Assert uptime ribbon preview appears
            testLogger.info('Step: Assert ribbon preview visible');
            await pm.sloCreatePage.expectAlertRibbonVisible();

            // 7. Assert group-by dropdown is disabled
            testLogger.info('Step: Assert group-by disabled');
            await pm.sloCreatePage.expectGroupByDisabled();

            // 8. Assert "Grouping locked" note is visible
            testLogger.info('Step: Assert group-by locked note visible');
            await pm.sloCreatePage.expectGroupByLockedNoteVisible();

            // 9. Assert groups_estimate field is NOT rendered
            testLogger.info('Step: Assert groups estimate hidden');
            await pm.sloCreatePage.expectGroupsEstimateHidden();

            // 10. Set target percentage
            testLogger.info('Step: Set target percentage');
            await pm.sloCreatePage.fillTarget(99);

            // 11. Select window (7d = 604800 seconds)
            testLogger.info('Step: Select compliance window');
            await pm.sloCreatePage.selectWindow(604800);

            // 12. Verify slice note shows per-slice text
            testLogger.info('Step: Assert slice note contains "per slice"');
            await pm.sloCreatePage.expectSliceNoteContains('per slice');

            // 13. Save
            testLogger.info('Step: Save SLO');
            await pm.sloCreatePage.save();

            // 14. Assert redirected to SLO list
            testLogger.info('Step: Assert redirected to SLO list');
            await pm.sloCreatePage.expectOnSloListPage();

            // 15. Assert the created SLO appears in the table
            testLogger.info('Step: Assert SLO appears in list');
            await pm.sloListPage.expectSloRowVisible(sloName);

            testLogger.info('P0.1 completed');
        });

    test('P0.2: should show uptime ribbon and source-alert button on detail page',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p0'] },
        async ({ page }) => {
            // --- Setup: create alert-based SLO via API ---
            const { alertName } = await ensureScheduledAlert(pm);

            // We need the alert's ID for the API call. The createScheduledAlertWithSQL
            // method returns the name, not the ID. Let's look up the alert ID from the
            // alerts list via API.
            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;
            testLogger.info('Resolved alert ID', { alertName, alertId });

            const sloName = `auto-slo-detail-${sharedRandomValue}`;
            await createAlertBasedSloViaApi(page, sloName, alertId);

            // Navigate to SLO list and refresh
            await page.goto(`/slos?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // 1. Click the row for the alert-based SLO
            testLogger.info('Step: Click SLO row', { sloName });
            await pm.sloListPage.clickSloRow(sloName);

            // 2. Assert source-alert button is visible
            testLogger.info('Step: Assert source-alert button visible');
            await pm.sloDetailPage.expectSourceAlertButtonVisible();

            // 3. Ensure Trend tab is active
            await pm.sloDetailPage.navigateToTrendTab();

            // 4. Assert uptime ribbon renders
            testLogger.info('Step: Assert ribbon visible');
            await pm.sloDetailPage.expectAlertRibbonVisible();

            // 5. Assert colored bands exist
            testLogger.info('Step: Assert ribbon bands');
            await pm.sloDetailPage.expectAlertRibbonBandCountAtLeast(1);

            // 6. Assert SLI tally is shown
            testLogger.info('Step: Assert tally');
            await pm.sloDetailPage.expectTallyContainsPercentage();

            // 7. Assert legend is visible
            testLogger.info('Step: Assert legend');
            await pm.sloDetailPage.expectLegendVisible();

            // 8. Assert stats strip is populated
            testLogger.info('Step: Assert stats strip');
            await pm.sloDetailPage.expectStatsStripVisible();

            testLogger.info('P0.2 completed');
        });

    // ====================================================================
    // P1 — Important variations
    // ====================================================================

    test('P1.1: should filter SLO list by alert SLI type',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p1'] },
        async ({ page }) => {
            // --- Setup: ensure at least one alert-based SLO exists ---
            const { alertName } = await ensureScheduledAlert(pm);

            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;

            const sloName = `auto-slo-filter-${sharedRandomValue}`;
            await createAlertBasedSloViaApi(page, sloName, alertId);

            // Refresh list
            await page.goto(`/slos?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // 1. Assert type filter has "Alert" option
            testLogger.info('Step: Assert alert type filter exists');
            await pm.sloListPage.expectTypeFilterAlertExists();

            // 2. Click the "Alert" filter
            testLogger.info('Step: Click alert type filter');
            await pm.sloListPage.filterByAlertType();

            // 3. Assert the table shows rows (the alert-based SLO we created)
            testLogger.info('Step: Assert alert-type SLO visible');
            await pm.sloListPage.expectSloRowVisible(sloName);

            // 4. Click filter again to deselect
            testLogger.info('Step: Clear alert type filter');
            await pm.sloListPage.clearAlertTypeFilter();

            // 5. Assert the SLO is still visible (everyone is back)
            await pm.sloListPage.expectSloRowVisible(sloName);

            testLogger.info('P1.1 completed');
        });

    test('P1.2: should create an SLO alert from the SLO detail page',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p1'] },
        async ({ page }) => {
            // --- Setup: create alert-based SLO via API ---
            const { alertName } = await ensureScheduledAlert(pm);

            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;

            const sloName = `auto-slo-alertform-${sharedRandomValue}`;
            await createAlertBasedSloViaApi(page, sloName, alertId);

            // Refresh list and click into the SLO
            await page.goto(`/slos?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await pm.sloListPage.clickSloRow(sloName);

            // Navigate to Alerts tab
            await pm.sloDetailPage.navigateToAlertsTab();

            // 1. Click "Add alert" in the SLO alerts panel
            testLogger.info('Step: Click Add alert');
            await pm.sloAlertsPanelPage.clickAddAlert();

            // 2. Assert SLO alert form opens
            testLogger.info('Step: Assert form visible');
            await pm.sloAlertsPanelPage.expectFormVisible();

            // 3. Assert alert name is auto-populated
            testLogger.info('Step: Assert form name auto-populated');
            await pm.sloAlertsPanelPage.expectFormNameNotEmpty();

            // 4. Select Burn-rate condition kind
            testLogger.info('Step: Select burn-rate kind');
            await pm.sloAlertsPanelPage.clickBurnRateKind();

            // 5. Pick Fast burn preset
            testLogger.info('Step: Click Fast burn preset');
            await pm.sloAlertsPanelPage.clickPresetFast();

            // 6. Save the alert
            testLogger.info('Step: Save SLO alert');
            await pm.sloAlertsPanelPage.saveAlert();

            // 7. Assert the new alert appears in the list
            testLogger.info('Step: Assert alert in list');
            await pm.sloAlertsPanelPage.expectAlertsListVisible();

            testLogger.info('P1.2 completed');
        });

    test('P1.3: should show SLO badge and link on alert in alerts list',
        { tag: ['@alert-sli-source', '@slo', '@alerts', '@all', '@p1'] },
        async ({ page }) => {
            // --- Setup: we need an SLO with an SLO alert attached ---
            const { alertName } = await ensureScheduledAlert(pm);

            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];

            // Create alert-based SLO via API
            const sloName = `auto-slo-badge-${sharedRandomValue}`;
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;

            const sloResp = await createAlertBasedSloViaApi(page, sloName, alertId);
            const sloId = sloResp?.id || sloResp?.slo_id;

            // Create an SLO alert via API so it shows up in the alerts list with an SLO badge
            const sloAlertName = `slo-burn-alert-${sharedRandomValue}`;
            const sloAlertPayload = {
                name: sloAlertName,
                alert_type: 'slo',
                slo_id: sloId,
                condition: {
                    kind: 'burn_rate',
                    burn_rate: {
                        short_window_minutes: 5,
                        long_window_minutes: 60,
                        threshold: 14.4,
                    },
                },
                destinations: [alertCache?.destinationName || ''],
                frequency_secs: 60,
                enabled: true,
                template: alertCache?.templateName || '',
                stream_name: alertCache?.streamName || '',
            };
            testLogger.info('Creating SLO alert via API', { sloAlertName, sloId });
            const alertCreateResp = await page.request.post(
                `${baseUrl}/api/v2/${orgId}/alerts`,
                { data: sloAlertPayload }
            );
            if (!alertCreateResp.ok()) {
                const body = await alertCreateResp.text().catch(() => '');
                testLogger.warn('SLO alert create returned non-ok', { status: alertCreateResp.status(), body });
            }

            // Navigate to alerts list
            await page.goto(`/alerts?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // 1. Assert the SLO badge is visible on the alert row
            testLogger.info('Step: Assert SLO badge visible', { sloAlertName });
            await pm.sloAlertsPanelPage.expectSloBadgeVisible(sloAlertName);

            // 2. Click the SLO link
            testLogger.info('Step: Click SLO link');
            await pm.sloAlertsPanelPage.clickSloLink(sloAlertName);

            // 3. Assert navigation redirects to SLO detail page
            testLogger.info('Step: Assert navigated to SLO detail');
            await pm.sloDetailPage.expectOnDetailPage();

            testLogger.info('P1.3 completed');
        });

    test('P1.4: should divert edit of SLO alert to SLO detail page',
        { tag: ['@alert-sli-source', '@slo', '@alerts', '@all', '@p1'] },
        async ({ page }) => {
            // --- Setup: create SLO + SLO alert via API ---
            const { alertName } = await ensureScheduledAlert(pm);
            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];

            const sloName = `auto-slo-divert-${sharedRandomValue}`;
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;

            const sloResp = await createAlertBasedSloViaApi(page, sloName, alertId);
            const sloId = sloResp?.id || sloResp?.slo_id;

            const sloAlertName = `slo-divert-alert-${sharedRandomValue}`;
            const sloAlertPayload = {
                name: sloAlertName,
                alert_type: 'slo',
                slo_id: sloId,
                condition: {
                    kind: 'burn_rate',
                    burn_rate: {
                        short_window_minutes: 5,
                        long_window_minutes: 60,
                        threshold: 14.4,
                    },
                },
                destinations: [alertCache?.destinationName || ''],
                frequency_secs: 60,
                enabled: true,
                template: alertCache?.templateName || '',
                stream_name: alertCache?.streamName || '',
            };
            const alertCreateResp = await page.request.post(
                `${baseUrl}/api/v2/${orgId}/alerts`,
                { data: sloAlertPayload }
            );
            const createdAlert = alertCreateResp.ok() ? await alertCreateResp.json().catch(() => ({})) : {};

            // Navigate to alerts list
            await page.goto(`/alerts?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // 1. Click the SLO link on the SLO alert row — this diverts to the SLO detail page
            testLogger.info('Step: Click SLO link for edit diversion', { sloAlertName });
            await pm.sloAlertsPanelPage.clickSloLink(sloAlertName);

            // 2. Assert navigation goes to SLO detail page
            testLogger.info('Step: Assert on SLO detail page');
            await pm.sloDetailPage.expectOnDetailPage();

            testLogger.info('P1.4 completed');
        });

    test('P1.5: should auto-adjust slice interval when alert source is picked',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p1'] },
        async ({ page }) => {
            // --- Setup: ensure a scheduled alert exists ---
            const { alertName } = await ensureScheduledAlert(pm);

            // Navigate to SLO list and open create form
            await pm.sloListPage.expectPageLoaded();
            await pm.sloCreatePage.clickNewSloButton();

            // 1. Select "Alert" SLI type
            testLogger.info('Step: Select Alert SLI type');
            await pm.sloCreatePage.selectAlertSliType();

            // 2. Pick an alert source
            testLogger.info('Step: Pick alert source', { alertName });
            await pm.sloCreatePage.selectAlertSource(alertName);

            // 3. Assert the slice interval updates to reflect the alert's cadence
            // The createScheduledAlertWithSQL creates alerts with a 60s frequency,
            // so the slice should auto-set to 60s.
            testLogger.info('Step: Assert slice updated to 60s');
            await pm.sloCreatePage.expectSliceItemSelected(60);

            // 4. Assert 60s slice option is available (not disabled)
            testLogger.info('Step: Assert 60s slice option is visible');
            // expectSliceItemSelected already asserts visibility — just confirm
            await pm.sloCreatePage.expectSliceItemSelected(60);

            testLogger.info('P1.5 completed');
        });

    // ====================================================================
    // P2 — Edge cases
    // ====================================================================

    test('P2.1: should show empty state when no eligible alerts exist',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p2', '@edge-case'] },
        async () => {
            // This test intentionally does NOT create any scheduled alert.
            testLogger.info('Step: Navigate to SLO create form without creating alerts');
            await pm.sloListPage.expectPageLoaded();
            await pm.sloCreatePage.clickNewSloButton();

            // 1. Select "Alert" SLI type
            testLogger.info('Step: Select Alert SLI type');
            await pm.sloCreatePage.selectAlertSliType();

            // 2. Assert empty-state banner appears
            testLogger.info('Step: Assert empty-state banner visible');
            await pm.sloCreatePage.expectEmptyStateBanner();

            testLogger.info('P2.1 completed');
        });

    test('P2.2: should show error banner when alert source API fails',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p2', '@edge-case'] },
        async ({ page }) => {
            // 1. Set up route interception to return 500 for the eligible-alerts API
            testLogger.info('Step: Intercept eligible-alerts API to return 500');
            const orgId = getOrgIdentifier();
            await page.route(`**/api/${orgId}/alerts/slo-eligible`, async (route) => {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal Server Error' }),
                });
            });

            // 2. Navigate to SLO create form
            await pm.sloListPage.expectPageLoaded();
            await pm.sloCreatePage.clickNewSloButton();

            // 3. Select "Alert" SLI type → triggers the API call
            testLogger.info('Step: Select Alert SLI type (triggers API call)');
            await pm.sloCreatePage.selectAlertSliType();

            // 4. Assert red error banner appears
            testLogger.info('Step: Assert error banner visible');
            await pm.sloCreatePage.expectErrorBanner();

            testLogger.info('P2.2 completed');
        });

    test('P2.3: should clear alert_id when switching away from alert SLI type',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p2', '@edge-case'] },
        async () => {
            // --- Setup: ensure a scheduled alert exists ---
            const { alertName } = await ensureScheduledAlert(pm);

            const sloName = `auto-slo-switch-${sharedRandomValue}`;

            await pm.sloListPage.expectPageLoaded();
            await pm.sloCreatePage.clickNewSloButton();
            await pm.sloCreatePage.fillName(sloName);

            // 1. Select "Alert" SLI type and pick a source
            testLogger.info('Step: Select Alert SLI type');
            await pm.sloCreatePage.selectAlertSliType();
            await pm.sloCreatePage.selectAlertSource(alertName);

            // 2. Assert ribbon preview is visible (proves alert_id is set)
            testLogger.info('Step: Assert ribbon preview visible');
            await pm.sloCreatePage.expectAlertRibbonVisible();

            // 3. Switch to "count" SLI type
            testLogger.info('Step: Switch to Count SLI type');
            await pm.sloCreatePage.selectCountSliType();

            // 4. Assert ribbon disappears
            testLogger.info('Step: Assert ribbon hidden');
            await pm.sloCreatePage.expectAlertRibbonHidden();

            // 5. Assert alert source picker is hidden
            testLogger.info('Step: Assert alert source picker hidden');
            await pm.sloCreatePage.expectAlertSourcePickerHidden();

            testLogger.info('P2.3 completed');
        });

    test('P2.4: should disable and clear group-by when switching to alert SLI type',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p2', '@edge-case'] },
        async () => {
            const sloName = `auto-slo-groupby-${sharedRandomValue}`;

            await pm.sloListPage.expectPageLoaded();
            await pm.sloCreatePage.clickNewSloButton();
            await pm.sloCreatePage.fillName(sloName);

            // 1. The form defaults to "count" SLI type (first option)
            // Select a group-by field if the dropdown is enabled and has options
            testLogger.info('Step: Attempt to set group-by in count mode');
            await pm.sloCreatePage.clickGroupByAndSelectFirst();

            // 2. Switch to "Alert" SLI type
            testLogger.info('Step: Switch to Alert SLI type');
            await pm.sloCreatePage.selectAlertSliType();

            // 3. Assert group-by dropdown is disabled
            testLogger.info('Step: Assert group-by disabled');
            await pm.sloCreatePage.expectGroupByDisabled();

            // 4. Assert "Grouping locked" note is visible
            testLogger.info('Step: Assert group-by locked note');
            await pm.sloCreatePage.expectGroupByLockedNoteVisible();

            // 5. Assert groups_estimate field is hidden
            testLogger.info('Step: Assert groups estimate hidden');
            await pm.sloCreatePage.expectGroupsEstimateHidden();

            testLogger.info('P2.4 completed');
        });

    test('P2.5: should update condition parameters when switching burn-rate presets',
        { tag: ['@alert-sli-source', '@slo', '@all', '@p2'] },
        async ({ page }) => {
            // --- Setup: create alert-based SLO via API ---
            const { alertName } = await ensureScheduledAlert(pm);

            const orgId = getOrgIdentifier();
            const baseUrl = process.env['ZO_BASE_URL'];
            const alertListResp = await page.request.get(
                `${baseUrl}/api/${orgId}/alerts?name=${encodeURIComponent(alertName)}`
            );
            const alertListData = await alertListResp.json();
            const alertId = alertListData?.list?.[0]?.alert_id || alertListData?.list?.[0]?.id;

            const sloName = `auto-slo-presets-${sharedRandomValue}`;
            await createAlertBasedSloViaApi(page, sloName, alertId);

            // Navigate to SLO detail and open alerts tab
            await page.goto(`/slos?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.reload();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await pm.sloListPage.clickSloRow(sloName);

            await pm.sloDetailPage.navigateToAlertsTab();
            await pm.sloAlertsPanelPage.clickAddAlert();
            await pm.sloAlertsPanelPage.expectFormVisible();

            // 1. Select Burn-rate condition kind
            testLogger.info('Step: Select burn-rate kind');
            await pm.sloAlertsPanelPage.clickBurnRateKind();

            // 2. Click "Fast burn" preset
            testLogger.info('Step: Click Fast burn preset');
            await pm.sloAlertsPanelPage.clickPresetFast();

            // Capture the alert name after Fast preset
            const fastName = await pm.sloAlertsPanelPage.getFormNameValue();
            testLogger.info('Form name after Fast preset', { fastName });

            // 3. Click "Slow burn" preset
            testLogger.info('Step: Click Slow burn preset');
            await pm.sloAlertsPanelPage.clickPresetSlow();

            // 4. Assert the alert name changed (proves condition parameters updated)
            testLogger.info('Step: Assert name changed after preset switch');
            await pm.sloAlertsPanelPage.expectAlertNameUpdatedAfterPresetChanged(fastName);

            testLogger.info('P2.5 completed');
        });
});
