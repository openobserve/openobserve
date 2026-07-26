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
 * Modelled after: Alerts/alerts-help-drawer.spec.js
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const NETWORK_IDLE_TIMEOUT_MS = 30000;
const TEST_STREAM = 'e2e_automate';

/** Open an OSelect dropdown by clicking its trigger until aria-expanded flips. */
async function openOSelectDropdown(page, rootLocator, { retries = 5, settleMs = 400 } = {}) {
    const trigger = rootLocator.locator('[data-test$="-trigger"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    for (let i = 0; i < retries; i++) {
        if ((await trigger.getAttribute('aria-expanded')) === 'true') return;
        await trigger.click();
        await page.waitForTimeout(settleMs);
    }
}

/** Navigate to the alert wizard, fill the required identity fields, land on Advanced. */
async function openWizardOnAdvancedTab(page, pm, alertName) {
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
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

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // The form exposes both controls (PT-10)
    // ─────────────────────────────────────────────────────────────────────────
    test('Advanced tab exposes a priority select (P1-P5) and a tag input', {
        tag: ['@alerts-priority-tags', '@smoke', '@alerts'],
    }, async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        await openWizardOnAdvancedTab(page, pm, 'auto_prio_form_' + suffix);

        const prioritySelect = page.locator('[data-test="alert-priority-select"]');
        const tagInput = page.locator('[data-test="alert-tags-input"]');
        await expect(prioritySelect).toBeVisible({ timeout: 10000 });
        await expect(tagInput).toBeVisible({ timeout: 10000 });

        // All five priorities must be offered — the scale is P1..P5 (D17), NOT
        // the P1..P4 incident-severity scale.
        await openOSelectDropdown(page, prioritySelect);
        for (const label of ['P1', 'P2', 'P3', 'P4', 'P5']) {
            await expect(
                page.locator('[data-test$="-popover"] [data-test$="-option"]').filter({ hasText: label }).first()
            ).toBeVisible({ timeout: 5000 });
        }
        testLogger.info('Priority select offers P1-P5 and tag input is present');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // THE ROUND TRIP — the regression guard for the three silent-drop bugs
    // ─────────────────────────────────────────────────────────────────────────
    test('priority and tags survive save and render back on the alert list', {
        tag: ['@alerts-priority-tags', '@alerts'],
    }, async ({ page }) => {
        const suffix = Math.random().toString(36).substring(2, 8);
        const alertName = 'auto_prio_roundtrip_' + suffix;
        await openWizardOnAdvancedTab(page, pm, alertName);

        // ── Set priority P3 ──────────────────────────────────────────────────
        const prioritySelect = page.locator('[data-test="alert-priority-select"]');
        await openOSelectDropdown(page, prioritySelect);
        await page
            .locator('[data-test$="-popover"] [data-test$="-option"]')
            .filter({ hasText: 'P3' })
            .first()
            .click();

        // ── Add DELIBERATELY MESSY tags ──────────────────────────────────────
        // Untrimmed and mixed-case on purpose: the server is the normalization
        // authority (D22), so this also proves the repair happens somewhere
        // real rather than being faked client-side.
        const tagField = page.locator('[data-test="alert-tags-input"] input').first();
        await tagField.fill('  PROD  ');
        await tagField.press('Enter');
        await tagField.fill('Service:Checkout');
        await tagField.press('Enter');

        // ── Destination is required before the form will submit ──────────────
        // It lives on the "Alert Rules" tab, NOT Advanced — switch back first,
        // otherwise the select is simply not in the DOM.
        await page.locator('[data-test="add-alert-tab-condition"]').click();
        const destinationSection = page.locator('[data-test="alert-destinations-select"]');
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });
        await openOSelectDropdown(page, destinationSection);
        const destOptions = page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(destOptions.first()).toBeVisible({ timeout: 5000 });
        await destOptions.first().click();
        await page.locator('body').click({ position: { x: 10, y: 10 } });

        // ── Save, asserting on the API response rather than a toast ──────────
        const savePromise = page
            .waitForResponse(
                (r) => r.url().includes('/alerts') && r.request().method() === 'POST',
                { timeout: 45000 }
            )
            .catch(() => null);
        // The submit button sits in a scroll container that clips it from the
        // viewport; a native DOM click bypasses that.
        await page.evaluate(() => {
            const btn = document.querySelector('[data-test="add-alert-submit-btn"]')
                || [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save');
            if (btn) btn.click();
        });
        const saveResp = await savePromise;
        expect(saveResp, 'alert save request must reach the API').toBeTruthy();
        expect(saveResp.ok(), `save failed: ${saveResp.status()}`).toBeTruthy();

        // ── Read the values back off the LIST TABLE ─────────────────────────
        // This is the assertion the three silent-drop bugs would each have
        // failed: the API can be perfect while the row mapping renders "—".
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        const row = page.locator('tbody tr').filter({ hasText: alertName }).first();
        await expect(row).toBeVisible({ timeout: 20000 });

        // Priority renders in its human form ("P3"), not the stored integer 3.
        await expect(
            row.locator(`[data-test="alert-list-${alertName}-priority"]`)
        ).toHaveText(/P3/, { timeout: 10000 });

        // Tags render NORMALIZED — trimmed, lowercased, colon preserved.
        const tagChips = row.locator(`[data-test="alert-list-${alertName}-tag"]`);
        await expect(tagChips).toHaveCount(2, { timeout: 10000 });
        await expect(tagChips.nth(0)).toHaveText('prod');
        await expect(tagChips.nth(1)).toHaveText('service:checkout');

        testLogger.info('Round trip verified: P3 + normalized tags rendered on the list');

        // Cleanup so repeat runs stay deterministic.
        await pm.alertsPage.deleteAlertByName?.(alertName).catch(() => {});
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Columns that were REMOVED must stay removed (list de-cluttering)
    // ─────────────────────────────────────────────────────────────────────────
    test('alert list shows Priority and Tags and no longer shows the removed configuration columns', {
        tag: ['@alerts-priority-tags', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

        const headerText = await page.locator('thead').first().innerText();

        expect(headerText).toContain('Priority');
        expect(headerText).toContain('Tags');

        // Removed because they duplicate a neighbouring column or are
        // configuration detail that belongs on the detail/edit view. They made
        // the row too wide to scan.
        for (const removed of ['State', 'Level', 'Look back window', 'Check every', 'Last Trained At']) {
            expect(headerText, `"${removed}" column must not be on the alert list`).not.toContain(removed);
        }
        testLogger.info('Alert list column set verified');
    });
});
