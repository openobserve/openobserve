import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

// The test-page controls sit here with the other telephony surfaces because the test page is what proves a provider works.
export class TelephonySettingsPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    const dialog = '[data-test="telephony-account-dialog"]';
    const confirm = '[data-test="confirm-dialog"]';
    return {
      settingsTab: '[data-test="telephony-settings-tab"]',
      title: '[data-test="telephony-settings-title"]',
      readOnly: '[data-test="telephony-settings-read-only"]',
      forbidden: '[data-test="telephony-settings-forbidden"]',
      hero: '[data-test="telephony-settings-hero"]',
      connectAction: '[data-test="o2-empty-state-action-connect"]',
      deployment: '[data-test="telephony-settings-deployment"]',
      useOwn: '[data-test="telephony-settings-use-own"]',
      connected: '[data-test="telephony-settings-connected"]',
      update: '[data-test="telephony-settings-update"]',
      disconnect: '[data-test="telephony-settings-disconnect"]',
      press4: '[data-test="telephony-settings-press4"]',
      cardMeta: '[data-test="telephony-card-meta"]',
      cardStatus: '[data-test="telephony-card-status"]',

      dialog,
      dialogRefusal: '[data-test="telephony-account-dialog-refusal"]',
      dialogSid: '[data-test="telephony-account-dialog-sid-field"]',
      dialogToken: '[data-test="telephony-account-dialog-token-field"]',
      dialogFrom: '[data-test="telephony-account-dialog-from-field"]',
      dialogPrimary: `${dialog} [data-test="o-dialog-primary-btn"]`,
      dialogCancel: `${dialog} [data-test="o-dialog-secondary-btn"]`,

      confirmDialog: confirm,
      confirmMessage: `${confirm} [data-test="dialog-box"]`,
      confirmPrimary: `${confirm} [data-test="o-dialog-primary-btn"]`,

      simulatorPriorityTrigger: '[data-test="oncall-simulator-priority-trigger"]',
      simulatorPriorityOption: '[data-test="oncall-simulator-priority-option"]',
      simulatorSendTest: '[data-test="oncall-simulator-send-test"]',
      simulatorTestResult: '[data-test="oncall-simulator-test-result"]',
      simulatorTestAttempts: '[data-test^="oncall-simulator-test-attempt-"]',
    };
  }

  async goto(orgId) {
    await this.page.goto(`/web/settings/telephony?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Telephony settings');
  }

  async gotoThroughSettingsMenu(orgId) {
    await this.page.goto(`/web/settings/?org_identifier=${orgId}`);
    const tab = this.page.locator(this.locators.settingsTab);
    await tab.waitFor({ state: 'visible', timeout: 30000 });
    await tab.click();
    await this.page.waitForURL(/\/settings\/telephony/, { timeout: 30000 });
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
  }

  async reload() {
    await this.page.reload();
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
  }

  async expectTitle(words) {
    await expect(this.page.locator(this.locators.title)).toContainText(words, { timeout: 30000 });
  }

  async expectHero({ title, action }) {
    await expect(this.page.locator(this.locators.hero)).toContainText(title, { timeout: 30000 });
    await expect(this.page.locator(this.locators.connectAction)).toContainText(action);
  }

  async expectNoHero() {
    await expect(this.page.locator(this.locators.hero)).toHaveCount(0, { timeout: 30000 });
  }

  async expectConnectedCard({ from, shortSid, status }) {
    await expect(this.page.locator(this.locators.connected)).toBeVisible({ timeout: 30000 });
    const meta = this.page.locator(this.locators.cardMeta);
    await expect(meta).toContainText(from, { timeout: 30000 });
    await expect(meta).toContainText(shortSid);
    await expect(this.page.locator(this.locators.cardStatus)).toHaveText(status, { timeout: 30000 });
  }

  async expectDeploymentCard({ title, from, useOwn }) {
    const card = this.page.locator(this.locators.deployment);
    await expect(card).toContainText(title, { timeout: 30000 });
    await expect(this.page.locator(this.locators.cardMeta)).toContainText(from);
    await expect(this.page.locator(this.locators.useOwn)).toHaveText(useOwn);
  }

  async expectKeysRow({ available, words }) {
    const row = this.page.locator(this.locators.press4);
    await expect(row).toHaveAttribute('data-available', String(available), { timeout: 30000 });
    for (const word of words) await expect(row).toContainText(word);
  }

  async expectControlsEnabled() {
    await expect(this.page.locator(this.locators.update)).toBeEnabled({ timeout: 30000 });
    await expect(this.page.locator(this.locators.disconnect)).toBeEnabled();
    await expect(this.page.locator(this.locators.readOnly)).toHaveCount(0);
  }

  async expectReadOnly(sentence) {
    await expect(this.page.locator(this.locators.readOnly)).toHaveText(sentence, { timeout: 30000 });
    await expect(this.page.locator(this.locators.update)).toBeDisabled();
    await expect(this.page.locator(this.locators.disconnect)).toBeDisabled();
  }

  async expectForbidden(sentence) {
    await expect(this.page.locator(this.locators.forbidden)).toHaveText(sentence, { timeout: 45000 });
    await expect(this.page.locator(this.locators.connected)).toHaveCount(0);
    await this.expectNoHero();
  }

  async openConnectDialog() {
    await this.page.locator(this.locators.connectAction).click();
    await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 20000 });
  }

  async openUseOwnDialog() {
    await this.page.locator(this.locators.useOwn).click();
    await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 20000 });
  }

  async openUpdateDialog() {
    await this.page.locator(this.locators.update).click();
    await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 20000 });
  }

  async expectDialogSays(words) {
    await expect(this.page.locator(this.locators.dialog)).toContainText(words, { timeout: 20000 });
  }

  async expectPrimaryButton(words) {
    await expect(this.page.locator(this.locators.dialogPrimary)).toHaveText(words, { timeout: 20000 });
  }

  async expectPrimaryButtonVisible() {
    await expect(this.page.locator(this.locators.dialogPrimary)).toBeVisible({ timeout: 20000 });
  }

  async fillAccount({ sid, token, from }) {
    if (sid !== undefined) await this.page.locator(this.locators.dialogSid).fill(sid);
    if (token !== undefined) await this.page.locator(this.locators.dialogToken).fill(token);
    if (from !== undefined) await this.page.locator(this.locators.dialogFrom).fill(from);
  }

  async clickPrimary() {
    await this.page.locator(this.locators.dialogPrimary).click();
  }

  async expectDialogClosed() {
    await expect(this.page.locator(this.locators.dialog)).toHaveCount(0, { timeout: 30000 });
  }

  async expectRefusal(sentence) {
    await expect(this.page.locator(this.locators.dialogRefusal)).toHaveText(sentence, { timeout: 30000 });
  }

  async expectNoRefusal() {
    await expect(this.page.locator(this.locators.dialogRefusal)).toHaveCount(0);
  }

  async cancelDialog() {
    await this.page.locator(this.locators.dialogCancel).click();
    await this.expectDialogClosed();
  }

  async expectTokenInputHiddenAndEmpty() {
    const token = this.page.locator(this.locators.dialogToken);
    await expect(token).toHaveAttribute('type', 'password', { timeout: 20000 });
    await expect(token).toHaveValue('');
  }

  async openDisconnectConfirm() {
    await this.page.locator(this.locators.disconnect).click();
    await expect(this.page.locator(this.locators.confirmDialog)).toBeVisible({ timeout: 20000 });
  }

  async expectDisconnectCopy(sentence) {
    await expect(this.page.locator(this.locators.confirmMessage)).toContainText(sentence, { timeout: 20000 });
  }

  async confirmDisconnect() {
    await this.page.locator(this.locators.confirmPrimary).click();
    await expect(this.page.locator(this.locators.confirmDialog)).toHaveCount(0, { timeout: 30000 });
  }

  // OpenFGA is off on the Playwright shards, so no non-admin can sign in; never route /config, the app's bootstrap hangs on it.
  async refuseAtNetworkEdge(orgId, methods) {
    const path = `/api/${orgId}/telephony`;
    await this.page.route(
      (url) => url.pathname === path,
      async (route, request) => {
        if (methods.includes(request.method())) {
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Forbidden' }),
          });
          return;
        }
        await route.fallback();
      },
    );
  }

  async chooseSimulatorPriority(value) {
    await this.page.locator(this.locators.simulatorPriorityTrigger).click();
    const option = this.page.locator(`${this.locators.simulatorPriorityOption}[data-test-value="${value}"]`);
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
    await expect(this.page.locator(this.locators.simulatorPriorityTrigger), 'the priority must commit')
      .toHaveAttribute('data-test-selected-value', value, { timeout: 20000 });
  }

  async sendTestPage() {
    await this.page.locator(this.locators.simulatorSendTest).click();
    await expect(this.page.locator(this.locators.simulatorTestResult)).toBeVisible({ timeout: 45000 });
  }

  async readTestAttempts() {
    const lines = await this.page.locator(this.locators.simulatorTestAttempts).allInnerTexts();
    return lines.map((line) => line.replace(/\s+/g, ' ').trim());
  }
}

export default TelephonySettingsPage;
