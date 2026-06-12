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

        // Action buttons (plain OButton — not dialog built-ins)
        this.saveBtn        = '[data-test="ai-toolset-save-btn"]';
        this.cancelBtn      = '[data-test="ai-toolset-cancel-btn"]';

        // Toast
        this.toastSuccess   = '[data-test="o-toast-success"]';
        this.toastMessage   = '[data-test="o-toast-message"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async navigateToAiToolsets() {
        testLogger.debug('Navigating to AI Toolsets page via URL');
        const orgId = process.env['ORGNAME'] || 'default';
        const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
        await this.page.goto(`${baseUrl}/web/management/ai_toolsets?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.locator(this.addToolsetBtn).waitFor({ state: 'visible', timeout: 15000 });
        testLogger.debug('AI Toolsets list page ready');
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
    getMcpUrlInputLocator()  { return this.page.locator(this.mcpUrlInput); }
    getMcpUrlErrorLocator()  { return this.page.locator(this.mcpUrlError); }
    getSaveBtnLocator()      { return this.page.locator(this.saveBtn); }
    getCancelBtnLocator()    { return this.page.locator(this.cancelBtn); }
    getAddToolsetBtnLocator(){ return this.page.locator(this.addToolsetBtn); }
    getToastMessageLocator() { return this.page.locator(this.toastMessage); }
    getToastSuccessLocator() { return this.page.locator(this.toastSuccess); }
}
