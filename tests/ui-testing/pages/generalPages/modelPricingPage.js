// modelPricingPage.js — Page object for Settings > Model Pricing
// Feature: OSS (no enterprise flag required, but gated by model_pricing_enabled config)
// Routes:
//   List:   /web/settings/model_pricing?org_identifier={org}
//   Editor: /web/settings/model_pricing/edit?org_identifier={org}&id={id}

import { expect } from '@playwright/test';

export class ModelPricingPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // Navigation
        // ============================================================
        this.settingsMenuLink = page.locator('[data-test="menu-link-settings-item"]');
        this.modelPricingTab   = page.locator('[data-test="model-pricing-tab"]');

        // ============================================================
        // List page — header controls
        // ============================================================
        // NOTE: model-pricing-list-title was removed in the fix/layout-exp1
        // refactor. The list page now uses AppPageHeader without a data-test
        // on the title span. The stable "list page is ready" anchor is the
        // table element itself: [data-test="model-pricing-list-table"].
        // listTitle is kept as an alias to listTable for backward-compat.
        this.listTitle          = page.locator('[data-test="model-pricing-list-table"]');
        this.infoBtn            = page.locator('[data-test="model-pricing-info-btn"]');
        this.refreshBtn         = page.locator('[data-test="model-pricing-refresh-btn"]');
        this.testMatchBtn       = page.locator('[data-test="model-pricing-test-match-btn"]');
        this.importBtn          = page.locator('[data-test="model-pricing-import-btn"]');
        this.addBtn             = page.locator('[data-test="model-pricing-add-btn"]');
        this.emptyAddBtn        = page.locator('[data-test="model-pricing-empty-add-btn"]');

        // ============================================================
        // List page — tabs (AppTabs renders as OToggleGroup with data-test="tab-{value}")
        // Tab values: "all", "org" (Custom), "inherited" (System/Built-in)
        // ============================================================
        this.tabAll         = page.locator('[data-test="tab-all"]');
        this.tabCustom      = page.locator('[data-test="tab-org"]');
        this.tabSystem      = page.locator('[data-test="tab-inherited"]');

        // ============================================================
        // List page — table and row actions
        // ============================================================
        this.listTable          = page.locator('[data-test="model-pricing-list-table"]');
        this.toggleBtn          = page.locator('[data-test="model-pricing-toggle-btn"]');
        this.editBtn            = page.locator('[data-test="model-pricing-edit-btn"]');
        this.deleteBtn          = page.locator('[data-test="model-pricing-delete-btn"]');
        this.duplicateBtn       = page.locator('[data-test="model-pricing-duplicate-btn"]');
        this.cloneBtn           = page.locator('[data-test="model-pricing-clone-btn"]');
        this.pricingDrawer      = page.locator('[data-test="model-pricing-list-pricing-drawer"]');

        // ============================================================
        // List page — bulk actions
        // ============================================================
        this.exportSelectedBtn  = page.locator('[data-test="model-pricing-export-selected-btn"]');
        this.deleteSelectedBtn  = page.locator('[data-test="model-pricing-delete-selected-btn"]');

        // ============================================================
        // Editor page
        // ============================================================
        this.editorBackBtn      = page.locator('[data-test="model-pricing-editor-back-btn"]');
        this.editorTitle        = page.locator('[data-test="model-pricing-editor-title"]');
        this.nameInput          = page.locator('[data-test="model-pricing-name-input"]');
        this.nameInputError     = page.locator('[data-test="model-pricing-name-input-error"]');
        this.patternInput       = page.locator('[data-test="model-pricing-pattern-input"]');
        this.patternInputError  = page.locator('[data-test="model-pricing-pattern-input-error"]');
        this.examplesDialog     = page.locator('[data-test="model-pricing-editor-examples-dialog"]');
        this.cancelBtn          = page.locator('[data-test="model-pricing-editor-cancel-btn"]');
        this.saveBtn            = page.locator('[data-test="model-pricing-editor-save-btn"]');

        // ============================================================
        // Editor page — optional feature buttons (may not exist in all builds)
        // ============================================================
        this.addTierBtn     = page.locator('button').filter({ hasText: /add.?tier/i }).first();
        this.templateBtn    = page.locator('button').filter({ hasText: /openai/i }).first();
        this.priceValueInput = page.getByPlaceholder('0.00').first();
        this.examplesBtn    = page.locator('button').filter({ hasText: /example/i }).first();

        // ============================================================
        // List page — search (OSearchInput, placeholder from i18n modelPricing.searchPlaceholder)
        // ============================================================
        this.listSearch         = page.getByPlaceholder('Search models...');

        // ============================================================
        // Built-in tab
        // NOTE: BuiltInModelPricingTab.vue is orphaned — all tabs use the same OTable.
        // The System/Built-in tab just filters filteredModels to show inherited rows.
        // builtInTable = same as listTable; builtInSearch = same OSearchInput in header.
        // ============================================================
        this.builtInSearch      = page.getByPlaceholder('Search models...');
        this.builtInRefreshBtn  = page.locator('[data-test="model-pricing-refresh-btn"]');
        this.builtInTable       = page.locator('[data-test="model-pricing-list-table"]');

        // ============================================================
        // Import overlay
        // ============================================================
        this.importNameInput        = page.locator('[data-test="model-pricing-import-name-input"]');
        this.importPatternInput     = page.locator('[data-test="model-pricing-import-pattern-input"]');
        this.importCreationTitle    = page.locator('[data-test="model-pricing-import-creation-title"]');
        this.importFileInput        = page.locator('input[type="file"]');

        // ============================================================
        // Test Match Dialog
        // ============================================================
        this.testMatchDialog    = page.locator('[data-test="test-model-match-dialog"]');
        this.testMatchInput     = page.locator('[data-test="test-match-model-input"]');
        this.testMatchClearBtn  = page.locator('[data-test="test-match-clear-btn"]');
        this.testMatchEmpty     = page.locator('[data-test="test-match-empty"]');
        this.testMatchWaiting   = page.locator('[data-test="test-match-waiting"]');
        this.testMatchNoResult  = page.locator('[data-test="test-match-no-result"]');
        this.testMatchResult    = page.locator('[data-test="test-match-result"]');

        // ============================================================
        // Confirm dialog (ODialog generic buttons)
        // ============================================================
        this.confirmOkBtn       = page.locator('[data-test="o-dialog-primary-btn"]');
        this.confirmCancelBtn   = page.locator('[data-test="o-dialog-secondary-btn"]');

        // ============================================================
        // Toast
        // ============================================================
        this.toastMessage       = page.locator('[data-test="o-toast-message"]');
    }

    // ----------------------------------------------------------------
    // Navigation helpers
    // ----------------------------------------------------------------

    async gotoModelPricingPage() {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/settings/model_pricing?org_identifier=${org}`
        );
        await this.listTitle.waitFor({ state: 'visible', timeout: 15000 });
    }

    async gotoEditorCreate() {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/settings/model_pricing/edit?org_identifier=${org}`
        );
        await this.editorTitle.waitFor({ state: 'visible', timeout: 15000 });
    }

    async gotoEditorDuplicate(modelId) {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/settings/model_pricing/edit?org_identifier=${org}&id=${modelId}&duplicate=true`
        );
        await this.editorTitle.waitFor({ state: 'visible', timeout: 15000 });
        const nameInput = this.nameInput.locator('input').first();
        await expect(nameInput).not.toHaveValue('', { timeout: 10000 });
    }

    async gotoEditorEdit(modelId) {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/settings/model_pricing/edit?org_identifier=${org}&id=${modelId}`
        );
        await this.editorTitle.waitFor({ state: 'visible', timeout: 15000 });
        // Wait for the async fetch to populate the form before the caller reads any field.
        const nameInput = this.nameInput.locator('input').first();
        await expect(nameInput).not.toHaveValue('', { timeout: 10000 });
    }

    // ----------------------------------------------------------------
    // List page actions
    // ----------------------------------------------------------------

    async clickAdd() {
        await this.addBtn.click();
        await this.editorTitle.waitFor({ state: 'visible', timeout: 10000 });
    }

    async clickEmptyAdd() {
        await this.emptyAddBtn.click();
        await this.editorTitle.waitFor({ state: 'visible', timeout: 10000 });
    }

    async clickImport() {
        await this.importBtn.click();
        await this.page.waitForSelector('input[type="file"]', { timeout: 10000 });
    }

    async clickTestMatch() {
        await this.testMatchBtn.click();
        await this.testMatchDialog.waitFor({ state: 'visible', timeout: 10000 });
    }

    editBtnForModel(name) {
        return this.page
            .locator('[data-test="model-pricing-list-table"]')
            .locator(`tr:has-text("${name}")`)
            .locator('[data-test="model-pricing-edit-btn"]');
    }

    deleteBtnForModel(name) {
        return this.page
            .locator('[data-test="model-pricing-list-table"]')
            .locator(`tr:has-text("${name}")`)
            .locator('[data-test="model-pricing-delete-btn"]');
    }

    toggleBtnForModel(name) {
        return this.page
            .locator('[data-test="model-pricing-list-table"]')
            .locator(`tr:has-text("${name}")`)
            .locator('[data-test="model-pricing-toggle-btn"]');
    }

    duplicateBtnForModel(name) {
        return this.page
            .locator('[data-test="model-pricing-list-table"]')
            .locator(`tr:has-text("${name}")`)
            .locator('[data-test="model-pricing-duplicate-btn"]');
    }

    cloneBtnForRow(rowLocator) {
        return rowLocator.locator('[data-test="model-pricing-clone-btn"]');
    }

    /** Check a table row's checkbox by model name.
     *  OCheckbox renders as <button role="checkbox"> (not <input type="checkbox">).
     *  The checkbox is inside the row's first cell.
     */
    async checkRowByName(name) {
        const row = this.page
            .locator('[data-test="model-pricing-list-table"]')
            .locator(`tr:has-text("${name}")`);
        // OCheckbox renders as button[role="checkbox"] — data-test="o2-table-select-{id}"
        const checkbox = row.locator('button[role="checkbox"]').first();
        await checkbox.click();
    }

    async verifyModelInList(name) {
        await expect(
            this.listTable.locator(`tr:has-text("${name}")`).first()
        ).toBeVisible({ timeout: 10000 });
    }

    async verifyModelNotInList(name) {
        await expect(
            this.listTable.locator(`tr:has-text("${name}")`)
        ).not.toBeVisible({ timeout: 5000 });
    }

    // ----------------------------------------------------------------
    // Editor actions
    // ----------------------------------------------------------------

    async fillName(name) {
        const input = this.nameInput.locator('input').first();
        await input.focus();
        // Directly set the native value and fire an 'input' event so Vue's handleInput
        // receives the full replacement value in one shot, avoiding selection-loss issues
        // with controlled Vue inputs that re-render between select and type operations.
        await input.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, name);
        await input.press('Tab'); // blur triggers nameTouched + debounce flush
    }

    async fillPattern(pattern) {
        const input = this.patternInput.locator('input').first();
        await input.focus();
        await input.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, pattern);
        await input.press('Tab'); // blur triggers patternTouched + debounce flush
    }

    /** Add a single price row to the specified tier (default: tier 0 = the Default tier).
     *  Scopes all locators to the target .tier-card so multiple tiers on the page
     *  don't cause the wrong add-row inputs to be targeted.
     *  @param {string} key
     *  @param {number} valuePricePerMillion
     *  @param {number} [tierIndex=0]
     */
    async addPriceRow(key, valuePricePerMillion, tierIndex = 0) {
        const tierCard = this.page.locator('.tier-card').nth(tierIndex);
        const addRow   = tierCard.locator('.price-add-row');

        const keyInput = addRow.getByPlaceholder('Usage key (e.g. input)');
        await keyInput.waitFor({ state: 'visible', timeout: 5000 });
        await keyInput.fill(key);

        const valueInput = addRow.getByPlaceholder('0.00');
        await valueInput.waitFor({ state: 'visible', timeout: 5000 });
        await valueInput.fill(String(valuePricePerMillion));

        const addPriceBtn = addRow.locator('button');
        await expect(addPriceBtn).toBeEnabled({ timeout: 5000 });
        await addPriceBtn.click();
        // Wait for Vue to process the add and reset the add-row inputs
        await this.page.waitForTimeout(200);
    }

    async clickSave() {
        await this.saveBtn.click();
        await Promise.race([
            this.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
            this.toastMessage.first().waitFor({ state: 'visible', timeout: 15000 }),
        ]);
    }

    async clickCancel() {
        await this.cancelBtn.click();
        await this.listTitle.waitFor({ state: 'visible', timeout: 10000 });
    }

    async clickEditorBack() {
        await this.editorBackBtn.click();
        await this.listTitle.waitFor({ state: 'visible', timeout: 10000 });
    }

    async verifyEditorOnPage() {
        await expect(this.editorTitle).toBeVisible({ timeout: 10000 });
    }

    async verifyNameInputValue(expected) {
        const input = this.nameInput.locator('input').first();
        await expect(input).toHaveValue(expected, { timeout: 5000 });
    }

    async verifyPatternInputValue(expected) {
        const input = this.patternInput.locator('input').first();
        await expect(input).toHaveValue(expected, { timeout: 5000 });
    }

    // ----------------------------------------------------------------
    // Test Match Dialog actions
    // ----------------------------------------------------------------

    /** Fill the test-match input. data-test is on the OInput wrapper — use inner <input>. */
    async fillTestMatchInput(modelName) {
        const input = this.testMatchInput.locator('input').first();
        await input.fill(modelName, { force: true });
    }

    async clickTestMatchRun() {
        const primaryBtn = this.testMatchDialog.locator('[data-test="o-dialog-primary-btn"]');
        await primaryBtn.click();
    }

    async clearTestMatch() {
        await this.testMatchClearBtn.click();
    }

    async closeTestMatchDialog() {
        const closeBtn = this.testMatchDialog.locator('[data-test="o-dialog-close-btn"]');
        await closeBtn.click();
        await this.testMatchDialog.waitFor({ state: 'hidden', timeout: 5000 });
    }

    // ----------------------------------------------------------------
    // Import overlay actions
    // ----------------------------------------------------------------

    async uploadImportJson(jsonString, filename = 'model-pricing-import.json') {
        await this.importFileInput.setInputFiles({
            name: filename,
            mimeType: 'application/json',
            buffer: Buffer.from(jsonString),
        });
    }

    async clickImportConfirm() {
        // BaseImport renders the import button as data-test="{testPrefix}-import-json-btn"
        // test-prefix="model-pricing" → data-test="model-pricing-import-json-btn"
        await this.page.locator('[data-test="model-pricing-import-json-btn"]').click();
    }

    async clickImportCancel() {
        // BaseImport cancel: data-test="model-pricing-import-cancel-btn"
        await this.page.locator('[data-test="model-pricing-import-cancel-btn"]').click();
        await this.listTitle.waitFor({ state: 'visible', timeout: 10000 });
    }

    // ----------------------------------------------------------------
    // Built-in tab actions
    // AppTabs renders as OToggleGroup with OToggleGroupItem per tab.
    // Each item has data-test="tab-{value}". System tab value = "inherited".
    // ----------------------------------------------------------------

    async switchToBuiltInTab() {
        await this.tabSystem.click();
        // All tabs share the same OTable — just wait for it to be visible
        await this.listTable.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(500); // allow filter to apply
    }

    async switchToCustomTab() {
        await this.tabCustom.click();
        await this.listTable.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(300);
    }

    async switchToAllTab() {
        await this.tabAll.click();
        await this.listTable.waitFor({ state: 'visible', timeout: 10000 });
    }

    // ----------------------------------------------------------------
    // Assertion helpers
    // ----------------------------------------------------------------

    async verifySuccessToast(messageFragment) {
        await expect(
            this.toastMessage.filter({ hasText: messageFragment })
        ).toBeVisible({ timeout: 10000 });
    }

    async verifyListPageVisible() {
        await expect(this.listTitle).toBeVisible({ timeout: 10000 });
    }
}
