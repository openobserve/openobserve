// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SyntheticsCreatePage — CreateProtocolCheck.vue (http/tcp/tls/ssh) and CreateBrowserTest.vue (gate → journey → configure).

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SyntheticsCreatePage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      // Details (protocol flow)
      nameField: '[data-test="synthetics-check-details-name-input-field"]',
      enabledSwitch: '[data-test="synthetics-check-details-enabled-switch-btn"]',
      targetField: '[data-test="synthetics-check-details-url-input-field"]',
      descriptionField: '[data-test="synthetics-check-details-description-textarea-field"]',
      tagField: '[data-test="synthetics-check-details-tag-input-field"]',
      addTagButton: '[data-test="synthetics-check-details-add-tag-btn"]',
      // Type cards
      addAssertionButton: '[data-test="synthetics-check-http-add-assertion-btn"]',
      tcpPortField: '[data-test="synthetics-check-tcp-port-input-field"]',
      tlsPortField: '[data-test="synthetics-check-tls-port-input-field"]',
      tlsMinDaysField: '[data-test="synthetics-check-tls-min-days-input-field"]',
      tlsVerifyChainSwitch: '[data-test="synthetics-check-tls-verify-chain-switch-btn"]',
      sshPortField: '[data-test="synthetics-check-ssh-port-input-field"]',
      sshUsernameField: '[data-test="synthetics-check-ssh-username-input-field"]',
      sshSecretField: '[data-test="synthetics-check-ssh-secret-input-field"]',
      // Schedule
      frequencyItem: (value) => `[data-test="synthetics-check-schedule-frequency-${value}-item"]`,
      customIntervalField: '[data-test="synthetics-check-schedule-custom-interval-value-input-field"]',
      cronField: '[data-test="synthetics-check-schedule-cron-input-field"]',
      cronError: '[data-test="synthetics-check-schedule-cron-error"]',
      // Configure sections
      basicAuthSwitch: '[data-test="synthetics-check-auth-network-basic-auth-switch-btn"]',
      basicAuthUsernameField: '[data-test="synthetics-check-auth-network-username-input-field"]',
      basicAuthPasswordField: '[data-test="synthetics-check-auth-network-password-input-field"]',
      retriesCountField: '[data-test="synthetics-check-retries-count-input-field"]',
      retriesDelayField: '[data-test="synthetics-check-retries-delay-input-field"]',
      alertThresholdField: '[data-test="synthetics-check-alerts-threshold-input-field"]',
      alertCooldownField: '[data-test="synthetics-check-alerts-cooldown-input-field"]',
      variablesEmpty: '[data-test="synthetics-check-variables-panel-empty"]',
      variablesAddVariableButton: '[data-test="synthetics-check-variables-panel-add-variable-btn"]',
      variablesAddNameField: '[data-test="synthetics-check-variables-panel-add-name-input-field"]',
      variablesAddNameError: '[data-test="synthetics-check-variables-panel-add-name-input-error"]',
      variablesAddValueField: '[data-test="synthetics-check-variables-panel-add-value-input-field"]',
      variablesAddButton: '[data-test="synthetics-check-variables-panel-add-btn"]',
      variablesCount: '[data-test="synthetics-check-variables-panel-count"]',
      variablesRemoveDialog: '[data-test="synthetics-check-variables-panel-remove-dialog"]',
      variablesUndoButton: '[data-test="synthetics-check-variables-panel-undo-btn"]',
      privateLocationsEmpty: '[data-test="synthetics-check-locations-private-empty"]',
      // Footer
      saveButton: '[data-test="synthetics-create-save-btn"]',
      cancelButton: '[data-test="synthetics-create-cancel-btn"]',
      unsavedDialog: '[data-test="synthetics-create-unsaved-dialog"]',
      dialogPrimary: '[data-test="o-dialog-primary-btn"]',
      // Browser gate + journey
      gateUrlField: '[data-test="synthetics-create-url-input-field"]',
      gateUrlError: '[data-test="synthetics-create-url-input-error"]',
      gateNameField: '[data-test="synthetics-create-name-input-field"]',
      buildButton: '[data-test="synthetics-create-build-btn"]',
      addStepButton: '[data-test="synthetics-journey-add-step-btn"]',
      stepActionSelect: '[data-test="synthetics-journey-step-action-select"]',
      assertionKindSelect: '[data-test="synthetics-journey-step-assertion-kind-select"]',
      assertionExpectedField: '[data-test="synthetics-journey-step-assertion-expected-input-field"]',
      stepValueField: '[data-test="synthetics-journey-step-value-input-field"]',
      stepNameField: '[data-test="synthetics-journey-step-name-input-field"]',
      stepLocatorError: '[data-test="synthetics-journey-step-locator-override-input-error"]',
      continueButton: '[data-test="synthetics-create-continue-btn"]',
      journeyStep: '[data-test^="synthetics-journey-step-anchor-"]',
      expandedRow: '[data-test^="o2-table-expanded-row-"]',
      toastMessage: '[data-test="o-toast-message"]',
    };
  }

  locationOption(id) { return `[data-test="synthetics-check-locations-option-${id}"]`; }
  assertionField(i) { return `[data-test="synthetics-check-http-assertion-field-${i}"]`; }
  assertionOperator(i) { return `[data-test="synthetics-check-http-assertion-operator-${i}"]`; }
  assertionValueField(i) { return `[data-test="synthetics-check-http-assertion-value-${i}-field"]`; }
  removeTagButton(i) { return `[data-test="synthetics-check-details-remove-tag-${i}-btn"]`; }
  deviceCell(browser, device) { return `[data-test="synthetics-check-browser-devices-cell-${browser}-${device}"]`; }
  variableRemoveButton(i) { return `[data-test="synthetics-check-variables-panel-remove-${i}-btn"]`; }

  // ---------------------------------------------------------------- navigation

  async gotoCreate(orgId, type) {
    await this.page.goto(`/web/synthetics/add?org_identifier=${orgId}&type=${type}`);
    const firstField = type === 'browser' ? this.locators.gateUrlField : this.locators.nameField;
    await expect(this.page.locator(firstField)).toBeVisible({ timeout: 30000 });
    testLogger.navigation(`Synthetics create (${type})`);
  }

  async gotoEdit(orgId, id) {
    await this.page.goto(`/web/synthetics/edit/${id}?org_identifier=${orgId}`);
  }

  // ------------------------------------------------------ protocol form actions

  async fillName(name) { await this.page.locator(this.locators.nameField).fill(name); }
  async fillTarget(target) { await this.page.locator(this.locators.targetField).fill(target); }
  async fillDescription(text) { await this.page.locator(this.locators.descriptionField).fill(text); }

  async addTag(tag) {
    await this.page.locator(this.locators.tagField).fill(tag);
    await this.page.locator(this.locators.addTagButton).click();
  }

  async removeTag(index) { await this.page.locator(this.removeTagButton(index)).click(); }

  // Appends an assertion row and fills it; `index` is the new row's position.
  async addAssertion(index, field, operator, value) {
    await this.page.locator(this.locators.addAssertionButton).click();
    await selectOSelectOption(this.page, this.assertionField(index), field);
    await selectOSelectOption(this.page, this.assertionOperator(index), operator);
    await this.page.locator(this.assertionValueField(index)).fill(String(value));
  }

  async fillTcp(port) { await this.page.locator(this.locators.tcpPortField).fill(String(port)); }

  async fillTls({ port, minDays }) {
    await this.page.locator(this.locators.tlsPortField).fill(String(port));
    await this.page.locator(this.locators.tlsMinDaysField).fill(String(minDays));
  }

  async setTlsVerifyChain(on) { await this.setSwitch(this.locators.tlsVerifyChainSwitch, on); }

  // Forms default to enabled; tests save disabled so the scheduler never claims what they create.
  async setEnabled(on) { await this.setSwitch(this.locators.enabledSwitch, on); }

  async setSwitch(selector, on) {
    const btn = this.page.locator(selector);
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    const state = await btn.getAttribute('data-state');
    if ((state === 'checked') !== on) await btn.click();
    await expect(btn).toHaveAttribute('data-state', on ? 'checked' : 'unchecked', { timeout: 10000 });
  }

  async fillSsh({ port, username, secret }) {
    await this.page.locator(this.locators.sshPortField).fill(String(port));
    await this.page.locator(this.locators.sshUsernameField).fill(username);
    await this.page.locator(this.locators.sshSecretField).fill(secret);
  }

  async selectLocation(id) {
    const option = this.page.locator(this.locationOption(id));
    await option.waitFor({ state: 'visible', timeout: 30000 });
    const box = option.locator('[role="checkbox"]');
    if ((await box.getAttribute('aria-checked')) !== 'true') await option.click();
    await expect(box).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
  }

  async deselectLocation(id) {
    const option = this.page.locator(this.locationOption(id));
    const box = option.locator('[role="checkbox"]');
    if ((await box.getAttribute('aria-checked')) === 'true') await option.click();
    await expect(box).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
  }

  async setCustomInterval(minutes) {
    await this.page.locator(this.locators.frequencyItem('custom')).click();
    await this.page.locator(this.locators.customIntervalField).fill(String(minutes));
  }

  async setCron(expression) {
    await this.page.locator(this.locators.frequencyItem('cron')).click();
    await this.page.locator(this.locators.cronField).fill(expression);
  }

  async setBasicAuth(username, password) {
    await this.setSwitch(this.locators.basicAuthSwitch, true);
    await this.page.locator(this.locators.basicAuthUsernameField).fill(username);
    await this.page.locator(this.locators.basicAuthPasswordField).fill(password);
  }

  async setRetries(count, delaySecs) {
    await this.page.locator(this.locators.retriesCountField).fill(String(count));
    await this.page.locator(this.locators.retriesDelayField).fill(String(delaySecs));
  }

  async setAlerts(threshold, cooldownMins) {
    await this.page.locator(this.locators.alertThresholdField).fill(String(threshold));
    await this.page.locator(this.locators.alertCooldownField).fill(String(cooldownMins));
  }

  // The empty state owns the only Add affordance until the first variable exists; an open form is reused.
  async openAddVariable() {
    if (await this.page.locator(this.locators.variablesAddNameField).isVisible()) return;
    const empty = this.page.locator(this.locators.variablesEmpty);
    if (await empty.count()) await empty.locator('button').first().click();
    else await this.page.locator(this.locators.variablesAddVariableButton).click();
    await expect(this.page.locator(this.locators.variablesAddNameField)).toBeVisible({ timeout: 10000 });
  }

  async addVariable(name, value) {
    await this.openAddVariable();
    await this.page.locator(this.locators.variablesAddNameField).fill(name);
    await this.page.locator(this.locators.variablesAddValueField).fill(value);
    await this.page.locator(this.locators.variablesAddButton).click();
  }

  async typeVariableName(name) { await this.page.locator(this.locators.variablesAddNameField).fill(name); }

  async undoVariableRemoval() { await this.page.locator(this.locators.variablesUndoButton).click(); }

  async expectVariableNameError(text) {
    await expect(this.page.locator(this.locators.variablesAddNameError)).toContainText(text, { timeout: 10000 });
  }

  async expectVariableCount(count) {
    await expect(this.page.locator(this.locators.variablesCount)).toContainText(String(count), { timeout: 10000 });
  }

  async removeVariable(index) {
    await this.page.locator(this.variableRemoveButton(index)).click();
    const dialog = this.page.locator(this.locators.variablesRemoveDialog);
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator(this.locators.dialogPrimary).click();
  }

  async toggleDevice(browser, device) {
    await this.page.locator(this.deviceCell(browser, device)).click();
  }

  // Resolves with the POST /synthetics response so callers can inspect status and body.
  async saveCapturingResponse() {
    const responsePromise = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/synthetics(\?|$)/.test(r.url()),
      { timeout: 30000 },
    );
    await this.page.locator(this.locators.saveButton).click();
    const response = await responsePromise;
    const text = await response.text().catch(() => '');
    return { status: response.status(), text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  }

  async save() { await this.page.locator(this.locators.saveButton).click(); }

  async cancel() { await this.page.locator(this.locators.cancelButton).click(); }

  async confirmLeave() {
    const dialog = this.page.locator(this.locators.unsavedDialog);
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.locator(this.locators.dialogPrimary).click();
  }

  // ---------------------------------------------------------- browser journey

  async fillGate(url, name) {
    await this.page.locator(this.locators.gateUrlField).fill(url);
    await this.page.locator(this.locators.gateUrlField).blur();
    if (name !== undefined) await this.page.locator(this.locators.gateNameField).fill(name);
  }

  async buildManually() {
    await this.page.locator(this.locators.buildButton).click();
    await expect(this.page.locator(this.locators.addStepButton)).toBeVisible({ timeout: 30000 });
  }

  // Every added step stays expanded, so editor controls are scoped to the newest editor.
  currentEditor() {
    return this.page.locator(this.locators.expandedRow).last();
  }

  async addStep() {
    await this.page.locator(this.locators.addStepButton).click();
    await expect(this.currentEditor().locator(this.locators.stepActionSelect)).toBeVisible({ timeout: 15000 });
  }

  async setStepAction(action) {
    await selectOSelectOption(this.page, this.locators.stepActionSelect, action, { scope: this.currentEditor() });
  }

  // The save gate requires a name on every step.
  async setStepName(name) {
    await this.currentEditor().locator(this.locators.stepNameField).fill(name);
  }

  // "Build manually" starts empty, so the first step is always a navigate added by the author.
  async addNavigateStep(url) {
    await this.addStep();
    await this.setStepAction('navigate');
    await this.setStepName('Open start URL');
    await this.currentEditor().locator(this.locators.stepValueField).fill(url);
  }

  async setAssertion(kind, expected) {
    await selectOSelectOption(this.page, this.locators.assertionKindSelect, kind, { scope: this.currentEditor() });
    await this.currentEditor().locator(this.locators.assertionExpectedField).fill(expected);
  }

  async continueToConfigure() {
    await this.page.locator(this.locators.continueButton).click();
  }

  // ---------------------------------------------------------------- assertions

  async expectSavedAndListed() {
    await this.expectToast('Check saved successfully.');
    await expect(this.page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });
  }

  async expectUpdatedAndListed() {
    await this.expectToast('Check updated successfully.');
    await expect(this.page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });
  }

  async expectToast(text) {
    await expect(this.page.locator(this.locators.toastMessage).filter({ hasText: text }).first())
      .toBeVisible({ timeout: 20000 });
  }

  async expectGateUrlRejected() {
    await expect(this.page.locator(this.locators.gateUrlError)).toBeVisible({ timeout: 10000 });
    await expect(this.page.locator(this.locators.buildButton)).toBeDisabled();
  }

  async expectStepLocatorError() {
    await expect(this.page.locator(this.locators.stepLocatorError).first()).toBeVisible({ timeout: 10000 });
  }

  async expectCronError(visible) {
    const error = this.page.locator(this.locators.cronError);
    if (visible) await expect(error).toBeVisible({ timeout: 10000 });
    else await expect(error).toHaveCount(0);
  }

  async expectNameValue(value) {
    await expect(this.page.locator(this.locators.nameField)).toHaveValue(value, { timeout: 30000 });
  }

  // `loadedId` is a location known to be listed, so "absent" is only asserted once the registry has rendered.
  async expectLocationOffered(id, offered, { loadedId = null } = {}) {
    const option = this.page.locator(this.locationOption(id));
    if (offered) {
      await expect(option).toBeVisible({ timeout: 30000 });
      return;
    }
    if (loadedId) await expect(this.page.locator(this.locationOption(loadedId))).toBeVisible({ timeout: 30000 });
    await expect(option).toHaveCount(0);
  }

  async expectNoPrivateLocationSection() {
    await expect(this.page.locator(this.locators.privateLocationsEmpty)).toHaveCount(0);
  }

  async expectJourneyStepCount(count) {
    await expect(this.page.locator(this.locators.journeyStep)).toHaveCount(count, { timeout: 15000 });
  }

  async expectOnJourneyStep() {
    await expect(this.page.locator(this.locators.continueButton)).toBeVisible();
    await expect(this.page.locator(this.locators.saveButton)).toHaveCount(0);
  }

  async expectOnConfigureStep() {
    await expect(this.page.locator(this.locators.saveButton)).toBeVisible({ timeout: 30000 });
  }
}

export default SyntheticsCreatePage;
