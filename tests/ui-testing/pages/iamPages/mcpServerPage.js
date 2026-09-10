// mcpServerPage.js
import { expect } from '@playwright/test';


export class McpServerPage {
    constructor(page) {
        this.page = page;

        // Card root + step code blocks.
        this.card = page.locator('[data-test="ai-integrations-mcp-card"]');
        this.endpoint = page.locator('[data-test="ai-integrations-mcp-endpoint"]');
        this.config = page.locator('[data-test="ai-integrations-mcp-config"]');
        this.skillsCmd = page.locator('[data-test="ai-integrations-mcp-skills-cmd"]');

        // Auth-mode picker (OAuth renders only on enterprise/cloud + SSO).
        this.authOauthTab = page.locator('[data-test="ai-integrations-mcp-auth-oauth"]');
        this.oauthNote = page.locator('[data-test="ai-integrations-mcp-oauth-note"]');

        // Token credential pane (pre-generation controls).
        this.credentialPane = page.locator('[data-test="ai-integrations-mcp-credential"]');
        this.generateButton = page.locator('[data-test="ai-integrations-mcp-generate-btn"]');
        this.credentialError = page.locator('[data-test="ai-integrations-mcp-credential-error"]');
        this.securityHint = page.locator('[data-test="ai-integrations-mcp-security"]');

        // Post-generation controls + scope notes.
        this.credentialHeader = page.locator('[data-test="ai-integrations-mcp-credential-header"]');
        this.downloadButton = page.locator('[data-test="ai-integrations-mcp-download-btn"]');
        this.manageButton = page.locator('[data-test="ai-integrations-mcp-manage-btn"]');
        this.rbacNote = page.locator('[data-test="ai-integrations-mcp-rbac-note"]');
        this.readonlyNote = page.locator('[data-test="ai-integrations-mcp-readonly-note"]');
        this.readonlyWarn = page.locator('[data-test="ai-integrations-mcp-readonly-warn"]');

        // One-click install + skills repo.
        this.installButton = page.locator('[data-test="ai-integrations-mcp-install-btn"]');
        this.skillsRepoButton = page.locator('[data-test="ai-integrations-mcp-skills-repo-btn"]');
    }

    // Client picker tab resolved by its stable id (claudeCode, cursor, ...).
    clientTab(id) {
        return this.page.locator(`[data-test="ai-integrations-mcp-client-${id}"]`);
    }

    async waitForCard() {
        await expect(this.endpoint).toBeVisible({ timeout: 15000 });
    }

    async expectEndpointVisible() {
        const org = process.env.ORGNAME || 'default';
        await expect(this.endpoint).toBeVisible();
        await expect(this.endpoint).toContainText(`/api/${org}/mcp`);
    }

    async expectOAuthTabAbsent() {
        await expect(this.authOauthTab).toHaveCount(0);
    }

    async expectCredentialPaneVisible() {
        await expect(this.credentialPane).toBeVisible();
        await expect(this.generateButton).toBeVisible();
    }

    async expectSecurityHintVisible() {
        await expect(this.securityHint).toBeVisible();
    }

    async clickGenerate() {
        await this.generateButton.click();
    }

    // Generation either mints a credential (success) or the backend rejects it
    // (e.g. service accounts disabled in a given env). Both are legitimate OSS
    // outcomes; the caller asserts whichever panel surfaced.
    async waitForGenerateOutcome() {
        await this.page.waitForFunction(
            () =>
                !!document.querySelector('[data-test="ai-integrations-mcp-credential-header"]') ||
                !!document.querySelector('[data-test="ai-integrations-mcp-credential-error"]'),
            null,
            { timeout: 20000 }
        );
        return (await this.credentialHeader.count()) > 0;
    }

    async expectPostGenerationPanel() {
        await expect(this.credentialHeader).toBeVisible();
        await expect(this.credentialHeader).toContainText('Basic ••••••••••••••••');
        await expect(this.rbacNote).toBeVisible();
        await expect(this.rbacNote).toContainText('RBAC is off');
        await expect(this.readonlyNote).toHaveCount(0);
        await expect(this.readonlyWarn).toHaveCount(0);
        await expect(this.downloadButton).toBeVisible();
        await expect(this.manageButton).toBeVisible();
    }

    async expectPlaceholderReplaced() {
        // The pre-generation placeholder ("Basic <base64 of ...>") is gone once a
        // real credential is injected — the raw header is never rendered to the DOM.
        await expect(this.page.locator('body')).not.toContainText('Basic <base64');
    }

    async expectErrorBanner() {
        await expect(this.credentialError).toBeVisible();
        await expect(this.generateButton).toBeVisible();
    }

    async switchClient(id) {
        await this.clientTab(id).click();
    }

    async expectConfigClaudeCode() {
        await expect(this.config).toContainText('claude mcp add openobserve');
    }

    async expectConfigCursor() {
        await expect(this.config).toContainText('"mcpServers"');
    }

    async expectInstallButtonAbsent() {
        await expect(this.installButton).toHaveCount(0);
    }

    async expectInstallButtonVisible() {
        await expect(this.installButton).toBeVisible();
        await expect(this.installButton).toContainText('Add to Cursor');
    }

    async expectSkillsCommandVisible() {
        await expect(this.skillsCmd).toBeVisible();
        await expect(this.skillsCmd).toContainText('npx skills add openobserve/skills');
    }

    async expectSkillsRepoButtonVisible() {
        await expect(this.skillsRepoButton).toBeVisible();
    }

    async clickManageAndExpectServiceAccounts() {
        await this.manageButton.click();
        await expect(this.page).toHaveURL(/serviceAccounts/);
    }

    // Enterprise/cloud-only outcomes, referenced by the fixme placeholders so the
    // assertion bodies survive until those editions wire the paths up.
    async expectOAuthTabVisible() {
        await expect(this.authOauthTab).toBeVisible();
        await expect(this.oauthNote).toBeVisible();
    }

    async expectReadonlyNoteVisible() {
        await expect(this.readonlyNote).toBeVisible();
    }

    async expectReadonlyWarnVisible() {
        await expect(this.readonlyWarn).toBeVisible();
    }
}
