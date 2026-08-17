// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const STREAM_NAME = 'e2e_automate';

// ============================================================================
// API HELPERS — copied from alerts-history.spec.js (the proven template →
// destination → alert chain), extended with an alert-level `template` override.
// ============================================================================

async function api(ctx, method, path, data) {
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const opts = { headers: getAuthHeaders() };
    if (data !== undefined) opts.data = data;
    const resp = await ctx[method](`${baseUrl}${path}`, opts);
    let body = null;
    try {
        body = await resp.json();
    } catch (_) { /* non-JSON response */ }
    return { status: resp.status(), data: body };
}

async function ensureTemplate(ctx, templateName) {
    const org = getOrgIdentifier();
    const resp = await api(ctx, 'post', `/api/${org}/alerts/templates`, {
        name: templateName,
        body: JSON.stringify({ text: 'Alert triggered: {alert_name}' }),
        isDefault: false,
    });
    testLogger.info('Created alert template', { templateName, status: resp.status });
    if (resp.status !== 200 && resp.status !== 409) {
        throw new Error(`ensureTemplate: unexpected status ${resp.status} for "${templateName}"`);
    }
}

async function ensureDestination(ctx, destinationName, templateName) {
    const org = getOrgIdentifier();
    const resp = await api(ctx, 'post', `/api/${org}/alerts/destinations`, {
        name: destinationName,
        url: 'https://httpbin.org/post',
        method: 'post',
        skip_tls_verify: true,
        template: templateName,
        headers: {},
    });
    testLogger.info('Created alert destination', { destinationName, status: resp.status });
    if (resp.status !== 200 && resp.status !== 409) {
        throw new Error(`ensureDestination: unexpected status ${resp.status} for "${destinationName}"`);
    }
}

async function createDepGraphAlert(ctx, alertName, { destinations, template = null }) {
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
            vrl_function: null,
        },
        trigger_condition: {
            threshold: 1,
            operator: '>=',
            frequency: 1,
            silence: 0,
            period: 5,
            frequency_type: 'minutes',
        },
        destinations,
        template,
        enabled: true,
        description: 'Dependency graph E2E test',
        context_attributes: {},
    };
    const resp = await api(ctx, 'post', `/api/v2/${org}/alerts?folder=default`, payload);
    testLogger.info('Created alert via API', { alertName, status: resp.status });
    if (resp.status !== 200 && resp.status !== 409) {
        throw new Error(`createDepGraphAlert: unexpected status ${resp.status} for "${alertName}"`);
    }
}

async function getAlertId(ctx, alertName) {
    const org = getOrgIdentifier();
    const resp = await api(ctx, 'get', `/api/v2/${org}/alerts?folder=default`);
    const alerts = resp.data?.list || [];
    const alert = alerts.find((a) => a.name === alertName);
    return alert ? alert.alert_id || alert.id || null : null;
}

async function deleteAlertByName(ctx, alertName) {
    const alertId = await getAlertId(ctx, alertName);
    if (alertId) {
        const org = getOrgIdentifier();
        await api(ctx, 'delete', `/api/v2/${org}/alerts/${alertId}?folder=default`);
        testLogger.info('Deleted test alert via API', { alertName, alertId });
    }
}

async function deleteDestinationByName(ctx, destinationName) {
    const org = getOrgIdentifier();
    await api(ctx, 'delete', `/api/${org}/alerts/destinations/${encodeURIComponent(destinationName)}`);
    testLogger.info('Deleted test destination via API', { destinationName });
}

async function deleteTemplateByName(ctx, templateName) {
    const org = getOrgIdentifier();
    await api(ctx, 'delete', `/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`);
    testLogger.info('Deleted test template via API', { templateName });
}

// ============================================================================
// TESTS
// ============================================================================

test.describe("Alert Notification Dependency Graph", () => {
    test.describe.configure({ mode: 'parallel' });

    let pm;

    // Shared chain names (unique per worker run). The "Used by" graph is built
    // client-side by cross-referencing these by NAME, so they must be
    // alphanumeric + underscores (the cell selector interpolates them raw).
    let TMPL;
    let DEST;
    let ALERT;

    test.beforeAll(async ({ request }) => {
        const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        TMPL = `depgraph_tmpl_${runId}`;
        DEST = `depgraph_dest_${runId}`;
        ALERT = `depgraph_alert_${runId}`;

        // Template → destination → alert (usage) chain. Each host page load
        // invalidates + rebuilds the graph, so these are the only shared seeds.
        await ensureTemplate(request, TMPL);
        await ensureDestination(request, DEST, TMPL);
        await createDepGraphAlert(request, ALERT, { destinations: [DEST], template: null });
        testLogger.info('Shared dependency-graph chain seeded', { TMPL, DEST, ALERT });
    });

    test.afterAll(async ({ request }) => {
        // Dependency order: alert → destination → template.
        await deleteAlertByName(request, ALERT);
        await deleteDestinationByName(request, DEST);
        await deleteTemplateByName(request, TMPL);
        testLogger.info('Shared dependency-graph chain cleaned up');
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    // ===== P0: CRITICAL PATH =====

    test("P0: Destination list shows an alert-count badge and opens a flat destination-focus impact dialog", {
        tag: ['@alert-dependency-graph', '@all', '@P0'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;
        testLogger.info('Navigating to alert destinations list', { DEST });
        await pm.alertDestinationsPage.navigateToDestinations();
        await pm.alertDestinationsPage.waitForDestinationListReady();
        await pm.alertDestinationsPage.searchDestinations(DEST);
        await dep.waitForTableLoaded();

        testLogger.info('Asserting the consumed destination renders an alert-count badge of 1');
        await dep.expectUsedByAlertBadge(DEST, 1);

        testLogger.info('Opening the destination-focus impact dialog');
        await dep.openImpactDialog(DEST);

        testLogger.info('Asserting the dialog renders a flat alert list with the consuming alert and no destinations lane');
        await dep.expectImpactBodyVisible();
        await dep.expectImpactLaneAlertVisible();
        await dep.expectImpactRowVisible(ALERT);
        await dep.expectDestinationsLaneAbsent();
        testLogger.info('Destination-focus dialog verified');
    });

    test("P0: Template list shows destination/alert badges and opens the multi-lane template-focus dialog with direct overrides", {
        tag: ['@alert-dependency-graph', '@all', '@P0'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;
        const overrideAlert = `${ALERT}_override`;

        // Alert-level override: references the template directly, no destinations.
        await createDepGraphAlert(page.request, overrideAlert, { destinations: [], template: TMPL });
        try {
            testLogger.info('Navigating to alert templates list', { TMPL });
            await pm.alertTemplatesPage.navigateToTemplates();
            await pm.alertTemplatesPage.waitForTemplateListReady();
            await pm.alertTemplatesPage.searchTemplates(TMPL);
            await dep.waitForTableLoaded();

            testLogger.info('Asserting template badges: 1 destination and 2 alerts (chain + override)');
            await dep.expectUsedByDestinationBadge(TMPL, 1);
            await dep.expectUsedByAlertBadge(TMPL, 2);

            testLogger.info('Opening the template-focus impact dialog');
            await dep.openImpactDialog(TMPL);

            testLogger.info('Asserting destinations lane, per-destination alert group, and direct overrides');
            await dep.expectImpactBodyVisible();
            await dep.expectDestinationsLaneVisible();
            await dep.expectImpactCardVisible(DEST);
            await dep.expectImpactGroupVisible(DEST);
            await dep.expectImpactRowVisible(ALERT);
            await dep.expectDirectSectionContainsRow(overrideAlert);
            testLogger.info('Template-focus dialog verified');
        } finally {
            await deleteAlertByName(page.request, overrideAlert);
        }
    });

    // ===== P1: IMPORTANT VARIATIONS / ERROR STATES =====

    test("P1: Orphan destination and orphan template collapse to the Unused chip", {
        tag: ['@alert-dependency-graph', '@all', '@P1'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;
        const orphanDest = `${DEST}_orphan`;
        const orphanTmpl = `${TMPL}_orphan`;

        await ensureDestination(page.request, orphanDest, TMPL);
        await ensureTemplate(page.request, orphanTmpl);
        try {
            testLogger.info('Asserting the orphan destination shows the Unused chip on the destinations list');
            await pm.alertDestinationsPage.navigateToDestinations();
            await pm.alertDestinationsPage.waitForDestinationListReady();
            await pm.alertDestinationsPage.searchDestinations(orphanDest);
            await dep.waitForTableLoaded();
            await dep.expectUnusedChip(orphanDest);

            testLogger.info('Asserting the orphan template shows the Unused chip on the templates list');
            await pm.alertTemplatesPage.navigateToTemplates();
            await pm.alertTemplatesPage.waitForTemplateListReady();
            await pm.alertTemplatesPage.searchTemplates(orphanTmpl);
            await dep.waitForTableLoaded();
            await dep.expectUnusedChip(orphanTmpl);
            testLogger.info('Unused chips verified for both orphan entities');
        } finally {
            await deleteDestinationByName(page.request, orphanDest);
            await deleteTemplateByName(page.request, orphanTmpl);
        }
    });

    test("P1: Impact dialog search filters downstream entities and shows the no-matches state", {
        tag: ['@alert-dependency-graph', '@all', '@P1'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;
        const secondAlert = `${ALERT}_second`;

        // A second alert that also delivers to DEST, so the filter has two rows to split.
        await createDepGraphAlert(page.request, secondAlert, { destinations: [DEST], template: null });
        try {
            await pm.alertDestinationsPage.navigateToDestinations();
            await pm.alertDestinationsPage.waitForDestinationListReady();
            await pm.alertDestinationsPage.searchDestinations(DEST);
            await dep.waitForTableLoaded();
            await dep.openImpactDialog(DEST);

            testLogger.info('Asserting both consuming alerts are present before filtering');
            await dep.expectImpactRowVisible(ALERT);
            await dep.expectImpactRowVisible(secondAlert);

            testLogger.info('Filtering by a non-matching term → both rows hidden and "No matches." shown');
            await dep.searchImpact('zzz_no_match_123');
            await dep.expectNoMatchesVisible();
            await dep.expectImpactRowAbsent(ALERT);
            await dep.expectImpactRowAbsent(secondAlert);

            testLogger.info('Filtering by the second alert name → only that row remains');
            await dep.searchImpact(secondAlert);
            await dep.expectImpactRowVisible(secondAlert);
            await dep.expectImpactRowAbsent(ALERT);
            testLogger.info('Search filter verified');
        } finally {
            await deleteAlertByName(page.request, secondAlert);
        }
    });

    test("P1: Deleting a non-focus neighbour from the dialog refetches the graph and removes the row", {
        tag: ['@alert-dependency-graph', '@all', '@P1'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;
        const secondAlert = `${ALERT}_second`;

        await createDepGraphAlert(page.request, secondAlert, { destinations: [DEST], template: null });
        try {
            await pm.alertDestinationsPage.navigateToDestinations();
            await pm.alertDestinationsPage.waitForDestinationListReady();
            await pm.alertDestinationsPage.searchDestinations(DEST);
            await dep.waitForTableLoaded();
            await dep.openImpactDialog(DEST);

            testLogger.info('Asserting both consuming alerts are present before deletion');
            await dep.expectImpactRowVisible(ALERT);
            await dep.expectImpactRowVisible(secondAlert);

            testLogger.info('Deleting the second alert (a neighbour, not the focus) from the dialog');
            await dep.deleteImpactEntity(secondAlert);

            testLogger.info('Asserting the deleted row is gone, the focus row remains, and the dialog stays open');
            await dep.expectImpactRowAbsent(secondAlert);
            await dep.expectImpactRowVisible(ALERT);
            await dep.expectImpactBodyVisible();
            testLogger.info('Non-focus delete verified');
        } finally {
            // Best-effort: the dialog delete already removed it; this no-ops if so.
            await deleteAlertByName(page.request, secondAlert);
        }
    });

    test("P1: Deleting an in-use entity from the dialog is blocked with an error toast", {
        tag: ['@alert-dependency-graph', '@all', '@P1'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;

        // DEST is in use by ALERT, so deleting it (as a destination card in the
        // template-focus dialog) must 409 and surface an error toast, leaving the
        // entity intact.
        await pm.alertTemplatesPage.navigateToTemplates();
        await pm.alertTemplatesPage.waitForTemplateListReady();
        await pm.alertTemplatesPage.searchTemplates(TMPL);
        await dep.waitForTableLoaded();
        await dep.openImpactDialog(TMPL);

        testLogger.info('Attempting to delete the in-use destination from the template-focus dialog');
        await dep.deleteImpactEntity(DEST);

        testLogger.info('Asserting the delete was blocked: error toast shown, entity and dialog remain');
        await dep.expectErrorToastVisible();
        await dep.expectImpactCardVisible(DEST);
        await dep.expectImpactBodyVisible();
        testLogger.info('In-use delete block verified');
    });

    // ===== P2: EDGE CASES / NICE-TO-HAVE =====

    test("P2: Open entity action navigates to the editor in a new tab", {
        tag: ['@alert-dependency-graph', '@all', '@P2'],
    }, async ({ page }) => {
        const dep = pm.alertsDependencyGraph;

        await pm.alertDestinationsPage.navigateToDestinations();
        await pm.alertDestinationsPage.waitForDestinationListReady();
        await pm.alertDestinationsPage.searchDestinations(DEST);
        await dep.waitForTableLoaded();
        await dep.openImpactDialog(DEST);

        testLogger.info('Hovering the alert row and clicking its open-in-new-tab action');
        const popupPromise = page.waitForEvent('popup');
        await dep.clickOpenEntity(ALERT);

        testLogger.info('Asserting a new tab opened on the alert detail route');
        const popup = await popupPromise;
        await dep.expectPopupUrl(popup, /alerts\/detail\//);
        testLogger.info('Open-in-new-tab verified');
    });

    test.fixme("P1: Deleting the focus entity closes the dialog — not wired: focus is never rendered as a deletable row", {
        tag: ['@alert-dependency-graph', '@all', '@P1', '@fixme'],
    }, async () => {
        // Evidence: DependencyImpactDialog.vue:452 guards `n.id === focusNode.value?.id`
        // and closes the dialog, but the focus node is only ever rendered as the
        // dialog HEADER — never as a DependencyEntityRow with a
        // dependency-impact-delete-<focus> control (rows are neighbours only:
        // alerts for a destination focus, destination cards + alert rows for a
        // template focus). There is therefore no UI trigger to delete the focus
        // entity from its own dialog. Parked until a focus delete control exists.
        //
        // Intended body once a focus-delete control is reachable:
        //   const dep = pm.alertsDependencyGraph;
        //   const orphanDest = `${DEST}_orphan`;
        //   await ensureDestination(page.request, orphanDest, TMPL);
        //   try {
        //     await pm.alertDestinationsPage.navigateToDestinations();
        //     await pm.alertDestinationsPage.waitForDestinationListReady();
        //     await dep.waitForTableLoaded();
        //     await dep.openImpactDialog(orphanDest);
        //     await dep.deleteImpactEntity(orphanDest);
        //     await dep.expectImpactBodyHidden();
        //   } finally {
        //     await deleteDestinationByName(page.request, orphanDest);
        //   }
        testLogger.info('Delete-focus-closes-dialog is parked (fixme): focus is not a deletable row');
    });

    test.fixme("P2: Missing chip for a dangling reference — not wired to a deterministic setup", {
        tag: ['@alert-dependency-graph', '@all', '@P2', '@fixme'],
    }, async () => {
        // Evidence: useDependencyGraph.ts:311,320 leaves `missing: true` for a
        // destination/template NAME referenced by an alert/destination but absent
        // from the list. This is reachable in code but NOT deterministically via
        // the public API — deleting a still-referenced entity is 409-blocked, so a
        // dangling name requires an out-of-band deletion or broken import. The chip
        // also has no data-test (NEEDS SELECTOR: DependencyUsageCell.vue:33-35 and
        // DependencyEntityRow.vue:51-53 render it as a bare OTag).
        //
        // Intended body once a deterministic setup + selector exist:
        //   const dep = pm.alertsDependencyGraph;
        //   await dep.expectMissingChip(danglingName);
        testLogger.info('Missing chip is parked (fixme): no deterministic API path and no data-test');
    });
});
