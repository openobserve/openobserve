const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const PAGE_TIMEOUT_MS = 30000;

class FleetConfigPage {
  constructor(page) {
    this.page = page;
    this.editorPage = '[data-test="fleet-config-editor-page"]';
    this.backLink = '[data-test="app-page-header-back"]';
    this.modeChip = '[data-test="fleet-config-editor-mode-chip"]';
    this.visualMode = '[data-test="fleet-config-editor-mode-visual"]';
    // The YAML toggle item has no data-test of its own; reka renders its value on the button.
    this.yamlMode = '[data-test="fleet-config-editor-mode"] button[value="yaml"]';
    this.yamlEditor = '[data-test="fleet-config-editor-yaml"]';
    this.canvas = '[data-test="fleet-editor-canvas"]';
    this.validateBtn = '[data-test="fleet-config-editor-validate"]';
    this.validationChip = '[data-test="fleet-config-editor-validation"]';
    this.publishBtn = '[data-test="fleet-config-editor-publish"]';
    this.publishDialog = '[data-test="fleet-config-editor-publish-dialog"]';
    this.publishMessageField = '[data-test="fleet-config-editor-publish-message-field"]';
    this.dialogPrimaryBtn = '[data-test="o-dialog-primary-btn"]';
    this.startRolloutBtn = '[data-test="fleet-config-editor-start-rollout"]';
    this.historyBtn = '[data-test="fleet-config-editor-history"]';
    this.history = '[data-test="fleet-config-history"]';
    this.diff = '[data-test="fleet-config-diff"]';
    this.properties = '[data-test="fleet-component-properties"]';
    this.newSettingKeyField = '[data-test="fleet-component-properties-new-key-field"]';
    this.newSettingValueField = '[data-test="fleet-component-properties-new-value-field"]';
    this.addSettingSubmit = '[data-test="fleet-component-properties-add-submit"]';
    this.successToast = '[data-test^="o-toast-"][data-test-variant="success"]';
  }

  paletteItem(kind, key) {
    return this.page.locator(`[data-test="fleet-component-palette-item-${kind}-${key}"]`);
  }

  node(nodeId) {
    return this.page.locator(`[data-test=${JSON.stringify(`fleet-editor-node-${nodeId}`)}]`);
  }

  // Dotted keys carry quotes and dots, so the attribute value is a quoted CSS string.
  propertyField(key) {
    return this.page.locator(`[data-test=${JSON.stringify(`fleet-component-properties-field-${key}-field`)}]`);
  }

  historyCompare(version) {
    return this.page.locator(`[data-test="fleet-config-history-compare-${version}"]`);
  }

  async goto(configId) {
    const url = `${process.env.ZO_BASE_URL}/web/fleet/configurations/${encodeURIComponent(configId)}?org_identifier=${getOrgIdentifier()}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator(this.editorPage)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.validateBtn)).toBeEnabled({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectTitle(configId) {
    await expect(this.page.locator(this.editorPage).getByRole('heading', { name: configId })).toBeVisible();
  }

  async clickBack() {
    await this.page.locator(this.backLink).click();
  }

  async expectVisualMode() {
    await expect(this.page.locator(this.visualMode)).toHaveAttribute('data-state', 'on', { timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.canvas)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async switchToYaml() {
    if ((await this.page.locator(this.yamlMode).getAttribute('data-state')) !== 'on') await this.page.locator(this.yamlMode).click();
    await expect(this.page.locator(this.yamlMode)).toHaveAttribute('data-state', 'on');
    await expect(this.page.locator(this.yamlEditor)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async switchToVisual() {
    await expect(this.page.locator(this.visualMode)).toBeEnabled({ timeout: PAGE_TIMEOUT_MS });
    await this.page.locator(this.visualMode).click();
    await this.expectVisualMode();
  }

  async expectVisualUnavailable() {
    await expect(this.page.locator(this.visualMode)).toBeDisabled({ timeout: PAGE_TIMEOUT_MS });
  }

  async monaco(action, text) {
    return await this.page.locator(this.yamlEditor).evaluate(
      (node, { action, text }) => {
        const editor = window.monaco?.editor?.getEditors?.().find((e) => node.contains(e.getDomNode()));
        if (!editor) return null;
        if (action === 'set') editor.setValue(text);
        return editor.getValue();
      },
      { action, text },
    );
  }

  async readYaml() {
    await expect.poll(() => this.monaco('read'), { timeout: PAGE_TIMEOUT_MS }).not.toBeNull();
    return await this.monaco('read');
  }

  async expectYaml(expected) {
    await expect.poll(async () => ((await this.monaco('read')) ?? '').trimEnd(), { timeout: PAGE_TIMEOUT_MS }).toBe(
      expected.trimEnd(),
    );
  }

  async setYaml(text) {
    await expect.poll(() => this.monaco('read'), { timeout: PAGE_TIMEOUT_MS }).not.toBeNull();
    await this.monaco('set', text);
    testLogger.info('YAML editor set', { lines: text.split('\n').length });
  }

  async addFromPalette(kind, key, nodeId) {
    await this.paletteItem(kind, key).click();
    await expect(this.node(nodeId)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async selectNode(nodeId) {
    await expect(this.node(nodeId)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await this.node(nodeId).click();
    await expect(this.page.locator(this.properties)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectPropertyValue(key, value) {
    await expect(this.propertyField(key)).toHaveValue(value, { timeout: PAGE_TIMEOUT_MS });
  }

  async expectNoProperty(key) {
    await expect(this.propertyField(key)).toHaveCount(0);
  }

  async setProperty(key, value) {
    await this.propertyField(key).fill(value);
    await expect(this.propertyField(key)).toHaveValue(value);
  }

  async addSetting(key, value) {
    await this.page.locator(this.newSettingKeyField).fill(key);
    await this.page.locator(this.newSettingValueField).fill(value);
    await this.page.locator(this.addSettingSubmit).click();
    await this.expectPropertyValue(key, value);
  }

  async validate() {
    await this.page.locator(this.validateBtn).click();
  }

  async expectValidationChip(text) {
    await expect(this.page.locator(this.validationChip)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }

  async publish(message) {
    await this.page.locator(this.publishBtn).click();
    const dialog = this.page.locator(this.publishDialog);
    await expect(dialog).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await dialog.locator(this.publishMessageField).fill(message);
    await dialog.locator(this.dialogPrimaryBtn).click();
  }

  async expectModeChip(text) {
    await expect(this.page.locator(this.modeChip)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }

  async expectSuccessToast(text) {
    await expect(this.page.locator(this.successToast).filter({ hasText: text }).first()).toBeVisible({
      timeout: PAGE_TIMEOUT_MS,
    });
  }

  async openHistory() {
    await this.page.locator(this.historyBtn).click();
    await expect(this.page.locator(this.history)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectCompareDisabled(version) {
    await expect(this.historyCompare(version)).toBeDisabled({ timeout: PAGE_TIMEOUT_MS });
  }

  async compare(version) {
    await this.historyCompare(version).click();
    await expect(this.page.locator(this.diff)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectDiffContains(text) {
    await expect(this.page.locator(this.diff)).toContainText(text);
  }

  async openDeployFromEditor() {
    await this.page.locator(this.startRolloutBtn).click();
  }
}

module.exports = FleetConfigPage;
