// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
import { openOSelectDropdown } from '../alertsPages/oselectHelpers.js';

export class CipherKeysFormValidationPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.settingsMenu = page.locator('[data-test="menu-link-/settings-item"]');
    this.cipherKeyTab = page.locator('[data-test="management-cipher-key-tab"]');
    this.addCipherKeyButton = page.locator('[data-test="cipher-keys-add-btn"]');

    // AddCipherKey — name field
    this.nameInput = page.locator('[data-test="add-cipher-key-name-input-field"]');
    this.nameError = page.locator('[data-test="add-cipher-key-name-input-error"]');

    // AddCipherKey — store type select
    this.storeTypeSelect = page.locator('[data-test="add-cipher-key-type-input"]');
    this.storeTypeError = page.locator('[data-test="add-cipher-key-type-input-error"]');
    this.storeTypeAkeylessOption = page.locator('[data-test="add-cipher-key-type-input-option"][data-test-value="akeyless"]');

    // AddCipherKey — step buttons
    this.continueButton = page.locator('[data-test="add-report-step1-continue-btn"]');
    this.saveButton = page.locator('[data-test="add-cipher-key-save-btn"]');
    this.cancelButton = page.locator('[data-test="add-cipher-key-cancel-btn"]');
    this.backButton = page.locator('[data-test="add-cipher-key-step2-back-btn"]');

    // AddOpenobserveType — secret textarea
    this.secretInput = page.locator('[data-test="add-cipher-key-openobserve-secret-input-field"]');
    this.secretError = page.locator('[data-test="add-cipher-key-openobserve-secret-input-error"]');

    // AddAkeylessType — base URL
    this.akeylessBaseUrlInput = page.locator('[data-test="add-cipher-key-akeyless-baseurl-input-field"]');
    this.akeylessBaseUrlError = page.locator('[data-test="add-cipher-key-akeyless-baseurl-input-error"]');

    // AddAkeylessType — access ID
    this.akeylessAccessIdInput = page.locator('[data-test="add-cipher-key-akeyless-access-id-input-field"]');
    this.akeylessAccessIdError = page.locator('[data-test="add-cipher-key-akeyless-access-id-input-error"]');

    // AddAkeylessType — auth method select (akeyless step 1 sub-form).
    // NOTE: shares the data-test "add-cipher-key-auth-method-input" with the
    // AddEncryptionMechanism provider-type select, but the two are never mounted
    // at the same time (akeyless = step 1 sub-form, mechanism = step 2).
    this.authMethodSelect = page.locator('[data-test="add-cipher-key-auth-method-input"]');
    this.authMethodError = page.locator('[data-test="add-cipher-key-auth-method-input-error"]');

    // AddAkeylessType — access key
    this.akeylessAccessKeyInput = page.locator('[data-test="add-cipher-key-akeyless-access-key-input-field"]');
    this.akeylessAccessKeyError = page.locator('[data-test="add-cipher-key-akeyless-access-key-input-error"]');

    // AddAkeylessType — secret type select
    this.secretTypeSelect = page.locator('[data-test="add-cipher-key-secret-type-input"]');
    this.secretTypeError = page.locator('[data-test="add-cipher-key-secret-type-input-error"]');

    // AddAkeylessType — static secret name
    this.staticSecretNameInput = page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input-field"]');
    this.staticSecretNameError = page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input-error"]');

    // AddEncryptionMechanism — provider type select and algorithm select (step 2)
    this.encryptionProviderTypeSelect = page.locator('[data-test="add-cipher-key-auth-method-input"]');
    this.encryptionProviderTypeError = page.locator('[data-test="add-cipher-key-auth-method-input-error"]');
    this.encryptionProviderTypeTrigger = page.locator('[data-test="add-cipher-key-auth-method-input-trigger"]');
    this.encryptionAlgorithmSelect = page.locator('[data-test="add-cipher-algorithm-input"]');
    this.encryptionAlgorithmError = page.locator('[data-test="add-cipher-algorithm-input-error"]');
    this.encryptionAlgorithmTrigger = page.locator('[data-test="add-cipher-algorithm-input-trigger"]');

    // Toast
    this.toastMessages = page.locator('[data-test="o-toast-message"]');
  }

  // ── Per-value option factory (runtime-dynamic value) ─────────────────────────

  /**
   * Returns the listbox option for a select identified by its parent data-test
   * and the option's `data-test-value` (the OSelect value-specific convention).
   */
  getSelectOptionByValue(parentDataTest, value) {
    return this.page.locator(`[data-test="${parentDataTest}-option"][data-test-value="${value}"]`);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  /**
   * Enterprise-availability probe. Navigates into the Cipher Keys tab and
   * POSITIVELY detects whether the (enterprise-only) feature mounted, returning
   * a boolean instead of throwing. Returns false on OSS where the route never
   * mounts so the suite can SKIP rather than fail. Returns true on enterprise.
   */
  async navigateToCipherKeysTab() {
    await this.settingsMenu.waitFor({ state: 'visible' });
    await this.settingsMenu.click();
    await this.page.waitForLoadState('domcontentloaded');
    try {
      await this.cipherKeyTab.waitFor({ state: 'visible', timeout: 15000 });
      await this.cipherKeyTab.click();
      return true;
    } catch {
      return false;
    }
  }

  async openAddCipherKeyForm() {
    await this.addCipherKeyButton.waitFor({ state: 'visible' });
    await this.addCipherKeyButton.click();
    await this.continueButton.waitFor({ state: 'visible' });
  }

  // ── Name field ──────────────────────────────────────────────────────────────

  async fillName(name) {
    await this.nameInput.waitFor({ state: 'attached' });
    await this.nameInput.fill(name, { force: true });
  }

  async clearName() {
    await this.nameInput.waitFor({ state: 'attached' });
    await this.nameInput.fill('', { force: true });
    // Trigger blur so the error fires
    await this.nameInput.dispatchEvent('blur');
  }

  async getNameError() {
    return this.nameError;
  }

  // ── Store type ──────────────────────────────────────────────────────────────

  async selectAkeylessStoreType() {
    await this.storeTypeSelect.waitFor({ state: 'visible' });
    await this.storeTypeSelect.click();
    await this.storeTypeAkeylessOption.waitFor({ state: 'visible' });
    await this.storeTypeAkeylessOption.click();
  }

  // ── Continue / Save ─────────────────────────────────────────────────────────

  async clickContinue() {
    await this.continueButton.waitFor({ state: 'visible' });
    await this.continueButton.click();
  }

  async clickSave() {
    await this.saveButton.waitFor({ state: 'visible' });
    await this.saveButton.click();
  }

  // ── OpenObserve secret ──────────────────────────────────────────────────────

  async fillSecret(secret) {
    await this.secretInput.waitFor({ state: 'attached' });
    await this.secretInput.fill(secret, { force: true });
  }

  // ── Akeyless fields ─────────────────────────────────────────────────────────

  async fillAkeylessBaseUrl(url) {
    await this.akeylessBaseUrlInput.waitFor({ state: 'attached' });
    await this.akeylessBaseUrlInput.fill(url, { force: true });
  }

  async fillAkeylessAccessId(id) {
    await this.akeylessAccessIdInput.waitFor({ state: 'attached' });
    await this.akeylessAccessIdInput.fill(id, { force: true });
  }

  async fillAkeylessAccessKey(key) {
    await this.akeylessAccessKeyInput.waitFor({ state: 'attached' });
    await this.akeylessAccessKeyInput.fill(key, { force: true });
  }

  async fillStaticSecretName(name) {
    await this.staticSecretNameInput.waitFor({ state: 'attached' });
    await this.staticSecretNameInput.fill(name, { force: true });
  }

  async selectAuthMethod(value) {
    await this.authMethodSelect.waitFor({ state: 'visible' });
    await this.authMethodSelect.click();
    const option = this.getSelectOptionByValue('add-cipher-key-auth-method-input', value);
    await option.waitFor({ state: 'visible' });
    await option.click();
  }

  async selectSecretType(value) {
    await this.secretTypeSelect.waitFor({ state: 'visible' });
    await this.secretTypeSelect.click();
    const option = this.getSelectOptionByValue('add-cipher-key-secret-type-input', value);
    await option.waitFor({ state: 'visible' });
    await option.click();
  }

  // ── Toast assertion ─────────────────────────────────────────────────────────

  async verifyToastMessage(expectedText) {
    // Deterministic wait: poll the visible toast text contents until the expected
    // message appears (or the assertion times out).
    await expect
      .poll(
        async () => {
          const texts = await this.toastMessages.allTextContents().catch(() => []);
          return texts.map((t) => (t || '').toLowerCase());
        },
        { timeout: 12000, intervals: [300] },
      )
      .toEqual(expect.arrayContaining([expect.stringContaining(expectedText.toLowerCase())]));
  }

  // ── Assertion helpers ────────────────────────────────────────────────────────

  async assertNameErrorVisible() {
    await expect(this.nameError).toBeVisible({ timeout: 5000 });
  }

  async assertStoreTypeErrorVisible() {
    await expect(this.storeTypeError).toBeVisible({ timeout: 5000 });
  }

  async assertSecretErrorVisible() {
    await expect(this.secretError).toBeVisible({ timeout: 5000 });
  }

  async assertAkeylessBaseUrlErrorVisible() {
    await expect(this.akeylessBaseUrlError).toBeVisible({ timeout: 5000 });
  }

  async assertAkeylessBaseUrlErrorContains(text) {
    await expect(this.akeylessBaseUrlError).toContainText(text, { timeout: 5000 });
  }

  async assertAkeylessAccessIdErrorVisible() {
    await expect(this.akeylessAccessIdError).toBeVisible({ timeout: 5000 });
  }

  async assertAkeylessAccessKeyErrorVisible() {
    await expect(this.akeylessAccessKeyError).toBeVisible({ timeout: 5000 });
  }

  async assertStaticSecretNameErrorVisible() {
    await expect(this.staticSecretNameError).toBeVisible({ timeout: 5000 });
  }

  // ── AddEncryptionMechanism helpers ──────────────────────────────────────────

  async selectEncryptionProviderType(value) {
    // OSelect (reka-ui popover): clicking the root wrapper does NOT open the
    // dropdown, and the trigger can open-then-close on a single click. Drive it
    // through the shared helper (clicks the inner -trigger until aria-expanded).
    await this.encryptionProviderTypeSelect.waitFor({ state: 'visible', timeout: 10000 });
    await openOSelectDropdown(this.page, this.encryptionProviderTypeSelect);
    const option = this.getSelectOptionByValue('add-cipher-key-auth-method-input', value);
    await option.waitFor({ state: 'visible' });
    await option.click();
  }

  async assertEncryptionProviderTypeErrorVisible() {
    await expect(this.encryptionProviderTypeError).toBeVisible({ timeout: 5000 });
  }

  async assertEncryptionProviderTypeErrorHidden() {
    await expect(this.encryptionProviderTypeError).toHaveCount(0);
  }

  async assertEncryptionProviderTypeSelected(label) {
    await expect(this.encryptionProviderTypeTrigger).toHaveAttribute('data-test-selected-label', label, { timeout: 5000 });
  }

  async assertEncryptionAlgorithmErrorVisible() {
    await expect(this.encryptionAlgorithmError).toBeVisible({ timeout: 5000 });
  }

  async assertEncryptionAlgorithmErrorHidden() {
    await expect(this.encryptionAlgorithmError).toHaveCount(0);
  }

  async assertEncryptionAlgorithmSelected(label) {
    await expect(this.encryptionAlgorithmTrigger).toHaveAttribute('data-test-selected-label', label, { timeout: 5000 });
  }

  // R3: Save is never disabled to gate validity — an invalid submit is blocked
  // by the schema and surfaces field errors instead of a dead button.
  async assertSaveButtonEnabled() {
    await expect(this.saveButton).toBeEnabled({ timeout: 5000 });
  }

  async clickSave() {
    await this.saveButton.click();
  }
}
