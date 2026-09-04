// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AiToolsetsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ────────────────────────────────────────────────────────
        // AI Toolsets lives under Management > ai_toolsets
        this.managementMenuLink = '[data-test="menu-link-\\/management-item"]';

        // ── List page ─────────────────────────────────────────────────────────
        this.addToolsetBtn = '[data-test="ai-toolsets-add-btn"]';

        // ── AddAiToolset form ─────────────────────────────────────────────────
        // OInput data-test="ai-toolset-name-input" → -field / -error
        this.nameInput      = '[data-test="ai-toolset-name-input-field"]';
        this.nameError      = '[data-test="ai-toolset-name-input-error"]';

        // OSelect data-test="ai-toolset-kind-select" → -popover / -error
        this.kindSelect     = '[data-test="ai-toolset-kind-select"]';
        this.kindError      = '[data-test="ai-toolset-kind-select-error"]';

        // MCP URL — shown when kind === 'mcp' (default)
        // OInput data-test="ai-toolset-mcp-url" → -field / -error
        this.mcpUrlInput    = '[data-test="ai-toolset-mcp-url-field"]';
        this.mcpUrlError    = '[data-test="ai-toolset-mcp-url-error"]';

        // OSelect kind — trigger popover and option selectors
        this.kindSelectPopover = '[data-test="ai-toolset-kind-select-popover"]';
        this.kindSelectOption  = '[data-test="ai-toolset-kind-select-option"]';

        // CLI command — shown when kind === 'cli'
        // OInput data-test="ai-toolset-cli-command" → -field / -error
        this.cliCommandInput = '[data-test="ai-toolset-cli-command-field"]';
        this.cliCommandError = '[data-test="ai-toolset-cli-command-error"]';

        // Action buttons (plain OButton — not dialog built-ins)
        this.saveBtn        = '[data-test="ai-toolset-save-btn"]';
        this.cancelBtn      = '[data-test="ai-toolset-cancel-btn"]';

        // Toast
        this.toastSuccess   = '[data-test-variant="success"]';
        this.toastMessage   = '[data-test="o-toast-message"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    /**
     * Enterprise-availability probe for the AI Toolsets feature.
     *
     * AI Toolsets is an enterprise/cloud-only feature — its route only mounts on
     * the enterprise binary. This positively detects feature presence by waiting
     * for the list-page signal (the Add Toolset button) and RETURNS A BOOLEAN:
     * true when the feature mounted, false on OSS where navigation never lands.
     * Callers gate the suite on the result (skip on OSS) instead of failing.
     *
     * @returns {Promise<boolean>} true when the AI Toolsets list page rendered
     */
    async navigateToAiToolsets() {
        testLogger.debug('Navigating to AI Toolsets page via URL');
        const orgId = process.env['ORGNAME'] || 'default';
        const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
        await this.page.goto(`${baseUrl}/web/settings/ai_toolsets?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        try {
            await this.page.locator(this.addToolsetBtn).waitFor({ state: 'visible', timeout: 15000 });
            testLogger.debug('AI Toolsets list page ready');
            return true;
        } catch {
            testLogger.debug('AI Toolsets list page not available (likely OSS build)');
            return false;
        }
    }

    // ── List page actions ─────────────────────────────────────────────────────

    async clickAddToolset() {
        testLogger.debug('Clicking Add AI Toolset button');
        await this.page.locator(this.addToolsetBtn).click();
        // Wait for the form to mount — name input is the first interactive field
        await this.page.locator(this.nameInput).waitFor({ state: 'visible', timeout: 10000 });
    }

    // ── Form field actions ────────────────────────────────────────────────────

    async fillName(name) {
        testLogger.debug('Filling toolset name', { name });
        await this.page.locator(this.nameInput).fill(name);
    }

    async clearName() {
        testLogger.debug('Clearing toolset name');
        await this.page.locator(this.nameInput).clear();
    }

    async fillMcpUrl(url) {
        testLogger.debug('Filling MCP URL', { url });
        await this.page.locator(this.mcpUrlInput).fill(url);
    }

    getKindOptionLocator(value) {
        return this.page.locator(`${this.kindSelectOption}[data-test-value="${value}"]`);
    }

    async selectKind(label) {
        testLogger.debug('Selecting toolset kind', { label });
        const labelToValue = { 'MCP Server': 'mcp', 'CLI Tool': 'cli', 'Skill': 'skill' };
        const value = labelToValue[label] || label;
        await this.page.locator(this.kindSelect).click();
        await this.page.locator(this.kindSelectPopover).waitFor({ state: 'visible', timeout: 8000 });
        await this.getKindOptionLocator(value).click();
    }

    async fillCliCommand(command) {
        testLogger.debug('Filling CLI command', { command });
        await this.page.locator(this.cliCommandInput).fill(command);
    }

    async clickSave() {
        testLogger.debug('Clicking Save button');
        await this.page.locator(this.saveBtn).click();
    }

    async clickCancel() {
        testLogger.debug('Clicking Cancel button');
        await this.page.locator(this.cancelBtn).click();
    }

    // ── Locator getters (for expect() assertions in spec) ─────────────────────

    getNameInputLocator()    { return this.page.locator(this.nameInput); }
    getNameErrorLocator()    { return this.page.locator(this.nameError); }
    getKindErrorLocator()    { return this.page.locator(this.kindError); }
    getMcpUrlInputLocator()      { return this.page.locator(this.mcpUrlInput); }
    getMcpUrlErrorLocator()      { return this.page.locator(this.mcpUrlError); }
    getCliCommandInputLocator()  { return this.page.locator(this.cliCommandInput); }
    getCliCommandErrorLocator()  { return this.page.locator(this.cliCommandError); }
    getSaveBtnLocator()      { return this.page.locator(this.saveBtn); }
    getCancelBtnLocator()    { return this.page.locator(this.cancelBtn); }
    getAddToolsetBtnLocator(){ return this.page.locator(this.addToolsetBtn); }
    getToastMessageLocator() { return this.page.locator(this.toastMessage); }
    getToastSuccessLocator() { return this.page.locator(this.toastSuccess); }
}
