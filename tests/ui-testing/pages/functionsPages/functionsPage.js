const { expect } = require('@playwright/test');

class FunctionsPage {
  constructor(page) {
    this.page = page;

    // ==================== Locators (All in constructor) ====================

    // Main page elements
    this.addFunctionButton = this.page.locator('[data-test="function-list-add-function-btn"]');
    // OInput wrapper for the list-page search field
    this.searchInputWrapper = this.page.locator('[data-test="functions-list-search-input"]');
    // OInput's auto-derived inner native input
    this.searchInputField = this.page.locator('[data-test="functions-list-search-input-field"]');
    // Bulk delete (footer) action — shown when rows are selected
    this.bulkDeleteButton = this.page.locator('[data-test="function-list-delete-functions-btn"]');
    // Per-row action buttons (resolved relative to a row locator)
    this.rowEditButtonSelector = '[data-test="function-list-edit-function-btn"]';
    this.rowDeleteButtonSelector = '[data-test="function-list-delete-function-btn"]';
    this.rowEditButton = this.page.locator(this.rowEditButtonSelector);
    this.rowDeleteButton = this.page.locator(this.rowDeleteButtonSelector);

    // Function type selection (Reka-UI radios — wrapper divs carry the data-test).
    // The inner RadioGroupItem renders data-state="checked|unchecked" — we read it
    // via page.evaluate scoped from the wrapper's data-test locator (no element-tag
    // or class selectors per AGENT_RULES §2).
    this.vrlRadio = this.page.locator('[data-test="function-transform-type-vrl-radio"]');
    this.jsRadio = this.page.locator('[data-test="function-transform-type-js-radio"]');

    // Function form elements
    this.functionNameInputWrapper = this.page.locator('[data-test="add-function-name-input"]');
    this.functionNameInputField = this.page.locator('[data-test="add-function-name-input-field"]');
    this.functionEditor = this.page.locator('[data-test="logs-vrl-function-editor"]');
    // Monaco mounts inside `data-test="query-editor"` (child of the function editor wrapper)
    this.functionEditorQueryDiv = this.page.locator('[data-test="logs-vrl-function-editor"] [data-test="query-editor"]');
    this.saveButton = this.page.locator('[data-test="add-function-save-btn"]');
    this.cancelButton = this.page.locator('[data-test="add-function-cancel-btn"]');
    this.testButton = this.page.locator('[data-test="add-function-test-btn"]');
    this.backButton = this.page.locator('[data-test="add-function-back-btn"]');

    // Test function elements
    this.testSection = this.page.locator('[data-test="test-function-section"]');
    this.testEventsEditor = this.page.locator('[data-test="vrl-function-test-events-editor"]');
    this.testEventsEditorQueryDiv = this.page.locator('[data-test="vrl-function-test-events-editor"] [data-test="query-editor"]');
    this.testOutputEditor = this.page.locator('[data-test="vrl-function-test-events-output-editor"]');

    // Confirm dialog (delete confirmation) — primary/secondary buttons
    this.confirmDialog = this.page.locator('[data-test="confirm-dialog"]');
    this.confirmDialogPrimaryBtn = this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
    this.confirmDialogSecondaryBtn = this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]');
  }

  // ==================== Locator factories (runtime-dynamic) ====================

  /**
   * Locator for the unique per-row function-name cell. FunctionList.vue
   * `#cell-name` slot renders one span per row tagged with
   * `data-test="function-list-name-cell-<name>"` (guaranteed unique per row).
   */
  getFunctionNameCell(name) {
    return this.page.locator(`[data-test="function-list-name-cell-${name}"]`);
  }

  /**
   * Get a row locator for a function by name. Walks up from the unique
   * name-cell to the OTable row using the `o2-table-row-*` data-test prefix.
   * @param {string} name
   */
  getRowByName(name) {
    return this.getFunctionNameCell(name).locator(
      'xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]'
    );
  }

  // ==================== Navigation Methods ====================

  async navigate(org = null) {
    const targetOrg = org || process.env.ORGID;
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`);
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(2000);
  }

  // ==================== Action Methods ====================

  /**
   * Click Add Function button with auto-recovery
   * @param {string} [org] - Optional org to navigate to if button isn't visible (use '_meta' for JS functions)
   */
  async clickAddFunctionButton(org = null) {
    // Wait for page to stabilize (in case we just closed a dialog)
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(500);

    // Quick check if button is visible - if not, navigate to ensure we're on list page
    const isVisible = await this.addFunctionButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      // Navigate to functions page (uses provided org or current URL's org)
      const targetOrg = org || this.getCurrentOrgFromUrl() || process.env.ORGID;
      await this.page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    }

    await expect(this.addFunctionButton).toBeVisible({ timeout: 10000 });
    await this.addFunctionButton.click();
    // Wait for the function dialog to actually open
    await expect(this.functionNameInputField).toBeVisible({ timeout: 10000 });
  }

  /**
   * Extract org identifier from current URL
   */
  getCurrentOrgFromUrl() {
    const url = this.page.url();
    const match = url.match(/org_identifier=([^&]+)/);
    return match ? match[1] : null;
  }

  async selectJavaScriptType() {
    // ORadio forwards the consumer's data-test onto the inner RadioGroupItem
    // (the ARIA-focusable radio button) — `this.jsRadio` IS the clickable item.
    await expect(this.jsRadio).toBeVisible();
    await this.jsRadio.click();
    // Wait for CodeQueryEditor to remount Monaco for the new language
    // (editor-id is re-keyed on currentLanguage in QueryEditor.vue)
    await this.page.waitForTimeout(1500);
  }

  async selectVRLType() {
    await expect(this.vrlRadio).toBeVisible();
    await this.vrlRadio.click();
    await this.page.waitForTimeout(1500);
  }

  async fillFunctionName(name) {
    // OInput convention: fill the auto-derived `-field` (native input), not the wrapper
    await expect(this.functionNameInputField).toBeVisible({ timeout: 15000 });
    await this.functionNameInputField.fill(name);
  }

  async enterFunctionCode(code) {
    // Drive the Monaco editor value via window.monaco APIs per AGENT_RULES §5.
    // Find the editor whose DOM node is inside the function-editor wrapper, then setValue.
    // On headless Linux, clicking the wrapper div doesn't transfer focus to Monaco's
    // internal textarea, so keyboard.type() sends keystrokes to nothing.
    await this.functionEditorQueryDiv.waitFor({ state: 'visible', timeout: 10000 });
    // CodeQueryEditor remounts the Monaco editor when language changes (transType
    // toggle re-keys editor-id), so we poll until a fresh, non-disposed editor
    // inside the wrapper accepts the value and the model reflects it.
    await expect
      .poll(
        async () =>
          await this.functionEditor.evaluate((el, text) => {
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
          }, code),
        { timeout: 10000, intervals: [200, 500, 1000] },
      )
      .toBe(code);
    // Wait longer than the Monaco editor's 500ms debounce so formData syncs via v-model
    await this.page.waitForTimeout(1000);
  }

  async clickSaveButton() {
    await this.saveButton.click();
    await this.page.waitForTimeout(2000);
  }

  async clickCancelButton() {
    await this.cancelButton.click();
    await this.page.waitForTimeout(1500); // Wait for dialog to fully close
  }

  async clickTestButton() {
    // force: true needed — button can be obscured by overlapping editor chrome
    await this.testButton.click({ force: true });
    await this.page.waitForTimeout(1000);
  }

  async searchFunction(name) {
    // OInput convention: fill the auto-derived `-field` (native input), not the wrapper
    await expect(this.searchInputWrapper).toBeVisible();
    await this.searchInputField.fill(name);
    await this.page.waitForTimeout(1000);
  }

  async clickFunctionByName(name) {
    // Walk from the name-cell up to the OTable row's data-test prefix,
    // then click the per-row edit button using its stable data-test.
    const functionRow = this.getRowByName(name);
    const editButton = functionRow.locator(this.rowEditButtonSelector);
    // After a cross-org (_meta) navigation the functions list can take a while
    // to stream in — wait for the row's edit button before clicking so a slow
    // list render doesn't fail the click.
    await editButton.waitFor({ state: 'visible', timeout: 30000 });
    await editButton.click();
    await this.page.waitForTimeout(1000);
  }

  async deleteFirstFunction() {
    // Use the per-row delete button (visible in each table row)
    const deleteBtn = this.rowDeleteButton.first();
    if (await deleteBtn.isVisible({ timeout: 2000 })) {
      await deleteBtn.click();
      await this.page.waitForTimeout(500);

      // Confirm deletion via ODialog primary button (scoped under ConfirmDialog)
      if (await this.confirmDialogPrimaryBtn.isVisible({ timeout: 2000 })) {
        await this.confirmDialogPrimaryBtn.click();
        await this.page.waitForTimeout(500);
      }
    }
  }

  // ==================== Test Function Methods ====================

  async enterTestEvent(eventJson) {
    // Drive the Monaco editor value via window.monaco APIs per AGENT_RULES §5.
    // Find the editor whose DOM node is inside the test-events-editor wrapper, then setValue.
    // Using setValue() ensures the v-model sync fires even on headless Linux where
    // focus + keyboard.type would otherwise be unreliable.
    await this.testEventsEditorQueryDiv.waitFor({ state: 'visible', timeout: 10000 });
    await this.testEventsEditor.evaluate((el, text) => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        if (node && el.contains(node)) {
          ed.setValue(text);
          ed.focus();
          return;
        }
      }
    }, eventJson);
    // Wait for Monaco editor v-model debounce to sync
    await this.page.waitForTimeout(600);
  }

  async clickRunTestButton() {
    // The toolbar "Test Function" button (`add-function-test-btn`) is the only
    // run-test trigger — it invokes the TestFunction component's testFunction()
    // via ref and POSTs to /api/{org}/functions/test, populating the output editor.
    if (await this.testButton.isVisible({ timeout: 2000 })) {
      // The spec calls clickTestButton() (which already fires a test request with the
      // pre-existing default events) BEFORE entering the custom test event and then
      // calls clickRunTestButton() to fire a SECOND request. The output editor still
      // holds the first request's payload, so we can't just poll on length > 10 —
      // we'd resolve on the stale value before the second response lands and overwrites
      // it (e.g. with "Error in testing function" on a backend reject). Tie the click
      // to a fresh `/functions/test` response via Promise.all + page.waitForResponse so
      // we read the model only after THIS click's request resolves on the client.
      const testApiResponse = this.page.waitForResponse(
        (response) =>
          response.url().includes('/functions/test') && response.request().method() === 'POST',
        { timeout: 15000 },
      );
      // force: true needed — button can be obscured by overlapping editor chrome
      await Promise.all([testApiResponse, this.testButton.click({ force: true })]);
      // After the network call returns, TestFunction.vue runs the success/error
      // handler synchronously (then() or catch()) and sets outputEvents.value;
      // Monaco's v-model debounce (500 ms) then flushes that into the model.
      // Poll the model for the post-debounce value (>10 chars distinguishes real
      // content / error text from an empty editor).
      await expect
        .poll(async () => (await this.getTestOutput()).length, {
          timeout: 15000,
          intervals: [200, 500, 1000],
        })
        .toBeGreaterThan(10);
      return true;
    }
    return false;
  }

  async getTestOutput() {
    // Read the Monaco model bound to the output editor wrapper directly per §5.
    // Falls back to .textContent only if Monaco isn't attached yet.
    return await this.testOutputEditor.evaluate((el) => {
      try {
        const editors = window.monaco?.editor?.getEditors?.() ?? [];
        for (const ed of editors) {
          const node = ed.getDomNode?.();
          if (node && el.contains(node)) {
            return ed.getValue();
          }
        }
      } catch (e) {}
      // Fallback when Monaco not initialized yet
      return el.textContent || '';
    });
  }

  // ==================== Assertion Methods ====================

  async expectAddButtonVisible() {
    await expect(this.addFunctionButton).toBeVisible({ timeout: 10000 });
  }

  async expectVrlRadioVisible() {
    await expect(this.vrlRadio).toBeVisible();
  }

  async expectJsRadioVisible() {
    await expect(this.jsRadio).toBeVisible();
  }

  async expectJsRadioSelected() {
    // ORadio forwards the consumer's data-test onto the inner RadioGroupItem,
    // which Reka-UI exposes via `data-state="checked|unchecked"`.
    await this.jsRadio.waitFor({ state: 'visible' });
    await expect(this.jsRadio).toHaveAttribute('data-state', 'checked');
  }

  async expectVrlRadioSelected() {
    await this.vrlRadio.waitFor({ state: 'visible' });
    await expect(this.vrlRadio).toHaveAttribute('data-state', 'checked');
  }

  async expectTestOutputContains(text) {
    const outputText = await this.getTestOutput();
    expect(outputText).toContain(text);
  }

  async expectFunctionInList(functionName) {
    const functionRow = this.getRowByName(functionName);
    await expect(functionRow).toBeVisible({ timeout: 10000 });
  }

  async isCancelButtonVisible() {
    return await this.cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
  }

  async getEditorContent() {
    // Drive Monaco editor value via window.monaco — do NOT scrape .view-lines
    return await this.functionEditor.evaluate((el) => {
      try {
        const editors = window.monaco?.editor?.getEditors?.() ?? [];
        // Find the editor whose DOM node is inside this container
        for (const ed of editors) {
          const node = ed.getDomNode?.();
          if (node && el.contains(node)) {
            return ed.getValue();
          }
        }
        return '';
      } catch (e) {
        return '';
      }
    });
  }

  async isJsRadioVisible() {
    return await this.jsRadio.isVisible().catch(() => false);
  }

  async expectJsRadioHidden() {
    await expect(this.jsRadio).not.toBeVisible();
  }

  // ==================== Complex Workflows ====================

  /**
   * Complete workflow to create a JS function
   * NOTE: JS functions only work in _meta org, so this defaults to _meta for recovery
   * @param {string} functionName - Name of the function
   * @param {string} jsCode - JavaScript code
   */
  async createJavaScriptFunction(functionName, jsCode) {
    await this.clickAddFunctionButton('_meta'); // JS functions require _meta org
    await this.fillFunctionName(functionName);
    await this.selectJavaScriptType();
    await this.enterFunctionCode(jsCode);
    await this.clickSaveButton();
  }

  /**
   * Complete workflow to create a VRL function
   * @param {string} functionName - Name of the function
   * @param {string} vrlCode - VRL code
   * @param {string} [org] - Optional org identifier for recovery navigation
   */
  async createVRLFunction(functionName, vrlCode, org = null) {
    await this.clickAddFunctionButton(org);
    await this.fillFunctionName(functionName);
    await this.selectVRLType();
    await this.enterFunctionCode(vrlCode);
    await this.clickSaveButton();
  }

  /**
   * Delete a function by name
   * @param {string} functionName - Name of the function to delete
   * @param {string} [org] - Optional org identifier (defaults to ORGID, use '_meta' for JS functions)
   */
  async deleteFunctionByName(functionName, org = null) {
    // Make sure we're on the functions list page (not in edit mode)
    const isOnListPage = await this.searchInputWrapper.isVisible({ timeout: 2000 }).catch(() => false);

    if (!isOnListPage) {
      // Navigate back to functions list with correct org
      const targetOrg = org || process.env.ORGID;
      await this.page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(2000);
    }

    await this.searchFunction(functionName);
    await this.deleteFirstFunction();
  }

  /**
   * Test a function with input data and return output.
   * The toolbar "Test Function" button directly triggers the API call using
   * the current function code and events editor content. Default test events
   * are loaded by the TestFunction component on mount.
   * @param {string} [testEventJson] - Optional custom test event JSON (entered before triggering test)
   * @returns {Promise<string>} Test output
   */
  async testFunctionExecution(testEventJson = null) {
    // The TestFunction component is always visible (rendered in splitter v-slot:after).
    // If custom events provided, enter them before triggering the test.
    if (testEventJson) {
      await this.enterTestEvent(testEventJson);
    }

    // The toolbar "Test Function" button calls testFunction() on the TestFunction
    // component, which POSTs to /api/{org}/functions/test and populates the output editor.
    await this.clickTestButton();

    // Poll the Monaco output model directly (>10 chars distinguishes real
    // content from an empty/initial editor); avoids DOM .view-line scraping.
    await expect
      .poll(async () => (await this.getTestOutput()).length, {
        timeout: 15000,
        intervals: [200, 500, 1000],
      })
      .toBeGreaterThan(10);

    return await this.getTestOutput();
  }

  /**
   * Navigate to function, edit it, and verify type
   * @param {string} functionName - Name of the function
   * @returns {Promise<'js'|'vrl'|null>} Function type
   */
  async openFunctionAndCheckType(functionName) {
    await this.searchFunction(functionName);
    await this.clickFunctionByName(functionName);

    // Wait for the editor to load after clicking the function
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(2000);

    // Wait for radio buttons to be visible
    await this.jsRadio.waitFor({ state: 'visible', timeout: 10000 });

    // ORadio forwards the consumer's data-test onto the inner RadioGroupItem,
    // which Reka-UI exposes via `data-state="checked|unchecked"`.
    const jsState = await this.jsRadio.getAttribute('data-state');
    const vrlState = await this.vrlRadio.getAttribute('data-state');

    if (jsState === 'checked') return 'js';
    if (vrlState === 'checked') return 'vrl';
    return null;
  }

  // ==================== Cleanup Methods ====================

  /**
   * Delete all functions matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'test_js_')
   */
  async deleteAllFunctionsMatching(pattern) {
    await this.searchFunction(pattern);
    await this.page.waitForTimeout(1000);

    // Delete all visible functions matching pattern with max attempts safety
    const maxAttempts = 50;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const deleteBtn = this.bulkDeleteButton.first();
      if (await deleteBtn.isVisible({ timeout: 2000 })) {
        await deleteBtn.click();
        await this.page.waitForTimeout(500);

        if (await this.confirmDialogPrimaryBtn.isVisible({ timeout: 2000 })) {
          await this.confirmDialogPrimaryBtn.click();
          await this.page.waitForTimeout(1000);
        }
        attempts++;
      } else {
        break; // No more functions to delete
      }
    }
  }
}

module.exports = FunctionsPage;
