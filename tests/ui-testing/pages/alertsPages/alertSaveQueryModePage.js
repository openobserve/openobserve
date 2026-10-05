// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * AlertSaveQueryModePage — the "Choose Query Mode" dialog Save opens when more
 * than one query mode is in play, plus the bits of the alert editor those tests
 * drive (the mode toggle, the SQL editor, the stream/destination selects).
 *
 * Owns the alert-save-mode-* selectors so specs stay selector-free.
 */
export class AlertSaveQueryModePage {
  constructor(page) {
    this.page = page;
    this.locators = {
      // ── the dialog ──────────────────────────────────────────────────────
      dialog: '[data-test="alert-save-mode-dialog"]',
      lead: '[data-test="alert-save-mode-lead"]',
      warning: '[data-test="alert-save-mode-warning"]',
      note: '[data-test="alert-save-mode-note"]',
      primaryBtn: '[data-test="alert-save-mode-dialog"] [data-test="o-dialog-primary-btn"]',
      secondaryBtn: '[data-test="alert-save-mode-dialog"] [data-test="o-dialog-secondary-btn"]',

      // ── the editor ──────────────────────────────────────────────────────
      submit: '[data-test="add-alert-submit-btn"]',
      nameTrigger: '[data-test="add-alert-name-input-trigger"]',
      nameInput: '[data-test="add-alert-name-input-input"]',
      streamTrigger: '[data-test="add-alert-stream-name-select-dropdown-trigger"]',
      destinationTrigger: '[data-test="alert-destinations-select-trigger"]',
      selectedOption: '[role="option"][aria-selected="true"]',
      addCondition: '[data-test="alert-conditions-add-condition-btn"]',
      conditionColumn: '[data-test="alert-conditions-select-column-trigger"]',
      conditionValue: '[data-test="alert-conditions-value-input-field"]',
      threshold: '[data-test="alert-trigger-threshold-input-field"]',
      realtimeTab: '[data-test="add-alert-type-tab-true"]',
      alertRulesTab: '[data-test="add-alert-tab-condition"]',
      modeToggle: '[data-test="step2-query-tabs"]',
      // Two nodes carry this: the visible query editor and the hidden anomaly preview.
      queryEditor: '[data-test="query-editor"]:visible',
      detailCondition: '[data-test="alerts-alertconfigsummary-condition"]',
    };
  }

  modeOption(mode) {
    return `[data-test="alert-save-mode-option-${mode}"]`;
  }

  modeTab(mode) {
    return `[data-test="query-mode-${mode}"]`;
  }

  // ── navigation ─────────────────────────────────────────────────────────

  async openEditor(alertId, { folder = 'default' } = {}) {
    await this.page.goto(`/web/alerts?org_identifier=${getOrgIdentifier()}&action=update&alert_id=${alertId}&folder=${folder}`);
    await expect(this.page.locator(this.locators.submit)).toBeVisible({ timeout: 30000 });
    // The form shell renders before the alert is fetched, and a Save fired in
    // that window reads an unpopulated form. The stream select is empty until
    // the alert lands, so it doubles as the "data is in" signal.
    await expect(this.page.locator(this.locators.streamTrigger))
      .not.toHaveAttribute('data-test-selected-value', '', { timeout: 30000 });
    testLogger.info('Opened alert editor', { alertId });
  }

  async openNewAlert({ folder = 'default' } = {}) {
    await this.page.goto(`/web/alerts?org_identifier=${getOrgIdentifier()}&action=add&folder=${folder}`);
    await expect(this.page.locator(this.locators.submit)).toBeVisible({ timeout: 30000 });
  }

  async openDetailConfiguration(alertId, { folder = 'default' } = {}) {
    await this.page.goto(`/web/alerts/detail/${alertId}?org_identifier=${getOrgIdentifier()}&folder=${folder}`);
    await this.page.getByRole('tab', { name: 'Configuration' }).click();
  }

  // ── form input ─────────────────────────────────────────────────────────

  /** Reka's listbox renders into a portal, so options are addressed by role. */
  async #pickFromDropdown(trigger, optionName) {
    await this.page.locator(trigger).click();
    const choice = this.page.getByRole('option', { name: optionName, exact: true });
    await choice.waitFor({ state: 'visible', timeout: 15000 });
    await choice.click();
  }

  async selectStream(streamName) {
    await this.#pickFromDropdown(this.locators.streamTrigger, streamName);
  }

  /** Multi-select: the popover stays open after a pick, so it needs dismissing. */
  async selectDestination(destinationName) {
    await this.#pickFromDropdown(this.locators.destinationTrigger, destinationName);
    await this.page.keyboard.press('Escape');
  }

  /** Clears the destination by re-picking the already-selected option. */
  async clearDestination() {
    await this.page.locator(this.locators.destinationTrigger).click();
    await this.page.locator(this.locators.selectedOption).first().click();
    await this.page.keyboard.press('Escape');
  }

  async addBuilderCondition(column, value) {
    await this.page.locator(this.locators.addCondition).click();
    await this.#pickFromDropdown(this.locators.conditionColumn, column);
    await this.page.locator(this.locators.conditionValue).fill(value);
  }

  /** The name field is an inline edit: open it, then type. Enter submits the form. */
  async setName(name, { submit = false } = {}) {
    await this.page.locator(this.locators.nameTrigger).click();
    await this.page.locator(this.locators.nameInput).fill(name);
    if (submit) await this.page.locator(this.locators.nameInput).press('Enter');
  }

  async setThreshold(value) {
    await this.page.locator(this.locators.threshold).fill(value);
  }

  async selectQueryMode(mode) {
    await this.page.locator(this.modeTab(mode)).click();
  }

  async selectRealtime() {
    await this.page.locator(this.locators.realtimeTab).click();
  }

  async clickSave() {
    await this.page.locator(this.locators.submit).click();
  }

  /**
   * Monaco auto-closes quotes, so typing a query key by key turns `FROM "x"`
   * into `FROM "x""` and the parser gives up — which silently kills the stream
   * sync some tests assert on. Filling the backing textarea sets the model in
   * one go and skips the auto-close entirely. A fill that lands before Monaco
   * has wired up its model is dropped without error, so the write is retried
   * until the new FROM table is on screen.
   */
  async setSql(sql) {
    const editor = this.page.locator(this.locators.queryEditor).first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    const input = editor.locator('textarea.inputarea');
    await input.waitFor({ state: 'attached', timeout: 20000 });
    const table = (sql.match(/FROM\s+"([^"]+)"/i) || [])[1];
    await expect(async () => {
      await editor.locator('.view-lines').click();
      await input.fill(sql);
      await expect(editor).toContainText(table, { timeout: 5000 });
    }).toPass({ timeout: 40000 });
    // Click away afterwards: the stream-name sync runs off the committed value,
    // which is why #15091/#15092 both say "click outside the editor and wait".
    await this.page.locator(this.locators.alertRulesTab).click();
  }

  // ── dialog actions ─────────────────────────────────────────────────────

  async pickSaveMode(mode) {
    await this.page.locator(this.modeOption(mode)).click();
    await expect(this.page.locator(this.modeOption(mode))).toHaveAttribute('data-state', 'on');
  }

  /**
   * The dialog closes before the request is sent — `saveWithPickedMode` clears
   * the open flag, then awaits a tick and submits — so a dialog-hidden wait
   * returns while the PUT is still in flight and a caller reading the alert
   * back sees the pre-save copy. The editor closing is the signal that the save
   * actually round-tripped.
   */
  async confirmSaveMode() {
    await this.page.locator(this.locators.primaryBtn).click();
    await expect(this.page.locator(this.locators.dialog)).toBeHidden({ timeout: 30000 });
    await expect(this.page.locator(this.locators.submit)).toBeHidden({ timeout: 30000 });
  }

  async cancelSaveMode() {
    await this.page.locator(this.locators.secondaryBtn).click();
    await expect(this.page.locator(this.locators.dialog)).toBeHidden();
  }

  // ── assertions ─────────────────────────────────────────────────────────

  async expectDialogOpen() {
    await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 15000 });
  }

  async expectDialogClosed() {
    await expect(this.page.locator(this.locators.dialog)).toBeHidden();
  }

  async expectLead(text) {
    await expect(this.page.locator(this.locators.lead)).toHaveText(text);
  }

  async expectWarning(text) {
    await expect(this.page.locator(this.locators.warning)).toHaveText(text);
  }

  async expectNoWarning() {
    await expect(this.page.locator(this.locators.warning)).toHaveCount(0);
  }

  async expectNote(text) {
    await expect(this.page.locator(this.locators.note)).toHaveText(text);
  }

  async expectPrimaryButtonLabel(text) {
    await expect(this.page.locator(this.locators.primaryBtn)).toHaveText(text);
  }

  async expectSaveModeSelected(mode) {
    await expect(this.page.locator(this.modeOption(mode))).toHaveAttribute('data-state', 'on');
  }

  async expectQueryModeSelected(mode) {
    await expect(this.page.locator(this.modeTab(mode))).toHaveAttribute('data-state', 'on');
  }

  async expectModeToggleHidden() {
    await expect(this.page.locator(this.locators.modeToggle)).toBeHidden();
  }

  async expectOnEditor() {
    await expect(this.page.locator(this.locators.submit)).toBeVisible();
  }

  /**
   * The dialog is the only thing between Save and the request, so "no dialog"
   * is asserted by the save completing: the editor closes back to the list.
   */
  async expectSavedWithoutDialog() {
    await this.expectDialogClosed();
    await expect(this.page.locator(this.locators.submit)).toBeHidden({ timeout: 30000 });
  }

  async expectStreamName(streamName) {
    await expect(this.page.locator(this.locators.streamTrigger)).toHaveText(streamName, { timeout: 20000 });
  }

  async expectThreshold(value) {
    // The field repaints from the fetched alert, so allow for the round trip.
    await expect(this.page.locator(this.locators.threshold)).toHaveValue(value, { timeout: 20000 });
  }

  async expectSqlContains(text) {
    await expect(this.page.locator(this.locators.queryEditor).first())
      .toContainText(text, { timeout: 20000 });
  }

  async expectValidationToast() {
    await expect(
      this.page.getByText('Please fix the highlighted fields before saving.').first(),
    ).toBeVisible({ timeout: 15000 });
  }

  async expectDetailConditionEmpty() {
    const condition = this.page.locator(this.locators.detailCondition);
    await expect(condition).toContainText('—');
    await expect(condition).not.toContainText('SELECT');
  }

  async expectDetailConditionShowsSql() {
    await expect(this.page.locator(this.locators.detailCondition)).toContainText('SELECT');
  }
}
