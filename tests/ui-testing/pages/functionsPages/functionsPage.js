const { expect } = require('@playwright/test');

class FunctionsPage {
  constructor(page) {
    this.page = page;
  }

  // ==================== Locators (All at top) ====================

  // Main page elements
  addFunctionButton = '[data-test="function-list-add-function-btn"]';
  searchInput = '[data-test="functions-list-search-input"]';
  deleteButton = '[data-test="function-list-delete-functions-btn"]';

  // Function type selection
  vrlRadio = '[data-test="function-transform-type-vrl-radio"]';
  jsRadio = '[data-test="function-transform-type-js-radio"]';

  // Function form elements
  functionNameInput = '[data-test="add-function-name-input"]';
  functionEditor = '[data-test="logs-vrl-function-editor"]';
  saveButton = '[data-test="add-function-save-btn"]';
  cancelButton = '[data-test="add-function-cancel-btn"]';
  testButton = '[data-test="add-function-test-btn"]';
  backButton = '[data-test="add-function-back-btn"]';

  // Test function elements
  testSection = '[data-test="test-function-section"]';
  testEventsEditor = '[data-test="vrl-function-test-events-editor"]';
  testOutputEditor = '[data-test="vrl-function-test-events-output-editor"]';

  // ==================== Navigation Methods ====================

  async navigate(org = null) {
    // Functions is under Pipeline menu
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

    const addButton = this.page.locator(this.addFunctionButton);

    // Quick check if button is visible - if not, navigate to ensure we're on list page
    const isVisible = await addButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      // Navigate to functions page (uses provided org or current URL's org)
      const targetOrg = org || this.getCurrentOrgFromUrl() || process.env.ORGID;
      await this.page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
    }

    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();
    // Wait for the function dialog to actually open
    const nameInput = this.page.locator(this.functionNameInput);
    await expect(nameInput).toBeVisible({ timeout: 10000 });
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
    // The data-test attribute is on the wrapper div
    // Need to click the .q-radio element with role="radio" inside
    const jsRadioWrapper = this.page.locator(this.jsRadio);
    await expect(jsRadioWrapper).toBeVisible();
    // Click the q-radio component that has role="radio"
    const radioElement = jsRadioWrapper.locator('.q-radio[role="radio"]');
    await radioElement.click();
    await this.page.waitForTimeout(500);
  }

  async selectVRLType() {
    const vrlRadio = this.page.locator(this.vrlRadio);
    await expect(vrlRadio).toBeVisible();
    await vrlRadio.click();
    await this.page.waitForTimeout(500);
  }

  async fillFunctionName(name) {
    const nameInput = this.page.locator(this.functionNameInput);
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill(name);
  }

  async enterFunctionCode(code) {
    // Set Monaco editor content programmatically to avoid keyboard/auto-completion
    // issues in headless CI. Same pattern used in pipelinesEP.js.
    await this.page.locator(this.functionEditor).waitFor({ state: 'visible' });
    await this.page.waitForTimeout(500);

    const success = await this.page.evaluate((args) => {
      const [selector, value] = args;
      const container = document.querySelector(selector);
      if (!container) return false;

      // 1. Try getEditorByDomElement — scoped to our container (most reliable)
      const monacoEditorEl = container.querySelector('.monaco-editor');
      if (monacoEditorEl) {
        const editor = window.monaco?.editor?.getEditorByDomElement?.(monacoEditorEl);
        if (editor) {
          editor.setValue(value);
          return true;
        }
        // 2. Try __vscode_monaco_editor__ property on the DOM element
        if (monacoEditorEl.__vscode_monaco_editor__) {
          monacoEditorEl.__vscode_monaco_editor__.setValue(value);
          return true;
        }
      }

      // 3. Iterate all editors and find the one whose DOM node is inside our container
      const editors = window.monaco?.editor?.getEditors?.();
      if (editors && editors.length > 0) {
        for (const ed of editors) {
          if (container.contains(ed.getDomNode?.())) {
            ed.setValue(value);
            return true;
          }
        }
      }

      return false;
    }, [this.functionEditor, code]);

    if (!success) {
      // Fallback to keyboard typing if programmatic approach fails
      const textarea = this.page.locator(`${this.functionEditor} textarea`);
      await textarea.focus();
      await this.page.waitForTimeout(300);
      const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
      await this.page.keyboard.press(selectAll);
      await this.page.keyboard.press('Backspace');
      await this.page.waitForTimeout(200);
      await this.page.keyboard.type(code);
    }

    // Wait longer than the Monaco editor's 500ms debounce so formData syncs via v-model
    await this.page.waitForTimeout(1000);
  }

  async clickSaveButton() {
    const saveButton = this.page.locator(this.saveButton);
    await saveButton.click();

    // Wait for any notification to appear (success or error).
    // Use a broad selector — the backend message text varies, so avoid text filters.
    const notification = this.page.locator('.q-notification').first();
    await notification.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    // Wait for the Add Function button to reappear (indicates save completed and we're back on list).
    // No .catch here — if this times out the save did not complete and the test should fail clearly.
    const addButton = this.page.locator(this.addFunctionButton);
    await expect(addButton).toBeVisible({ timeout: 15000 });
  }

  /**
   * Click save and wait for an error notification to appear.
   * Use this instead of clickSaveButton() when the save is expected to fail
   * (e.g. invalid/empty code) so the form stays open and the list-page add
   * button never reappears.
   */
  async clickSaveButtonExpectError() {
    const saveButton = this.page.locator(this.saveButton);
    await saveButton.click();

    // Wait for an error notification; .catch keeps the test flowing if none appears.
    const notification = this.page.locator('.q-notification').first();
    await notification.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  async clickCancelButton() {
    const cancelButton = this.page.locator(this.cancelButton);
    await cancelButton.click();
    await this.page.waitForTimeout(1500); // Wait for dialog to fully close
  }

  async clickTestButton() {
    const testButton = this.page.locator(this.testButton);
    // force: true needed — button can be obscured by overlapping editor chrome
    await testButton.click({ force: true });
    await this.page.waitForTimeout(1000);
  }

  async searchFunction(name) {
    // The data-test attribute is on the wrapper div, need to target the input inside
    const searchInputWrapper = this.page.locator(this.searchInput);
    await expect(searchInputWrapper).toBeVisible();
    // Target the actual q-input element inside the wrapper
    const inputField = searchInputWrapper.locator('input');
    await inputField.fill(name);
    await this.page.waitForTimeout(1000);
  }

  async clickFunctionByName(name) {
    // Find the row containing the function name and click its edit button.
    // 30 s timeout: the reactive filter re-applies when data arrives, so this correctly
    // handles slow CI where the list API responds after the search field is filled.
    const functionRow = this.page.locator('tr').filter({ hasText: name }).first();
    await expect(functionRow).toBeVisible({ timeout: 30000 });
    const editButton = functionRow.locator('[data-test="function-list-edit-btn"]');
    await editButton.click();
    await this.page.waitForTimeout(1000);
  }

  async deleteFirstFunction() {
    const deleteBtn = this.page.locator(this.deleteButton).first();
    if (await deleteBtn.isVisible({ timeout: 2000 })) {
      await deleteBtn.click();
      await this.page.waitForTimeout(500);

      // Confirm deletion
      const confirmButton = this.page.getByRole('button', { name: 'OK' });
      if (await confirmButton.isVisible({ timeout: 1000 })) {
        await confirmButton.click();
        await this.page.waitForTimeout(500);
      }
    }
  }

  // ==================== Test Function Methods ====================

  async enterTestEvent(eventJson) {
    // Set Monaco editor content programmatically to avoid keyboard issues in headless CI.
    await this.page.locator(this.testEventsEditor).waitFor({ state: 'visible' });
    await this.page.waitForTimeout(500);

    const success = await this.page.evaluate((args) => {
      const [selector, value] = args;
      const container = document.querySelector(selector);
      if (!container) return false;

      // 1. Try getEditorByDomElement — scoped to our container (most reliable)
      const monacoEditorEl = container.querySelector('.monaco-editor');
      if (monacoEditorEl) {
        const editor = window.monaco?.editor?.getEditorByDomElement?.(monacoEditorEl);
        if (editor) {
          editor.setValue(value);
          return true;
        }
        // 2. Try __vscode_monaco_editor__ property on the DOM element
        if (monacoEditorEl.__vscode_monaco_editor__) {
          monacoEditorEl.__vscode_monaco_editor__.setValue(value);
          return true;
        }
      }

      // 3. Iterate all editors and find the one whose DOM node is inside our container
      const editors = window.monaco?.editor?.getEditors?.();
      if (editors && editors.length > 0) {
        for (const ed of editors) {
          if (container.contains(ed.getDomNode?.())) {
            ed.setValue(value);
            return true;
          }
        }
      }

      return false;
    }, [this.testEventsEditor, eventJson]);

    if (!success) {
      // Fallback to keyboard typing
      const textarea = this.page.locator(`${this.testEventsEditor} textarea`);
      await textarea.focus();
      await this.page.waitForTimeout(300);
      const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
      await this.page.keyboard.press(selectAll);
      await this.page.keyboard.press('Backspace');
      await this.page.waitForTimeout(200);
      await this.page.keyboard.type(eventJson);
    }

    // Wait for Monaco editor v-model debounce to sync
    await this.page.waitForTimeout(600);
  }

  async clickRunTestButton() {
    const testSection = this.page.locator(this.testSection);
    const runButton = testSection.getByRole('button', { name: /run|execute|test/i });

    if (await runButton.isVisible({ timeout: 2000 })) {
      // force: true needed — button can be obscured by overlapping editor chrome
      await runButton.click({ force: true });
      // Wait for output to load (>10 chars distinguishes real content from Monaco line numbers)
      const outputLocator = this.page.locator(this.testOutputEditor);
      await expect(outputLocator).toHaveText(/.{10,}/, { timeout: 15000 });
      return true;
    }
    return false;
  }

  async getTestOutput() {
    const outputEditor = this.page.locator(this.testOutputEditor);
    return await outputEditor.textContent();
  }

  // ==================== Assertion Methods ====================

  async expectAddButtonVisible() {
    const addButton = this.page.locator(this.addFunctionButton);
    await expect(addButton).toBeVisible({ timeout: 10000 });
  }

  async expectVrlRadioVisible() {
    const vrlRadio = this.page.locator(this.vrlRadio);
    await expect(vrlRadio).toBeVisible();
  }

  async expectJsRadioVisible() {
    const jsRadio = this.page.locator(this.jsRadio);
    await expect(jsRadio).toBeVisible();
  }

  async expectJsRadioSelected() {
    // For Quasar radio buttons with v-model, check aria-checked attribute
    const jsRadio = this.page.locator(this.jsRadio);
    await jsRadio.waitFor({ state: 'visible' });
    const radioElement = jsRadio.locator('.q-radio');
    await expect(radioElement).toHaveAttribute('aria-checked', 'true');
  }

  async expectVrlRadioSelected() {
    const vrlRadioInput = this.page.locator(`${this.vrlRadio} input[type="radio"]`);
    await expect(vrlRadioInput).toBeChecked();
  }

  async expectTestOutputContains(text) {
    const outputText = await this.getTestOutput();
    expect(outputText).toContain(text);
  }

  async expectFunctionInList(functionName) {
    // Use a table row locator for more reliable matching.
    // 30 s timeout: the reactive filter re-applies when data arrives, so this correctly
    // handles slow CI where the list API responds after the search field is filled.
    const functionRow = this.page.locator('tr').filter({ hasText: functionName }).first();
    await expect(functionRow).toBeVisible({ timeout: 30000 });
  }

  async isCancelButtonVisible() {
    const cancelButton = this.page.locator(this.cancelButton);
    return await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
  }

  async getEditorContent() {
    const editor = this.page.locator(this.functionEditor);
    return await editor.textContent();
  }

  async isJsRadioVisible() {
    const jsRadio = this.page.locator(this.jsRadio);
    return await jsRadio.isVisible().catch(() => false);
  }

  async expectJsRadioHidden() {
    const jsRadio = this.page.locator(this.jsRadio);
    await expect(jsRadio).not.toBeVisible();
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
    const searchInput = this.page.locator(this.searchInput);
    const isOnListPage = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);

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

    // Wait for output editor to have real content (>10 chars to skip Monaco line numbers)
    const outputLocator = this.page.locator(this.testOutputEditor);
    await expect(outputLocator).toHaveText(/.{10,}/, { timeout: 15000 });

    return await this.getTestOutput();
  }

  /**
   * Navigate to function, edit it, and verify type
   * @param {string} functionName - Name of the function
   * @returns {Promise<'js'|'vrl'|null>} Function type
   */
  async openFunctionAndCheckType(functionName) {
    // Wait for the functions table to have at least one data row before searching.
    // After page navigation, getJSTransforms() is async — the list may not be
    // populated yet even after waitForLoadState+2s in the spec.
    const anyDataRow = this.page.locator('tbody tr').first();
    await anyDataRow.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});

    await this.searchFunction(functionName);
    await this.clickFunctionByName(functionName);

    // Wait for the editor to load after clicking the function
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(2000);

    // Wait for radio buttons to be visible
    const jsRadioWrapper = this.page.locator(this.jsRadio);
    await jsRadioWrapper.waitFor({ state: 'visible', timeout: 10000 });

    // Check which radio is selected using aria-checked attribute
    const jsRadioElement = jsRadioWrapper.locator('.q-radio[role="radio"]');
    const vrlRadioElement = this.page.locator(this.vrlRadio).locator('.q-radio[role="radio"]');

    const jsChecked = await jsRadioElement.getAttribute('aria-checked');
    const vrlChecked = await vrlRadioElement.getAttribute('aria-checked');

    if (jsChecked === 'true') return 'js';
    if (vrlChecked === 'true') return 'vrl';
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
      const deleteBtn = this.page.locator(this.deleteButton).first();
      if (await deleteBtn.isVisible({ timeout: 2000 })) {
        await deleteBtn.click();
        await this.page.waitForTimeout(500);

        const confirmButton = this.page.getByRole('button', { name: 'OK' });
        if (await confirmButton.isVisible({ timeout: 1000 })) {
          await confirmButton.click();
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
