const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { GetStartedPage } = require('../../pages/generalPages/getStartedPage.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const homeUrl = (orgId) => `${baseUrl()}/web/?org_identifier=${orgId}`;

async function orgPasscode(request, orgId) {
    const res = await request.get(`${baseUrl()}/api/${orgId}/passcode`, { headers: getAuthHeaders() });
    if (!res.ok()) return '';
    const body = await res.json();
    return body?.data?.passcode ?? '';
}

test.describe('Get started dialog', () => {
    test.describe.configure({ mode: 'serial' });
    let gs;
    let orgId;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        orgId = getOrgIdentifier();
        await navigateToBase(page);
        gs = new GetStartedPage(page);
        await gs.captureAttribution({ passThrough: isCloudEnvironment() });
    });

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')).catch(() => {});
    });

    test('is persistent, names the trial and offers the 11 sources in order with logos', {
        tag: ['@onboarding', '@get-started', '@all', '@P1'],
    }, async ({ page }) => {
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId });

        await expect(gs.title).toHaveText('Welcome to OpenObserve');
        await expect(gs.subtitle).toContainText('Your 14-day trial has started');
        expect(await gs.sourceIds()).toEqual(GetStartedPage.SOURCE_IDS);
        await expect(gs.grid.locator('img')).toHaveCount(7);
        await expect(gs.grid).toContainText('Logs over HTTP');
        await expect(gs.grid).toContainText('Not sure yet');

        await page.keyboard.press('Escape');
        await expect(gs.title).toBeVisible();
        await page.mouse.click(8, 8);
        await expect(gs.title).toBeVisible();
        await page.reload();
        await expect(gs.title).toBeVisible({ timeout: 20000 });
        testLogger.info('Dialog stays open across Escape, backdrop and reload');
    });

    test('reaches a copied command in three interactions from a prefilled pick, popup suppressed', {
        tag: ['@onboarding', '@get-started', '@all', '@P1'],
    }, async ({ page, request }) => {
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId, prefill: { utm_content: 'http' } });
        await gs.expectPicked('http');
        await expect(gs.continueBtn).toBeDisabled();
        await expect(gs.skipBtn).toBeDisabled();

        let interactions = 0;
        await gs.agree.click(); interactions += 1;
        await gs.skipBtn.click(); interactions += 1;

        await page.waitForURL(/\/ingestion\/custom\/logs\/curl/, { timeout: 20000 });
        await expect(gs.title).toHaveCount(0);
        expect(gs.attributionBodies).toEqual([
            { from: '', company: '', first_source: 'http', skipped: true },
        ]);
        expect(await gs.storedPick(orgId)).toBe('http');
        expect(await gs.firstLoginFlag()).toBeNull();

        await page.locator('[data-test="ingestion-curl-code-block-pre"]').click(); interactions += 1;
        expect(interactions).toBeLessThanOrEqual(3);
        const copied = await gs.readClipboard();
        expect(copied).toContain(`/api/${orgId}/`);
        expect(copied).not.toContain('•');
        const passcode = await orgPasscode(request, orgId);
        if (passcode) expect(copied).toContain(passcode);
        await expect(gs.connectPopup).toHaveCount(0);
        testLogger.info('Copied command after three interactions', { interactions });
    });

    test('Continue sends the answers and pins a recommended pick above the rail', {
        tag: ['@onboarding', '@get-started', '@all', '@P1'],
    }, async ({ page }) => {
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId });
        await gs.hearAboutUs.fill('A colleague');
        await gs.whereDoYouWork.fill('Acme');
        await gs.source('kubernetes').click();
        await gs.agree.click();
        await gs.continueBtn.click();

        await page.waitForURL(/\/ingestion\/recommended\/kubernetes/, { timeout: 20000 });
        expect(gs.attributionBodies).toEqual([
            { from: 'A colleague', company: 'Acme', first_source: 'kubernetes', skipped: false },
        ]);
        await expect(gs.pickGroup).toHaveText('Your pick');
        await expect(page.locator('[data-test="ingestion-recommended-pick-tab-ingestFromKubernetes"]')).toBeVisible();
        await expect(page.locator('[data-test="ingestion-recommended-tab-ingestFromKubernetes"]')).toHaveCount(0);
    });

    test('Let an AI agent set it up lands on the MCP card', {
        tag: ['@onboarding', '@get-started', '@all', '@P2'],
    }, async ({ page }) => {
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId });
        await gs.source('agent').click();
        await gs.agree.click();
        await gs.skipBtn.click();
        await page.waitForURL(/\/ingestion\/recommended\/mcp/, { timeout: 20000 });
    });

    test('Not sure yet keeps today\'s landing', {
        tag: ['@onboarding', '@get-started', '@all', '@P2'],
    }, async ({ page }) => {
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId });
        await gs.source('unsure').click();
        await gs.agree.click();
        await gs.skipBtn.click();
        await expect(gs.title).toHaveCount(0);
        expect(new URL(page.url()).pathname).toMatch(/\/web\/?$/);
        expect(await gs.storedPick(orgId)).toBe('unsure');
    });

    test('a followed redirect wins over the pick', {
        tag: ['@onboarding', '@get-started', '@all', '@P2'],
    }, async ({ page }) => {
        await gs.openAsFirstLogin(`${baseUrl()}/web/logs?org_identifier=${orgId}`, { orgId });
        await gs.source('kubernetes').click();
        await gs.agree.click();
        await gs.skipBtn.click();
        await expect(gs.title).toHaveCount(0);
        expect(new URL(page.url()).pathname).toMatch(/\/web\/logs/);
    });

    test('a failed attribution keeps every answer and Continue retries', {
        tag: ['@onboarding', '@get-started', '@all', '@P2'],
    }, async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        let calls = 0;
        await page.route(/\/api\/[^/]+\/billings\/new_user_attribution$/, (route) => {
            calls += 1;
            return calls === 1
                ? route.fulfill({ status: 500, json: { code: 500, message: 'boom' } })
                : route.fulfill({ status: 200, json: { code: 200, message: 'Success' } });
        });
        await gs.openAsFirstLogin(homeUrl(orgId), { orgId });
        await gs.hearAboutUs.fill('Hacker News');
        await gs.whereDoYouWork.fill('Acme');
        await gs.source('webserver').click();
        await gs.agree.click();
        await gs.continueBtn.click();

        await expect(page.getByText('Something went wrong').first()).toBeVisible();
        await expect(gs.title).toBeVisible();
        await expect(gs.hearAboutUs).toHaveValue('Hacker News');
        await gs.expectPicked('webserver');

        await gs.continueBtn.click();
        await page.waitForURL(/\/ingestion\/servers\/nginx/, { timeout: 20000 });
        expect(calls).toBe(2);
    });
});
