const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment, getOrgIdentifier } = require('../utils/cloud-auth.js');

const ORG_SEARCH_INPUT = '[data-test="org-management-search-input-field"]';

test.describe("Synthetics Status Steps Quota (Organization Management)", () => {
    // Serial: every case reads the same shared _meta org list and one case writes a
    // usage limit, so under fullyParallel they would race each other.
    test.describe.configure({ mode: 'serial' });

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
        tag: ['@synthetics-status-steps-quota', '@cloud', '@p0']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps columns render in the org list');

        await pm.organizationManagementPage.expectStatusStepsColumnsVisible();

        const org = await pm.organizationManagementPage.getFirstOrg();
        await pm.organizationManagementPage.expectStatusStepsCellsNumeric(org.identifier);

        testLogger.info('Status Steps columns render with numeric cells');
    });

    test("should set the Status Steps allowance from the Status Steps tab", {
        tag: ['@synthetics-status-steps-quota', '@cloud', '@p0']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps allowance write path');

        // The only case that writes, so it targets the org this run signed in to, never
        // the first row of the shared _meta list (another tenant's org).
        const identifier = getOrgIdentifier();
        expect(identifier, 'org identifier for this run').toBeTruthy();
        await page.locator(ORG_SEARCH_INPUT).fill(identifier);
        const org = { identifier };
        await expect(pm.organizationManagementPage.getStatusStepsTotalCell(identifier)).toBeVisible({ timeout: 10000 });

        const currentTotalText = await pm.organizationManagementPage.getStatusStepsTotalText(org.identifier);
        const originalLimit = Number(currentTotalText.replace(/[^\d-]/g, ''));
        const newLimit = originalLimit + 1000;
        let restoreStatus;

        try {
            await pm.organizationManagementPage.openUsageLimitsForOrg(org.identifier);
            await pm.organizationManagementPage.selectStatusStepsTab();
            await pm.organizationManagementPage.expectStatusStepsInputValue(originalLimit);

            await pm.organizationManagementPage.fillStatusStepsLimit(newLimit);
            await pm.organizationManagementPage.saveUsageLimits();

            await pm.organizationManagementPage.expectStatusStepsUpdatedToast();
            await pm.organizationManagementPage.expectUsageLimitsDialogClosed();
            await pm.organizationManagementPage.expectStatusStepsTotalCellEquals(org.identifier, newLimit);
        } finally {
            // Asserted after the finally, so a failed restore never masks the original error.
            restoreStatus = await pm.organizationManagementPage.setStatusStepsLimitViaApi(org.identifier, originalLimit);
            if (restoreStatus !== 200) testLogger.error(`Failed to restore status-steps limit of ${org.identifier} to ${originalLimit}: ${restoreStatus}`);
        }
        expect(restoreStatus, `restore status-steps limit of ${org.identifier} to ${originalLimit}`).toBe(200);

        testLogger.info('Status Steps allowance updated, reflected in the org list, and restored');
    });

    test("should show its own wording and used-count on the Status Steps tab", {
        tag: ['@synthetics-status-steps-quota', '@cloud', '@p1']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps tab wording and used-count');

        const org = await pm.organizationManagementPage.getFirstOrg();
        const usedText = await pm.organizationManagementPage.getStatusStepsUsedText(org.identifier);

        await pm.organizationManagementPage.openUsageLimitsForOrg(org.identifier);
        await pm.organizationManagementPage.expectAiCreditsTabActive();

        await pm.organizationManagementPage.selectProtocolStepsTab();
        await pm.organizationManagementPage.expectProtocolStepsWording(org.name);

        await pm.organizationManagementPage.selectStatusStepsTab();
        await pm.organizationManagementPage.expectStatusStepsWording(org.name, usedText);

        testLogger.info('Status Steps tab shows distinct wording and used-count');
    });

    test("should reject non-integer and negative Status Steps values", {
        tag: ['@synthetics-status-steps-quota', '@cloud', '@p1', '@validation']
    }, async ({ page }) => {
        testLogger.info('Testing Status Steps input validation');

        const org = await pm.organizationManagementPage.getFirstOrg();
        await pm.organizationManagementPage.openUsageLimitsForOrg(org.identifier);
        await pm.organizationManagementPage.selectStatusStepsTab();
        await pm.organizationManagementPage.expectStatusStepsTabActive(org.name);

        await pm.organizationManagementPage.fillStatusStepsLimit('12.5');
        await pm.organizationManagementPage.saveUsageLimits();
        await pm.organizationManagementPage.expectStatusStepsValidationError('whole number');
        await pm.organizationManagementPage.expectUsageLimitsDialogVisible();

        await pm.organizationManagementPage.fillStatusStepsLimit('-5');
        await pm.organizationManagementPage.saveUsageLimits();
        await pm.organizationManagementPage.expectStatusStepsValidationError('negative');
        await pm.organizationManagementPage.expectUsageLimitsDialogVisible();
        await pm.organizationManagementPage.expectStatusStepsTabActive(org.name);

        testLogger.info('Status Steps input rejected non-integer and negative values');
    });

    test("should expose status-step fields via the admin org-list API", {
        tag: ['@synthetics-status-steps-quota', '@cloud', '@p2', '@api']
    }, async ({ page }) => {
        testLogger.info('Testing GET /api/_meta/organizations status-step fields');

        const { status, data } = await pm.organizationManagementPage.getAdminOrgsViaSession();

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
