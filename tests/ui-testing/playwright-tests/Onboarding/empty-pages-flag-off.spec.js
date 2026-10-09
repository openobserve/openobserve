const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { EmptyPagesPage } = require('../../pages/generalPages/emptyPagesPage.js');
const { authedRequest } = require('../utils/cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

test.describe('Pages before data with the flag off', () => {
    test('mounts no panel and sends no first-event probe on an empty org', {
        tag: ['@onboarding', '@all', '@P2'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const created = await authedRequest(page, 'post', `${base()}/api/organizations`, {
            data: { name: `e2e_flag_off_${Date.now()}` },
        });
        expect(created.ok()).toBeTruthy();
        const body = await created.json();
        const orgId = body.identifier || (body.data && body.data.identifier);
        const ep = new EmptyPagesPage(page);
        try {
            test.skip(await ep.restrictedRoutesOn(orgId), 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA off');
            await ep.setPick(orgId, 'kubernetes');
            // The next-visit notice probes each type once per page load with the flag off; a watcher would repeat on its 5 s cadence.
            let loads = 0;
            page.on('load', () => { loads += 1; });
            const probes = [];
            page.on('request', (req) => {
                const url = new URL(req.url());
                if (url.pathname === `/api/${orgId}/streams` && url.searchParams.get('limit') === '1') {
                    probes.push(`${loads}:${url.searchParams.get('type')}`);
                }
            });

            await ep.open('logs', orgId);
            await expect(ep.logsNoData).toBeVisible({ timeout: 20000 });
            await page.waitForTimeout(12000);
            await ep.open('dashboards', orgId);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await ep.open('', orgId);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            await expect(ep.panel).toHaveCount(0);
            await expect(ep.status).toHaveCount(0);
            expect(probes.filter((p, i) => probes.indexOf(p) !== i)).toEqual([]);
        } finally {
            await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
        }
    });
});
