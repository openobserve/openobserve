// mcpServerPage.js — Page object for the IAM MCP Server feature
// Covers: McpServer.vue (IAM page wrapper), McpServerCard.vue (card component),
// McpCrossLink.vue (discoverability pointer), and Ingestion Recommended tab navigation.
import { expect } from '@playwright/test';

export class McpServerPage {
    constructor(page) {
        this.page = page;

        // ── Navigation ──────────────────────────────────────────────
        this.mcpServerTab = page.locator('[data-test="iam-mcp-server-tab"]');

        // ── Page containers ─────────────────────────────────────────
        this.pageContainer = page.locator('[data-test="iam-mcp-server"]');
        this.card = page.locator('[data-test="ai-integrations-mcp-card"]');

        // ── CopyContent instances (scoped inside the MCP card) ─────
        // .nth(0) = endpoint, .nth(1) = credential, .nth(2) = config snippet
        this.endpointContent = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-content-text"]').nth(0);
        this.credentialContent = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-content-text"]').nth(1);
        // Use .last() for config snippet because the credential block (nth(1))
        // is absent when authMode === 'oauth' or before a credential is generated.
        this.configSnippetContent = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-content-text"]').last();
        this.endpointCopyBtn = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-copy-btn"]').nth(0);
        this.credentialCopyBtn = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-copy-btn"]').nth(1);
        this.configSnippetCopyBtn = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-copy-btn"]').last();

        // ── Auth mode (OSS: only token tab may be relevant) ────────
        this.oauthTab = page.locator('[data-test="ai-integrations-mcp-auth-oauth"]');
        this.tokenTab = page.locator('[data-test="ai-integrations-mcp-auth-token"]');

        // ── Credential management (Enterprise-gated on OSS) ────────
        this.credentialSection = page.locator('[data-test="ai-integrations-mcp-credential"]');
        this.generateBtn = page.locator('[data-test="ai-integrations-mcp-generate-btn"]');
        this.credentialError = page.locator('[data-test="ai-integrations-mcp-credential-error"]');

        // ── Client tabs (11 clients) ────────────────────────────────
        this.allClientTabs = page.locator('[data-test^="ai-integrations-mcp-client-"]');
        // Per-client tab factory
        this.clientTab = (id) => page.locator(`[data-test="ai-integrations-mcp-client-${id}"]`);

        // ── One-click install deep-link button ──────────────────────
        this.installBtn = page.locator('[data-test="ai-integrations-mcp-install-btn"]');

        // ── Security note (token mode only) ─────────────────────────
        this.securityNote = page.locator('[data-test="ai-integrations-mcp-security"]');

        // ── Docs button ─────────────────────────────────────────────
        this.docsBtn = page.locator('[data-test="ai-integrations-mcp-docs-btn"]');

        // ── Ingestion Recommended → McpCrossLink discoverability ────
        this.recommendedMcpTab = page.locator('[data-test="ingestion-recommended-tab-recommendedMcp"]');
        this.crossLinkCard = page.locator('[data-test="mcp-cross-link"]');
        this.crossLinkBtn = page.locator('[data-test="mcp-cross-link-btn"]');
    }

    // ═══════════════════════════════════════════════════════════════
    //  Navigation
    // ═══════════════════════════════════════════════════════════════

    /**
     * Switch to the Token auth mode tab if it exists (Enterprise: OAuth is default).
     * On OSS the auth tabs are not rendered at all — token is the only mode.
     * Returns true if a switch was performed.
     */
    async switchToTokenMode() {
        if (await this.tokenTab.count() > 0) {
            await this.tokenTab.click();
            // Wait for the token-mode credential section to appear.
            await this.credentialSection.waitFor({ state: 'visible', timeout: 10000 });
            return true;
        }
        return false;
    }

    /** Click the MCP Server tab in the IAM sidebar and wait for the page to load. */
    async clickMcpServerTab() {
        await this.mcpServerTab.click();
        await this.pageContainer.waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Navigate directly to the IAM MCP Server route.
     * Uses the org_identifier from env; page must already be authenticated.
     */
    async navigateDirectToMcpServer() {
        await this.page.goto(`/web/iam/mcpServer?org_identifier=${process.env["ORGNAME"]}`);
        await this.pageContainer.waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Navigate to Ingestion page, then click the Recommended tab's MCP entry
     * so the McpCrossLink card renders inside the Recommended component.
     */
    async gotoIngestionRecommended() {
        await this.page.goto(`/web/ingestion?org_identifier=${process.env["ORGNAME"]}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    /** Click the MCP Server entry in the Ingestion Recommended sidebar. */
    async clickRecommendedMcpTab() {
        await this.recommendedMcpTab.click();
        await this.crossLinkCard.waitFor({ state: 'visible', timeout: 10000 });
    }

    /** Click "Open MCP setup" on the discoverability cross-link card. */
    async clickOpenMcpSetup() {
        await this.crossLinkBtn.click();
        await this.pageContainer.waitFor({ state: 'visible', timeout: 10000 });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Queries (return booleans / counts — used in conditional skips)
    // ═══════════════════════════════════════════════════════════════

    /** Returns true if the OAuth auth-mode tab is present in the DOM (Enterprise/Cloud only). */
    async isOAuthTabPresent() {
        return (await this.oauthTab.count()) > 0;
    }

    /** Returns true if the Generate read-only credential button is present (Enterprise + RBAC only). */
    async isGenerateButtonPresent() {
        return (await this.generateBtn.count()) > 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Expect / assertion helpers
    // ═══════════════════════════════════════════════════════════════

    /** Assert the MCP page container and card are visible. */
    async expectPageVisible() {
        await expect(this.pageContainer).toBeVisible({ timeout: 10000 });
        await expect(this.card).toBeVisible({ timeout: 10000 });
    }

    /** Assert the endpoint CopyContent text contains the given substring(s). */
    async expectEndpointContains(text) {
        await expect(this.endpointContent).toContainText(text, { timeout: 10000 });
    }

    /** Assert the number of rendered client tabs equals the expected count. */
    async expectClientTabsCount(expected) {
        await expect(this.allClientTabs).toHaveCount(expected, { timeout: 10000 });
    }

    /** Assert a specific client tab exists and is visible. Active state is verified indirectly via snippet text changes. */
    async expectClientTabVisible(clientId) {
        const tab = this.clientTab(clientId);
        await expect(tab).toBeVisible({ timeout: 5000 });
    }

    /** Assert the config snippet CopyContent text contains the given substring. */
    async expectConfigSnippetContains(text) {
        await expect(this.configSnippetContent).toContainText(text, { timeout: 10000 });
    }

    /** Assert that the OAuth auth-mode tab is NOT present in the DOM. */
    async expectOAuthTabNotVisible() {
        await expect(this.oauthTab).toHaveCount(0, { timeout: 5000 });
    }

    /** Assert that the credential management section is visible (token mode default). */
    async expectCredentialSectionVisible() {
        await expect(this.credentialSection).toBeVisible({ timeout: 5000 });
    }

    /** Assert that the Generate read-only credential button is NOT present. */
    async expectGenerateButtonNotVisible() {
        await expect(this.generateBtn).toHaveCount(0, { timeout: 5000 });
    }

    /** Assert that the security best-practice note is visible. */
    async expectSecurityNoteVisible() {
        await expect(this.securityNote).toBeVisible({ timeout: 5000 });
    }

    /** Assert the docs button is visible and enabled. */
    async expectDocsButtonVisible() {
        await expect(this.docsBtn).toBeVisible({ timeout: 5000 });
    }

    /** Assert the docs button href contains the expected URL fragment. */
    async expectDocsLinkContains(urlFragment) {
        await expect(this.docsBtn).toHaveAttribute('href', new RegExp(urlFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 5000 });
    }

    /**
     * Assert the docs button's click handler opens the expected documentation URL.
     * The button uses @click → window.open (no href attribute), so we intercept
     * window.open to capture the URL without actually navigating away.
     */
    async expectDocsButtonOpensUrl(expectedUrlPath) {
        // Stub window.open so we can capture the URL without a real navigation.
        await this.page.evaluate(() => { window.__capturedDocsUrl = null; });
        await this.page.evaluate(() => {
            window.open = function (url) {
                window.__capturedDocsUrl = url;
                return null;
            };
        });

        await this.docsBtn.click();

        // Wait for the click handler to call window.open (synchronous within the handler).
        await this.page.waitForFunction(
            () => window.__capturedDocsUrl !== null,
            { timeout: 5000 },
        );

        const capturedUrl = await this.page.evaluate(() => window.__capturedDocsUrl);
        expect(capturedUrl, `Docs button should open a URL containing "${expectedUrlPath}"`).toContain(expectedUrlPath);

        // Clean up the test-only property.
        await this.page.evaluate(() => { delete window.__capturedDocsUrl; });
    }

    /** Assert the one-click install button is visible for the current client. */
    async expectInstallButtonVisible() {
        await expect(this.installBtn).toBeVisible({ timeout: 5000 });
    }

    /** Assert the one-click install button is hidden for the current client. */
    async expectInstallButtonHidden() {
        await expect(this.installBtn).toBeHidden({ timeout: 5000 });
    }

    /** Assert the McpCrossLink discoverability card is visible. */
    async expectCrossLinkVisible() {
        await expect(this.crossLinkCard).toBeVisible({ timeout: 10000 });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Actions
    // ═══════════════════════════════════════════════════════════════

    /**
     * Click a client selector tab by its id (e.g. 'claudeCode', 'cursor', 'vscode').
     * Waits for the tab to be visible before clicking.
     */
    async clickClientTab(clientId) {
        const tab = this.clientTab(clientId);
        await tab.waitFor({ state: 'visible', timeout: 5000 });
        await tab.click();
    }

    /** Return the visible text of the config snippet CopyContent (nth 2). */
    async getConfigSnippetText() {
        return await this.configSnippetContent.textContent({ timeout: 10000 });
    }

    /** Return the visible text of the endpoint CopyContent (nth 0). */
    async getEndpointText() {
        return await this.endpointContent.textContent({ timeout: 10000 });
    }

    /** Click the copy button for the config snippet (nth 2). */
    async clickCopyConfigSnippet() {
        await this.configSnippetCopyBtn.click();
    }

    /** Click the copy button for the endpoint URL (nth 0). */
    async clickCopyEndpoint() {
        await this.endpointCopyBtn.click();
    }

    /** Read the system clipboard. Requires clipboard permissions (configured in playwright.config.js). */
    async getClipboardText() {
        return await this.page.evaluate(() => navigator.clipboard.readText());
    }
}
