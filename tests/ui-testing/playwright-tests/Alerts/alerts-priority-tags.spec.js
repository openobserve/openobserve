// Copyright 2026 OpenObserve Inc.

/**
 * Alert Priority & Tags — E2E Tests (Feature 2, PT-1/PT-3/PT-6/PT-7/PT-10)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Priority and tags travel through FOUR hand-maintained mappings between the
 * form and the database:
 *
 *   form state -> alertPayload -> API request model -> domain Alert -> DB
 *   DB -> domain Alert -> list response model -> AlertList row map -> table
 *
 * Every one of those is field-by-field, so a missing line drops the value
 * SILENTLY — no type error, no test failure, no console warning. Three such
 * drops were found by hand during development (the API request model, the list
 * response model, and the AlertList row mapping), each of which left unit tests
 * fully green while the feature did nothing. Component tests cannot catch this
 * class of bug because they stub the boundary the bug lives in.
 *
 * These tests therefore assert the ROUND TRIP: type into the real form, save
 * through the real API, and read the values back off the real list table.
 *
 * All UI selectors live in page objects (pm.alertsPage); shared API plumbing
 * (cleanup) lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
    findAlertId, getAlert, deleteAlerts, seedAlertFixtures, DEST,
    simpleAlert, realtimeAlert, cronAlert, createAlert, waitForAlertOutcome,
} = require('../utils/alerts-api-helpers.js');

const NETWORK_IDLE_TIMEOUT_MS = 30000;
const TEST_STREAM = 'e2e_automate';

/** Navigate to the alert wizard, fill the required identity fields, land on Advanced. */
async function openWizardOnAdvancedTab(page, pm, alertName) {
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(alertName);
    await pm.alertsPage.selectStreamType('logs');
    await pm.alertsPage.selectStreamByName(TEST_STREAM);
    await pm.alertsPage.openAdvancedTab();
}

test.describe('Alerts — priority, tags & additional variables', {
    tag: ['@alerts-priority-tags', '@smoke', '@alerts', '@P1'],
}, () => {
    let pm;
    const createdAlertNames = [];

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        // Seed a self-delivering dogfood destination (idempotent) so the save
        // never depends on a destination created by a parallel spec.
        await seedAlertFixtures(page);
    });

    test.afterEach(async ({ page }) => {
        // Guaranteed cleanup so repeat runs stay deterministic. (The previous inline
        // `deleteAlertByName?.(...)` was a silent no-op — that method does not exist, only
        // `deleteAlertByRow` — so saved round-trip alerts leaked on every run.)
        const ids = [];
        for (const name of createdAlertNames) ids.push(await findAlertId(page, name));
        await deleteAlerts(page, ids);
        createdAlertNames.length = 0;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // The form exposes both controls (PT-10)
    // ─────────────────────────────────────────────────────────────────────────
    test('Advanced tab exposes a priority select (P1-P5) and a tag input', async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        await openWizardOnAdvancedTab(page, pm, 'auto_prio_form_' + suffix);

        await pm.alertsPage.expectPriorityAndTagControlsVisible();
        // The scale is P1..P5 (D17), NOT the P1..P4 incident-severity scale.
        await pm.alertsPage.expectPriorityOptions(['P1', 'P2', 'P3', 'P4', 'P5']);
        testLogger.info('Priority select offers P1-P5 and tag input is present');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // THE ROUND TRIP — the regression guard for the three silent-drop bugs
    // ─────────────────────────────────────────────────────────────────────────
    test('priority and tags survive save and render back on the alert list', async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const alertName = 'auto_prio_roundtrip_' + suffix;
        createdAlertNames.push(alertName);
        await openWizardOnAdvancedTab(page, pm, alertName);

        await pm.alertsPage.selectPriority('P3');
        // Deliberately messy — the server is the normalization authority (D22), so this proves
        // the repair happens somewhere real rather than being faked client-side.
        await pm.alertsPage.addTag('  PROD  ');
        await pm.alertsPage.addTag('Service:Checkout');

        // Destination is required before the form will submit; it lives on the "Alert Rules"
        // tab, NOT Advanced — switch back first, otherwise the select is not in the DOM.
        await pm.alertsPage.openConditionTab();
        await pm.alertsPage.selectDestinationByName(DEST);

        // Save, asserting on the API response rather than a toast.
        const savePromise = page
            .waitForResponse((r) => r.url().includes('/alerts') && r.request().method() === 'POST', { timeout: 45000 })
            .catch(() => null);
        await pm.alertsPage.submitAlertForm();
        const saveResp = await savePromise;
        expect(saveResp, 'alert save request must reach the API').toBeTruthy();
        expect(saveResp.ok(), `save failed: ${saveResp.status()}`).toBeTruthy();

        // Read the values back off the LIST TABLE — the assertion the three silent-drop bugs
        // would each have failed (the API can be perfect while the row mapping renders "—").
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.expectAlertVisibleInList(alertName);
        await pm.alertsPage.expectAlertPriorityInList(alertName, /P3/); // human form, not integer 3
        await pm.alertsPage.expectAlertTagsInList(alertName, ['prod', 'service:checkout']); // normalized
        testLogger.info('Round trip verified: P3 + normalized tags rendered on the list');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Additional Variables (context_attributes) — same silent-drop risk, same guard
    // ─────────────────────────────────────────────────────────────────────────
    test('an additional variable survives save and round-trips through the alert', async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const alertName = 'auto_prio_vars_' + suffix;
        createdAlertNames.push(alertName);
        await openWizardOnAdvancedTab(page, pm, alertName);

        // Add one key/value variable on the Advanced tab.
        await pm.alertsPage.addAlertVariable('team', 'payments');

        // Destination is required to submit; it lives on the "Alert Rules" tab, not Advanced.
        await pm.alertsPage.openConditionTab();
        await pm.alertsPage.selectDestinationByName(DEST);

        const savePromise = page
            .waitForResponse((r) => r.url().includes('/alerts') && r.request().method() === 'POST', { timeout: 45000 })
            .catch(() => null);
        await pm.alertsPage.submitAlertForm();
        const saveResp = await savePromise;
        expect(saveResp, 'alert save request must reach the API').toBeTruthy();
        expect(saveResp.ok(), `save failed: ${saveResp.status()}`).toBeTruthy();

        // Variables have no list column, so verify the round trip through the stored alert
        // (form -> payload -> API request model -> domain -> DB) — the same chain that
        // silently dropped priority/tags during development.
        const id = await findAlertId(page, alertName);
        expect(id, 'the saved alert must be findable by name').toBeTruthy();
        const alert = await getAlert(page, id);
        expect(alert, 'GET must return the saved alert').toBeTruthy();
        expect(alert.context_attributes, 'the Additional Variable must survive the full round trip')
            .toMatchObject({ team: 'payments' });
        testLogger.info('Round trip verified: additional variable persisted on the alert');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // State/Level/Look back window/Last Trained At stay removed (list
    // de-cluttering); Check every was restored (issue #14038) — it has no
    // other surface in the list-browsing flow.
    // ─────────────────────────────────────────────────────────────────────────
    test('alert list shows Priority and Tags and no longer shows the removed configuration columns', async ({ page }) => {
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.expectListColumns({
            present: ['Priority', 'Tags', 'Check every'],
            absent: ['State', 'Level', 'Look back window', 'Last Trained At'],
        });
        testLogger.info('Alert list column set verified');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Frequency ("Check every") cadence cell + column conditional (issue #14038)
    // ─────────────────────────────────────────────────────────────────────────
    test('frequency cell renders the cadence for cron, minute-interval and real-time alerts', {
        tag: ['@alert-list-frequency-retries', '@all', '@alerts', '@P0'],
    }, async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const cronName = 'auto_freq_cron_' + suffix;
        const minsName = 'auto_freq_mins_' + suffix;
        const rtName = 'auto_freq_rt_' + suffix;
        createdAlertNames.push(cronName, minsName, rtName);

        const cronResp = await createAlert(page, cronAlert(cronName));
        const minsResp = await createAlert(page, simpleAlert(minsName));
        const rtResp = await createAlert(page, realtimeAlert(rtName));
        expect(cronResp.ok(), `cron alert create failed: ${cronResp.status()}`).toBeTruthy();
        expect(minsResp.ok(), `minutes alert create failed: ${minsResp.status()}`).toBeTruthy();
        expect(rtResp.ok(), `realtime alert create failed: ${rtResp.status()}`).toBeTruthy();

        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.expectFrequencyCell(cronName, '0 */10 * * * *');
        await pm.alertsPage.expectFrequencyCell(minsName, '10 Mins');
        await pm.alertsPage.expectFrequencyCell(rtName, '--');
        testLogger.info('Frequency cells render cron, minutes and realtime cadence correctly');
    });

    test('Check every column is present on scheduled and absent on the realTime tab', {
        tag: ['@alert-list-frequency-retries', '@all', '@alerts', '@P0'],
    }, async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const schedName = 'auto_tab_sched_' + suffix;
        const rtName = 'auto_tab_rt_' + suffix;
        createdAlertNames.push(schedName, rtName);

        // One scheduled + one real-time alert so both tabs render a table header to assert against.
        await createAlert(page, simpleAlert(schedName));
        await createAlert(page, realtimeAlert(rtName));

        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.clickAlertTypeTab('scheduled');
        await pm.alertsPage.expectListColumns({ present: ['Check every'], absent: [] });

        await pm.alertsPage.clickAlertTypeTab('realTime');
        await pm.alertsPage.expectListColumns({ present: [], absent: ['Check every'] });
        testLogger.info('Check every column present on scheduled, absent on realTime');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Retries column in the per-alert evaluation history
    // ─────────────────────────────────────────────────────────────────────────
    test('evaluation history shows a Retries column with a numeric value', {
        tag: ['@alert-list-frequency-retries', '@all', '@alerts', '@P1'],
    }, async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const retryName = 'auto_retry_' + suffix;
        createdAlertNames.push(retryName);

        // Fast cadence so the scheduler evaluates it within the waitForAlertOutcome window.
        const retryAlert = simpleAlert(retryName);
        retryAlert.trigger_condition.frequency = 1;
        const createResp = await createAlert(page, retryAlert);
        expect(createResp.ok(), `alert create failed: ${createResp.status()}`).toBeTruthy();

        // Guarantee a recent evaluation so the history endpoint returns a hit.
        const evaluated = await waitForAlertOutcome(page, retryName);
        expect(evaluated, `scheduled alert ${retryName} must be evaluated within the timeout`).toBeTruthy();
        expect(evaluated.last_outcome, 'the alert must have a run outcome').toBeTruthy();

        const id = await findAlertId(page, retryName);
        expect(id, 'the evaluated alert must be findable by name').toBeTruthy();

        await pm.alertDetailPage.open(id);
        await pm.alertsPage.expectAlertDetailsHistorySectionVisible();

        // The per-alert history fetch is single-shot on page load; re-fetch until the row lands.
        await pm.alertsPage.waitForEvaluationHistoryRow();
        await pm.alertsPage.expectEvaluationHistoryRetriesColumn();
        await pm.alertsPage.expectEvaluationHistoryRetriesValue(0);
        testLogger.info('Retries column renders a numeric value in evaluation history');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section tab strip agrees with the nav rail
    // ─────────────────────────────────────────────────────────────────────────
    test('the alert section tab strip shows the renamed labels', {
        tag: ['@alert-list-frequency-retries', '@all', '@alerts', '@P1'],
    }, async ({ page }) => {
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.expectSectionTabLabels([
            'All Alerts', 'Notification Destinations', 'Destination Templates', 'Alert Library',
        ]);
        await pm.alertsPage.expectSectionTabLabel('alertDestinations', 'Notification Destinations');
        await pm.alertsPage.expectSectionTabLabel('alertLibrary', 'Alert Library');
        testLogger.info('Section tab strip shows the renamed labels');
    });
});
