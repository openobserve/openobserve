// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');

/**
 * Page object for pipeline import/export, and for the functions a pipeline
 * bundles with it (Phase 2 of #13299).
 *
 * Owns the import screen (/web/pipeline/pipelines/import) — the JSON Monaco
 * editor, the run-import action and the per-pipeline result lines — plus the
 * list page's row and bulk export actions. Everything else about the list
 * (navigation, row assertions, delete) lives on `pipelinesPage`.
 */
class PipelineImportExportPage {
  constructor(page) {
    this.page = page;

    // ==================== Locators ====================

    // Import screen. BaseImport gets test-prefix="pipeline".
    this.importJsonButton = this.page.locator('[data-test="pipeline-import-json-btn"]');
    this.importSqlEditor = this.page.locator('[data-test="pipeline-import-sql-editor"]');
    this.importCancelButton = this.page.locator('[data-test="pipeline-import-cancel-btn"]');
    this.importCreationTitle = this.page.locator('[data-test="pipeline-import-creation-title"]');

    // List page
    this.bulkExportButton = this.page.locator('[data-test="pipeline-list-export-pipelines-btn"]');
    this.selectAllRowsCheckbox = this.page.locator('[data-test="o2-table-select-all"]');
    this.listSearchInput = this.page.locator('[data-test="pipeline-list-search-input"] input');

    // Toast
    this.toastMessage = this.page.locator('[data-test="o-toast-message"]');

    // ---- selectors ----
    // Row actions carry the pipeline's name and result lines their index, so
    // these are builders rather than fixed locators; the pattern still lives
    // here rather than inside the methods.
    this.rowMoreOptionsSelector = (name) => `[data-test="pipeline-list-${name}-more-options"]`;
    this.rowExportActionSelector = (name) => `[data-test="pipeline-list-${name}-export-action"]`;
    this.errorAtSelector = (itemIndex, errorIndex) =>
      `[data-test="pipeline-import-error-${itemIndex}-${errorIndex}"]`;
    this.creationLineSelector = '[data-test^="pipeline-import-creation-"]';
    this.creationMessageSelector =
      '[data-test^="pipeline-import-creation-"][data-test$="-message"]';
    this.errorLineSelector = '[data-test^="pipeline-import-error-"]';
    // Either kind of output means the import has finished talking.
    this.importOutputSelector = `${this.creationLineSelector}, ${this.errorLineSelector}`;
  }

  // ==================== Navigation ====================

  /** Navigate to the pipelines list. */
  async navigateToList(org) {
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/pipelines?org_identifier=${org}`,
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /** Navigate directly to the import route and wait for the JSON editor to mount. */
  async navigateToImport(org) {
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/pipelines/import?org_identifier=${org}`,
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.importSqlEditor.waitFor({ state: 'visible', timeout: 30000 });
  }

  // ==================== Export ====================

  /**
   * Export one pipeline through its row menu and return the parsed file.
   *
   * The row also carries a hidden `[data-row-action="export"]` proxy for the
   * hover shortcut; the menu item is the one a user actually clicks.
   */
  async exportPipelineByRow(name) {
    await this.page.locator(this.rowMoreOptionsSelector(name)).click();
    const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
    await this.page.locator(this.rowExportActionSelector(name)).click();
    return await downloadPromise;
  }

  /**
   * Narrow the list to rows matching `term`.
   *
   * select-all only ticks the current page, and the list pages at 20, so a shard
   * with enough pipelines can push the rows under test onto page two.
   */
  async searchPipelines(term) {
    await this.listSearchInput.fill(term);
    await expect
      .poll(async () => await this.page.locator('[data-test^="pipeline-list-"]').count(), {
        timeout: 15000,
        intervals: [250, 500],
      })
      .toBeGreaterThan(0);
  }

  /** Tick the header select-all box and wait for the bulk action to appear. */
  async selectAllRows() {
    await this.selectAllRowsCheckbox.click();
    await expect(
      this.bulkExportButton,
      'Selecting pipelines must reveal a bulk export action',
    ).toBeVisible({ timeout: 15000 });
  }

  /** Click the footer bulk-export button (only rendered when rows are selected). */
  async clickBulkExport() {
    const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
    await this.bulkExportButton.click();
    return await downloadPromise;
  }

  // ==================== Import ====================

  /** Write JSON into the import Monaco editor via window.monaco. */
  async setImportJsonViaMonaco(json) {
    await this._setMonacoValue(this.importSqlEditor, json);
  }

  /** Click the header "Import" button and leave the results on screen. */
  async runImport() {
    await this.importJsonButton.click();
  }

  /**
   * Click Import and wait for the screen to take itself back to the list.
   *
   * The screen creates each pipeline in turn — and, since Phase 2, the functions
   * each one bundles — and only redirects once every one of them has landed.
   * Navigating away under our own steam would cancel whatever was still in
   * flight and silently drop the trailing items.
   */
  async runImportAndWaitForList() {
    await this.importJsonButton.click();
    await this.page.waitForURL((url) => !url.pathname.includes('/pipelines/import'), {
      timeout: 90000,
    });
  }

  // ==================== Assertions ====================

  /**
   * Wait for the import to have said something — a result line or a validation
   * error.
   *
   * `runImport()` only clicks: the screen then validates and writes
   * asynchronously, and the Import button is visible throughout, so there is no
   * state to assert on in between. Reading the lines without this races the
   * import and sees an empty list.
   */
  async waitForImportOutcome() {
    await expect
      .poll(
        async () => await this.page.locator(this.importOutputSelector).count(),
        { timeout: 60000, intervals: [250, 500, 1000] },
      )
      .toBeGreaterThan(0);

    // The first line appears before the pipeline POST, so the list is still growing
    // here. The button is disabled for the duration, so its re-enabling is the only
    // signal that every line has been pushed.
    await expect(this.importJsonButton).toBeEnabled({ timeout: 60000 });
  }

  /**
   * Every result line, in the order the screen lists them.
   *
   * Reading the rendered text rather than the pushed value is the point: an error
   * or result whose shape the template has no branch for is shown to the user as
   * raw JSON, and only the DOM can tell you that happened.
   */
  async getCreationMessages() {
    return await this.page.locator(this.creationMessageSelector).allInnerTexts();
  }

  /** Every validation error line, as rendered. */
  async getImportErrors() {
    return await this.page.locator(this.errorLineSelector).allInnerTexts();
  }

  /** Assert a result line contains the given text, wherever it sits in the list. */
  async expectCreationMessage(text) {
    await expect(
      this.page.locator(this.creationLineSelector).filter({ hasText: text }).first(),
    ).toBeVisible({ timeout: 30000 });
  }

  /** Assert no result line mentions the given text. */
  async expectNoCreationMessage(text) {
    await expect(
      this.page.locator(this.creationLineSelector).filter({ hasText: text }),
    ).toHaveCount(0);
  }

  /** Assert a per-item validation error line is visible. */
  async expectImportError(itemIndex, errorIndex) {
    await expect(this.page.locator(this.errorAtSelector(itemIndex, errorIndex))).toBeVisible({
      timeout: 15000,
    });
  }

  /** Assert the import screen is still mounted (no redirect back to the list). */
  async expectStillOnImportScreen() {
    await expect(this.importJsonButton).toBeVisible({ timeout: 10000 });
    expect(this.page.url()).toContain('/pipelines/import');
  }

  /** Assert a toast surfaced with the given text. */
  async expectToast(text) {
    await expect(this.toastMessage.first()).toContainText(text, { timeout: 15000 });
  }

  // ==================== Internal helpers ====================

  /**
   * Drive a Monaco editor's value via window.monaco and wait for it to stick.
   * Same approach as functionsImportExportPage — keyboard.type never reaches
   * Monaco's hidden textarea headless.
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

module.exports = PipelineImportExportPage;
