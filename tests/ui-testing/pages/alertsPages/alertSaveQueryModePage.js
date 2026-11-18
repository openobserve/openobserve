// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
import {
  ALERT_NAME_FIELD,
  expandAlertSettingGroups,
  expectSaveNamesIssues,
  fillAlertName,
  goToAlertSection,
  openAlertFilterBuilder,
  pickAlertDestination,
  selectAlertStreamType,
  settleIntoView,
} from './alertSectionHelpers.js';
const { FilterBuilderDriver } = require('../generalPages/filterBuilderPage.js');

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
      streamTrigger: '[data-test="add-alert-stream-name-select-dropdown-trigger"]',
      watchSummary: '[data-test="add-alert-watch-summary"] > span:first-child',
      threshold: '[data-test="alert-trigger-threshold-input-field"]',
      realtimeTab: '[data-test="add-alert-type-tab-true"]',
      scheduledTab: '[data-test="add-alert-type-tab-false"]',
      // Compare-with-Past is a tucked setting of "When is it a problem?".
      multiWindowAdd: '[data-test="multi-time-range-alerts-add-btn"]',
      multiWindowDelete: '[data-test="multi-time-range-alerts-delete-btn"]',
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
    // A Save fired before the alert is fetched reads an empty form. Edit locks section 1 to a
    // "type · stream · how" summary whose stream slot stays blank until the alert lands.
    await expect(this.page.locator(this.locators.watchSummary)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.watchSummary)).not.toHaveText(/·\s*·/, { timeout: 30000 });
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
    await settleIntoView(this.page, this.page.locator(trigger));
    await this.page.locator(trigger).click();
    // The option list is virtual: an option past the rendered window is not in the DOM until filtered.
    const search = this.page.locator(trigger.replace(/-trigger"\]$/, '-search"]'));
    if (await search.count()) await search.fill(optionName);
    const choice = this.page.getByRole('option', { name: optionName, exact: true });
    await choice.waitFor({ state: 'visible', timeout: 15000 });
    await choice.click();
  }

  async selectStream(streamName) {
    await this.#pickFromDropdown(this.locators.streamTrigger, streamName);
  }

  async selectDestination(destinationName) {
    await pickAlertDestination(this.page, destinationName);
  }

  async addBuilderCondition(column, value) {
    // A field list opened mid-scroll loses its anchor when the snap settles, and the list hides.
    await openAlertFilterBuilder(this.page);
    await new FilterBuilderDriver(this.page, 'alert-conditions').addCondition(column, '=', value);
  }

  /** Enter in the name field submits the form. */
  async setName(name, { submit = false } = {}) {
    await fillAlertName(this.page, name);
    if (submit) await this.page.locator(ALERT_NAME_FIELD).first().press('Enter');
  }

  async setThreshold(value) {
    await this.page.locator(this.locators.threshold).fill(value);
  }

  async selectQueryMode(mode) {
    await this.page.locator(this.modeTab(mode)).click();
  }

  async selectRealtime() {
    await goToAlertSection(this.page, 'watch');
    await this.page.locator(this.locators.realtimeTab).click();
  }

  async selectScheduled() {
    await goToAlertSection(this.page, 'watch');
    await this.page.locator(this.locators.scheduledTab).click();
  }

  async selectStreamType(streamType) {
    await selectAlertStreamType(this.page, streamType.toLowerCase());
  }

  async openAdvancedTab() {
    await expandAlertSettingGroups(this.page, ['condition']);
    await goToAlertSection(this.page, 'condition');
    await expect(this.page.locator(this.locators.multiWindowAdd)).toBeVisible({ timeout: 20000 });
  }

  /** Compare-with-Past reference window. Requires openAdvancedTab() first. */
  async addCompareWithPastWindow() {
    const before = await this.page.locator(this.locators.multiWindowDelete).count();
    await this.page.locator(this.locators.multiWindowAdd).click();
    await expect(this.page.locator(this.locators.multiWindowDelete)).toHaveCount(before + 1, {
      timeout: 20000,
    });
  }

  async expectCompareWithPastWindowCount(count) {
    await expect(this.page.locator(this.locators.multiWindowDelete)).toHaveCount(count, {
      timeout: 20000,
    });
  }

  async clickSave() {
    await this.page.locator(this.locators.submit).click();
  }

  /** Clicks Save on an existing alert and resolves with the PUT it sends. */
  async saveAndWaitForUpdate() {
    const saved = this.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/api\/v2\/[^/]+\/alerts\//.test(r.url()),
    );
    await this.clickSave();
    return saved;
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
      // Firefox renders Monaco's textarea 0px wide, so the fill must skip the visibility check.
      await input.fill(sql, { force: true });
      await expect(editor).toContainText(table, { timeout: 5000 });
    }).toPass({ timeout: 40000 });
    // The stream-name sync runs off the value Monaco commits on blur; a click-away
    // lands on the signature-help popup the fill opens, so close it and blur directly.
    await this.page.keyboard.press('Escape');
    await input.evaluate((el) => el.blur());
    await expect(this.page.locator(this.locators.streamTrigger)).toHaveAttribute('data-test-selected-value', table, {
      timeout: 15000,
    });
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

  /** On edit section 1 is locked, so the stream shows only in its summary. */
  async expectStreamName(streamName) {
    const trigger = this.page.locator(this.locators.streamTrigger);
    if (await trigger.count()) {
      await expect(trigger).toHaveText(streamName, { timeout: 20000 });
      return;
    }
    await expect(this.page.locator(this.locators.watchSummary)).toContainText(`· ${streamName} ·`, { timeout: 20000 });
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
    await expectSaveNamesIssues(this.page);
  }

  async expectDetailConditionCountOnly() {
    const condition = this.page.locator(this.locators.detailCondition);
    // A Builder condition is plain text in the value div; a query renders as a code block.
    await expect(condition.locator('[data-test="alerts-alertconfigsummary-condition-value"]')).toContainText(/count >=/);
    await expect(condition).not.toContainText('SELECT');
  }

  async expectDetailConditionShowsSql() {
    await expect(this.page.locator(this.locators.detailCondition)).toContainText('SELECT');
  }
}
