const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe("Synthetics Status Steps Quota (Organization Management)", () => {
    test.describe.configure({ mode: 'parallel' });

    // Cloud-only: the Organization Management page and the
    // synthetics_status_protocol pool are gated by isCloud + meta-org.
    test.skip(!isCloudEnvironment(), 'Organization Management page and status-steps pool are cloud-only (meta-org admin)');

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.logoManagementPage.managementOrg('_meta');
        await pm.organizationManagementPage.navigateToOrganizationManagement();
        testLogger.info('Organization management test setup completed');
    });

    test("should render Status Steps Used and Total columns in the org list", {
        tag: ['@synthetics-status-steps-quota', '@all', '@p0']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps columns render in the org list');

        await pm.organizationManagementPage.expectStatusStepsColumnsVisible();

        const orgName = await pm.organizationManagementPage.getFirstOrgName();
        await pm.organizationManagementPage.expectStatusStepsCellsNumeric(orgName);

        testLogger.info('Status Steps columns render with numeric cells');
    });

    test("should set the Status Steps allowance from the Status Steps tab", {
        tag: ['@synthetics-status-steps-quota', '@all', '@p0']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps allowance write path');

        const orgName = await pm.organizationManagementPage.getFirstOrgName();
        const currentTotalText = await pm.organizationManagementPage.getStatusStepsTotalText(orgName);
        const currentLimit = Number(currentTotalText.replace(/[^\d-]/g, ''));
        const newLimit = currentLimit + 1000;

        await pm.organizationManagementPage.openUsageLimitsForOrg(orgName);
        await pm.organizationManagementPage.selectStatusStepsTab();
        await pm.organizationManagementPage.expectStatusStepsInputValue(currentLimit);

        await pm.organizationManagementPage.fillStatusStepsLimit(newLimit);
        await pm.organizationManagementPage.saveUsageLimits();

        await pm.organizationManagementPage.expectStatusStepsUpdatedToast();
        await pm.organizationManagementPage.expectUsageLimitsDialogClosed();
        await pm.organizationManagementPage.expectStatusStepsTotalCellEquals(orgName, newLimit);

        testLogger.info('Status Steps allowance updated and reflected in the org list');
    });

    test("should show its own wording and used-count on the Status Steps tab", {
        tag: ['@synthetics-status-steps-quota', '@all', '@p1']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps tab wording and used-count');

        const orgName = await pm.organizationManagementPage.getFirstOrgName();
        const usedText = await pm.organizationManagementPage.getStatusStepsUsedText(orgName);

        await pm.organizationManagementPage.openUsageLimitsForOrg(orgName);
        await pm.organizationManagementPage.expectAiCreditsTabActive();

        await pm.organizationManagementPage.selectProtocolStepsTab();
        await pm.organizationManagementPage.expectProtocolStepsWording(orgName);

        await pm.organizationManagementPage.selectStatusStepsTab();
        await pm.organizationManagementPage.expectStatusStepsWording(orgName, usedText);

        testLogger.info('Status Steps tab shows distinct wording and used-count');
    });

    test("should reject non-integer and negative Status Steps values", {
        tag: ['@synthetics-status-steps-quota', '@all', '@p1', '@validation']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps input validation');

        const orgName = await pm.organizationManagementPage.getFirstOrgName();
        await pm.organizationManagementPage.openUsageLimitsForOrg(orgName);
        await pm.organizationManagementPage.selectStatusStepsTab();

        await pm.organizationManagementPage.fillStatusStepsLimit('12.5');
        await pm.organizationManagementPage.saveUsageLimits();
        await pm.organizationManagementPage.expectStatusStepsValidationError('whole number');
        await pm.organizationManagementPage.expectUsageLimitsDialogVisible();

        await pm.organizationManagementPage.fillStatusStepsLimit('-5');
        await pm.organizationManagementPage.saveUsageLimits();
        await pm.organizationManagementPage.expectStatusStepsValidationError('negative');
        await pm.organizationManagementPage.expectUsageLimitsDialogVisible();

        testLogger.info('Status Steps input rejected non-integer and negative values');
    });

    test("should expose status-step fields via the admin org-list API", {
        tag: ['@synthetics-status-steps-quota', '@all', '@p2', '@api']
    }, async ({ page }) => {
        testLogger.info('Testing GET /api/_meta/organizations status-step fields');

        const { status, data } = await pm.createOrgPage.getAdminOrgs();

        expect(status).toBe(200);
        expect(data.list.length).toBeGreaterThan(0);

        const first = data.list[0];
        expect(first).toHaveProperty('status_steps_used');
        expect(first).toHaveProperty('status_steps_limit');
        expect(typeof first.status_steps_used).toBe('number');
        expect(typeof first.status_steps_limit).toBe('number');

        testLogger.info('Admin org-list API exposes status_steps_used and status_steps_limit');
    });
});
