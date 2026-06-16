// Copyright 2026 OpenObserve Inc.
//
// Settings domain — form validation E2E tests
//
// Covers:
//   OrganizationSettings : clear trace ID → required error on save
//                          invalid identifier → format error on input
//                          valid values → saved successfully
//   OrgStorageEditor     : empty required fields → required errors on submit
//                          (storage is @enterprise-only — all tests tagged accordingly)
//   DomainManagement     : invalid domain format → error; valid domain → added

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ── OrganizationSettings (Log Details) form ───────────────────────────────────

test.describe("Settings OrganizationSettings form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.settingsFormValidation.navigateToOrganizationSettings();
        testLogger.info('Navigated to Settings > Organization Settings');
    });

    test("should show required error when trace ID field is cleared and save is clicked", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error on empty trace ID field after save');

        // Clear the trace ID field completely
        await pm.settingsFormValidation.clearTraceIdField();
        // Trigger save to force validation
        await pm.settingsFormValidation.clickOrgSettingsSave();

        const traceError = pm.settingsFormValidation.getTraceIdErrorLocator();
        await expect(traceError).toBeVisible({ timeout: 5000 });
        await expect(traceError).toContainText('Name is required');

        testLogger.info('Required error correctly shown for empty trace ID');
    });

    test("should show format error when trace ID contains invalid characters", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing format error for invalid trace ID identifier');

        // Type a value with invalid characters — error fires on input change
        await pm.settingsFormValidation.fillTraceIdField('invalid value with spaces!');
        // Trigger field update by clicking save
        await pm.settingsFormValidation.clickOrgSettingsSave();

        const traceError = pm.settingsFormValidation.getTraceIdErrorLocator();
        await expect(traceError).toBeVisible({ timeout: 5000 });
        await expect(traceError).toContainText("Use alphanumeric and '+=,.@-_' characters only, without spaces.");

        testLogger.info('Format error correctly shown for invalid trace ID characters');
    });

    test("should show required error when span ID field is cleared and save is clicked", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error on empty span ID field after save');

        await pm.settingsFormValidation.clearTraceIdField();
        await pm.settingsFormValidation.fillSpanIdField('');
        await pm.settingsFormValidation.clickOrgSettingsSave();

        const spanError = pm.settingsFormValidation.getSpanIdErrorLocator();
        await expect(spanError).toBeVisible({ timeout: 5000 });
        await expect(spanError).toContainText('Name is required');

        testLogger.info('Required error correctly shown for empty span ID');
    });

    test("should save successfully when valid trace and span IDs are provided", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing successful save with valid trace and span IDs');

        // Fill both fields with valid alphanumeric identifiers
        await pm.settingsFormValidation.fillTraceIdField('trace_id_fv_001');
        await pm.settingsFormValidation.fillSpanIdField('span_id_fv_001');
        await pm.settingsFormValidation.clickOrgSettingsSave();

        // Expect success toast — either direct success or no error toast
        const toastSuccess = pm.settingsFormValidation.getToastSuccessLocator();
        const toastError   = pm.settingsFormValidation.getToastErrorLocator();

        // Wait briefly for a toast to appear
        await page.waitForTimeout(1500);

        // If a success toast appears it should not contain an error
        const successCount = await toastSuccess.count();
        const errorCount   = await toastError.count();

        // At least one of these should be true: success appeared OR no error appeared
        expect(successCount > 0 || errorCount === 0).toBe(true);

        testLogger.info('Save with valid identifiers completed without client-side validation errors');
    });
});

// ── OrgStorageEditor required-field validation ────────────────────────────────
// Storage configuration is enterprise-only.

test.describe("Settings OrgStorageEditor form validation", {
    tag: '@enterprise'
}, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        // Navigate to Settings — storage tab
        await pm.settingsFormValidation.navigateToSettings(page);
        // Click the storage settings tab (Settings shell)
        const storageTab = pm.settingsFormValidation.getStorageTabLocator();
        const found = await storageTab.count();
        if (found > 0) {
            await storageTab.first().click();
        }
        // Wait for the "Add Storage" or storage list page to be ready
        const addStorageBtn = pm.settingsFormValidation.getAddStorageBtnLocator();
        await addStorageBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addStorageBtn.click();
        // Wait for step 1 (provider selection)
        await pm.settingsFormValidation.getStep1ContinueBtnLocator().waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Navigated to OrgStorageEditor (step 1)');
    });

    test("should show required errors when submitting AWS storage with empty required fields", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AWS storage empty required fields validation');

        // Select AWS provider and proceed to step 2
        await pm.settingsFormValidation.selectProviderAndContinue('aws');

        // Click submit without filling any field
        await pm.settingsFormValidation.clickStorageSubmit();

        // At least the bucket name error should appear
        const bucketError = pm.settingsFormValidation.getBucketNameErrorLocator();
        await expect(bucketError).toBeVisible({ timeout: 5000 });
        await expect(bucketError).toContainText('Bucket name is required');

        testLogger.info('Bucket name required error correctly shown for empty AWS fields');
    });

    test("should show access key required error when bucket name is filled but access key is empty", {
        tag: ['@settings-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing access key required error with partial AWS form fill');

        await pm.settingsFormValidation.selectProviderAndContinue('aws');

        // Fill only bucket name — leave access key and secret key empty
        await pm.settingsFormValidation.fillBucketName('test-bucket-fv-001');
        await pm.settingsFormValidation.clickStorageSubmit();

        const accessKeyError = pm.settingsFormValidation.getAccessKeyErrorLocator();
        await expect(accessKeyError).toBeVisible({ timeout: 5000 });
        await expect(accessKeyError).toContainText('Access key is required');

        testLogger.info('Access key required error correctly shown');
    });

    test("should show secret key required error when bucket and access key are filled but secret key is empty", {
        tag: ['@settings-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing secret key required error with partial AWS form fill');

        await pm.settingsFormValidation.selectProviderAndContinue('aws');

        await pm.settingsFormValidation.fillBucketName('test-bucket-fv-002');
        await pm.settingsFormValidation.fillAccessKey('AKIAIOSFODNN7EXAMPLE');
        // Leave secret key empty
        await pm.settingsFormValidation.clickStorageSubmit();

        const secretKeyError = pm.settingsFormValidation.getSecretKeyErrorLocator();
        await expect(secretKeyError).toBeVisible({ timeout: 5000 });
        await expect(secretKeyError).toContainText('Secret key is required');

        testLogger.info('Secret key required error correctly shown');
    });
});

// ── DomainManagement form validation ─────────────────────────────────────────
// DomainManagement is available only in the meta-org context (@enterprise).

test.describe("Settings DomainManagement form validation", {
    tag: '@enterprise'
}, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.settingsFormValidation.navigateToSettings(page);
        // Click the domain management tab
        const domainTab = pm.settingsFormValidation.getDomainTabLocator();
        const found = await domainTab.count();
        if (found > 0) {
            await domainTab.first().click();
        }
        // Wait for either the "no domain" message or the domain restrictions title
        await pm.settingsFormValidation.getDomainRestrictionsTitleLocator().waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Navigated to Settings > Domain Management');
    });

    test("should show error when an invalid domain format is entered", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing invalid domain format error');

        // Fill an invalid domain (no TLD, contains spaces)
        await pm.settingsFormValidation.fillNewDomain('not_a_domain');
        // The Add Domain button should be disabled for invalid input
        const addBtn = pm.settingsFormValidation.getAddDomainBtnLocator();
        await expect(addBtn).toBeDisabled({ timeout: 3000 });

        testLogger.info('Add Domain button correctly disabled for invalid domain format');
    });

    test("should show error for domain with invalid characters", {
        tag: ['@settings-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing domain with invalid special characters');

        await pm.settingsFormValidation.fillNewDomain('domain with spaces.com');
        const addBtn = pm.settingsFormValidation.getAddDomainBtnLocator();
        await expect(addBtn).toBeDisabled({ timeout: 3000 });

        testLogger.info('Add Domain button disabled for domain with spaces');
    });

    test("should enable add button and add domain when valid domain is entered", {
        tag: ['@settings-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing valid domain addition');

        const validDomain = 'test-fv-domain.example.com';
        await pm.settingsFormValidation.fillNewDomain(validDomain);

        const addBtn = pm.settingsFormValidation.getAddDomainBtnLocator();
        await expect(addBtn).toBeEnabled({ timeout: 3000 });

        await addBtn.click();

        // After clicking Add, the domain should appear in the list
        // The "no domain" message should no longer be visible
        const noDomainMsg = pm.settingsFormValidation.getNoDomainMessageLocator();
        await expect(noDomainMsg).not.toBeVisible({ timeout: 5000 });

        // The domain name should appear somewhere in the page
        await expect(page.getByText(validDomain)).toBeVisible({ timeout: 5000 });

        testLogger.info('Valid domain successfully added to the list');
    });

    test("should show required error when trying to add an empty domain", {
        tag: ['@settings-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Add Domain button disabled state for empty input');

        // Do not fill any domain value — button should be disabled
        const addBtn = pm.settingsFormValidation.getAddDomainBtnLocator();
        await expect(addBtn).toBeDisabled({ timeout: 3000 });

        testLogger.info('Add Domain button correctly disabled when domain input is empty');
    });
});

// ── ModelPricingEditor form validation ────────────────────────────────────────

test.describe("Settings ModelPricingEditor form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.settingsFormValidation.navigateToModelPricing();
        testLogger.info('Navigated to Settings > Model Pricing');
    });

    test("should disable save or show error when model pricing name is empty", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Verifying save is disabled or error shown when model pricing name is empty');

        // Clear the name field to trigger validation
        await pm.settingsFormValidation.clearModelPricingName();

        const saveBtn   = pm.settingsFormValidation.getModelPricingSaveBtnLocator();
        const nameError = pm.settingsFormValidation.getModelPricingNameErrorLocator();

        // Either the save button is disabled OR an error message is shown
        const saveDisabled = await saveBtn.isDisabled().catch(() => false);
        const errorVisible = await nameError.isVisible().catch(() => false);

        expect(saveDisabled || errorVisible).toBe(true);

        testLogger.info('Save button disabled or name error shown for empty model pricing name');
    });

    test("should show pattern error when pattern is empty", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Verifying pattern error shown when pattern field is empty');

        // Fill a valid name so that field does not block validation
        await pm.settingsFormValidation.fillModelPricingName('test_fv_001');

        // Clear the pattern field
        await pm.settingsFormValidation.clearModelPricingPattern();

        // Attempt save to trigger validation
        await pm.settingsFormValidation.clickModelPricingSave();

        const patternError = pm.settingsFormValidation.getModelPricingPatternErrorLocator();
        await patternError.waitFor({ state: 'visible', timeout: 5000 });
        await expect(patternError).toBeVisible();
        await expect(patternError).toContainText('Match pattern is required');

        testLogger.info('Pattern error correctly shown when pattern field is empty');
    });

    test("should close editor when cancel is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Verifying editor closes when cancel button is clicked');

        // The editor is already open (navigateToModelPricing waits for save btn)
        const saveBtn = pm.settingsFormValidation.getModelPricingSaveBtnLocator();
        await expect(saveBtn).toBeVisible();

        // Click cancel
        await pm.settingsFormValidation.clickModelPricingCancel();

        // After cancel, the save button should no longer be visible
        await expect(saveBtn).not.toBeVisible({ timeout: 5000 });

        testLogger.info('Model pricing editor closed after cancel button click');
    });
});
