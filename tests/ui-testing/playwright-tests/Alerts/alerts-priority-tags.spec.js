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
const { findAlertId, deleteAlerts } = require('../utils/alerts-api-helpers.js');

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

test.describe('Alerts — priority & tags', {
    tag: ['@alerts-priority-tags', '@smoke', '@alerts', '@P1'],
}, () => {
    let pm;
    const createdAlertNames = [];

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
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
        await pm.alertsPage.selectFirstDestination();

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
    // Columns that were REMOVED must stay removed (list de-cluttering)
    // ─────────────────────────────────────────────────────────────────────────
    test('alert list shows Priority and Tags and no longer shows the removed configuration columns', async ({ page }) => {
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        await pm.alertsPage.expectListColumns({
            present: ['Priority', 'Tags'],
            absent: ['State', 'Level', 'Look back window', 'Check every', 'Last Trained At'],
        });
        testLogger.info('Alert list column set verified');
    });
});
