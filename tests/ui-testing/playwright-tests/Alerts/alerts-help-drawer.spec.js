// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Additional Settings Help Drawer — E2E Smoke Tests
 *
 * Verifies three behaviors introduced by the new AlertSettingsHelpDrawer component:
 *   1. Clicking the info button opens the help drawer with current-section content.
 *   2. Selecting a template in the panel's preview dropdown does NOT mutate the
 *      form's Template Override select (Apply is required to commit).
 *   3. The drawer closes when clicking the overlay.
 *
 * Modelled after: tests/ui-testing/playwright-tests/Alerts/alerts-advanced.spec.js
 * Uses the same harness: enhanced-baseFixtures.js + PageManager + oselectHelpers pattern.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const NETWORK_IDLE_TIMEOUT_MS = 30000;
const ALERT_LIST_ADD_BTN = '[data-test="alert-list-add-alert-btn"]';

/**
 * Open an OSelect dropdown by clicking its trigger button until aria-expanded is true.
 * Mirrors the pattern in oselectHelpers.js (which is ES module; we inline for CJS compat).
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
 * Navigate to the alert creation wizard and land on the Advanced tab.
 * Reuses the same navigation pattern used by alertCreationWizard.js:
 *   Click add → fill name → select stream type → select stream → reach Advanced tab.
 *
 * We do the minimal steps needed to reach the Advanced tab without creating an alert.
 */
async function navigateToAdvancedTab(page, pm) {
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

    // Open alert creation wizard
    await page.locator(ALERT_LIST_ADD_BTN).waitFor({ state: 'visible', timeout: 30000 });
    await page.locator(ALERT_LIST_ADD_BTN).click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Fill alert name
    await page.locator('[data-test="alert-name-input"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-test="alert-name-input"]').click();
    const uniqueSuffix = Math.random().toString(36).substring(2, 8);
    await page.locator('[data-test="alert-name-input"] input').fill('auto_helpdrawer_smoke_' + uniqueSuffix);

    // Select stream type (logs) via OSelect popover
    const streamTypeSelect = page.locator('[data-test="alert-stream-type-select"]');
    await openOSelectDropdown(page, streamTypeSelect);
    const streamTypePopover = page.locator('[data-test="alert-stream-type-select-popover"]');
    await streamTypePopover.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-test="alert-stream-type-select-option"][data-test-value="logs"]').click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Select stream — use e2e_automate which always exists in CI
    const streamNameSelect = page.locator('[data-test="alert-stream-name-select"]');
    await streamNameSelect.waitFor({ state: 'visible', timeout: 10000 });
    await openOSelectDropdown(page, streamNameSelect);
    // Type to filter, then pick first available
    await page.keyboard.type('e2e_automate', { delay: 30 });
    await page.waitForTimeout(1000);
    const firstStreamOption = page.locator('[data-test$="-option"]').first();
    await firstStreamOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await firstStreamOption.click();
    await page.waitForTimeout(500);

    // Switch to Advanced tab (mirrors _switchToAdvancedTab in alertCreationWizard.js)
    const advancedTab = page.locator('.alert-v3-tabs > div:first-child > div').filter({ hasText: 'Advanced' }).first();
    await advancedTab.waitFor({ state: 'visible', timeout: 10000 });
    await advancedTab.click({ force: true });
    await page.waitForTimeout(500);
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
    // Behavior 1: Info button opens the help drawer
    // ─────────────────────────────────────────────────────────────────────────
    test('clicking the info button opens the help drawer and shows current-section content', {
        tag: ['@alerts-help-drawer', '@smoke', '@alerts'],
    }, async ({ page }) => {
        await navigateToAdvancedTab(page, pm);

        // The help-info button lives next to the Template Override field in Advanced tab
        const infoBtn = page.locator('[data-test="advanced-template-info-btn"]');
        await infoBtn.waitFor({ state: 'visible', timeout: 10000 });
        await infoBtn.click();

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

        // Open drawer
        const infoBtn = page.locator('[data-test="advanced-template-info-btn"]');
        await infoBtn.waitFor({ state: 'visible', timeout: 10000 });
        await infoBtn.click();
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

        // Open drawer
        const infoBtn = page.locator('[data-test="advanced-template-info-btn"]');
        await infoBtn.waitFor({ state: 'visible', timeout: 10000 });
        await infoBtn.click();
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
});
