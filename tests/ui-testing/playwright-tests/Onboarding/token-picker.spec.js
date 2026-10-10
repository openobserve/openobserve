const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

test.describe('Code block token link opens the header token picker', () => {
    test.describe.configure({ mode: 'serial' });
    const tokenName = `e2e_tp_${Date.now()}`;
    let tokenValue = '';

    test.beforeAll(async ({ request }) => {
        const orgId = getOrgIdentifier();
        const res = await request.post(`${baseUrl()}/api/${orgId}/ingestion-tokens`, {
            headers: getAuthHeaders(),
            data: { name: tokenName, description: 'token picker e2e' },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        tokenValue = body?.data?.token ?? '';
        expect(tokenValue).not.toBe('');
    });

    test.afterAll(async ({ request }) => {
        const orgId = getOrgIdentifier();
        await request.patch(`${baseUrl()}/api/${orgId}/ingestion-tokens/${encodeURIComponent(tokenName)}`, {
            headers: getAuthHeaders(),
            data: { enabled: false },
        }).catch(() => {});
    });

    test('switching the token updates name, mask and copied token without reload', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const orgId = getOrgIdentifier();
        await navigateToBase(page);
        const pm = new PageManager(page);
        await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/curl', orgId);
        await pm.ingestionConfigPage.expectCodeBlockVisible('curl');

        const before = await pm.ingestionConfigPage.getTokenLinkText('curl');
        expect(before).toMatch(/^org token · /);
        const maskedBefore = await pm.ingestionConfigPage.getCodeBlockText('curl');

        let navigations = 0;
        page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });

        await pm.ingestionConfigPage.clickTokenLink('curl');
        await pm.ingestionConfigPage.expectTokenPickerOpen();
        await pm.ingestionConfigPage.chooseToken(tokenName);

        await expect.poll(() => pm.ingestionConfigPage.getTokenLinkText('curl')).toBe(`org token · ${tokenName}`);
        const maskedAfter = await pm.ingestionConfigPage.getCodeBlockText('curl');
        expect(maskedAfter).not.toBe(maskedBefore);
        expect(maskedAfter).toContain(tokenValue.slice(0, 4));
        expect(maskedAfter).not.toContain(tokenValue);

        await pm.ingestionConfigPage.clickCodeBlock('curl');
        await pm.ingestionConfigPage.expectToastText(`Copied with org token ${tokenName}`);
        expect(await pm.ingestionConfigPage.readClipboard()).toContain(tokenValue);
        expect(navigations).toBe(0);

        testLogger.info('Token picker verified');
    });
});
