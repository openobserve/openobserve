// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';

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

    // AddCipherKey — step buttons
    this.continueButton = page.locator('[data-test="add-report-step1-continue-btn"]');
    this.saveButton = page.locator('[data-test="add-cipher-key-save-btn"]');
    this.cancelButton = page.locator('[data-test="add-cipher-key-cancel-btn"]');
    this.backButton = page.locator('[data-test="add-cipher-key-step2-back-btn"]');

    // AddOpenobserveType — secret textarea
    this.secretInput = page.locator('[data-test="add-cipher-key-openobserve-secret-input-field"]');
    this.secretError = page.locator('[data-test="add-cipher-key-openobserve-secret-input"] [role="alert"]');

    // AddAkeylessType — base URL
    this.akeylessBaseUrlInput = page.locator('[data-test="add-cipher-key-akeyless-baseurl-input-field"]');
    this.akeylessBaseUrlError = page.locator('[data-test="add-cipher-key-akeyless-baseurl-input-error"]');

    // AddAkeylessType — access ID
    this.akeylessAccessIdInput = page.locator('[data-test="add-cipher-key-akeyless-access-id-input-field"]');
    this.akeylessAccessIdError = page.locator('[data-test="add-cipher-key-akeyless-access-id-input-error"]');

    // AddAkeylessType — auth method select
    this.authMethodSelect = page.locator('[data-test="add-cipher-key-auth-method-input"]').first();
    this.authMethodError = page.locator('[data-test="add-cipher-key-auth-method-input-error"]').first();

    // AddAkeylessType — access key
    this.akeylessAccessKeyInput = page.locator('[data-test="add-cipher-key-akeyless-access-key-input-field"]');
    this.akeylessAccessKeyError = page.locator('[data-test="add-cipher-key-akeyless-access-key-input-error"]');

    // AddAkeylessType — secret type select
    this.secretTypeSelect = page.locator('[data-test="add-cipher-key-secret-type-input"]');
    this.secretTypeError = page.locator('[data-test="add-cipher-key-secret-type-input-error"]');

    // AddAkeylessType — static secret name
    this.staticSecretNameInput = page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input-field"]');
    this.staticSecretNameError = page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input-error"]');

    // AddEncryptionMechanism — provider type select and algorithm select
    this.encryptionProviderTypeSelect = page.locator('[data-test="add-cipher-key-auth-method-input"]').last();
    this.encryptionProviderTypeError = page.locator('[data-test="add-cipher-key-auth-method-input-error"]').last();
    this.encryptionAlgorithmSelect = page.locator('[data-test="add-cipher-algorithm-input"]');
    this.encryptionAlgorithmError = page.locator('[data-test="add-cipher-algorithm-input-error"]');

    // Toast
    this.toastMessages = page.locator('[data-test="o-toast-message"]');
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  async navigateToCipherKeysTab() {
    await this.settingsMenu.waitFor({ state: 'visible' });
    await this.settingsMenu.click();
    await this.cipherKeyTab.waitFor({ state: 'visible' });
    await this.cipherKeyTab.click();
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

  async selectStoreType(label) {
    await this.storeTypeSelect.waitFor({ state: 'visible' });
    await this.storeTypeSelect.click();
    await this.page.locator('[data-test="add-cipher-key-type-input-option"]', { hasText: label }).first().click();
  }

  async selectAkeylessStoreType() {
    await this.selectStoreType('Akeyless');
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
    // Trigger change event so validation fires
    await this.akeylessBaseUrlInput.dispatchEvent('input');
  }

  async fillAkeylessAccessId(id) {
    await this.akeylessAccessIdInput.waitFor({ state: 'attached' });
    await this.akeylessAccessIdInput.fill(id, { force: true });
    await this.akeylessAccessIdInput.dispatchEvent('input');
  }

  async fillAkeylessAccessKey(key) {
    await this.akeylessAccessKeyInput.waitFor({ state: 'attached' });
    await this.akeylessAccessKeyInput.fill(key, { force: true });
    await this.akeylessAccessKeyInput.dispatchEvent('input');
  }

  async fillStaticSecretName(name) {
    await this.staticSecretNameInput.waitFor({ state: 'attached' });
    await this.staticSecretNameInput.fill(name, { force: true });
    await this.staticSecretNameInput.dispatchEvent('input');
  }

  async selectAuthMethod(label) {
    await this.authMethodSelect.waitFor({ state: 'visible' });
    await this.authMethodSelect.click();
    await this.page.locator('[data-test="add-cipher-key-auth-method-input-option"]', { hasText: label }).first().click();
  }

  async selectSecretType(label) {
    await this.secretTypeSelect.waitFor({ state: 'visible' });
    await this.secretTypeSelect.click();
    await this.page.locator('[data-test="add-cipher-key-secret-type-input-option"]', { hasText: label }).first().click();
  }

  // ── Toast assertion ─────────────────────────────────────────────────────────

  async verifyToastMessage(expectedText) {
    const timeout = 12000;
    const interval = 300;
    let elapsed = 0;
    let lastSeenTexts = [];

    const lowerExpected = expectedText.toLowerCase();
    while (elapsed < timeout) {
      const texts = await this.toastMessages.allTextContents().catch(() => []);
      lastSeenTexts = texts;
      if (texts.some(t => t && t.toLowerCase().includes(lowerExpected))) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
      elapsed += interval;
    }

    const seen = lastSeenTexts.length > 0
      ? `Last visible toasts: ${JSON.stringify(lastSeenTexts)}`
      : 'No toasts were visible at last check.';
    throw new Error(`Expected toast message "${expectedText}" not found within ${timeout}ms. ${seen}`);
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

  async selectEncryptionProviderType(label) {
    await this.encryptionProviderTypeSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.encryptionProviderTypeSelect.click();
    await this.page.locator('[data-test="add-cipher-key-auth-method-input-option"]', { hasText: label }).first().click();
  }

  async assertEncryptionProviderTypeErrorVisible() {
    await expect(this.encryptionProviderTypeError).toBeVisible({ timeout: 5000 });
  }

  async assertEncryptionAlgorithmErrorVisible() {
    await expect(this.encryptionAlgorithmError).toBeVisible({ timeout: 5000 });
  }

  async assertSaveButtonDisabled() {
    await expect(this.saveButton).toBeDisabled({ timeout: 5000 });
  }
}
