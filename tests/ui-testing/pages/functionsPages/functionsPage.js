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
    await this.page.waitForLoadState('networkidle');
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
      await this.page.waitForLoadState('networkidle');
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
    const editor = this.page.locator(this.functionEditor);
    await editor.click();
    await this.page.waitForTimeout(500);

    // Clear existing content and type new code
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.type(code);
    await this.page.waitForTimeout(500);
  }

  async clickSaveButton() {
    const saveButton = this.page.locator(this.saveButton);
    await saveButton.click();
    await this.page.waitForTimeout(2000);
  }

  async clickCancelButton() {
    const cancelButton = this.page.locator(this.cancelButton);
    await cancelButton.click();
    await this.page.waitForTimeout(1500); // Wait for dialog to fully close
  }

  async clickTestButton() {
    const testButton = this.page.locator(this.testButton);
    await testButton.click();
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
    // Find the row containing the function name
    const functionRow = this.page.locator('tr').filter({ hasText: name }).first();
    // Click the edit button in that row (Quasar icon button with edit icon)
    const editButton = functionRow.getByRole('button').filter({ has: this.page.locator('.q-icon').filter({ hasText: 'edit' }) });
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
    const testInput = this.page.locator(this.testEventsEditor);
    await testInput.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.type(eventJson);
    await this.page.waitForTimeout(500);
  }

  async clickRunTestButton() {
    const testSection = this.page.locator(this.testSection);
    const runButton = testSection.getByRole('button', { name: /run|execute|test/i });

    if (await runButton.isVisible({ timeout: 2000 })) {
      // Wait for button to be enabled (it may be disabled initially)
      await runButton.waitFor({ state: 'visible', timeout: 5000 });
      // Try to click with force if needed (button validation may be preventing click)
      try {
        await runButton.click({ timeout: 5000 });
      } catch (e) {
        // If regular click fails due to disabled state, force click
        await runButton.click({ force: true });
      }
      await this.page.waitForTimeout(2000);
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
    const functionRow = this.page.locator(`text=${functionName}`);
    await expect(functionRow).toBeVisible({ timeout: 10000 });
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
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);
    }

    await this.searchFunction(functionName);
    await this.deleteFirstFunction();
  }

  /**
   * Test a function with input data and return output
   * @param {string} testEventJson - Test event as JSON string
   * @returns {Promise<string>} Test output
   */
  async testFunctionExecution(testEventJson) {
    await this.clickTestButton();
    await this.enterTestEvent(testEventJson);
    const runSuccess = await this.clickRunTestButton();

    if (runSuccess) {
      return await this.getTestOutput();
    }
    return null;
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
    await this.page.waitForLoadState('networkidle');
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
