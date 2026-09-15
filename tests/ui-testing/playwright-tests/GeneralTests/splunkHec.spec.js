const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment, getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /services/collector with a Splunk HEC GUID. A cold node can answer
// 503 "Server is busy" (code 9) while its token cache warms — that is a
// retryable condition, not a token failure, so retry a few times.
async function postCollector(page, base, guid, payload) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const resp = await page.request.post(`${base}/services/collector`, {
            headers: { Authorization: `Splunk ${guid}`, 'Content-Type': 'application/json' },
            data: payload,
        });
        if (resp.status() !== 503) {
            return resp;
        }
        const body = await resp.json().catch(() => ({}));
        if (body.code !== 9) {
            return resp;
        }
        testLogger.info(`Collector busy (code 9), retry ${attempt}/5`);
        await page.waitForTimeout(1000);
    }
    throw new Error('Collector stayed busy (503/code 9) after 5 attempts');
}

test.describe("Splunk HEC Ingestion", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    // -------------------------------------------------------------------
    // Documentation page
    // -------------------------------------------------------------------

    test("Splunk HEC documentation page renders all sections and banners", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@ingestion', '@P0', '@all'],
    }, async ({ page }) => {
        const orgId = getOrgIdentifier();
        testLogger.info('Navigating to Splunk HEC documentation page');

        await pm.splunkHecPage.gotoSplunkHec(orgId);
        await pm.splunkHecPage.verifyDocumentationRendered();

        // Endpoint copy block is root-mounted and org-free: no /api/ and no org segment.
        const endpointText = await pm.splunkHecPage.getSectionCopyText(pm.splunkHecPage.endpointSection);
        expect(endpointText).toContain('/services/collector');
        expect(endpointText).not.toContain('/api/');
        expect(endpointText).not.toContain(orgId);

        // Example copy block documents the Splunk auth header placeholder.
        const exampleText = await pm.splunkHecPage.getSectionCopyText(pm.splunkHecPage.exampleSection);
        expect(exampleText).toContain('Authorization: Splunk [SPLUNK_HEC_TOKEN]');

        testLogger.info('Test completed successfully');
    });

    test("Splunk HEC page links to the org-scoped Ingestion Tokens page", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@ingestion', '@navigation', '@P0', '@all'],
    }, async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Ingestion tokens page not available on cloud UI');
        const orgId = getOrgIdentifier();

        await pm.splunkHecPage.gotoSplunkHec(orgId);
        await pm.splunkHecPage.clickTokensLink();

        await expect(page).toHaveURL(/ingestionTokens/);
        await pm.ingestionTokensPage.verifyTitleVisible();

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // End-to-end API contract
    // -------------------------------------------------------------------

    test("End-to-end HEC ingestion via collector returns code 0 and health returns code 17", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@api', '@P0', '@all'],
    }, async ({ page }) => {
        const orgId = getOrgIdentifier();
        const base = process.env.ZO_BASE_URL;
        const tokenName = `splunk_api_${Date.now()}`;

        // Mint a token + Splunk GUID via the management API.
        const createResp = await page.request.post(`${base}/api/${orgId}/ingestion-tokens`, {
            headers: getAuthHeaders(),
            data: { name: tokenName, description: 'splunk e2e', splunk_token: true },
        });
        expect(createResp.status()).toBe(200);
        const createBody = await createResp.json();
        const guid = createBody.data.splunk_token;
        expect(guid).toMatch(GUID_RE);

        // Collector POST is root-mounted (no /api/, no org segment) and uses the Splunk scheme.
        const postResp = await postCollector(page, base, guid, {
            event: { level: 'info', log: `splunk e2e ${tokenName}` },
            index: 'default',
            time: Math.floor(Date.now() / 1000),
        });
        expect(postResp.status()).toBe(200);
        const postBody = await postResp.json();
        expect(postBody.text).toBe('Success');
        expect(postBody.code).toBe(0);

        // Unauthenticated health check.
        const healthResp = await page.request.get(`${base}/services/collector/health`);
        expect(healthResp.status()).toBe(200);
        const healthBody = await healthResp.json();
        expect(healthBody.text).toBe('HEC is healthy');
        expect(healthBody.code).toBe(17);

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Token lifecycle — UI (cloud-skipped)
    // -------------------------------------------------------------------

    test("Create token with Splunk HEC token via UI reveals GUID and HEC URL", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@ingestion', '@create', '@P1', '@all'],
    }, async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Ingestion tokens page not available on cloud UI');
        const uniqueName = `splunk_ui_${Date.now()}`;

        await pm.ingestionTokensPage.gotoIamPage();
        await pm.ingestionTokensPage.gotoIngestionTokensTab();
        await pm.ingestionTokensPage.clickCreateToken();
        await pm.ingestionTokensPage.fillTokenName(uniqueName);
        await pm.ingestionTokensPage.checkSplunkCheckbox();
        await pm.ingestionTokensPage.clickCreate();

        await pm.ingestionTokensPage.verifySuccessMessage('Token created successfully.');

        // Revealed dialog shows the lowercase GUID and the HEC URL block.
        const guid = await pm.ingestionTokensPage.getRevealedSplunkGuid();
        expect(guid.trim()).toMatch(GUID_RE);

        const hecUrl = await pm.ingestionTokensPage.getRevealedHecUrl();
        expect(hecUrl).toContain('/services/collector');

        await pm.ingestionTokensPage.closeRevealedDialog();

        // The token's Splunk cell is no longer "Not enabled" — it shows the GUID.
        const cellText = await pm.ingestionTokensPage.getSplunkCellText(uniqueName);
        expect(cellText.trim()).toMatch(GUID_RE);

        testLogger.info('Test completed successfully');
    });

    test("Generate a Splunk GUID for an existing token via the per-row action", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@ingestion', '@generate', '@P1', '@all'],
    }, async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Ingestion tokens page not available on cloud UI');
        const uniqueName = `splunk_gen_${Date.now()}`;

        // Create a token WITHOUT the Splunk checkbox.
        await pm.ingestionTokensPage.gotoIamPage();
        await pm.ingestionTokensPage.gotoIngestionTokensTab();
        await pm.ingestionTokensPage.clickCreateToken();
        await pm.ingestionTokensPage.fillTokenName(uniqueName);
        await pm.ingestionTokensPage.clickCreate();
        await pm.ingestionTokensPage.verifySuccessMessage('Token created successfully.');
        await pm.ingestionTokensPage.closeRevealedDialog();

        // Splunk cell starts empty ("Not enabled").
        const before = await pm.ingestionTokensPage.getSplunkCellText(uniqueName);
        expect(before).toContain('Not enabled');

        // Generate via the per-row link action.
        await pm.ingestionTokensPage.clickSplunkAction(uniqueName);
        await pm.ingestionTokensPage.verifySuccessMessage('Splunk HEC token generated.');

        // Splunk cell now shows a lowercase GUID.
        const after = await pm.ingestionTokensPage.getSplunkCellText(uniqueName);
        expect(after.trim()).toMatch(GUID_RE);

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Token lifecycle — API
    // -------------------------------------------------------------------

    test("Revoking a Splunk GUID makes the collector reject it with 403", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@api', '@revoke', '@P1', '@all'],
    }, async ({ page }) => {
        const orgId = getOrgIdentifier();
        const base = process.env.ZO_BASE_URL;
        const tokenName = `splunk_revoke_${Date.now()}`;

        const createResp = await page.request.post(`${base}/api/${orgId}/ingestion-tokens`, {
            headers: getAuthHeaders(),
            data: { name: tokenName, description: 'splunk e2e', splunk_token: true },
        });
        expect(createResp.status()).toBe(200);
        const guid = (await createResp.json()).data.splunk_token;

        // Warm the path: a first POST succeeds.
        const warmResp = await postCollector(page, base, guid, {
            event: { level: 'info', log: `splunk e2e ${tokenName}` },
            index: 'default',
            time: Math.floor(Date.now() / 1000),
        });
        expect(warmResp.status()).toBe(200);

        // Revoke the GUID.
        const revokeResp = await page.request.patch(`${base}/api/${orgId}/ingestion-tokens/${tokenName}`, {
            headers: getAuthHeaders(),
            data: { splunk_token: 'revoke' },
        });
        expect(revokeResp.status()).toBe(200);

        // Collector now rejects the revoked GUID (disabled/invalid token are both 403).
        const postResp = await postCollector(page, base, guid, {
            event: { level: 'info', log: `splunk e2e ${tokenName}` },
            index: 'default',
            time: Math.floor(Date.now() / 1000),
        });
        expect(postResp.status()).toBe(403);
        const postBody = await postResp.json();
        expect([1, 4]).toContain(postBody.code);

        testLogger.info('Test completed successfully');
    });

    test("Disabled backing token rejects the collector with 403 code 1", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@api', '@P2', '@all'],
    }, async ({ page }) => {
        const orgId = getOrgIdentifier();
        const base = process.env.ZO_BASE_URL;
        const tokenName = `splunk_disabled_${Date.now()}`;

        const createResp = await page.request.post(`${base}/api/${orgId}/ingestion-tokens`, {
            headers: getAuthHeaders(),
            data: { name: tokenName, description: 'splunk e2e', splunk_token: true },
        });
        expect(createResp.status()).toBe(200);
        const guid = (await createResp.json()).data.splunk_token;

        // Disable the backing token.
        const disableResp = await page.request.patch(`${base}/api/${orgId}/ingestion-tokens/${tokenName}`, {
            headers: getAuthHeaders(),
            data: { enabled: false },
        });
        expect(disableResp.status()).toBe(200);

        // Collector rejects with 403 code 1 ("Token disabled").
        const postResp = await postCollector(page, base, guid, {
            event: { level: 'info', log: `splunk e2e ${tokenName}` },
            index: 'default',
            time: Math.floor(Date.now() / 1000),
        });
        expect(postResp.status()).toBe(403);
        const postBody = await postResp.json();
        expect(postBody.code).toBe(1);

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Copy snippets
    // -------------------------------------------------------------------

    test("Copy snippets write to clipboard and show a toast", {
        tag: ['@splunk-hec-ingestion', '@splunk', '@copy', '@P2', '@all'],
    }, async ({ page }) => {
        const orgId = getOrgIdentifier();

        await pm.splunkHecPage.gotoSplunkHec(orgId);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        // Copy the example curl snippet (scoped to the example section).
        await pm.splunkHecPage.clickSectionCopyButton(pm.splunkHecPage.exampleSection);

        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboard).toContain('services/collector');
        expect(clipboard).toContain('Authorization: Splunk [SPLUNK_HEC_TOKEN]');

        await pm.splunkHecPage.expectCopyToast();

        testLogger.info('Test completed successfully');
    });
});
