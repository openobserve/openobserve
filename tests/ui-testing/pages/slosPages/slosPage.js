// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Page object for the SLO (Service Level Objective) create/edit form and SLO list page.
 *
 * Covers:
 *   • SLO list page (SloList.vue) — navigation, "New SLO" button
 *   • SLO add/edit form (AddSlo.vue) — SLI type selection, stream/stream-type pickers,
 *     query language toggles, expression fields (SQL and PromQL), save, preview sections
 */
export class SlosPage {
  constructor(page) {
    this.page = page;

    // ── SLO List page ──────────────────────────────────────────────────────
    this.sloListTitle = '[data-test="slos-slolist-title"]';
    this.newSloBtn = '[data-test="slos-slolist-new"]';

    // ── AddSlo form — common ───────────────────────────────────────────────
    this.title = '[data-test="slos-addslo-title"]';
    this.nameInput = '[data-test="slos-addslo-name"]';
    this.saveBtn = '[data-test="slos-addslo-save"]';
    this.errorBanner = '[data-test="slos-addslo-error"]';
    this.regenWarning = '[data-test="slos-addslo-regen-warning"]';

    // SLI type toggle
    this.sliTypeGroup = '[data-test="slos-addslo-sli-type"]';
    this.sliTypeDesc = '[data-test="slos-addslo-sli-type-description"]';

    // Target / window / slice
    this.targetInput = '[data-test="slos-addslo-target"]';

    // ── Count branch ───────────────────────────────────────────────────────
    this.countStreamType = '[data-test="slos-addslo-stream-type"]';
    this.countStream = '[data-test="slos-addslo-stream"]';
    this.countLanguageGroup = '[data-test="slos-addslo-count-language"]';
    this.countScope = '[data-test="slos-addslo-scope"]';
    this.countGoodExpr = '[data-test="slos-addslo-good-expr"]';
    this.countPromqlGood = '[data-test="slos-addslo-promql-good"]';
    this.countPromqlTotal = '[data-test="slos-addslo-promql-total"]';
    this.countPromqlHint = '[data-test="slos-addslo-count-promql-hint"]';
    this.countPreviewSection = '[data-test="slos-addslo-preview-section"]';

    // ── Time-slice branch ──────────────────────────────────────────────────
    this.timesliceStreamType = '[data-test="slos-addslo-timeslice-stream-type"]';
    this.timesliceStream = '[data-test="slos-addslo-timeslice-stream"]';
    this.timesliceLanguageGroup = '[data-test="slos-addslo-timeslice-language"]';
    this.timesliceAggregate = '[data-test="slos-addslo-aggregate"]';
    this.timesliceScope = '[data-test="slos-addslo-timeslice-scope"]';
    this.timesliceAbsentNote = '[data-test="slos-addslo-promql-absent-note"]';
    this.timeslicePreviewSection = '[data-test="slos-addslo-timeslice-preview-section"]';

    // ── SloTimeSlicePreview selectors ──────────────────────────────────────
    this.timeslicePreviewRoot = '[data-test="slos-slotimeslicepreview-root"]';
    this.timeslicePreviewEmpty = '[data-test="slos-slotimeslicepreview-empty"]';
    this.timeslicePreviewLoading = '[data-test="slos-slotimeslicepreview-loading"]';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Navigate directly to the SLO list page.
   */
  async navigateToSloList() {
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    testLogger.info('Navigating to SLO list page');
    await this.page.goto(`${baseUrl}/web/slos?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Navigate directly to the edit page for a stored SLO.
   * @param {string} sloId
   */
  async navigateToEditSlo(sloId) {
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    testLogger.info('Navigating to edit SLO', { sloId });
    await this.page.goto(`${baseUrl}/web/slos/edit/${sloId}?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SLO List actions
  // ──────────────────────────────────────────────────────────────────────────

  async clickNewSlo() {
    testLogger.info('Clicking New SLO button');
    await this.page.locator(this.newSloBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.newSloBtn).click();
    // Wait for the AddSlo form to render
    await this.page.locator(this.title).waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Form basics
  // ──────────────────────────────────────────────────────────────────────────

  async setName(name) {
    testLogger.info('Setting SLO name', { name });
    // OInput renders the wrapper div with data-test; the native <input> gets data-test="<name>-field"
    const input = this.page.locator(this.nameInput.replace('"]', '-field"]'));
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.clear();
    await input.fill(name);
  }

  async setTarget(value) {
    testLogger.info('Setting target', { value });
    // OInput: the native input gets data-test="<name>-field"
    const input = this.page.locator(this.targetInput.replace('"]', '-field"]'));
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.clear();
    await input.fill(String(value));
  }

  async setThreshold(value) {
    testLogger.info('Setting threshold', { value });
    // Threshold OInput has no data-test; it's the first input[type="number"] in DOM
    // (appears before target in the time-slice template).
    const thresholdInput = this.page.locator('input[type="number"]').first();
    await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
    await thresholdInput.clear();
    await thresholdInput.fill(String(value));
  }

  async clickSave() {
    testLogger.info('Clicking save');
    await this.page.locator(this.saveBtn).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(this.saveBtn).click();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SLI type selection
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Select an SLI type by clicking the toggle item.
   * @param {'count'|'time_slice'|'alert'} type
   */
  async selectSliType(type) {
    testLogger.info('Selecting SLI type', { type });
    const selector = `[data-test="slos-addslo-sli-type-${type}"]`;
    await this.page.locator(selector).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(selector).click();
    // Allow form to re-render for the selected branch
    await this.page.waitForTimeout(500);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OSelect helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Open an OSelect dropdown and pick an option by its data-test-value.
   * OSelect forwards data-test onto an inner <button> trigger; we click that.
   *
   * @param {string} rootSelector - the OSelect root data-test
   * @param {string} value - the data-test-value of the option to pick
   */
  async _openAndPickOption(rootSelector, value) {
    const root = this.page.locator(rootSelector);
    await root.waitFor({ state: 'visible', timeout: 10000 });

    // OSelect trigger: the inner button that toggles the popover
    const trigger = root.locator('[data-test$="-trigger"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });

    // Click until the popover reports open
    for (let i = 0; i < 5; i++) {
      const expanded = await trigger.getAttribute('aria-expanded');
      if (expanded === 'true') break;
      await trigger.click();
      await this.page.waitForTimeout(400);
    }

    // Pick the option
    const option = this.page.locator(`[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(300);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stream type selection
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Select the stream type (logs / metrics / traces).
   * @param {'count'|'timeslice'} branch
   * @param {'logs'|'metrics'|'traces'} type
   */
  async selectStreamType(branch, type) {
    testLogger.info('Selecting stream type', { branch, type });
    const selector = branch === 'count' ? this.countStreamType : this.timesliceStreamType;
    await this._openAndPickOption(selector, type);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stream selection
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Select a stream by its name/label.
   * @param {'count'|'timeslice'} branch
   * @param {string} streamName
   */
  async selectStream(branch, streamName) {
    testLogger.info('Selecting stream', { branch, streamName });
    const selector = branch === 'count' ? this.countStream : this.timesliceStream;
    await this._openAndPickOption(selector, streamName);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Language toggle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Select the query language (SQL or PromQL) on a branch.
   * @param {'count'|'timeslice'} branch
   * @param {'prom_ql'|'sql'} language
   */
  async selectLanguage(branch, language) {
    testLogger.info('Selecting language', { branch, language });
    const selector = `[data-test="slos-addslo-${branch}-language-${language}"]`;
    const item = this.page.locator(selector);
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
    // Allow watchers (expression clear) to run
    await this.page.waitForTimeout(400);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Expression fields
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fill the aggregate expression field (time-slice branch).
   * SloExpressionField has a Monaco editor: we click the editor surface,
   * clear via keyboard, and type — avoiding the textarea click that Monaco's
   * view-line overlay intercepts.
   * @param {string} expr
   */
  async fillAggregate(expr) {
    testLogger.info('Filling aggregate expression');
    const wrapper = this.page.locator(this.timesliceAggregate);
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    // Click the monaco editor surface to focus it
    const monacoEditor = wrapper.locator('.monaco-editor').first();
    await monacoEditor.waitFor({ state: 'visible', timeout: 5000 });
    await monacoEditor.click({ position: { x: 10, y: 10 } });
    // Clear existing text and type
    const isMac = process.platform === 'darwin';
    await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expr);
    await this.page.waitForTimeout(600); // debounce
  }

  /**
   * Fill the scope expression field (SQL time-slice / SQL count).
   * @param {string} expr
   */
  async fillScope(expr) {
    testLogger.info('Filling scope expression');
    const wrapper = this.page.locator(this.timesliceScope);
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    const monacoEditor = wrapper.locator('.monaco-editor').first();
    await monacoEditor.waitFor({ state: 'visible', timeout: 5000 });
    await monacoEditor.click({ position: { x: 10, y: 10 } });
    const isMac = process.platform === 'darwin';
    await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expr);
    await this.page.waitForTimeout(300);
  }

  /**
   * Fill the PromQL "Good" expression field (count branch).
   * @param {string} expr
   */
  async fillPromqlGood(expr) {
    testLogger.info('Filling PromQL good expression');
    const wrapper = this.page.locator(this.countPromqlGood);
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    const monacoEditor = wrapper.locator('.monaco-editor').first();
    await monacoEditor.waitFor({ state: 'visible', timeout: 5000 });
    await monacoEditor.click({ position: { x: 10, y: 10 } });
    const isMac = process.platform === 'darwin';
    await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expr);
    await this.page.waitForTimeout(600); // debounce
  }

  /**
   * Fill the PromQL "Total" expression field (count branch).
   * @param {string} expr
   */
  async fillPromqlTotal(expr) {
    testLogger.info('Filling PromQL total expression');
    const wrapper = this.page.locator(this.countPromqlTotal);
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    const monacoEditor = wrapper.locator('.monaco-editor').first();
    await monacoEditor.waitFor({ state: 'visible', timeout: 5000 });
    await monacoEditor.click({ position: { x: 10, y: 10 } });
    const isMac = process.platform === 'darwin';
    await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expr);
    await this.page.waitForTimeout(600); // debounce
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Window / slice selectors
  // ──────────────────────────────────────────────────────────────────────────

  async selectWindow(seconds) {
    testLogger.info('Selecting window', { seconds });
    const selector = `[data-test="slos-addslo-window-${seconds}"]`;
    await this.page.locator(selector).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(selector).click();
    await this.page.waitForTimeout(300);
  }

  async selectSlice(seconds) {
    testLogger.info('Selecting slice', { seconds });
    const selector = `[data-test="slos-addslo-slice-${seconds}"]`;
    await this.page.locator(selector).waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(selector).click();
    await this.page.waitForTimeout(300);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Locator getters (for external assertions via expect)
  // ──────────────────────────────────────────────────────────────────────────

  getTitleLocator() {
    return this.page.locator(this.title);
  }

  getErrorBannerLocator() {
    return this.page.locator(this.errorBanner);
  }

  getRegenWarningLocator() {
    return this.page.locator(this.regenWarning);
  }

  getSliTypeDescLocator() {
    return this.page.locator(this.sliTypeDesc);
  }

  /** Language toggle group visibility on a branch */
  getLanguageToggleLocator(branch) {
    const sel = branch === 'count' ? this.countLanguageGroup : this.timesliceLanguageGroup;
    return this.page.locator(sel);
  }

  /** Individual language toggle item */
  getLanguageToggleItemLocator(branch, language) {
    return this.page.locator(`[data-test="slos-addslo-${branch}-language-${language}"]`);
  }

  getScopeLocator() {
    return this.page.locator(this.timesliceScope);
  }

  getAbsentNoteLocator() {
    return this.page.locator(this.timesliceAbsentNote);
  }

  getAggregateLocator() {
    return this.page.locator(this.timesliceAggregate);
  }

  getCountScopeLocator() {
    return this.page.locator(this.countScope);
  }

  getGoodExprLocator() {
    return this.page.locator(this.countGoodExpr);
  }

  getPromqlGoodLocator() {
    return this.page.locator(this.countPromqlGood);
  }

  getPromqlTotalLocator() {
    return this.page.locator(this.countPromqlTotal);
  }

  getRangeHintLocator() {
    return this.page.locator(this.countPromqlHint);
  }

  getPreviewSectionLocator() {
    return this.page.locator(this.countPreviewSection);
  }

  getTimeSlicePreviewSectionLocator() {
    return this.page.locator(this.timeslicePreviewSection);
  }

  getTimeSlicePreviewRootLocator() {
    return this.page.locator(this.timeslicePreviewRoot);
  }

  getTimeSlicePreviewEmptyLocator() {
    return this.page.locator(this.timeslicePreviewEmpty);
  }

  getAggregateInputValueLocator() {
    return this.page.locator(this.timesliceAggregate).locator('textarea').first();
  }

  getNameInputLocator() {
    // OInput inner native input gets data-test="<name>-field"
    return this.page.locator(this.nameInput.replace('"]', '-field"]'));
  }
}
