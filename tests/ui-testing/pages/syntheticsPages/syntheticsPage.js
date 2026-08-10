import { expect } from '@playwright/test';

export class SyntheticsPage {
  constructor(page) {
    this.page = page;

    // ── Gate screen (Create Browser Check wizard entry) ──────────────────
    this.urlInput = page.locator('[data-test="synthetics-create-url-input"]');
    this.nameInput = page.locator('[data-test="synthetics-create-name-input"]');
    this.buildBtn = page.locator('[data-test="synthetics-create-build-btn"]');

    // ── Navigation between wizard steps ──────────────────────────────────
    this.continueBtn = page.locator('[data-test="synthetics-create-continue-btn"]');
    this.backToJourneyBtn = page.locator('[data-test="synthetics-create-back-to-journey-btn"]');

    // ── Variables Panel root + header ────────────────────────────────────
    this.panelRoot = page.locator('[data-test="synthetics-check-variables-panel"]');
    this.countBadge = page.locator('[data-test="synthetics-check-variables-panel-count"]');
    this.hintIcon = page.locator('[data-test="synthetics-check-variables-panel-hint-icon"]');

    // ── Empty state ──────────────────────────────────────────────────────
    this.emptyState = page.locator('[data-test="synthetics-check-variables-panel-empty"]');

    // ── Add form ─────────────────────────────────────────────────────────
    this.addForm = page.locator('[data-test="synthetics-check-variables-panel-add-form"]');
    this.addNameInput = page.locator('[data-test="synthetics-check-variables-panel-add-name-input"]');
    this.addValueInput = page.locator('[data-test="synthetics-check-variables-panel-add-value-input"]');
    this.addSecureSwitch = page.locator('[data-test="synthetics-check-variables-panel-add-secure-switch"]');
    this.addBtn = page.locator('[data-test="synthetics-check-variables-panel-add-btn"]');
    this.addCancelBtn = page.locator('[data-test="synthetics-check-variables-panel-add-cancel-btn"]');

    // ── Pinned "Add Variable" button ─────────────────────────────────────
    this.addVariableBtn = page.locator('[data-test="synthetics-check-variables-panel-add-variable-btn"]');

    // ── Remove confirmation dialog ───────────────────────────────────────
    this.removeDialog = page.locator('[data-test="synthetics-check-variables-panel-remove-dialog"]');

    // ── Undo banner ──────────────────────────────────────────────────────
    this.undoRow = page.locator('[data-test="synthetics-check-variables-panel-undo-row"]');
    this.undoBtn = page.locator('[data-test="synthetics-check-variables-panel-undo-btn"]');

    // ── Journey toolbar ──────────────────────────────────────────────────
    this.toggleVariablesBtn = page.locator('[data-test="synthetics-journey-toggle-variables-btn"]');
    this.addStepBtn = page.locator('[data-test="synthetics-journey-add-step-btn"]');
  }

  // ── Card selectors (dynamic, index-based) ───────────────────────────────
  card(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-card-${index}"]`);
  }

  cardEditBtn(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-${index}-btn"]`);
  }

  cardRemoveBtn(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-remove-${index}-btn"]`);
  }

  cardUsageBadge(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-usage-${index}-badge"]`);
  }

  cardValueDisplay(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-value-${index}"]`);
  }

  editForm(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-form-${index}"]`);
  }

  editNameInput(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-name-${index}-input"]`);
  }

  editValueInput(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-value-${index}-input"]`);
  }

  editSecureSwitch(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-secure-${index}-switch"]`);
  }

  editSaveBtn(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-save-${index}-btn"]`);
  }

  editCancelBtn(index) {
    return this.page.locator(`[data-test="synthetics-check-variables-panel-edit-cancel-${index}-btn"]`);
  }

  // ── Gate screen methods ─────────────────────────────────────────────────
  async navigateToCreateBrowserCheck(checkName) {
    const baseUrl = process.env['ZO_BASE_URL'];
    const orgId = process.env['ORGNAME'];
    await this.page.goto(`${baseUrl}/web/synthetics/add?type=browser&org_identifier=${orgId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await this.fillUrlAndBuildManually(checkName);
  }

  async fillUrlAndBuildManually(checkName) {
    await this.urlInput.fill('https://example.com');
    // Tab/blur to trigger URL validation before Build manually enables
    await this.nameInput.click();
    await this.nameInput.fill(checkName || 'Variables Test');
    await this.buildBtn.click();
    await this.panelRoot.waitFor({ state: 'visible', timeout: 10000 });
  }

  // ── Variables Panel methods ──────────────────────────────────────────────
  async openAddFormFromEmptyState() {
    // The empty-state CTA is a button inside the empty state component.
    const emptyCta = this.page.locator('[data-test="synthetics-check-variables-panel-empty"] button');
    await emptyCta.click();
    await this.addForm.waitFor({ state: 'visible', timeout: 5000 });
  }

  async openAddForm() {
    // Try pinned button first; if not visible, use empty-state CTA.
    const pinnedVisible = await this.addVariableBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (pinnedVisible) {
      await this.addVariableBtn.click();
    } else {
      await this.openAddFormFromEmptyState();
    }
    await this.addForm.waitFor({ state: 'visible', timeout: 5000 });
  }

  async fillAddForm(name, value, secure) {
    await this.addNameInput.fill(name);
    await this.addValueInput.fill(value || '');
    if (secure) {
      await this.addSecureSwitch.click();
    }
  }

  async commitAddForm() {
    await this.addBtn.click();
  }

  async cancelAddForm() {
    await this.addCancelBtn.click();
  }

  async addVariable(name, value, secure) {
    await this.openAddForm();
    await this.fillAddForm(name, value, secure);
    await this.commitAddForm();
  }

  async editVariable(index, name, value, secure) {
    await this.cardEditBtn(index).click();
    await this.editForm(index).waitFor({ state: 'visible', timeout: 5000 });
    if (name !== undefined) {
      await this.editNameInput(index).clear();
      await this.editNameInput(index).fill(name);
    }
    if (value !== undefined) {
      await this.editValueInput(index).clear();
      await this.editValueInput(index).fill(value);
    }
    if (secure !== undefined) {
      await this.editSecureSwitch(index).click();
    }
    await this.editSaveBtn(index).click();
  }

  async cancelEdit(index) {
    await this.cardEditBtn(index).click();
    await this.editForm(index).waitFor({ state: 'visible', timeout: 5000 });
    await this.editCancelBtn(index).click();
  }

  async removeVariable(index) {
    await this.cardRemoveBtn(index).click();
    await this.removeDialog.waitFor({ state: 'visible', timeout: 5000 });
    // Confirm: click "OK" (primary button in the dialog)
    const confirmBtn = this.page.locator('[data-test="synthetics-check-variables-panel-remove-dialog"] button').first();
    await confirmBtn.click();
  }

  async cancelRemove(index) {
    await this.cardRemoveBtn(index).click();
    await this.removeDialog.waitFor({ state: 'visible', timeout: 5000 });
    // Cancel: click the secondary button in the dialog
    const cancelBtn = this.page.locator('[data-test="synthetics-check-variables-panel-remove-dialog"] button').last();
    await cancelBtn.click();
  }

  async undoRemove() {
    await this.undoBtn.click();
  }

  async toggleVariablesPanel() {
    await this.toggleVariablesBtn.click();
  }

  async clickContinue() {
    await this.continueBtn.click();
    // Wait for Configure step to load — panel should be visible
    await this.panelRoot.waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickBackToJourney() {
    await this.backToJourneyBtn.click();
    await this.panelRoot.waitFor({ state: 'visible', timeout: 10000 });
  }

  // ── Assertion helpers ────────────────────────────────────────────────────
  async expectPanelVisible() {
    await expect(this.panelRoot).toBeVisible();
  }

  async expectPanelHidden() {
    await expect(this.panelRoot).not.toBeVisible();
  }

  async expectEmptyStateVisible() {
    await expect(this.emptyState).toBeVisible();
  }

  async expectAddFormVisible() {
    await expect(this.addForm).toBeVisible();
  }

  async expectAddFormNotVisible() {
    await expect(this.addForm).not.toBeVisible();
  }

  async expectCountBadge(count) {
    await expect(this.countBadge).toContainText(String(count));
  }

  async expectCardVisible(index) {
    await expect(this.card(index)).toBeVisible();
  }

  async expectCardNotVisible(index) {
    await expect(this.card(index)).not.toBeVisible();
  }

  async expectCardName(index, expectedName) {
    await expect(this.card(index)).toContainText(expectedName);
  }

  async expectCardValueMasked(index) {
    // Secure values display as placeholder dots (••••••••)
    await expect(this.cardValueDisplay(index)).toContainText('\u2022');
  }

  async expectEditFormVisible(index) {
    await expect(this.editForm(index)).toBeVisible();
  }

  async expectUsageBadge(index, expectedCount) {
    await expect(this.cardUsageBadge(index)).toContainText(String(expectedCount));
  }

  async expectUsageBadgeText(index, expectedText) {
    await expect(this.cardUsageBadge(index)).toContainText(expectedText);
  }

  async expectUndoRowVisible() {
    await expect(this.undoRow).toBeVisible();
  }

  async expectUndoRowNotVisible() {
    await expect(this.undoRow).not.toBeVisible();
  }

  async expectRemoveDialogVisible() {
    await expect(this.removeDialog).toBeVisible();
  }

  async expectRemoveDialogNotVisible() {
    await expect(this.removeDialog).not.toBeVisible();
  }

  async hoverHintIcon() {
    await this.hintIcon.hover();
  }

  async expectHintTooltipVisible() {
    // Tooltip should contain the syntax hint text
    await expect(this.page.getByText('{{VARIABLE_NAME}}')).toBeVisible();
  }

  async expectAddNameError(expectedMessage) {
    // OInput error state: the input wrapper shows error text
    const errorText = this.page.locator('[data-test="synthetics-check-variables-panel-add-name-input"] ~ *').filter({ hasText: expectedMessage });
    await expect(errorText.first()).toBeVisible();
  }

  async expectAddVariableBtnVisible() {
    await expect(this.addVariableBtn).toBeVisible();
  }

  async expectAddVariableBtnNotVisible() {
    await expect(this.addVariableBtn).not.toBeVisible();
  }

  async expectAddNameInputHasValue(expectedValue) {
    await expect(this.addNameInput).toHaveValue(expectedValue);
  }

  async expectToggleBtnVisible() {
    await expect(this.toggleVariablesBtn).toBeVisible();
  }

  // ── Step editor helpers (for usage-count testing) ───────────────────────
  async clickAddStep() {
    await this.addStepBtn.click();
  }

  async fillStepUrl(value) {
    const stepUrlInput = this.page.locator('[data-test="synthetics-step-navigate-url-input"]');
    const stepUrlExists = await stepUrlInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (stepUrlExists) {
      await stepUrlInput.fill(value);
    } else {
      // Fallback: find any input in the step expansion area
      const anyInput = this.page.locator('[data-test^="synthetics-step-"] input').first();
      await anyInput.fill(value);
    }
  }

  // ── Card content assertion helpers ──────────────────────────────────────
  async expectNoCardWithName(name) {
    const cardsWithName = this.page.locator('[data-test^="synthetics-check-variables-panel-card-"]').filter({ hasText: name });
    await expect(cardsWithName).toHaveCount(0);
  }

  async expectCardNameTooltipVisible(expectedName) {
    const tooltip = this.page.getByText(expectedName, { exact: false });
    await expect(tooltip).toBeVisible();
  }
}
