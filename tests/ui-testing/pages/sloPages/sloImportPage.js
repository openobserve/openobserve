// The folder picker is SelectFolderDropDown with type="alerts", hence the alerts-index-dropdown hooks.
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SloImportPage {
  constructor(page) {
    this.page = page;
    this.locators = {
      importJsonBtn: '[data-test="slo-import-json-btn"]',
      editor: '[data-test="slo-import-sql-editor"]',
      fileInputField: '[data-test="slo-import-json-file-input-field"]',
      folderTrigger: '[data-test="alerts-index-dropdown-stream_type-trigger"]',
      folderSearch: '[data-test="alerts-index-dropdown-stream_type-search"]',
      noResults: '[data-test="slo-import-no-results"]',
      anyResult: '[data-test^="slo-import-result-"]',
      toastMessage: '[data-test="o-toast-message"]',
    };
  }

  result(index) { return `[data-test="slo-import-result-${index}"]`; }
  folderOption(folderId) {
    return `[data-test="alerts-index-dropdown-stream_type-option"][data-test-value="${folderId}"]`;
  }

  async goto(orgId, folderId) {
    const folder = folderId ? `&folder=${encodeURIComponent(folderId)}` : '';
    await this.page.goto(`/web/slos/import?org_identifier=${orgId}${folder}`);
    await this.expectLoaded();
    testLogger.navigation('SLO import');
  }

  /** The editor is mounted and the folder fetch that gates Import has finished. */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/slos\/import/, { timeout: 30000 });
    await expect(this.page.locator(this.locators.editor)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.importJsonBtn)).toBeEnabled({ timeout: 30000 });
  }

  async selectFolder(folderId, folderName) {
    const trigger = this.page.locator(this.locators.folderTrigger);
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
    }).toPass({ timeout: 20000 });
    // The option list is virtualized, so narrow it before looking for the row.
    await this.page.locator(this.locators.folderSearch).fill(folderName);
    await this.page.locator(this.folderOption(folderId)).click();
    await this.expectFolderSelected(folderId);
  }

  /** Put text into the JSON editor and commit it to the page's model. */
  async pasteJson(text) {
    const wrapper = this.page.locator(this.locators.editor);
    await wrapper.waitFor({ state: 'visible', timeout: 15000 });
    await expect
      .poll(
        () => wrapper.evaluate((el, value) => {
          const editor = (window.monaco?.editor?.getEditors?.() ?? [])
            .find((ed) => el.contains(ed.getDomNode?.()));
          if (!editor) return null;
          editor.setValue(value);
          editor.focus();
          // Blur flushes the editor's change debounce, so the page holds the value now.
          document.activeElement?.blur();
          return editor.getValue();
        }, text),
        { timeout: 15000, intervals: [200, 500, 1000] },
      )
      .toBe(text);
  }

  /** Upload JSON through the file input; resolves once the editor shows it. */
  async uploadJsonFile(fileName, content, marker) {
    await this.page.locator(this.locators.fileInputField).setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(content, 'utf-8'),
    });
    await expect.poll(() => this.editorValue(), { timeout: 15000 }).toContain(marker);
  }

  async editorValue() {
    return this.page.locator(this.locators.editor).evaluate((el) => {
      const editor = (window.monaco?.editor?.getEditors?.() ?? [])
        .find((ed) => el.contains(ed.getDomNode?.()));
      return editor ? editor.getValue() : '';
    });
  }

  async clickImport() {
    const button = this.page.locator(this.locators.importJsonBtn);
    await expect(button).toBeEnabled({ timeout: 30000 });
    await button.click();
  }

  /** Import and wait for the page to return to the list on full success. */
  async importAndExpectList(folderId) {
    await this.clickImport();
    await this.page.waitForURL(
      (url) => url.pathname.endsWith('/slos') && url.searchParams.get('folder') === folderId,
      { timeout: 60000 },
    );
  }

  /** Import and wait until every per-item result has rendered and the run is over. */
  async importAndWaitForResults(count) {
    await this.clickImport();
    await expect(this.page.locator(this.result(count - 1))).toBeVisible({ timeout: 60000 });
    await expect(this.page.locator(this.locators.importJsonBtn)).toBeEnabled({ timeout: 60000 });
    await expect(this.page.locator(this.locators.anyResult)).toHaveCount(count);
  }

  async expectFolderSelected(folderId) {
    await expect(this.page.locator(this.locators.folderTrigger))
      .toHaveAttribute('data-test-selected-value', folderId, { timeout: 15000 });
  }

  async expectResultText(index, text) {
    await expect(this.page.locator(this.result(index))).toContainText(text, { timeout: 15000 });
  }

  async expectStillOnImport() {
    await expect(this.page).toHaveURL(/\/slos\/import/);
    await expect(this.page.locator(this.locators.importJsonBtn)).toBeVisible();
  }

  async expectNoResults() {
    await expect(this.page.locator(this.locators.noResults)).toBeVisible();
    await expect(this.page.locator(this.locators.anyResult)).toHaveCount(0);
  }

  async expectErrorToast(text) {
    await expect(
      this.page.locator(`[data-test-variant="error"] ${this.locators.toastMessage}`)
        .filter({ hasText: text }).first(),
    ).toBeVisible({ timeout: 15000 });
  }
}

export default SloImportPage;
