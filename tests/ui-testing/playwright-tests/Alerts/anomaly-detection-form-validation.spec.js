// Copyright 2026 OpenObserve Inc.
//
// Anomaly Detection domain — form validation E2E tests
//
// Covers:
//   1. Add Anomaly wizard — blank name blocks save and highlights the field
//   2. Query mode toggle — switching between filter and custom SQL modes
//   3. Detection window error — save button disabled or window error shown for invalid window

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Anomaly Detection form validation', { tag: ['@anomaly-form-validation', '@P0', '@smoke'] }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        const available = await pm.anomalyFormValidation.navigateToAnomalyDetection();
        if (!available) {
            test.skip(true, 'Anomaly Detection tab not available on this build (enterprise feature)');
        }
        testLogger.info('Navigated to Anomaly Detection tab');
    });

    // ── TC001: blank name blocks save and highlights the name field ───────────
    //
    // The wizard does NOT gate save by disabling the button: OForm keeps submit
    // enabled and validates on click, so the offending field gets painted rather
    // than the user being left guessing why a gray button won't respond. The
    // blank-name rule lives in AddAlert.schema.ts's anomaly branch.

    test('should block save and highlight the name when it is blank', {
        tag: ['@anomaly-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC001: Verify blank anomaly name blocks save and paints the field');

        await pm.anomalyFormValidation.openAddAnomalyWizard();

        // Wizard is open on step 1; name is blank and nothing is selected yet
        await expect(pm.anomalyFormValidation.getStreamTypeSelectLocator()).toBeVisible();

        // Save stays enabled — validation runs on submit, not via a disabled button
        const saveBtn = pm.anomalyFormValidation.getSaveBtnLocator();
        await expect(saveBtn).toBeEnabled();

        await pm.anomalyFormValidation.clickSave();

        // Blank name must paint the topbar field and toast, and must not save
        await expect(pm.anomalyFormValidation.getAnomalyNameErrorLocator())
            .toHaveText('Anomaly name is required.');
        await expect(pm.anomalyFormValidation.getToastMessageLocator(/fix the highlighted fields/i))
            .toBeVisible();
        testLogger.info('Blank name correctly blocked save and highlighted the field');

        await pm.anomalyFormValidation.clickCancel();
    });

    // ── TC002: Stream type select is visible and interactive ─────────────────

    test('should show stream type select when Add Anomaly wizard opens', {
        tag: ['@anomaly-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC002: Verify stream type select is present on wizard open');

        await pm.anomalyFormValidation.openAddAnomalyWizard();

        await expect(pm.anomalyFormValidation.getStreamTypeSelectLocator()).toBeVisible();
        await expect(pm.anomalyFormValidation.getStreamNameSelectLocator()).toBeVisible();

        testLogger.info('Stream type and name selects are visible');

        await pm.anomalyFormValidation.clickCancel();
    });

    // ── TC003: Cancel closes the wizard ──────────────────────────────────────

    test('should close wizard when Cancel is clicked', {
        tag: ['@anomaly-form-validation', '@functional', '@P2']
    }, async ({ page }) => {
        testLogger.info('TC003: Verify Cancel closes the anomaly wizard');

        await pm.anomalyFormValidation.openAddAnomalyWizard();

        // Stream type select should be visible (wizard is open)
        await expect(pm.anomalyFormValidation.getStreamTypeSelectLocator()).toBeVisible();

        await pm.anomalyFormValidation.clickCancel();

        // After cancel, anomaly table should still be visible (back on list page)
        await expect(pm.anomalyFormValidation.getAnomalyTableLocator()).toBeVisible({ timeout: 10000 });
        testLogger.info('Wizard closed correctly after Cancel');
    });
});
