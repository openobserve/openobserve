// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class FunctionsFormValidationPage {
  constructor(page) {
    this.page = page;

    // ==================== AddFunction / FunctionsToolbar locators ====================

    // Name input (OInput — derives -field and -error automatically)
    this.functionNameField = page.locator('[data-test="add-function-name-input-field"]');
    this.functionNameError = page.locator('[data-test="add-function-name-input-error"]');

    // VRL editor wrapper
    this.functionEditor = page.locator('[data-test="logs-vrl-function-editor"]');

    // Action buttons
    this.saveButton = page.locator('[data-test="add-function-save-btn"]');
    this.cancelButton = page.locator('[data-test="add-function-cancel-btn"]');
    this.backButton = page.locator('[data-test="add-function-back-btn"]');

    // Toast notifications
    this.toastSuccess = page.locator('[data-test-variant="success"]');
    this.toastError = page.locator('[data-test-variant="error"]');

    // ==================== AddEnrichmentTable locators ====================

    // Add form root
    this.enrichmentPage = page.locator('[data-test="add-enrichment-table-page"]');

    // Name field (OInput)
    this.enrichmentNameField = page.locator('[data-test="add-enrichment-table-name-field"]');
    this.enrichmentNameError = page.locator('[data-test="add-enrichment-table-name-error"]');

    // File upload (OFile — derives -field automatically; -error for validation msg)
    this.enrichmentFileField = page.locator('[data-test="add-enrichment-table-file-field"]');
    this.enrichmentFileError = page.locator('[data-test="add-enrichment-table-file-error"]');

    // URL field (OInput for URL source)
    this.enrichmentUrlField = page.locator('[data-test="add-enrichment-table-url-field"]');
    this.enrichmentUrlError = page.locator('[data-test="add-enrichment-table-url-error"]');

    // Source toggle (OOptionGroup — file vs url)
    this.enrichmentSourceGroup = page.locator('[data-test="add-enrichment-table-source"]');

    // Footer buttons
    this.enrichmentSaveButton = page.locator('[data-test="add-enrichment-table-save-btn"]');
    this.enrichmentCancelButton = page.locator('[data-test="add-enrichment-table-cancel-btn"]');
    this.enrichmentBackButton = page.locator('[data-test="add-enrichment-table-back-btn"]');

    // Add enrichment button on list page
    this.enrichmentAddButton = page.locator('[data-test="enrichment-tables-add-btn"]');

    // Pipeline / enrichment navigation
    this.enrichmentTableTab = page.locator('[data-test="pipeline-section-tab-enrichmentTables"]');

    // Add function button on functions list
    this.addFunctionButton = page.locator('[data-test="function-list-add-function-btn"]');

    // ==================== FunctionsToolbar locators ====================

    // VRL / JS transform type radios
    this.vrlRadio = page.locator('[data-test="function-transform-type-vrl-radio"]');
    this.jsRadio = page.locator('[data-test="function-transform-type-js-radio"]');

    // ==================== StreamRouting locators ====================

    // StreamRouting panel root
    this.streamRoutingSection = page.locator('[data-test="add-stream-routing-section"]');

    // Close icon
    this.streamRoutingCloseBtn = page.locator('[data-test="stream-routing-close-dialog-btn"]');

    // Destination name input (OInput — derives -field and -error)
    this.streamRoutingDestNameField = page.locator('[data-test="stream-routing-destination-name-input-field"]');
    this.streamRoutingDestNameError = page.locator('[data-test="stream-routing-destination-name-input-error"]');

    // Stream type select (OSelect — derives -error)
    this.streamRoutingStreamTypeError = page.locator('[data-test="add-alert-stream-type-select-error"]');

    // Stream name select (OSelect — derives -error)
    this.streamRoutingStreamNameError = page.locator('[data-test="add-alert-stream-select-error"]');

    // Save / Cancel buttons
    this.streamRoutingSaveBtn = page.locator('[data-test="add-report-save-btn"]');
    this.streamRoutingCancelBtn = page.locator('[data-test="add-report-cancel-btn"]');

    // Pipeline add-routing button (if available in the pipeline view)
    this.addStreamRoutingButton = page.locator('[data-test="pipeline-add-stream-routing-btn"]');
  }

  // ==================== Navigation ====================

  async navigateToFunctions(org) {
    const targetOrg = org || process.env.ORGID;
    testLogger.info(`Navigating to functions page for org: ${targetOrg}`);
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async navigateToEnrichmentTables(org) {
    const targetOrg = org || process.env.ORGID;
    testLogger.info(`Navigating to enrichment tables for org: ${targetOrg}`);
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await this.enrichmentTableTab.waitFor({ state: 'visible', timeout: 15000 });
    await this.enrichmentTableTab.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  // ==================== Add Function actions ====================

  async openAddFunctionForm(org) {
    await this.navigateToFunctions(org);
    await this.addFunctionButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.addFunctionButton.click();
    await this.functionNameField.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('Add Function form opened');
  }

  async fillFunctionName(name) {
    testLogger.info(`Filling function name: ${name}`);
    await this.functionNameField.waitFor({ state: 'visible' });
    await this.functionNameField.fill(name);
  }

  async clickSave() {
    testLogger.info('Clicking Save button');
    await this.saveButton.waitFor({ state: 'visible' });
    await this.saveButton.click();
  }

  async expectFunctionNameError(message) {
    testLogger.info(`Expecting function name error: ${message}`);
    await this.functionNameError.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.functionNameError).toBeVisible();
    if (message) {
      await expect(this.functionNameError).toContainText(message);
    }
  }

  async expectFunctionNameErrorVisible() {
    testLogger.info('Expecting function name error to be visible');
    await this.functionNameError.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.functionNameError).toBeVisible();
  }

  async typeInVrlEditor(code) {
    testLogger.info('Typing VRL code into editor');
    await this.functionEditor.waitFor({ state: 'visible', timeout: 15000 });
    // Click the editor to ensure Monaco is focused/initialized (lazy-loaded async component)
    await this.functionEditor.click();
    await this.page.waitForTimeout(300);
    // Use Monaco's executeEdits API to set the content and trigger onDidChangeModelContent,
    // which propagates through unified-query-editor's @update:query to formData.function.
    // keyboard.type() and keyboard.insertText() do NOT trigger the reactive update.
    await this.page.evaluate((vrlCode) => {
      const editors = window.monaco?.editor?.getEditors?.();
      const container = document.querySelector('[data-test="logs-vrl-function-editor"]');
      const targetEditor = editors?.find(e => container?.contains(e.getContainerDomNode()));
      if (targetEditor) {
        targetEditor.executeEdits('playwright', [{
          range: targetEditor.getModel().getFullModelRange(),
          text: vrlCode
        }]);
      }
    }, code);
    // Wait for Vue reactivity to propagate from onDidChangeModelContent → emit → formData.function
    await this.page.waitForTimeout(500);
  }

  async expectSuccessToast() {
    testLogger.info('Waiting for success toast');
    await this.toastSuccess.waitFor({ state: 'visible', timeout: 15000 });
    await expect(this.toastSuccess).toBeVisible();
  }

  // ==================== Add Enrichment Table actions ====================

  async openAddEnrichmentTableForm(org) {
    await this.navigateToEnrichmentTables(org);
    await this.enrichmentAddButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.enrichmentAddButton.click();
    await this.enrichmentPage.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('Add Enrichment Table form opened');
  }

  async fillEnrichmentName(name) {
    testLogger.info(`Filling enrichment table name: ${name}`);
    await this.enrichmentNameField.waitFor({ state: 'visible' });
    await this.enrichmentNameField.fill(name);
  }

  async clickEnrichmentSave() {
    testLogger.info('Clicking enrichment table Save button');
    await this.enrichmentSaveButton.waitFor({ state: 'visible' });
    await this.enrichmentSaveButton.click();
  }

  async expectEnrichmentNameError(message) {
    testLogger.info(`Expecting enrichment name error: ${message}`);
    await this.enrichmentNameError.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.enrichmentNameError).toBeVisible();
    if (message) {
      await expect(this.enrichmentNameError).toContainText(message);
    }
  }

  async expectEnrichmentFileError(message) {
    testLogger.info(`Expecting enrichment file error: ${message}`);
    await this.enrichmentFileError.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.enrichmentFileError).toBeVisible();
    if (message) {
      await expect(this.enrichmentFileError).toContainText(message);
    }
  }

  // ==================== FunctionsToolbar assertion helpers ====================

  async assertVrlRadioSelected() {
    testLogger.info('Asserting VRL radio is checked');
    await this.vrlRadio.waitFor({ state: 'visible', timeout: 10000 });
    // ORadio renders a native input — check aria-checked or checked attribute
    const checked = await this.vrlRadio.evaluate(el => {
      const input = el.querySelector('input[type="radio"]') || el.closest('[role="radio"]') || el;
      return input.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
    });
    expect(checked).toBe(true);
  }

  // ==================== StreamRouting actions ====================

  async openStreamRoutingForm(org) {
    const targetOrg = org || process.env.ORGID;
    testLogger.info('Opening StreamRouting form via pipeline page');
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${targetOrg}`
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // Attempt to open routing panel; fall back gracefully if not available in env
    const routingBtn = this.addStreamRoutingButton;
    const btnVisible = await routingBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (btnVisible) {
      await routingBtn.click();
      await this.streamRoutingSection.waitFor({ state: 'visible', timeout: 10000 });
      testLogger.info('StreamRouting panel opened via button');
    } else {
      // Navigate directly to routing view if the button is not available
      await this.page.goto(
        `${process.env.ZO_BASE_URL}/web/pipeline/stream-routing?org_identifier=${targetOrg}`
      );
      await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await this.streamRoutingSection.waitFor({ state: 'visible', timeout: 15000 });
      testLogger.info('StreamRouting panel opened via direct URL');
    }
  }

  async fillStreamRoutingDestName(name) {
    testLogger.info(`Filling stream routing destination name: ${name}`);
    await this.streamRoutingDestNameField.waitFor({ state: 'visible', timeout: 10000 });
    await this.streamRoutingDestNameField.fill(name);
    await this.streamRoutingDestNameField.dispatchEvent('blur');
  }

  async clickStreamRoutingSave() {
    testLogger.info('Clicking StreamRouting Save button');
    await this.streamRoutingSaveBtn.waitFor({ state: 'visible' });
    await this.streamRoutingSaveBtn.click();
  }

  async clickStreamRoutingClose() {
    testLogger.info('Clicking StreamRouting close icon');
    await this.streamRoutingCloseBtn.waitFor({ state: 'visible' });
    await this.streamRoutingCloseBtn.click();
  }

  async assertStreamRoutingNameErrorVisible() {
    testLogger.info('Asserting stream routing destination name error visible');
    await expect(this.streamRoutingDestNameError).toBeVisible({ timeout: 5000 });
  }

  async assertStreamRoutingStreamTypeErrorVisible() {
    testLogger.info('Asserting stream routing stream type error visible');
    await expect(this.streamRoutingStreamTypeError).toBeVisible({ timeout: 5000 });
  }

  async selectUrlSource() {
    testLogger.info('Selecting URL data source');
    // OOptionGroup renders each option — click the "url" option
    const urlOption = this.enrichmentSourceGroup.locator('[data-value="url"], [value="url"]').first();
    // Fallback: click by visible text
    const urlBtn = this.enrichmentSourceGroup.getByText('From URL').first();
    await urlBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      await urlOption.click();
    });
    await urlBtn.click().catch(() => urlOption.click());
    testLogger.info('URL source selected');
  }
}

module.exports = FunctionsFormValidationPage;
