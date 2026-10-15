const { execFileSync } = require('child_process');
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { GetStartedPage } = require('../../pages/generalPages/getStartedPage.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');

const apiBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const uiBase = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const CLICK_LOG = 'e2e.journey.clicks';
const FORBIDDEN_CLICK = /(reveal-btn|troubleshoot-btn|test-btn|recheck)/;

async function orgPasscode(request, orgId) {
    const res = await request.get(`${apiBase()}/api/${orgId}/passcode`, { headers: getAuthHeaders() });
    if (!res.ok()) return '';
    const body = await res.json();
    return body?.data?.passcode ?? '';
}

// Every trusted pointer press and Enter key, logged by the page itself so the count does not trust the test's own tally.
async function recordInteractions(page) {
    await page.addInitScript((key) => {
        const log = (kind, target) => {
            const path = [];
            for (let el = target; el && el.getAttribute; el = el.parentElement) {
                const id = el.getAttribute('data-test');
                if (id) path.push(id);
            }
            const entries = JSON.parse(sessionStorage.getItem(key) || '[]');
            entries.push({ kind, path });
            sessionStorage.setItem(key, JSON.stringify(entries));
        };
        window.addEventListener('pointerdown', (e) => { if (e.isTrusted) log('pointer', e.target); }, true);
        window.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Enter') log('enter', e.target); }, true);
    }, CLICK_LOG);
}

// Get started to the first record in Logs takes at most six interactions, never a Reveal, Test, Recheck or Troubleshoot click.
test.describe('First data journey', () => {
    test('Terms, Skip, one block click, the command run outside, Open in Logs', {
        tag: ['@onboarding', '@journey', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        // Cloud runs in the signup org; OSS root's passcode only ingests into the default org, so OSS cannot use a fresh org.
        const orgId = getOrgIdentifier();
        const gs = new GetStartedPage(page);
        const fe = new FirstEventPage(page);
        await gs.captureAttribution({ passThrough: isCloudEnvironment() });
        await recordInteractions(page);
        await gs.openAsFirstLogin(`${uiBase()}/web/?org_identifier=${orgId}`, { orgId, prefill: { utm_content: 'http' } });
        await page.evaluate((key) => sessionStorage.removeItem(key), CLICK_LOG);
        await gs.expectPicked('http');

        let interactions = 0;
        await gs.agree.click(); interactions += 1;
        await gs.skipBtn.click(); interactions += 1;
        await page.waitForURL(/\/ingestion\/custom\/logs\/curl/, { timeout: 20000 });
        await fe.expectState('waiting', 20000);

        await page.locator('[data-test="ingestion-curl-code-block-pre"]').click(); interactions += 1;
        const copied = await gs.readClipboard();
        expect(copied).toMatch(/^curl -u /);
        expect(copied).not.toContain('•');
        expect(copied).not.toContain('[PASSCODE]');
        const passcode = await orgPasscode(request, orgId);
        if (passcode) expect(copied).toContain(passcode);

        const sentUs = Date.now() * 1000;
        const marker = `journey-${Date.now()}`;
        const command = copied.replace('test message for openobserve', marker);
        const out = execFileSync('/bin/sh', ['-c', `${command} -s -o /dev/null -w "%{http_code}"`], { encoding: 'utf8' });
        expect(out.trim()).toBe('200');

        await fe.expectState('received', 20000);
        await expect(fe.firstRecord).toContainText(marker);
        await fe.clickOpen(); interactions += 1;
        await expect(page).toHaveURL(/\/logs\?/);
        expect(new URL(page.url()).searchParams.get('stream')).toBe('default');
        await fe.expectLogsRows(1);
        // Quick mode may project only the stream's interesting fields, so the row is matched by its timestamp, not the message.
        const first = Number(new URL(page.url()).searchParams.get('from'));
        const last = Number(new URL(page.url()).searchParams.get('to'));
        expect(first).toBeLessThanOrEqual(sentUs);
        expect(last).toBeGreaterThanOrEqual(sentUs);

        const logged = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || '[]'), CLICK_LOG);
        expect(logged.filter((e) => e.path.some((id) => FORBIDDEN_CLICK.test(id)))).toEqual([]);
        expect(logged).toHaveLength(interactions);
        expect(interactions).toBe(4);
        expect(interactions).toBeLessThanOrEqual(6);
        testLogger.info('Journey reached the first record', { interactions, logged: logged.map((e) => e.path[0]) });
    });
});
