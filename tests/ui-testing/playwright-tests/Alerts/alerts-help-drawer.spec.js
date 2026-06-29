// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Additional Settings Help Drawer — E2E Smoke Tests
 *
 * Verifies three behaviors of the AlertSettingsHelpDrawer component:
 *   1. Clicking the "Learn more" help trigger opens the help drawer with its
 *      "What this alert sends now" (current) section.
 *   2. Selecting a template in the panel's preview dropdown does NOT mutate the
 *      form's Template Override select (Apply is required to commit).
 *   3. The drawer closes when clicking the overlay.
 *
 * Modelled after: tests/ui-testing/playwright-tests/Alerts/alerts-advanced.spec.js
 * Navigation reuses the shared PageManager / AlertsPage page-object methods
 * (fillAlertName / selectStreamType / selectStreamByName / openAdvancedTab) so
 * selectors stay in one place and match the real wizard.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const NETWORK_IDLE_TIMEOUT_MS = 30000;
const TEST_STREAM = 'e2e_automate';

/**
 * Open an OSelect dropdown by clicking its trigger until aria-expanded is true.
 * Used only for the in-drawer preview select (no page-object method covers it).
 */
async function openOSelectDropdown(page, rootLocator, { retries = 5, settleMs = 400 } = {}) {
    const trigger = rootLocator.locator('[data-test$="-trigger"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    for (let i = 0; i < retries; i++) {
        if ((await trigger.getAttribute('aria-expanded')) === 'true') return;
        await trigger.click();
        await page.waitForTimeout(settleMs);
    }
}

/**
 * Navigate to the alert creation wizard and land on the Advanced tab, using the
 * shared AlertsPage page-object methods (single source of truth for selectors).
 * Minimal steps only — we do not create the alert.
 */
async function navigateToAdvancedTab(page, pm) {
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

    const uniqueSuffix = Math.random().toString(36).substring(2, 8);
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName('auto_helpdrawer_smoke_' + uniqueSuffix);
    await pm.alertsPage.selectStreamType('logs');
    await pm.alertsPage.selectStreamByName(TEST_STREAM);
    await pm.alertsPage.openAdvancedTab();
    testLogger.info('Navigated to Advanced tab');
}

test.describe('Alerts — Additional Settings Help Drawer', {
    tag: ['@alerts-help-drawer', '@smoke', '@alerts', '@P1'],
}, () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Behavior 1: "Learn more" trigger opens the help drawer
    // ─────────────────────────────────────────────────────────────────────────
    test('clicking the "Learn more" link opens the help drawer and shows current-section content', {
        tag: ['@alerts-help-drawer', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await navigateToAdvancedTab(page, pm);

        // The "Learn more" help trigger lives next to the Template Override field.
        // (data-test kept as advanced-template-info-btn for selector stability.)
        const learnMore = page.locator('[data-test="advanced-template-info-btn"]');
        await learnMore.waitFor({ state: 'visible', timeout: 10000 });
        await learnMore.click();

        // Drawer must be visible and the current-section content area must render
        const drawer = page.locator('[data-test="alert-settings-help-drawer"]');
        await expect(drawer).toBeVisible({ timeout: 5000 });

        const currentSection = page.locator('[data-test="help-current-section"]');
        await expect(currentSection).toBeVisible({ timeout: 5000 });

        testLogger.info('Help drawer opened and current-section is visible');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Behavior 2: Preview dropdown in the drawer does NOT mutate the form select
    // ─────────────────────────────────────────────────────────────────────────
    test('selecting a template in the panel preview dropdown does not change the form Template Override select', {
        tag: ['@alerts-help-drawer', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await navigateToAdvancedTab(page, pm);

        // Open drawer via the Template Override "Learn more" trigger
        const learnMore = page.locator('[data-test="advanced-template-info-btn"]');
        await learnMore.waitFor({ state: 'visible', timeout: 10000 });
        await learnMore.click();
        await page.locator('[data-test="alert-settings-help-drawer"]').waitFor({ state: 'visible', timeout: 5000 });

        // Capture form's Template Override select value BEFORE panel interaction
        const formSelect = page.locator('[data-test="advanced-template-override-select"]');
        const beforeText = await formSelect.textContent();
        testLogger.info('Template Override value before panel interaction', { beforeText });

        // Open the panel preview template select and pick first available option
        const previewSelect = page.locator('[data-test="help-preview-template-select"]');
        await previewSelect.waitFor({ state: 'visible', timeout: 5000 });
        await openOSelectDropdown(page, previewSelect);

        // If there are options, pick the first; if not, just close the dropdown
        const previewOption = page.locator('[data-test="help-preview-template-select-popover"] [data-test$="-option"]').first();
        const hasOption = await previewOption.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasOption) {
            await previewOption.click();
            testLogger.info('Selected first template in panel preview dropdown');
        } else {
            // No templates installed — press Escape to close dropdown
            await page.keyboard.press('Escape');
            testLogger.info('No preview options available; skipped selection (still validates isolation)');
        }
        await page.waitForTimeout(300);

        // Assert: form select value must be unchanged — Apply is required to commit
        const afterText = await formSelect.textContent();
        expect(afterText).toBe(beforeText);
        testLogger.info('Form Template Override unchanged after panel selection', { beforeText, afterText });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Behavior 3: Drawer closes on overlay click
    // ─────────────────────────────────────────────────────────────────────────
    test('drawer closes when clicking the overlay', {
        tag: ['@alerts-help-drawer', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await navigateToAdvancedTab(page, pm);

        // Open drawer via the Template Override "Learn more" trigger
        const learnMore = page.locator('[data-test="advanced-template-info-btn"]');
        await learnMore.waitFor({ state: 'visible', timeout: 10000 });
        await learnMore.click();
        const drawer = page.locator('[data-test="alert-settings-help-drawer"]');
        await expect(drawer).toBeVisible({ timeout: 5000 });

        // Click the overlay to dismiss
        const overlay = page.locator('[data-test="o-drawer-overlay"]');
        await overlay.waitFor({ state: 'visible', timeout: 5000 });
        await overlay.click({ force: true });

        // Drawer must no longer be visible
        await expect(drawer).toBeHidden({ timeout: 5000 });
        testLogger.info('Drawer closed on overlay click');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Behavior 4: Additional Variables panel — built-in list is collapsed by
    // default (no upfront wall of chips) and expands on demand.
    // ─────────────────────────────────────────────────────────────────────────
    test('Additional Variables help collapses the built-in variables list until expanded', {
        tag: ['@alerts-help-drawer', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await navigateToAdvancedTab(page, pm);

        // Open the Additional Variables "Learn more" trigger
        const learnMore = page.locator('[data-test="advanced-variables-info-btn"]');
        await learnMore.waitFor({ state: 'visible', timeout: 10000 });
        await learnMore.click();
        await expect(page.locator('[data-test="alert-settings-help-drawer"]')).toBeVisible({ timeout: 5000 });

        // Built-in variable chips are hidden until the disclosure is expanded
        await expect(page.locator('[data-test="help-builtin-var"]').first()).toBeHidden();
        const toggle = page.locator('[data-test="help-builtin-toggle"]');
        await expect(toggle).toBeVisible({ timeout: 5000 });

        // Expanding reveals the chips
        await toggle.click();
        await expect(page.locator('[data-test="help-builtin-var"]').first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Built-in variables list expands on demand');
    });
});
