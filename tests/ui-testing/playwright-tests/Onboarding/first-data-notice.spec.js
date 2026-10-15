const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');
const { getAuthHeaders, authedRequest } = require('../utils/cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

test.describe('Next-visit first data banner', () => {
    test('shows once after a visit with no data, opens Logs, and never returns after Dismiss', {
        tag: ['@onboarding', '@all', '@P2'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `e2e_notice_${Date.now()}`;
        const created = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name } });
        expect(created.ok()).toBeTruthy();
        const body = await created.json();
        const orgId = body.identifier || (body.data && body.data.identifier);
        try {
            await navigateToBase(page);
            const fe = new FirstEventPage(page);
            await fe.openHome(orgId);
            await expect.poll(() =>
                page.evaluate((o) => localStorage.getItem(`o2.onboarding.firstData.${o}`), orgId),
            ).not.toBeNull();
            await expect(fe.notice).toHaveCount(0);

            const res = await request.post(`${ingestionBase()}/api/${orgId}/e2e_notice/_json`, {
                headers: getAuthHeaders(),
                data: [{ level: 'info', log: 'arrived while away' }],
            });
            expect(res.ok()).toBeTruthy();

            await fe.openHome(orgId);
            await expect(fe.notice).toBeVisible({ timeout: 20000 });
            await expect(fe.noticeText).toContainText('e2e_notice');
            await fe.noticeDismissBtn.click();
            await expect(fe.notice).toHaveCount(0);

            await fe.openHome(orgId);
            await page.waitForTimeout(3000);
            await expect(fe.notice).toHaveCount(0);
        } finally {
            await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
        }
    });
});
