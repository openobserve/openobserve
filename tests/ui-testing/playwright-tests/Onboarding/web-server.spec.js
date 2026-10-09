const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

async function orgPasscode(request, orgId) {
    const res = await request.get(`${baseUrl()}/api/${orgId}/passcode`, { headers: getAuthHeaders() });
    if (!res.ok()) return '';
    const body = await res.json();
    return body?.data?.passcode ?? '';
}

const SERVERS = [
    { server: 'nginx', label: 'nginx', install: true },
    { server: 'apache', label: 'Apache', install: true },
    { server: 'iis', label: 'IIS', install: false },
];

test.describe('Web server guides', () => {
    test.describe.configure({ mode: 'serial' });

    for (const { server, label, install } of SERVERS) {
        test(`${label} shows the Fluent Bit config with the bar waiting on the ${server} stream`, {
            tag: ['@onboarding', '@ingestion', '@all', '@P1'],
        }, async ({ page, request }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            const orgId = getOrgIdentifier();
            await navigateToBase(page);
            await page.goto(`${baseUrl()}/web/ingestion/servers/${server}?org_identifier=${orgId}`);

            const pre = page.locator(`[data-test="ingestion-${server}-config-code-block-pre"]`);
            await expect(pre).toBeVisible({ timeout: 20000 });
            const shown = (await pre.textContent()) ?? '';
            expect(shown).toContain('[INPUT]');
            expect(shown).toContain('Name              tail');
            expect(shown).toContain(`URI               /api/${orgId}/${server}/_json`);
            expect(shown).toContain('HTTP_Passwd');
            expect(shown).toContain('•');
            expect(shown).not.toContain('Access Key');
            await expect(page.locator(`[data-test="ingestion-${server}-config-code-block-token-link"]`)).toContainText('org token');
            await expect(page.locator(`[data-test="ingestion-${server}-install-code-block"]`)).toHaveCount(install ? 1 : 0);

            const bar = page.locator('[data-test="first-event-status"]');
            await expect(bar).toHaveCount(1);
            await expect(bar).toHaveAttribute('data-state', 'waiting');
            // a stream left by an earlier run turns the wording to new data since the watch start
            await expect(bar).toContainText(new RegExp(`Waiting for (logs|new data) in ${server}`));
            await expect(page.locator('[data-test="first-event-status-troubleshoot-btn"]')).toBeVisible();

            await pre.click();
            const copied = await page.evaluate(() => navigator.clipboard.readText());
            expect(copied).not.toContain('•');
            expect(copied).toContain(`URI               /api/${orgId}/${server}/_json`);
            const passcode = await orgPasscode(request, orgId);
            if (passcode) expect(copied).toContain(`HTTP_Passwd       ${passcode}`);
            testLogger.info('Web server guide verified', { server });
        });
    }

    test('the nginx bar turns green when a record reaches the nginx stream', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const orgId = getOrgIdentifier();
        await navigateToBase(page);
        await page.goto(`${baseUrl()}/web/ingestion/servers/nginx?org_identifier=${orgId}`);
        const bar = page.locator('[data-test="first-event-status"]');
        await expect(bar).toHaveAttribute('data-state', 'waiting', { timeout: 20000 });

        const res = await request.post(`${ingestionBase()}/api/${orgId}/nginx/_json`, {
            headers: getAuthHeaders(),
            data: [{ log: `GET /health 200 e2e-${Date.now()}` }],
        });
        expect(res.ok()).toBeTruthy();
        await expect(bar).toHaveAttribute('data-state', 'received', { timeout: 15000 });
    });
});
