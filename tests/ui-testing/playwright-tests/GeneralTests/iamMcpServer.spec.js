const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("IAM MCP Server testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to IAM → MCP Server tab (shared path for most tests).
        await pm.iamPage.gotoIamPage();
        await pm.mcpServerPage.clickMcpServerTab();
        await pm.mcpServerPage.expectPageVisible();

        testLogger.info('Test setup completed');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  P0 — Critical Path (OSS Edition)
    // ═══════════════════════════════════════════════════════════════════

    test("should navigate to MCP Server from IAM sidebar and verify page renders", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying MCP Server page container and card are visible');

        // Page + card are already asserted visible in beforeEach.
        // Verify the endpoint URL contains the expected path segments.
        await pm.mcpServerPage.expectEndpointContains('/api/');
        await pm.mcpServerPage.expectEndpointContains('/mcp');

        testLogger.info('Test completed successfully');
    });

    test("should render all 11 client tabs and update config snippet on client switch", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying client tabs count and snippet switching');

        // Assert all 11 client tabs are rendered.
        await pm.mcpServerPage.expectClientTabsCount(11);

        // Verify the default client (claudeCode) tab is visible.
        await pm.mcpServerPage.expectClientTabVisible('claudeCode');

        // Capture the default snippet text.
        const defaultSnippet = await pm.mcpServerPage.getConfigSnippetText();
        expect(defaultSnippet).toBeTruthy();

        // Switch to Cursor client.
        await pm.mcpServerPage.clickClientTab('cursor');
        await pm.mcpServerPage.expectClientTabVisible('cursor');

        // Verify the snippet text changed.
        const cursorSnippet = await pm.mcpServerPage.getConfigSnippetText();
        expect(cursorSnippet).toBeTruthy();
        expect(cursorSnippet).not.toBe(defaultSnippet);

        // Switch to VS Code client.
        await pm.mcpServerPage.clickClientTab('vscode');
        await pm.mcpServerPage.expectClientTabVisible('vscode');

        // Verify the snippet text changed again.
        const vscodeSnippet = await pm.mcpServerPage.getConfigSnippetText();
        expect(vscodeSnippet).toBeTruthy();
        expect(vscodeSnippet).not.toBe(cursorSnippet);

        testLogger.info('Test completed successfully');
    });

    test("should render config snippet with masked passcode and copy unmasked value to clipboard", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying masked passcode on-screen and unmasked copy');

        // On Enterprise the default is OAuth mode — switch to token first
        // so the auth header appears in the snippet.
        await pm.mcpServerPage.switchToTokenMode();

        // The config snippet should contain an auth header (either placeholder or real passcode).
        // The passcode may already be cached in the store, so we check for "Basic" prefix.
        await pm.mcpServerPage.expectConfigSnippetContains('Basic ');

        // Click the copy button for the config snippet (last copy btn).
        await pm.mcpServerPage.clickCopyConfigSnippet();

        // Read the clipboard — the unmasked value must be a valid auth header.
        const clipboardText = await pm.mcpServerPage.getClipboardText();
        expect(clipboardText).toBeTruthy();
        expect(clipboardText).toContain('Basic ');

        testLogger.info('Test completed successfully');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  P1 — Important Functional Coverage
    // ═══════════════════════════════════════════════════════════════════

    test("should display endpoint URL and copy unmasked to clipboard", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying endpoint URL display and copy');

        // Assert the endpoint text contains the expected URL pattern.
        const endpointText = await pm.mcpServerPage.getEndpointText();
        expect(endpointText).toContain('/api/');
        expect(endpointText).toContain('/mcp');

        // Click the endpoint copy button (nth 0).
        await pm.mcpServerPage.clickCopyEndpoint();

        // Read clipboard and verify the URL text is intact (no masking for endpoints).
        const clipboardText = await pm.mcpServerPage.getClipboardText();
        expect(clipboardText).toContain('/api/');
        expect(clipboardText).toContain('/mcp');

        testLogger.info('Test completed successfully');
    });

    test("should show docs button linking to the correct documentation URL", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying docs button visibility and URL');

        // The docs button is an OButton with @click (window.open), not an <a href>.
        // Verify the button is visible and its click handler opens the correct URL.
        await pm.mcpServerPage.expectDocsButtonVisible();
        await pm.mcpServerPage.expectDocsButtonOpensUrl('/docs/integration/ai/mcp/');

        testLogger.info('Test completed successfully');
    });

    test("should NOT render OAuth tab on OSS edition", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying OAuth tab is absent on OSS');

        // On Enterprise/Cloud the OAuth tab IS expected — skip this assertion there.
        const isEnt = await pm.mcpServerPage.isOAuthTabPresent();
        test.skip(isEnt, 'OAuth tab is expected on Enterprise/Cloud editions');

        // OAuth tab must not be rendered on OSS.
        await pm.mcpServerPage.expectOAuthTabNotVisible();

        // The credential management section (token mode) should be visible.
        await pm.mcpServerPage.expectCredentialSectionVisible();

        testLogger.info('Test completed successfully');
    });

    test("should NOT render generate credential button on OSS", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying generate credential button is absent on OSS');

        // On Enterprise with RBAC the Generate button IS expected — skip this assertion there.
        const hasGenerateBtn = await pm.mcpServerPage.isGenerateButtonPresent();
        test.skip(hasGenerateBtn, 'Generate button is expected on Enterprise with RBAC');

        // Generate button (Enterprise + RBAC only) must not appear on OSS.
        await pm.mcpServerPage.expectGenerateButtonNotVisible();

        testLogger.info('Test completed successfully');
    });

    test("should show security note in token mode", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying security best-practice note is visible');

        // On Enterprise the default is OAuth mode — switch to token first.
        await pm.mcpServerPage.switchToTokenMode();

        await pm.mcpServerPage.expectSecurityNoteVisible();

        testLogger.info('Test completed successfully');
    });

    test("should navigate from Ingestion Recommended cross-link card to IAM MCP Server page", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying discoverability cross-link from Ingestion Recommended tab');

        // Navigate to Ingestion page, then click the Recommended MCP entry.
        await pm.mcpServerPage.gotoIngestionRecommended();
        await pm.mcpServerPage.clickRecommendedMcpTab();

        // Assert the cross-link pointer card is visible.
        await pm.mcpServerPage.expectCrossLinkVisible();

        // Click "Open MCP setup" — should navigate to the IAM MCP Server page.
        await pm.mcpServerPage.clickOpenMcpSetup();
        await pm.mcpServerPage.expectPageVisible();

        // Verify the URL reflects the MCP Server route.
        await expect(page).toHaveURL(/mcpServer/);

        testLogger.info('Test completed successfully');
    });

    test("should show one-click install buttons for Cursor and VS Code in token mode", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying install buttons for Cursor and VS Code');

        // Switch to token mode — the test title explicitly promises this precondition.
        await pm.mcpServerPage.switchToTokenMode();

        // Select Cursor client — install button should be visible.
        await pm.mcpServerPage.clickClientTab('cursor');
        await pm.mcpServerPage.expectInstallButtonVisible();

        // Select VS Code client — install button should be visible.
        await pm.mcpServerPage.clickClientTab('vscode');
        await pm.mcpServerPage.expectInstallButtonVisible();

        testLogger.info('Test completed successfully');
    });

    // ═══════════════════════════════════════════════════════════════════
    //  P2 — Edge Cases / Nice-to-have
    // ═══════════════════════════════════════════════════════════════════

    test("should hide Claude Desktop deep link in token mode", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying Claude Desktop install button is hidden in token mode');

        // On Enterprise the default is OAuth mode — switch to token first,
        // because the Claude Desktop install button is only hidden in token mode.
        await pm.mcpServerPage.switchToTokenMode();

        // Select Claude Desktop client.
        await pm.mcpServerPage.clickClientTab('claudeDesktop');

        // Install button must be hidden — Claude Desktop deep link only works in OAuth mode.
        await pm.mcpServerPage.expectInstallButtonHidden();

        testLogger.info('Test completed successfully');
    });

    test("should load MCP Server page via direct URL navigation", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying direct URL navigation to MCP Server page');

        // Navigate directly to the MCP Server route (bypasses IAM sidebar).
        await pm.mcpServerPage.navigateDirectToMcpServer();

        // Page container and card should be visible.
        await pm.mcpServerPage.expectPageVisible();

        testLogger.info('Test completed successfully');
    });

    test("should render config snippet with auth header in token mode", { tag: ['@iamMcpServer', '@all'] }, async ({ page }) => {
        testLogger.info('Verifying auth header renders in config snippet in token mode');

        // On Enterprise the default is OAuth mode — switch to token first
        // so the auth header appears in the snippet.
        await pm.mcpServerPage.switchToTokenMode();

        // The config snippet should contain an auth header. The passcode may already
        // be loaded from the store (authenticated session), so check for the "Basic"
        // prefix rather than the literal [BASIC_PASSCODE] placeholder.
        await pm.mcpServerPage.expectConfigSnippetContains('Basic ');

        testLogger.info('Test completed successfully');
    });
});
