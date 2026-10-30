const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

const DAY_US = 24 * 60 * 60 * 1_000_000;
const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

// Pins the org's trial state and billing provider, so each case runs on any Cloud org.
async function pinBillingState(page, { expiry, provider }) {
    await page.route(/\/api\/[^/]+\/settings(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json().catch(() => ({ data: {} }));
        body.data = { ...(body.data || {}), free_trial_expiry: expiry ?? '' };
        await route.fulfill({ response, json: body });
    });
    await page.route(/\/billings\/list_subscription(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, provider } });
    });
}

async function openBillingFromRail(page) {
    const orgId = getOrgIdentifier();
    await page.goto(`${baseUrl()}/web/billings?org_identifier=${orgId}`);
    await page.waitForURL(/\/billings\/(usage|plans)/, { timeout: 30000 });
}

test.describe('Billing landing and trial strip', () => {
    test.skip(!isCloudEnvironment(), 'Billing is Cloud-only');

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
    });

    // A pinned route still in flight when the test ends must not fail it after its assertions passed.
    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('a trial org lands on Usage with the info strip, Compare plans and the end rule', {
        tag: ['@onboarding', '@billing', '@cloud', '@P1'],
    }, async ({ page }) => {
        await pinBillingState(page, { expiry: Date.now() * 1000 + 9.5 * DAY_US, provider: 'stripe' });
        await openBillingFromRail(page);

        await expect(page).toHaveURL(/\/billings\/usage/);
        const strip = page.locator('[data-test="trial-period-container"]');
        await expect(strip).toHaveAttribute('data-tone', 'info');
        await expect(strip).toContainText('Trial period');
        await expect(strip).toContainText('9 days left');
        await expect(page.locator('[data-test="trial-period-end-rule"]')).toHaveText(
            'When the trial ends, only Plans and settings open until you choose a plan.',
        );

        await page.locator('[data-test="trial-period-compare-plans-btn"]').click();
        await expect(page).toHaveURL(/\/billings\/plans/);
        await expect(page.locator('[data-test="trial-period-contact-support-btn"]')).toBeVisible();
        await expect(page.locator('[data-test="billing-plans-pro-subscribe-btn"]')).toHaveCount(1);
        await expect(page.locator('[data-test="billing-plans-enterprise-contact-btn"]')).toHaveCount(1);
        await expect(page.getByText('Please subscribe to one of the plan.')).toHaveCount(0);
    });

    test('three days or fewer turn the strip warning', {
        tag: ['@onboarding', '@billing', '@cloud', '@P2'],
    }, async ({ page }) => {
        await pinBillingState(page, { expiry: Date.now() * 1000 + 2.5 * DAY_US, provider: 'stripe' });
        await openBillingFromRail(page);

        const strip = page.locator('[data-test="trial-period-container"]');
        await expect(strip).toHaveAttribute('data-tone', 'warning');
        await expect(strip).toContainText('2 days left');
    });

    test('an expired trial reads ended in warning tone on Plans', {
        tag: ['@onboarding', '@billing', '@cloud', '@P2'],
    }, async ({ page }) => {
        await pinBillingState(page, { expiry: Date.now() * 1000 - 2 * DAY_US, provider: 'stripe' });
        const orgId = getOrgIdentifier();
        await page.goto(`${baseUrl()}/web/billings/plans?org_identifier=${orgId}`);

        const strip = page.locator('[data-test="trial-period-container"]');
        await expect(strip).toHaveAttribute('data-tone', 'warning');
        await expect(strip).toContainText('ended');
    });

    test('a paid org lands on Plans with no subscribe toast', {
        tag: ['@onboarding', '@billing', '@cloud', '@P1'],
    }, async ({ page }) => {
        await pinBillingState(page, { expiry: '', provider: 'stripe' });
        await openBillingFromRail(page);

        await expect(page).toHaveURL(/\/billings\/plans/);
        await expect(page.locator('[data-test="trial-period-container"]')).toHaveCount(0);
        for (const id of ['billing-tab-plans', 'billing-tab-usage', 'billing-tab-group']) {
            await expect(page.locator(`[data-test="${id}"]`)).toHaveCount(1);
        }
        await expect(page.getByText('Please subscribe to one of the plan.')).toHaveCount(0);
    });

    test('an AWS-billed trial org lands on Plans with no strip', {
        tag: ['@onboarding', '@billing', '@cloud', '@P2'],
    }, async ({ page }) => {
        await pinBillingState(page, { expiry: Date.now() * 1000 + 9.5 * DAY_US, provider: 'aws' });
        await openBillingFromRail(page);

        await expect(page).toHaveURL(/\/billings\/plans/);
        await expect(page.locator('[data-test="trial-period-container"]')).toHaveCount(0);
    });
});
