// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');

class ActionScriptsFormValidationPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── List page ─────────────────────────────────────────────────────────────
    this.listPage                = '[data-test="action-scripts-list-page"]';
    this.addButton               = '[data-test="action-list-add-btn"]';
    this.table                   = '[data-test="action-scripts-table"]';

    // ── Clone dialog ──────────────────────────────────────────────────────────
    // ODialog wrapper
    this.cloneDialog             = '[data-test="action-scripts-form-dialog"]';
    // OInput data-test="to-be-clone-action-name" → -field / -error
    this.cloneNameField          = '[data-test="to-be-clone-action-name-field"]';
    this.cloneNameError          = '[data-test="to-be-clone-action-name-error"]';
    // OSelect data-test="to-be-clone-stream-type" → -popover / -error
    this.cloneStreamTypePopover  = '[data-test="to-be-clone-stream-type-popover"]';
    this.cloneStreamTypeError    = '[data-test="to-be-clone-stream-type-error"]';
    // OSelect data-test="to-be-clone-stream-name" → -popover / -error
    this.cloneStreamNamePopover  = '[data-test="to-be-clone-stream-name-popover"]';
    // ODialog built-in primary / secondary buttons scoped to dialog
    this.cloneSaveBtn            = '[data-test="action-scripts-form-dialog"] [data-test="o-dialog-primary-btn"]';
    this.cloneCancelBtn          = '[data-test="action-scripts-form-dialog"] [data-test="o-dialog-secondary-btn"]';

    // ── EditScript (add/update) page ──────────────────────────────────────────
    this.editScriptSection       = '[data-test="add-action-script-section"]';
    this.backBtn                 = '[data-test="add-action-script-back-btn"]';
    this.titleEl                 = '[data-test="add-action-script-title"]';

    // OInput data-test="add-action-script-name-input" wraps OInput:
    // OInput generates -field (native <input>) and -error (error message)
    this.nameInputWrapper        = '[data-test="add-action-script-name-input"]';
    this.nameField               = '[data-test="add-action-script-name-input-field"]';
    this.nameError               = '[data-test="add-action-script-name-input-error"]';

    // OSelect data-test="add-action-script-type-select" → -popover / -error
    this.typeSelectPopover       = '[data-test="add-action-script-type-select-popover"]';
    this.typeSelectError         = '[data-test="add-action-script-type-select-error"]';

    // Stepper steps
    this.step1                   = '[data-test="add-action-script-step-1"]';
    this.step3                   = '[data-test="add-action-script-step-3"]';

    // OFile data-test="add-action-script-file-input" → -error
    this.fileInput               = '[data-test="add-action-script-file-input"]';
    this.step1ContinueBtn        = '[data-test="add-action-script-step1-continue-btn"]';

    // Service account select
    this.serviceAccountSelect    = '[data-test="add-action-script-service-account-select"]';
    this.serviceAccountError     = '[data-test="add-action-script-service-account-select-error"]';

    // Footer action buttons
    this.saveBtn                 = '[data-test="add-action-script-save-btn"]';
    this.cancelBtn               = '[data-test="add-action-script-cancel-btn"]';

    // Per-row action buttons (dynamic — built with row.name)
    this.rowEditBtnSelector      = (name) => `[data-test="alert-list-${name}-update-alert"]`;
    this.rowDeleteBtnSelector    = (name) => `[data-test="alert-list-${name}-delete-alert"]`;

    // Toast
    this.toastSuccess            = '[data-test="o-toast-success"]';
    this.toastError              = '[data-test="o-toast-error"]';
  }

  // ── Locator getters ───────────────────────────────────────────────────────

  getTableLocator() {
    return this.page.locator(this.table);
  }

  getCloneDialogLocator() {
    return this.page.locator(this.cloneDialog);
  }

  getListPageLocator() {
    return this.page.locator(this.listPage);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async navigateToActionScripts(orgIdentifier) {
    const org = orgIdentifier || process.env.ORGID || 'default';
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/pipeline/action-scripts?org_identifier=${org}`
    );
    await this.page.locator(this.listPage).waitFor({ state: 'visible', timeout: 15000 });
  }

  // ── List page helpers ─────────────────────────────────────────────────────

  async clickAddButton() {
    await this.page.locator(this.addButton).waitFor({ state: 'visible' });
    await this.page.locator(this.addButton).click();
    await this.page.locator(this.editScriptSection).waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickEditRow(name) {
    await this.page.locator(this.rowEditBtnSelector(name)).waitFor({ state: 'visible' });
    await this.page.locator(this.rowEditBtnSelector(name)).click();
    await this.page.locator(this.editScriptSection).waitFor({ state: 'visible', timeout: 10000 });
  }

  // ── EditScript form actions ────────────────────────────────────────────────

  async fillName(value) {
    await this.page.locator(this.nameField).waitFor({ state: 'visible' });
    await this.page.locator(this.nameField).fill(value);
  }

  async clearName() {
    await this.page.locator(this.nameField).waitFor({ state: 'visible' });
    await this.page.locator(this.nameField).fill('');
  }

  async expectNameError(message) {
    await this.page.locator(this.nameError).waitFor({ state: 'visible' });
    if (message) {
      await expect(this.page.locator(this.nameError)).toContainText(message);
    } else {
      await expect(this.page.locator(this.nameError)).toBeVisible();
    }
  }

  async expectTypeError(message) {
    await this.page.locator(this.typeSelectError).waitFor({ state: 'visible' });
    await expect(this.page.locator(this.typeSelectError)).toBeVisible();
    if (message) {
      await expect(this.page.locator(this.typeSelectError)).toContainText(message);
    }
  }

  async selectType(value) {
    await this.page.locator(this.typeSelectPopover).waitFor({ state: 'visible' });
    await this.page.locator(this.typeSelectPopover).click();
    // Select option by text inside the opened dropdown
    await this.page.getByRole('option', { name: value }).click();
  }

  async clickSave() {
    await this.page.locator(this.saveBtn).waitFor({ state: 'visible' });
    await this.page.locator(this.saveBtn).click();
  }

  async clickCancel() {
    await this.page.locator(this.cancelBtn).waitFor({ state: 'visible' });
    await this.page.locator(this.cancelBtn).click();
  }

  async expectSaveButtonVisible() {
    await expect(this.page.locator(this.saveBtn)).toBeVisible();
  }

  // ── Clone dialog helpers ───────────────────────────────────────────────────

  async openCloneDialog(rowName) {
    // Clone is opened via a row-level action — not directly via the add button.
    // The clone dialog data-test is "action-scripts-form-dialog" and is triggered
    // by some row-level UI. In the absence of a dedicated clone button selector,
    // we rely on the caller to trigger the dialog before calling this method.
    await this.page.locator(this.cloneDialog).waitFor({ state: 'visible', timeout: 10000 });
  }

  async fillCloneName(value) {
    await this.page.locator(this.cloneNameField).waitFor({ state: 'visible' });
    await this.page.locator(this.cloneNameField).fill(value);
  }

  async clearCloneName() {
    await this.page.locator(this.cloneNameField).fill('');
  }

  async expectCloneNameError(message) {
    await this.page.locator(this.cloneNameError).waitFor({ state: 'visible' });
    await expect(this.page.locator(this.cloneNameError)).toBeVisible();
    if (message) {
      await expect(this.page.locator(this.cloneNameError)).toContainText(message);
    }
  }

  async clickCloneSave() {
    await this.page.locator(this.cloneSaveBtn).waitFor({ state: 'visible' });
    await this.page.locator(this.cloneSaveBtn).click();
  }

  async clickCloneCancel() {
    await this.page.locator(this.cloneCancelBtn).waitFor({ state: 'visible' });
    await this.page.locator(this.cloneCancelBtn).click();
    await this.page.locator(this.cloneDialog).waitFor({ state: 'hidden', timeout: 5000 });
  }

  async expectCloneDialogClosed() {
    await expect(this.page.locator(this.cloneDialog)).not.toBeVisible();
  }

  async expectCloneDialogOpen() {
    await expect(this.page.locator(this.cloneDialog)).toBeVisible();
  }

  // ── Assertion helpers ──────────────────────────────────────────────────────

  async expectOnListPage() {
    await this.page.locator(this.listPage).waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator(this.listPage)).toBeVisible();
  }

  async expectOnEditPage() {
    await this.page.locator(this.editScriptSection).waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator(this.editScriptSection)).toBeVisible();
  }
}

module.exports = { ActionScriptsFormValidationPage };
