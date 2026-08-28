const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../utils/cloud-auth.js');


test.describe("Synthetics Steps Quota Management testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // The whole feature is cloud + _meta org only; in an OSS build there is
        // no route, no tab, and a 404 endpoint.
        test.skip(!isCloudEnvironment(), 'steps quota is cloud + _meta org only');

        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.organizationSyntheticsStepsPage.openOrganizationManagement();

        testLogger.info('Synthetics steps quota test setup completed');
    });

    test("should set the Browser Steps allowance and update the row's Browser Steps Total cell", {
        tag: ['@synthetics-steps-quota', '@all', '@quota', '@browser-steps', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Setting the Browser Steps allowance through the Usage Allowance dialog');

        const targetOrg = 'default';
        const expectedLimit = 12345;
        const before = await pm.organizationSyntheticsStepsPage.getOrgQuota('synthetics_browser_steps', targetOrg);

        try {
            await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);
            await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();
            await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Browser Steps');
            await pm.organizationSyntheticsStepsPage.fillStepsLimit(expectedLimit);
            await pm.organizationSyntheticsStepsPage.saveUsageLimit();

            await pm.organizationSyntheticsStepsPage.expectStepsTotalCell(targetOrg, 'browser', expectedLimit.toLocaleString());
            testLogger.info('Browser Steps Total cell updated to the new ceiling');
        } finally {
            if (typeof before === 'number') {
                await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit('synthetics_browser_steps', targetOrg, before).catch(() => {});
            }
        }
    });

    test("should set the Protocol Steps allowance and update the row's Protocol Steps Total cell", {
        tag: ['@synthetics-steps-quota', '@all', '@quota', '@protocol-steps', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Setting the Protocol Steps allowance through the Usage Allowance dialog');

        const targetOrg = 'default';
        const expectedLimit = 54321;
        const before = await pm.organizationSyntheticsStepsPage.getOrgQuota('synthetics_protocol_steps', targetOrg);

        try {
            await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);
            await pm.organizationSyntheticsStepsPage.selectProtocolStepsTab();
            await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Protocol Steps');
            await pm.organizationSyntheticsStepsPage.fillStepsLimit(expectedLimit);
            await pm.organizationSyntheticsStepsPage.saveUsageLimit();

            await pm.organizationSyntheticsStepsPage.expectStepsTotalCell(targetOrg, 'protocol', expectedLimit.toLocaleString());
            testLogger.info('Protocol Steps Total cell updated to the new ceiling');
        } finally {
            if (typeof before === 'number') {
                await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit('synthetics_protocol_steps', targetOrg, before).catch(() => {});
            }
        }
    });

    test("should set the quota usage limit as a ceiling, not an increment", {
        tag: ['@synthetics-steps-quota', '@all', '@api', '@quota', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying the quota usage limit replaces the ceiling rather than incrementing it');

        const targetOrg = 'default';
        const pool = 'synthetics_browser_steps';
        const before = await pm.organizationSyntheticsStepsPage.getOrgQuota(pool, targetOrg);

        try {
            const { status, data } = await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit(pool, targetOrg, 999);
            expect(status).toBe(200);
            expect(data.limit).toBe(999);

            const persistedLimit = await pm.organizationSyntheticsStepsPage.getOrgQuota(pool, targetOrg);
            expect(persistedLimit).toBe(999);

            testLogger.info('Quota limit stored as the replacement ceiling (not used + limit)');
        } finally {
            if (typeof before === 'number') {
                await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit(pool, targetOrg, before).catch(() => {});
            }
        }
    });

    test("should default to the AI Credits tab and only mount the steps input after selecting a synthetics tab", {
        tag: ['@synthetics-steps-quota', '@all', '@quota', '@ui', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying the dialog opens on AI Credits and mounts the steps input only on tab switch');

        const targetOrg = 'default';
        await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);

        await pm.organizationSyntheticsStepsPage.expectAiCreditsInputVisible();
        await pm.organizationSyntheticsStepsPage.expectStepsInputNotPresent();

        await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();
        await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Browser Steps');

        testLogger.info('Steps input only present after selecting the synthetics tab');
    });

    test("should keep the dialog open and show an error for invalid steps input", {
        tag: ['@synthetics-steps-quota', '@all', '@validation', '@negative', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying invalid steps values are rejected with a per-case error');

        const targetOrg = 'default';
        await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);
        await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();

        const cases = [
            { value: '', error: 'Synthetics steps must be a whole number.' },
            { value: '-1', error: 'Synthetics steps cannot be negative.' },
            { value: '1.5', error: 'Synthetics steps must be a whole number.' },
        ];

        for (const c of cases) {
            await pm.organizationSyntheticsStepsPage.fillStepsLimit(c.value);
            await pm.organizationSyntheticsStepsPage.clickSaveButton();
            await pm.organizationSyntheticsStepsPage.expectDialogStillOpen();
            await pm.organizationSyntheticsStepsPage.expectStepsInputError(c.error);
        }

        testLogger.info('Invalid steps input keeps the dialog open and surfaces the correct error');
    });

    test("should close the dialog on cancel without changing the Browser Steps Total cell", {
        tag: ['@synthetics-steps-quota', '@all', '@quota', '@negative', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying cancel closes the dialog without persisting the entered value');

        const targetOrg = 'default';
        const beforeCellText = await pm.organizationSyntheticsStepsPage.getStepsTotalCellText(targetOrg, 'browser');

        await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);
        await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();
        await pm.organizationSyntheticsStepsPage.fillStepsLimit('777');
        await pm.organizationSyntheticsStepsPage.cancelUsageLimit();

        await pm.organizationSyntheticsStepsPage.expectStepsTotalCell(targetOrg, 'browser', beforeCellText);

        testLogger.info('Cancel left the Browser Steps Total cell unchanged');
    });

    test("should expose step-quota fields in the GET organizations response", {
        tag: ['@synthetics-steps-quota', '@all', '@api', '@adminOrg', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying GET /api/_meta/organizations returns step-quota fields in { data: [...] }');

        const { status, data } = await pm.createOrgPage.getAdminOrgs('_meta');

        expect(status).toBe(200);
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.data.length).toBeGreaterThan(0);

        const first = data.data[0];
        for (const key of ['browser_steps_used', 'browser_steps_limit', 'protocol_steps_used', 'protocol_steps_limit']) {
            expect(typeof first[key]).toBe('number');
        }

        testLogger.info('GET organizations response exposes the step-quota columns');
    });

    test("should swap the steps input label between Browser and Protocol tabs", {
        tag: ['@synthetics-steps-quota', '@all', '@quota', '@ui', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying the shared steps input label follows the active tab');

        const targetOrg = 'default';
        await pm.organizationSyntheticsStepsPage.openUsageLimitsDialog(targetOrg);

        await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();
        await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Browser Steps');

        await pm.organizationSyntheticsStepsPage.selectProtocolStepsTab();
        await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Protocol Steps');

        await pm.organizationSyntheticsStepsPage.selectBrowserStepsTab();
        await pm.organizationSyntheticsStepsPage.expectStepsFormLabel('Total Browser Steps');

        testLogger.info('Steps input label follows the active tab');
    });

    test("should return 4xx for unauthorized / unknown pool / missing org", {
        tag: ['@synthetics-steps-quota', '@all', '@api', '@negative', '@cloud', '@meta']
    }, async ({ page }) => {
        testLogger.info('Verifying the quota endpoint error paths for non-meta / unknown pool / missing org');

        const targetOrg = 'default';

        const unauthorized = await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit('synthetics_browser_steps', targetOrg, 1, 'default');
        expect(unauthorized.status).toBe(401);

        const unknownPool = await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit('unknown_pool', targetOrg, 1);
        expect(unknownPool.status).toBe(400);

        const missingOrg = await pm.organizationSyntheticsStepsPage.setQuotaUsageLimit('synthetics_browser_steps', 'nonexistent_org_xyz', 1);
        expect(missingOrg.status).toBe(404);

        testLogger.info('Quota endpoint returns 401 / 400 / 404 for the documented error paths');
    });
});
