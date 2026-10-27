// First login on cloud opens /onboarding: five choices, other ways to start, the terms notice,
// and exits that record the start once. Onboarding exists only on cloud and only for an org
// with no data, so each test runs in a fresh org.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { authedRequest } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { OnboardingPage } = require('../../pages/generalPages/getStartedPage.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const homeUrl = (orgId) => `${baseUrl()}/web/?org_identifier=${orgId}`;

async function createOrg(page) {
    const res = await authedRequest(page, 'post', `${baseUrl()}/api/organizations`, { data: { name: `e2e_onb_${Date.now()}` } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return body.identifier || (body.data && body.data.identifier);
}

test.describe('Onboarding on first login', () => {
    test.describe.configure({ mode: 'serial' });
    let ob;
    let orgId;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(!isCloudEnvironment(), 'Onboarding is cloud-only');
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        orgId = await createOrg(page);
        ob = new OnboardingPage(page);
        await ob.captureAttribution({ passThrough: true });
    });

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')).catch(() => {});
        if (orgId) await authedRequest(page, 'delete', `${baseUrl()}/api/organizations/${orgId}`).catch(() => {});
    });

    test('opens step 1 once, with five choices and the coding agent first', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P1'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId });
        await ob.expectStepOne();

        expect(await ob.choiceIds()).toEqual(OnboardingPage.CHOICE_IDS);
        expect((await ob.otherIds())[0]).toBe('agent');
        expect(await ob.firstLoginFlag()).toBeNull();
        expect(ob.attributionBodies).toEqual([]);

        // The flag is gone, so a reload of Home does not send the user back.
        await page.goto(homeUrl(orgId));
        await expect(ob.view).toHaveCount(0);
        testLogger.info('Step 1 opened once on first login');
    });

    test('previews the choice a signup link prefilled', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P2'],
    }, async () => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId, prefill: { utm_content: 'rum' } });
        await ob.expectStepOne();
        await expect(ob.previewTitle).toHaveText('Frontend and mobile apps');
    });

    test('the Linux tile opens its guide inside onboarding and records linux once', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P1'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId });
        await ob.expectStepOne();
        await ob.choice('infrastructure').click();
        await ob.row('linux-windows-or-macos-host').click();
        await ob.tile('linux').click();

        await page.waitForURL(/\/onboarding\/infrastructure\/linux-windows-or-macos-host\/linux/, { timeout: 20000 });
        await expect(ob.guide).toBeVisible();
        await ob.expectGuideStatus('waiting');
        await expect.poll(() => ob.attributionBodies.length).toBe(1);
        expect(ob.attributionBodies[0]).toEqual({ from: '', company: '', first_source: 'linux', skipped: false });
        expect(await ob.storedPick(orgId)).toBe('linux');
    });

    test('a row and a tile open a guide inside onboarding', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P2'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId });
        await ob.expectStepOne();
        await ob.choice('backend').click();
        await expect(ob.rows).toBeVisible();
        await ob.row('add-a-library-to-your-code').click();
        await expect(ob.which).toBeVisible();
        await ob.tile('java').click();

        await page.waitForURL(/\/onboarding\/backend\/add-a-library-to-your-code\/java/, { timeout: 20000 });
        await expect(ob.guide).toBeVisible();
        await expect(page.locator('[data-test="onboarding-step-guide-language-docs"]')).toHaveAttribute(
            'href',
            'https://opentelemetry.io/docs/languages/java/getting-started/',
        );
    });

    test('the coding agent card opens the agent page with the listen bar', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P2'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId });
        await ob.expectStepOne();
        await ob.other('agent').click();

        await page.waitForURL(/\/onboarding\/agent/, { timeout: 20000 });
        await expect(ob.agentSetup).toBeVisible();
        await expect(ob.listenBar).toBeVisible();
        await expect.poll(() => ob.attributionBodies.length).toBe(1);
        expect(ob.attributionBodies[0]).toMatchObject({ skipped: false });
    });

    test('Skip to app records a skip and lands on Home', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P1'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(homeUrl(orgId), { orgId });
        await ob.expectStepOne();
        await ob.skipBtn.click();

        await expect(ob.view).toHaveCount(0, { timeout: 20000 });
        expect(new URL(page.url()).pathname).toMatch(/\/web\/?$/);
        await expect.poll(() => ob.attributionBodies.length).toBe(1);
        expect(ob.attributionBodies[0]).toMatchObject({ skipped: true });
    });

    test('a followed redirect wins over onboarding, and the flag waits for a later visit', {
        tag: ['@onboarding', '@get-started', '@cloud', '@P2'],
    }, async ({ page }) => {
        await ob.openAsFirstLogin(`${baseUrl()}/web/logs?org_identifier=${orgId}`, { orgId });
        await page.waitForLoadState('domcontentloaded');
        await expect(ob.view).toHaveCount(0);
        expect(new URL(page.url()).pathname).toMatch(/\/web\/logs/);
        expect(await ob.firstLoginFlag()).toBe('true');
    });
});
