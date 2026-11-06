// Copyright 2026 OpenObserve Inc.
// Onboarding and Marketplace — form validation E2E tests
//
// Covers:
//   AWS Marketplace Setup (@cloud):
//     - Create & Link button stays enabled (OForm+zod gates the submit, not a
//       disabled button); submitting an empty org name reveals the required error
//     - valid org name keeps the Create & Link button enabled
//
//   Azure Marketplace Setup (@cloud):
//     - Create & Link button stays enabled (OForm+zod gates the submit, not a
//       disabled button); submitting an empty org name reveals the required error
//     - valid org name keeps the Create & Link button enabled

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
// AWS/Azure Marketplace onboarding is cloud-only — absent on the OSS binary.
// Cache availability so only the first test of each describe pays the probe cost;
// the rest skip immediately on OSS while running fully on the cloud binary.
const featureAvailable = {};

// ── AWS Marketplace Setup (@cloud) ────────────────────────────────────────────

test.describe("AWS Marketplace Setup form validation", { tag: '@cloud' }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        pm = new PageManager(page);
        // Inject a fake aws_marketplace_token cookie so the page renders the form.
        // The probe navigates, seeds the cookie, reloads and waits for the form's
        // signal element — returning false on the OSS build where the route is absent.
        if (featureAvailable['onboarding-aws'] === false) {
            test.skip(true, 'AWS Marketplace onboarding is a cloud-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['onboarding-aws'] = await pm.onboardingFormValidation.probeAwsMarketplaceSetup();
        if (!featureAvailable['onboarding-aws']) {
            test.skip(true, 'AWS Marketplace onboarding is a cloud-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('AWS Marketplace setup page loaded');
    });

    test("should keep Create & Link button enabled when org name is empty", {
        tag: ['@onboarding-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AWS Create & Link stays enabled for empty org name (OForm)');

        // Under the OForm+zod foundation the Create & Link button is ALWAYS
        // enabled — the schema (newOrgName min(1)) gates the submit, not a
        // disabled button. With an empty org name the button stays enabled.
        await expect(pm.onboardingFormValidation.getAwsCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('AWS Create & Link button correctly stays enabled for empty org name');
    });

    test("should show org name error message when Create & Link is clicked with empty name", {
        tag: ['@onboarding-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AWS org name error when Create & Link clicked with empty name');

        // Submitting the empty form runs the schema (newOrgName required) and
        // reveals the required error on the org-name field — the button itself
        // stays enabled throughout.
        await pm.onboardingFormValidation.clickAwsCreateLink();

        await expect(pm.onboardingFormValidation.getAwsOrgNameInputLocator()).toBeVisible();
        await expect(pm.onboardingFormValidation.getAwsOrgNameErrorLocator()).toBeVisible();

        testLogger.info('AWS org name required error correctly shown on empty submit');
    });

    test("should enable Create & Link button when org name is entered", {
        tag: ['@onboarding-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AWS Create & Link enabled when org name is filled');

        await pm.onboardingFormValidation.fillAwsOrgName('test_fv_aws_org_001');

        await expect(pm.onboardingFormValidation.getAwsCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('AWS Create & Link button correctly enabled after org name entry');
    });

    test("should re-show org name error after a filled name is cleared", {
        tag: ['@onboarding-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AWS org name error returns after clearing a filled name');

        await pm.onboardingFormValidation.fillAwsOrgName('test_fv_aws_org_002');
        await expect(pm.onboardingFormValidation.getAwsCreateLinkBtnLocator()).toBeEnabled();

        // Clearing the field and submitting re-runs the schema and re-reveals the
        // required error (the button stays enabled the whole time).
        await pm.onboardingFormValidation.clearAwsOrgName();
        await pm.onboardingFormValidation.clickAwsCreateLink();
        await expect(pm.onboardingFormValidation.getAwsOrgNameErrorLocator()).toBeVisible();
        await expect(pm.onboardingFormValidation.getAwsCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('AWS org name required error correctly re-shown after clearing');
    });
});

// ── Azure Marketplace Setup (@cloud) ─────────────────────────────────────────

test.describe("Azure Marketplace Setup form validation", { tag: '@cloud' }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        pm = new PageManager(page);
        // Azure setup page reads token from sessionStorage.
        // The probe navigates, seeds the token, reloads and waits for the form's
        // signal element — returning false on the OSS build where the route is absent.
        if (featureAvailable['onboarding-azure'] === false) {
            test.skip(true, 'Azure Marketplace onboarding is a cloud-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['onboarding-azure'] = await pm.onboardingFormValidation.probeAzureMarketplaceSetup();
        if (!featureAvailable['onboarding-azure']) {
            test.skip(true, 'Azure Marketplace onboarding is a cloud-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('Azure Marketplace setup page loaded');
    });

    test("should keep Create & Link button enabled when org name is empty", {
        tag: ['@onboarding-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Azure Create & Link stays enabled for empty org name (OForm)');

        // Always enabled under the OForm+zod foundation — the schema (newOrgName
        // min(1)) gates the submit, not a disabled button.
        await expect(pm.onboardingFormValidation.getAzureCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('Azure Create & Link button correctly stays enabled for empty org name');
    });

    test("should show org name input visible and button enabled with empty credentials", {
        tag: ['@onboarding-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Azure form shows org name input and button stays enabled');

        await expect(pm.onboardingFormValidation.getAzureOrgNameInputLocator()).toBeVisible();
        await expect(pm.onboardingFormValidation.getAzureCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('Azure form org name input visible, Create & Link stays enabled on empty credentials');
    });

    test("should enable Create & Link button when org name is entered", {
        tag: ['@onboarding-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Azure Create & Link enabled when org name is filled');

        await pm.onboardingFormValidation.fillAzureOrgName('test_fv_azure_org_001');

        await expect(pm.onboardingFormValidation.getAzureCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('Azure Create & Link button correctly enabled after org name entry');
    });

    test("should re-show org name error after a filled name is cleared", {
        tag: ['@onboarding-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Azure org name error returns after clearing a filled name');

        await pm.onboardingFormValidation.fillAzureOrgName('test_fv_azure_org_002');
        await expect(pm.onboardingFormValidation.getAzureCreateLinkBtnLocator()).toBeEnabled();

        // Clearing the field and submitting re-runs the schema and re-reveals the
        // required error (the button stays enabled the whole time).
        await pm.onboardingFormValidation.clearAzureOrgName();
        await pm.onboardingFormValidation.clickAzureCreateLink();
        await expect(pm.onboardingFormValidation.getAzureOrgNameErrorLocator()).toBeVisible();
        await expect(pm.onboardingFormValidation.getAzureCreateLinkBtnLocator()).toBeEnabled();

        testLogger.info('Azure org name required error correctly re-shown after clearing');
    });
});
