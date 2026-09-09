// Copyright 2026 OpenObserve Inc.
//
// Expired Trial Settings Paywall — E2E tests.
//
// Covers the OSS baseline (General Settings renders fully, no paywall) and the
// OSS route-guard regression (a paid route is not redirected to /billings/plans).
// The two expired-trial paywall scenarios are cloud-only — `free_trial_expiry` is
// only populated in a cloud build and `shouldPaywallRoute` hard-gates on
// `config.isCloud === "true"` — so they are parked as test.fixme feature-gap
// placeholders, never as tests that would fail in OSS.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Expired Trial Settings Paywall testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    test("should render the full General Settings platform form without paywall", {
        tag: ['@trial-expiry-settings', '@all', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Asserting OSS baseline: full settings form renders with no paywall');

        await pm.settingsFormValidation.gotoGeneralSettings();

        // Platform settings form (scrape interval + max series per query) renders.
        await pm.settingsFormValidation.expectScrapeIntervalFieldVisible();
        await pm.settingsFormValidation.expectMaxSeriesPerQueryFieldVisible();

        // Theme chips and the save button render.
        await pm.themePage.expectThemeLightChipVisible();
        await pm.themePage.expectThemeDarkChipVisible();
        await pm.settingsFormValidation.expectGeneralSettingsSaveBtnVisible();

        // Danger Zone is cloud-only (canDeleteOrg requires config.isCloud === "true").
        await pm.settingsFormValidation.expectDangerZoneHidden();

        // No redirect to the billing plans page occurred.
        await pm.settingsFormValidation.expectNotOnPlans();

        testLogger.info('OSS baseline test completed');
    });

    test("should not redirect a paid route to /billings/plans in OSS", {
        tag: ['@trial-expiry-settings', '@all', '@P1']
    }, async ({ page }) => {
        testLogger.info('Asserting OSS route guard does not paywall a paid route');

        await pm.logsPage.navigateToLogs();

        // The logs page renders (query editor visible) instead of redirecting.
        await pm.logsPage.expectQueryEditorVisible();

        // The strict config.isCloud === "true" guard means OSS never paywalls.
        await expect(page).not.toHaveURL(/\/billings\/plans/);

        testLogger.info('OSS route guard regression test completed');
    });

    test.fixme("Expired trial hides settings sections but keeps Danger Zone — not wired: free_trial_expiry only set in cloud (src/db/src/organization.rs:58-59)", {
        tag: ['@trial-expiry-settings', '@all', '@P1']
    }, async ({ page }) => {
        testLogger.info('Asserting paywall hides non-destructive sections but keeps Danger Zone (cloud-only)');

        await pm.settingsFormValidation.gotoGeneralSettings();

        // Non-destructive sections are hidden when trialExpired is true.
        await pm.settingsFormValidation.expectScrapeIntervalFieldHidden();
        await pm.settingsFormValidation.expectMaxSeriesPerQueryFieldHidden();
        await pm.themePage.expectThemeLightChipHidden();
        await pm.themePage.expectThemeDarkChipHidden();

        // Danger Zone stays reachable for an admin to delete the org.
        await pm.settingsFormValidation.expectDangerZoneVisible();
        await pm.settingsFormValidation.expectDeleteOrgBtnVisible();

        testLogger.info('Paywall hide-sections test completed');
    });

    test.fixme("Expired trial redirects paid routes to plans but exempts settings/general — not wired: config.isCloud==='true' required; plans route is enterprise-only (router.ts:261-262)", {
        tag: ['@trial-expiry-settings', '@all', '@P2']
    }, async ({ page }) => {
        testLogger.info('Asserting paywall redirects paid routes and exempts settings/general (cloud-only)');

        // A paid route redirects to plans with the org_identifier preserved.
        await pm.logsPage.navigateToLogs();
        await pm.settingsFormValidation.expectOnPlans();

        // settings/general is exempt and renders without a redirect.
        await pm.settingsFormValidation.gotoGeneralSettings();
        await pm.settingsFormValidation.expectNotOnPlans();
        await pm.settingsFormValidation.expectScrapeIntervalFieldVisible();

        testLogger.info('Paywall redirect test completed');
    });
});
