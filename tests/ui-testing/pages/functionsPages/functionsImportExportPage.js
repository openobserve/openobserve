// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');

/**
 * Page object for the Functions Import & Export feature.
 *
 * Covers the import screen (/web/pipeline/functions/import) — the JSON Monaco
 * editor, the run-import action, and the inline fix-up controls that render for
 * rejected items — and the list page's single/bulk export actions.
 *
 * List-side navigation/assertion helpers (search, expect-in-list, row lookup)
 * live on `functionsPage`; this object only owns the import/export surface so
 * the two concerns stay separate.
 */
class FunctionsImportExportPage {
  constructor(page) {
    this.page = page;

    // ==================== Locators ====================

    // Import screen
    this.importJsonButton = this.page.locator('[data-test="function-import-json-btn"]');
    this.importSqlEditor = this.page.locator('[data-test="function-import-sql-editor"]');
    this.importCancelButton = this.page.locator('[data-test="function-import-cancel-btn"]');
    this.importResultsTitle = this.page.locator('[data-test="function-import-results-title"]');

    // BaseImport source tabs (test-prefix="function" => AppTabs values below)
    this.fileUploadTab = this.page.locator('[data-test="tab-import_json_file"]');
    this.urlImportTab = this.page.locator('[data-test="tab-import_json_url"]');
    // OFile/OInput forward the consumer data-test onto the real control as `-field`.
    this.importFileInput = this.page.locator('[data-test="function-import-json-file-input-field"]');
    this.importUrlInput = this.page.locator('[data-test="function-import-url-input-field"]');

    // List page
    this.listImportButton = this.page.locator('[data-test="function-list-import-function-btn"]');
    this.rowMoreActionsSelector = '[data-test="function-list-row-more-actions"]';
    this.rowExportMenuItem = this.page.locator('[data-test="function-list-export-function-btn-menu"]');

    // Export (list page)
    this.bulkExportButton = this.page.locator('[data-test="function-list-export-functions-btn"]');
    this.rowExportButtonSelector = '[data-test="function-list-export-function-btn"]';

    // Toast
    this.toastMessage = this.page.locator('[data-test="o-toast-message"]');
  }

  // ==================== Navigation ====================

  /**
   * Navigate directly to the import route and wait for the JSON editor to mount.
   */
  async navigateToImport(org) {
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions/import?org_identifier=${org}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.importSqlEditor.waitFor({ state: 'visible', timeout: 30000 });
  }

  // ==================== Import JSON input ====================

  /**
   * Write JSON into the import Monaco editor via window.monaco. Headless-safe —
   * keyboard.type never reaches Monaco's hidden textarea.
   */
  async setImportJsonViaMonaco(json) {
    await this._setMonacoValue(this.importSqlEditor, json);
  }

  /** Click the header "Import" button. */
  async runImport() {
    await this.importJsonButton.click();
  }

  /**
   * Click Import and wait for the screen to take itself back to the list.
   *
   * The screen writes each item in turn and only redirects once every one of
   * them has been written, so this is the signal that the import is finished.
   * Navigating away under our own steam instead would cancel whichever POSTs
   * were still in flight — with a multi-item file that silently drops the
   * trailing items.
   */
  async runImportAndWaitForList() {
    await this.importJsonButton.click();
    await this.page.waitForURL((url) => !url.pathname.includes('/functions/import'), {
      timeout: 90000,
    });
  }

  // ==================== Import fix-up controls ====================

  /** Type a replacement name into an item's rename control. */
  async renameImportItem(itemIndex, name) {
    const field = this.page.locator(`[data-test="function-import-name-input-${itemIndex}-field"]`);
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(name);
  }

  /** Write a new body into an item's body editor via window.monaco. */
  async setImportBody(itemIndex, body) {
    const wrapper = this.page.locator(`[data-test="function-import-body-input-${itemIndex}"]`);
    await this._setMonacoValue(wrapper, body);
  }

  /** Tick an item's "replace existing function" checkbox. */
  async overrideImportItem(itemIndex) {
    const checkbox = this.page
      .locator(`[data-test="function-import-override-checkbox-${itemIndex}"]`)
      .getByRole('checkbox');
    await checkbox.waitFor({ state: 'visible', timeout: 15000 });
    await checkbox.click();
  }

  // ==================== Export ====================

  /** Click the per-row export button for a function (by name). */
  async clickSingleExport(name) {
    const row = this._rowByName(name);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.locator(this.rowExportButtonSelector).click();
  }

  /** Select a function's row checkbox (for bulk actions). */
  async selectFunctionRow(name) {
    const row = this._rowByName(name);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.locator('[data-test="o2-table-select-cell"]').getByRole('checkbox').click();
  }

  /** Click the footer bulk-export button (only rendered when rows are selected). */
  async clickBulkExport() {
    await this.bulkExportButton.click();
  }

  // ==================== Import source tabs ====================

  /** Switch to the "File Upload" source tab and wait for the editor to remount. */
  async switchToFileTab() {
    await this.fileUploadTab.click();
    await this.importSqlEditor.waitFor({ state: 'visible', timeout: 15000 });
  }

  /** Switch to the "URL Import" source tab and wait for the editor to remount. */
  async switchToUrlTab() {
    await this.urlImportTab.click();
    await this.importUrlInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Import from a real .json file through the file chooser. Exercises the
   * FileReader path that pasting into Monaco skips.
   */
  async uploadImportFile(filePath) {
    await this.importFileInput.setInputFiles(filePath);
    // BaseImport reads the file and writes it into the editor; wait for that.
    await expect
      .poll(async () => (await this._readMonacoValue(this.importSqlEditor))?.length ?? 0, {
        timeout: 15000,
        intervals: [200, 500, 1000],
      })
      .toBeGreaterThan(0);
  }

  /**
   * Fill the URL field on the URL Import tab. BaseImport watches `url` and
   * axios-GETs it, so the editor fills itself once the response lands.
   */
  async fillImportUrl(url) {
    await this.importUrlInput.fill(url);
    await this.importUrlInput.blur();
    await expect
      .poll(async () => (await this._readMonacoValue(this.importSqlEditor))?.length ?? 0, {
        timeout: 20000,
        intervals: [200, 500, 1000],
      })
      .toBeGreaterThan(0);
  }

  // ==================== List-page affordances ====================

  /** Open a row's overflow ("more actions") menu — the narrow-viewport home of Export. */
  async openRowMoreActions(name) {
    const row = this._rowByName(name);
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await row.locator(this.rowMoreActionsSelector).click();
  }

  /** Click Export from inside a row's overflow menu. */
  async clickExportFromRowMenu(name) {
    await this.openRowMoreActions(name);
    await this.rowExportMenuItem.click();
  }

  // ==================== Assertions ====================

  /** Assert a specific per-item validation/rejection error line is visible. */
  async expectImportError(itemIndex, errorIndex) {
    await expect(
      this.page.locator(`[data-test="function-import-error-${itemIndex}-${errorIndex}"]`),
    ).toBeVisible({ timeout: 15000 });
  }

  /** Assert an item's "replace existing function" checkbox is visible. */
  async expectOverrideCheckboxVisible(itemIndex) {
    await expect(
      this.page.locator(`[data-test="function-import-override-checkbox-${itemIndex}"]`),
    ).toBeVisible({ timeout: 15000 });
  }

  /** Assert a toast surfaced with the given (stable, i18n) message text. */
  async expectToast(text) {
    await expect(this.toastMessage.first()).toContainText(text, { timeout: 15000 });
  }

  /** Assert some toast surfaced (used where the message text is browser-dependent). */
  async expectToastVisible() {
    await expect(this.toastMessage.first()).toBeVisible({ timeout: 15000 });
  }

  /** Assert the import wrote nothing (no per-item result line rendered). */
  async expectNoImportResult() {
    await expect(this.page.locator('[data-test="function-import-result-0"]')).toHaveCount(0);
  }

  /** Assert the footer bulk-export button is visible (selection active). */
  async expectBulkExportVisible() {
    await expect(this.bulkExportButton).toBeVisible({ timeout: 15000 });
  }

  /** Assert the affected-pipelines warning names a pipeline. */
  async expectOverrideDependents(itemIndex, pipelineName) {
    await expect(
      this.page.locator(`[data-test="function-import-override-dependents-${itemIndex}"]`),
    ).toContainText(pipelineName, { timeout: 15000 });
  }

  /** Assert the affected-pipelines warning is not rendered. */
  async expectOverrideDependentsHidden(itemIndex) {
    await expect(
      this.page.locator(`[data-test="function-import-override-dependents-${itemIndex}"]`),
    ).toHaveCount(0);
  }

  /** Assert a specific per-item result line contains the given text. */
  async expectImportResult(itemIndex, text) {
    await expect(
      this.page.locator(`[data-test="function-import-result-${itemIndex}"]`),
    ).toContainText(text, { timeout: 15000 });
  }

  /**
   * Wait for a started import to finish writing.
   *
   * The Import button is disabled for the duration of the run, so its
   * re-enabling is the only signal every result line has been pushed. Absence
   * assertions are meaningless before this: `toHaveCount(0)` is satisfied
   * immediately, before the controls have rendered.
   */
  async waitForImportSettled() {
    await expect(this.importJsonButton).toBeEnabled({ timeout: 60000 });
  }

  /** Assert an item was NOT offered as an inline-fixable error. */
  async expectNoImportError(itemIndex, errorIndex) {
    await expect(
      this.page.locator(`[data-test="function-import-error-${itemIndex}-${errorIndex}"]`),
    ).toHaveCount(0);
  }

  /** Assert neither the language control nor the body editor is offered for an item. */
  async expectNoInlineFixControls(itemIndex) {
    await expect(
      this.page.locator(`[data-test="function-import-trans-type-input-${itemIndex}"]`),
    ).toHaveCount(0);
    await expect(
      this.page.locator(`[data-test="function-import-body-input-${itemIndex}"]`),
    ).toHaveCount(0);
  }

  /** Assert the import screen is still mounted (no redirect back to the list). */
  async expectStillOnImportScreen() {
    await expect(this.importJsonButton).toBeVisible({ timeout: 10000 });
    expect(this.page.url()).toContain('/functions/import');
  }

  /** Assert the list page's header Import button is visible. */
  async expectListImportButtonVisible() {
    await expect(this.listImportButton).toBeVisible({ timeout: 15000 });
  }

  /** Read the JSON currently held by the import editor. */
  async getImportEditorValue() {
    return await this._readMonacoValue(this.importSqlEditor);
  }

  // ==================== Internal helpers ====================

  /** Locate the OTable row (`<tr>`) that contains a function's unique name cell. */
  _rowByName(name) {
    return this.page
      .locator('tr')
      .filter({ has: this.page.locator(`[data-test="function-list-name-cell-${name}"]`) });
  }

  /** Read a Monaco editor's current value through window.monaco. */
  async _readMonacoValue(wrapper) {
    await wrapper.waitFor({ state: 'visible', timeout: 15000 });
    return await wrapper.evaluate((el) => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        if (node && el.contains(node)) return ed.getValue();
      }
      return null;
    });
  }

  /**
   * Drive a Monaco editor's value via window.monaco and wait for it to stick.
   * The wrapper locator must enclose the editor's DOM node (QueryEditor root).
   */
  async _setMonacoValue(wrapper, value) {
    await wrapper.waitFor({ state: 'visible', timeout: 15000 });
    await expect
      .poll(
        async () =>
          await wrapper.evaluate((el, text) => {
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            let target = null;
            for (const ed of editors) {
              const node = ed.getDomNode?.();
              if (node && el.contains(node)) target = ed;
            }
            if (!target) return null;
            target.setValue(text);
            target.focus();
            return target.getValue();
          }, value),
        { timeout: 15000, intervals: [200, 500, 1000] },
      )
      .toBe(value);
    // Let Monaco's debounce flush the value into the v-model before acting.
    await this.page.waitForTimeout(1000);
  }
}

module.exports = FunctionsImportExportPage;
