const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

// Legacy guides render CredentialCodeBlock (OCodeBlock, code-masked) instead of CopyContent.
const LEGACY_PAGES = [
    { path: '/ingestion/custom/logs/curl', slug: 'curl' },
    { path: '/ingestion/custom/logs/fluentbit', slug: 'fluentbit' },
    { path: '/ingestion/custom/metrics/prometheus', slug: 'prometheus' },
    { path: '/ingestion/servers/nginx', slug: 'nginx-config' },
    { path: '/ingestion/languages/python', slug: 'python' },
];

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const basicForm = (secret) => Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${secret}`).toString('base64');

// Every credential the page could substitute: the org passcode and each enabled ingestion token.
async function orgSecrets(request, orgId) {
    const headers = getAuthHeaders();
    const secrets = [];
    const tokens = await request.get(`${baseUrl()}/api/${orgId}/ingestion-tokens`, { headers });
    if (tokens.ok()) {
        const body = await tokens.json();
        const list = Array.isArray(body) ? body : body.data ?? [];
        for (const t of list) if (t.enabled && t.token) secrets.push(t.token);
    }
    const passcode = await request.get(`${baseUrl()}/api/${orgId}/passcode`, { headers });
    if (passcode.ok()) {
        const body = await passcode.json();
        const value = body?.data?.passcode;
        if (value) secrets.push(value);
    }
    return secrets;
}

test.describe('Legacy ingestion guides use the masked code block', () => {
    test.describe.configure({ mode: 'serial' });

    for (const { path, slug } of LEGACY_PAGES) {
        test(`${slug}: masked in the DOM, real token on click`, {
            tag: ['@onboarding', '@ingestion', '@all', '@P1'],
        }, async ({ page, request }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            const orgId = getOrgIdentifier();
            const secrets = await orgSecrets(request, orgId);
            expect(secrets.length).toBeGreaterThan(0);

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.ingestionConfigPage.navigateToIntegration(path, orgId);
            await pm.ingestionConfigPage.expectCodeBlockVisible(slug);

            const block = pm.ingestionConfigPage.codeBlock(slug);
            await expect(block.copyBtn).toBeVisible();
            await expect(block.revealBtn).toBeVisible();

            const shown = await pm.ingestionConfigPage.getCodeBlockText(slug);
            expect(shown).toContain('•');
            const html = await page.content();
            for (const secret of secrets) {
                expect(html).not.toContain(secret);
                expect(html).not.toContain(basicForm(secret));
            }

            await pm.ingestionConfigPage.clickCodeBlock(slug);
            await pm.ingestionConfigPage.expectToastText('Copied');
            const copied = await pm.ingestionConfigPage.readClipboard();
            expect(copied).not.toContain('•');
            expect(secrets.some((s) => copied.includes(s) || copied.includes(basicForm(s)))).toBe(true);

            testLogger.info('Legacy page verified', { slug });
        });
    }
});
