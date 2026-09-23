const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment, getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

// The forbidden banner is driven by GET /api/{org}/passcode returning 403. That
// 403 is only reachable in OSS via a ServiceAccount principal (API layer) — every
// OSS UI user is force-set to Admin/Root, so the banner itself is enterprise-only
// (see docs/test_generator/ci/setup-contract.md). Cloud orgs are OIDC-managed and
// hide the surface entirely, so the whole spec is self-hosted only.
test.describe("Org Ingestion Token (Passcode) Access Control", () => {
    test.skip(isCloudEnvironment(), 'Org passcode access control is self-hosted only (cloud hides the surface and OIDC-manages the org)');
    let pm;

    // Matches the apiCleanup.cleanupServiceAccounts() pattern (^sa\d+x\d+), so
    // accounts created here are swept by the pre-test cleanup on the next run.
    const uniqueSaName = () => `sa${Date.now()}x${Math.floor(Math.random() * 10000)}`;

    test("Admin/Root sees the real Kubernetes setup card with no forbidden banner", {
        tag: ['@ingestion-passcode-forbidden', '@all', '@P0'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.ingestionConfigPage.navigateToIngestion(getOrgIdentifier());
        await pm.ingestionConfigPage.expectDataSourceSetupCardVisible();
        await pm.ingestionConfigPage.expectDataSourceSetupCardForbiddenHidden();

        testLogger.info('Test completed');
    });

    test("ServiceAccount GET /passcode returns 403 (API boundary)", {
        tag: ['@ingestion-passcode-forbidden', '@all', '@api', '@P0'],
    }, async ({ page, request }, testInfo) => {
        const uniqueName = uniqueSaName();
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.iamPage.gotoIamPage();
        await pm.iamPage.iamPageServiceAccountsTab();
        await pm.iamPage.iamPageAddServiceAccount();
        await pm.iamPage.enterNameServiceAccount(uniqueName);
        await pm.iamPage.clickSaveServiceAccount();
        await pm.iamPage.verifySuccessMessage('Service account created successfully.');

        const token = await pm.iamPage.captureServiceAccountToken();
        expect(token).toBeTruthy();

        // Service accounts are keyed by the synthesized <name>.<org>@sa.internal
        // identifier, and are not Admin/Root — so require_credential_access must
        // deny the org passcode read. Use the isolated `request` fixture (not
        // `page.request`), which would inherit the logged-in session's auth_tokens
        // cookie and authenticate as the root user (200) — masking the SA's 403.
        const org = getOrgIdentifier();
        const saIdentifier = pm.iamPage.serviceAccountEmailFor(uniqueName);
        const basic = Buffer.from(`${saIdentifier}:${token}`).toString('base64');
        const response = await request.get(`${process.env.ZO_BASE_URL}/api/${org}/passcode`, {
            headers: { 'Authorization': `Basic ${basic}` },
        });

        expect(response.status()).toBe(403);

        testLogger.info('Test completed');
    });

    // Parked gap report: OSS cannot create a non-admin/root UI session (save/update
    // force base_role=Admin under #[cfg(not(feature = "enterprise"))]). The real
    // assertion body is kept intact so it goes green once a non-admin session exists.
    test.fixme("Forbidden role sees the warning banner instead of the passcode snippet — not wired: OSS users/mod.rs:213-216,307-313 force base_role=Admin", {
        tag: ['@ingestion-passcode-forbidden', '@all', '@P0'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.ingestionConfigPage.navigateToIngestion(getOrgIdentifier());
        await pm.ingestionConfigPage.expectDataSourceSetupCardForbiddenVisible();
        await pm.ingestionConfigPage.expectDataSourceSetupCardHidden();

        testLogger.info('Test completed');
    });

    test("Legacy curl CopyContent renders normally for an allowed session", {
        tag: ['@ingestion-passcode-forbidden', '@all', '@P1'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.ingestionConfigPage.navigateToIntegration('/ingestion/custom/logs/curl', getOrgIdentifier());
        await pm.ingestionConfigPage.expectRumContentTextVisible();
        const content = await pm.ingestionConfigPage.getRumContentText();
        expect(content.trim().length).toBeGreaterThan(0);
        await pm.ingestionConfigPage.expectCopyContentForbiddenHidden();

        testLogger.info('Test completed');
    });

    test("AI Integrations card renders normally for an allowed session", {
        tag: ['@ingestion-passcode-forbidden', '@all', '@P1'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.ingestionConfigPage.navigateToIntegration('/ingestion/ai-integrations', getOrgIdentifier());
        await pm.ingestionConfigPage.expectAiIntegrationContentVisible();
        await pm.ingestionConfigPage.expectAiIntegrationForbiddenHidden();

        testLogger.info('Test completed');
    });
});
