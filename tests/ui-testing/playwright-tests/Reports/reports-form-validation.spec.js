// Copyright 2026 OpenObserve Inc.
// Reports domain — form validation E2E tests
//
// Covers:
//   1. Empty submit → name required error shown (blocks save)
//   2. Absolute timerange with no range set → save blocked (no from/to validation)
//   3. Valid full config → report created successfully
//
// Cleanup notes:
//   Reports created in the happy-path test follow the test_fv_reports_001 name.
//   Clean up via UI or API after the suite run if the test org is shared.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ── Test 1 & 2: Validation error paths ────────────────────────────────────────

test.describe("Reports form validation — required field errors", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        // Open the form without a ?folder= param so the dashboard folder stays
        // deterministically empty — the Add-Report button would pre-scope it to
        // "default" and race the folder-required validation (CI flake).
        await pm.reportsFormValidation.openCreateReportFormDirect();
        testLogger.info('Navigated to Create Report form');
    });

    test("should show name required error when save is clicked with empty name", {
        tag: ['@reports-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing empty name → name required error');

        // Ensure name field is empty
        await pm.reportsFormValidation.clearReportName();

        // Click save without filling any fields
        await pm.reportsFormValidation.clickSave();

        // Name error must be visible
        await expect(pm.reportsFormValidation.getReportNameErrorLocator()).toBeVisible();
        await expect(pm.reportsFormValidation.getReportNameErrorLocator()).toContainText('Name is required');

        // Form must stay on the create page (save was blocked)
        await expect(pm.reportsFormValidation.getAddReportSectionLocator()).toBeVisible();

        testLogger.info('Name required error correctly shown on empty submit');
    });

    test("should show name invalid-characters error when name contains disallowed chars", {
        tag: ['@reports-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing name with invalid characters → format error');

        // Fill a name with disallowed characters
        await pm.reportsFormValidation.fillReportName('invalid name with spaces!');

        // Click save
        await pm.reportsFormValidation.clickSave();

        // Name error for invalid chars must be visible
        await expect(pm.reportsFormValidation.getReportNameErrorLocator()).toBeVisible();
        await expect(pm.reportsFormValidation.getReportNameErrorLocator()).toContainText(
            'Characters like :, ?, /, #, and spaces are not allowed.'
        );

        // Form must stay on the create page
        await expect(pm.reportsFormValidation.getAddReportSectionLocator()).toBeVisible();

        testLogger.info('Invalid-character name error correctly shown');
    });

    test("should show dashboard folder required error when name is valid but folder is empty", {
        tag: ['@reports-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing missing dashboard folder → folder required error');

        // Fill valid name but leave folder empty
        await pm.reportsFormValidation.fillReportName('validname');

        // Click save — saveReport() calls validateReportData() which sets folderError
        await pm.reportsFormValidation.clickSave();

        // Folder error must be visible (wait up to 5s for Vue async re-render)
        await pm.reportsFormValidation.getDashboardFolderErrorLocator().waitFor({ state: 'visible', timeout: 10000 });
        await expect(pm.reportsFormValidation.getDashboardFolderErrorLocator()).toContainText('This field is required');

        // Form must stay on the create page
        await expect(pm.reportsFormValidation.getAddReportSectionLocator()).toBeVisible();

        testLogger.info('Dashboard folder required error correctly shown');
    });
});

// ── Test 2: Absolute timerange with no date set blocks save ───────────────────
// The component validates absolute timerange: if type === "absolute" and
// from/to are both 0 (not set), validateReportData returns false and save is
// blocked. No toast is shown — the form simply stays open.

test.describe("Reports form validation — absolute timerange with no range blocks save", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.reportsFormValidation.navigateToReports();
        await pm.reportsFormValidation.openCreateReportForm();
        testLogger.info('Navigated to Create Report form for timerange test');
    });

    test("should block save when absolute timerange has no from/to date set", {
        tag: ['@reports-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing absolute timerange with no dates → save blocked');

        // Fill a valid name
        await pm.reportsFormValidation.fillReportName('validname_tr_test');

        // Select folder and dashboard (must be present to reach timerange validation)
        await pm.reportsFormValidation.selectFirstDashboardFolder();
        await pm.reportsFormValidation.selectFirstDashboard();
        await pm.reportsFormValidation.selectFirstDashboardTab();

        // Open the timerange picker and switch to absolute mode without setting dates
        await pm.reportsFormValidation.openTimerangeDropdown();

        // Switch to Absolute tab inside the DateTime picker
        await pm.reportsFormValidation.switchToAbsoluteTimerange();

        // Clear both start and end fields so no absolute time is set
        await pm.reportsFormValidation.clearAbsoluteTimerangeFields();

        // Dismiss the picker by pressing Escape
        await pm.reportsFormValidation.dismissTimerangePicker();

        // Attempt to save
        await pm.reportsFormValidation.clickSave();

        // Form must remain on the create-report page — success toast must NOT appear
        await expect(pm.reportsFormValidation.getAddReportSectionLocator()).toBeVisible();
        await expect(pm.reportsFormValidation.getToastSuccessLocator()).not.toBeVisible();

        testLogger.info('Save correctly blocked when absolute timerange has no from/to');
    });
});

// ── Test 3: Happy path — valid config → report created ────────────────────────

test.describe("Reports form validation — valid config creates report", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeAll(async ({ request }) => {
        // Delete the test report if it exists from a previous run so the happy-path test can create it fresh.
        const org  = process.env.ORGNAME || 'default';
        const base = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/+$/, '');
        const creds = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');
        await request.delete(
            `${base}/api/${org}/reports/test_fv_reports_001`,
            { headers: { Authorization: `Basic ${creds}` } }
        ).catch(() => {}); // ignore 404 if report doesn't exist
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.reportsFormValidation.navigateToReports();
        await pm.reportsFormValidation.openCreateReportForm();
        testLogger.info('Navigated to Create Report form for happy path test');
    });

    test("should create report successfully when all required fields are filled correctly", {
        tag: ['@reports-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing valid report creation — happy path');

        const reportName = 'test_fv_reports_001';

        // Step 1: Fill report name
        await pm.reportsFormValidation.fillReportName(reportName);

        // Step 1: Select dashboard folder (default), dashboard, and tab
        await pm.reportsFormValidation.selectFirstDashboardFolder();
        await pm.reportsFormValidation.selectFirstDashboard();
        await pm.reportsFormValidation.selectFirstDashboardTab();

        // Step 1: Continue to step 2
        await pm.reportsFormValidation.clickContinueStep1();

        // Step 2: frequency defaults to "once" + scheduleNow — timezone is
        // auto-filled by saveReport() from the browser timezone. The timezone
        // OSelect is only rendered for cron frequency or scheduleLater tab, so
        // there is nothing to interact with here.

        // Step 2: Continue to step 3
        await pm.reportsFormValidation.clickContinueStep2();

        // Step 3: Fill share title and a valid recipient email
        await pm.reportsFormValidation.fillShareTitle('E2E Form Validation Report');
        await pm.reportsFormValidation.fillShareRecipients(
            process.env['ZO_ROOT_USER_EMAIL'] || process.env['ZO_USER_EMAIL'] || 'test@example.com'
        );

        // Save the report
        await pm.reportsFormValidation.clickSave();

        // Success toast must appear
        await expect(pm.reportsFormValidation.getToastSuccessLocator()).toBeVisible({ timeout: 15000 });

        testLogger.info('Report created successfully with valid config');
    });
});
