// Copyright 2026 OpenObserve Inc.

export class RegexPatternsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ───────────────────────────────────────────────────────
        this.settingsMenuLink       = '[data-test="menu-link-/settings-item"]';
        this.regexPatternsTab       = '[data-test="regex-patterns-tab"]';
        this.addPatternButton       = '[data-test="regex-pattern-list-add-pattern-btn"]';

        // ── Drawer ───────────────────────────────────────────────────────────
        this.drawer                 = '[data-test="regex-pattern-list-add-regex-pattern-drawer"]';

        // ── Name field (OFormInput — generates -field and -error suffixes) ───
        // data-test="add-regex-pattern-name-input" on OFormInput
        this.nameInput              = '[data-test="add-regex-pattern-name-input-field"]';
        this.nameError              = '[data-test="add-regex-pattern-name-input-error"]';

        // ── Description field (OInput — no validators, no -error suffix) ────
        this.descriptionInput       = '[data-test="add-regex-pattern-description-input-field"]';

        // ── Pattern field (OFormTextarea — generates -field and -error) ─────
        // data-test="add-regex-pattern-input" on OFormTextarea
        this.patternInput           = '[data-test="add-regex-pattern-input-field"]';
        this.patternError           = '[data-test="add-regex-pattern-input-error"]';

        // ── ODrawer built-in action buttons scoped to drawer ─────────────────
        this.saveButton             = '[data-test="regex-pattern-list-add-regex-pattern-drawer"] [data-test="o-drawer-primary-btn"]';
        this.cancelButton           = '[data-test="regex-pattern-list-add-regex-pattern-drawer"] [data-test="o-drawer-secondary-btn"]';

        // ── Toast feedback ───────────────────────────────────────────────────
        this.toastSuccess           = '[data-test-variant="success"]';
        this.toastError             = '[data-test-variant="error"]';
        this.toastMessage           = '[data-test="o-toast-message"]';
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    /**
     * Enterprise-availability probe for the Regex Patterns feature.
     * Navigates to the settings page and POSITIVELY detects whether the
     * (enterprise-only) Regex Patterns route mounted by waiting for its page
     * signal. Returns true when the feature is present, false otherwise — never
     * throws — so callers can gate the suite into a clean SKIP on the OSS binary.
     * @returns {Promise<boolean>}
     */
    async navigateToRegexPatterns() {
        const orgName = process.env.ORGNAME || 'default';
        const baseUrl = process.env.ZO_BASE_URL;
        const targetUrl = `${baseUrl}/web/settings/regex_patterns?org_identifier=${orgName}`;
        await this.page.goto(targetUrl);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded');
        try {
            await this.page.locator(this.addPatternButton).waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            return false;
        }
    }

    // ── Drawer helpers ────────────────────────────────────────────────────────

    async openAddPatternDrawer() {
        await this.page.locator(this.addPatternButton).click();
        await this.page.locator(this.drawer).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillName(name) {
        await this.page.locator(this.nameInput).fill(name);
    }

    async fillPattern(pattern) {
        await this.page.locator(this.patternInput).fill(pattern);
    }

    async clickSave() {
        await this.page.locator(this.saveButton).click();
    }

    async clickCancel() {
        await this.page.locator(this.cancelButton).click();
    }

    async touchNameField() {
        // Fill then clear: OFormInput calls field.handleBlur() on every update:model-value,
        // so this sets isTouched=true with an empty value, revealing the required error.
        const input = this.page.locator(this.nameInput);
        await input.fill('x');
        await input.fill('');
    }

    async touchPatternField() {
        const input = this.page.locator(this.patternInput);
        await input.fill('x');
        await input.fill('');
    }

    async triggerNameValidation() {
        // Submit the OForm to trigger validators on empty fields
        await this.page.locator(this.saveButton).click();
    }

    // ── Assertion-ready locator getters ──────────────────────────────────────

    getDrawerLocator()      { return this.page.locator(this.drawer); }
    getNameErrorLocator()   { return this.page.locator(this.nameError); }
    getPatternErrorLocator(){ return this.page.locator(this.patternError); }
    getSaveButtonLocator()  { return this.page.locator(this.saveButton); }
    getCancelButtonLocator(){ return this.page.locator(this.cancelButton); }
    getToastMessageLocator(){ return this.page.locator(this.toastMessage); }
    getToastErrorLocator()  { return this.page.locator(this.toastError); }
}
