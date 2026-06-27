// Copyright 2026 OpenObserve Inc.
// Regex Patterns — form validation E2E tests
//
// Covers: AddRegexPattern drawer (AddRegexPattern.vue)
//   1. Empty form submission → name and pattern field errors shown
//   2. Invalid regex syntax supplied → API returns error toast
//   3. Valid name + valid regex → pattern created, drawer closes
//   4. Cancel → drawer closes without saving
//
// Cleanup notes:
//   Patterns created in the happy-path test follow the e2e_fv_regex_001 name.
//   Delete them via Settings > Regex Patterns if cleanup.spec.js does not cover it.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
// Regex Patterns is enterprise-only — its route is absent on the OSS binary.
// Cache availability so only the first test pays the probe cost; the rest skip
// immediately on OSS while running fully on the enterprise binary.
const featureAvailable = {};

test.describe("Regex Patterns form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (featureAvailable['regex-patterns'] === false) {
            test.skip(true, 'Regex Patterns is an enterprise-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['regex-patterns'] = await pm.regexPatternsFormValidation.navigateToRegexPatterns();
        if (!featureAvailable['regex-patterns']) {
            test.skip(true, 'Regex Patterns is an enterprise-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('Navigated to Regex Patterns settings page');
    });

    // ── Test 1: Empty form → name and pattern required errors ────────────────

    test("should show name and pattern required errors when form is submitted empty", {
        tag: ['@regex-patterns-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing empty form submission shows required field errors');

        await pm.regexPatternsFormValidation.openAddPatternDrawer();
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).toBeVisible();

        // The Create button is NOT gated on form contents — AddRegexPattern.vue's
        // ODrawer has no :primary-button-disabled binding, so the primary button
        // stays enabled and validation is enforced on submit via the OForm schema.
        // (Verified against the enterprise build; OSS skips this suite entirely.)
        await expect(pm.regexPatternsFormValidation.getSaveButtonLocator()).toBeEnabled();

        testLogger.info('Save button enabled for empty form — validation enforced on submit');

        // Submitting the empty form runs the OForm schema validators, which mark
        // every field touched and surface the required errors without submitting
        // (vee-validate blocks the @submit handler while the form is invalid).
        await pm.regexPatternsFormValidation.clickSave();

        // vee-validate blocks the @submit handler while the form is invalid, so
        // no save fires and the drawer must stay open — guards against an
        // accidental side-effect submit on the empty form.
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).toBeVisible();

        // OFormInput validator: '* Name is required'
        await expect(pm.regexPatternsFormValidation.getNameErrorLocator()).toBeVisible();
        await expect(pm.regexPatternsFormValidation.getNameErrorLocator()).toContainText('* Name is required');
        // OFormTextarea validator: '* Pattern is required'
        await expect(pm.regexPatternsFormValidation.getPatternErrorLocator()).toBeVisible();
        await expect(pm.regexPatternsFormValidation.getPatternErrorLocator()).toContainText('* Pattern is required');

        testLogger.info('Name and pattern required errors correctly shown for empty form');
    });

    // ── Test 2: Invalid regex syntax → API error toast ───────────────────────

    test("should show error toast when invalid regex syntax is submitted", {
        tag: ['@regex-patterns-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing invalid regex syntax triggers an error response');

        await pm.regexPatternsFormValidation.openAddPatternDrawer();
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).toBeVisible();

        // Fill valid name so the form is not empty, but use an invalid regex
        await pm.regexPatternsFormValidation.fillName('e2e_fv_regex_invalid_syntax');
        // Unbalanced bracket is universally invalid regex syntax
        await pm.regexPatternsFormValidation.fillPattern('[unclosed(bracket');

        // Save button should now be enabled (name and pattern are both non-empty)
        await expect(pm.regexPatternsFormValidation.getSaveButtonLocator()).toBeEnabled();

        await pm.regexPatternsFormValidation.clickSave();

        // The backend should reject the invalid regex and the component shows an error toast
        await expect(pm.regexPatternsFormValidation.getToastErrorLocator()).toBeVisible({ timeout: 10000 });

        testLogger.info('Error toast correctly shown for invalid regex syntax');
    });

    // ── Test 3: Valid name + valid regex → pattern created ───────────────────

    test("should create pattern successfully with valid name and valid regex", {
        tag: ['@regex-patterns-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing successful pattern creation with valid inputs');

        await pm.regexPatternsFormValidation.openAddPatternDrawer();
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).toBeVisible();

        // Unique name per run so re-runs don't hit a duplicate-name backend
        // rejection (which keeps the drawer open and fails the close assertion).
        await pm.regexPatternsFormValidation.fillName(`test_fv_regex_${Date.now()}`);
        // Valid regex pattern matching digits
        await pm.regexPatternsFormValidation.fillPattern('\\d{4}-\\d{2}-\\d{2}');

        await expect(pm.regexPatternsFormValidation.getSaveButtonLocator()).toBeEnabled();
        await pm.regexPatternsFormValidation.clickSave();

        // Drawer should close after successful creation
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).not.toBeVisible({ timeout: 10000 });

        testLogger.info('Pattern created successfully — drawer closed as expected');
    });

    // ── Test 4: Cancel → drawer closes ───────────────────────────────────────

    test("should close drawer without saving when cancel is clicked", {
        tag: ['@regex-patterns-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing drawer closes on cancel without saving');

        await pm.regexPatternsFormValidation.openAddPatternDrawer();
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).toBeVisible();

        // Fill in some values to confirm they are discarded
        await pm.regexPatternsFormValidation.fillName('e2e_fv_regex_cancel_test');
        await pm.regexPatternsFormValidation.fillPattern('.*cancel.*');

        await pm.regexPatternsFormValidation.clickCancel();

        // Drawer should no longer be visible after cancel
        await expect(pm.regexPatternsFormValidation.getDrawerLocator()).not.toBeVisible({ timeout: 8000 });

        testLogger.info('Drawer correctly closed on cancel — no pattern saved');
    });
});
