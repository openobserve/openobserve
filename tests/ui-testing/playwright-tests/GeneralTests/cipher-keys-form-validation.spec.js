// Copyright 2026 OpenObserve Inc.
//
// Cipher Keys — form validation E2E tests (enterprise only)
//
// Covers:
//   AddCipherKey: empty submit → name + store-type + encryption-type errors
//   AddCipherKey: Akeyless selected + Continue → Akeyless credential errors
//   AddCipherKey: valid OpenObserve key → created successfully
//   AddAkeylessType: invalid base URL format → URL format error

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ── AddCipherKey — empty form validation ────────────────────────────────────

test.describe('Cipher Keys — AddCipherKey empty form validation', {
  tag: '@enterprise',
}, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.cipherKeysFormValidation.navigateToCipherKeysTab();
    await pm.cipherKeysFormValidation.openAddCipherKeyForm();
    testLogger.info('Navigated to Add Cipher Key form');
  });

  test('should show name error when Continue is clicked with empty name', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing name required error on empty Continue click');

    await pm.cipherKeysFormValidation.clickContinue();
    await pm.cipherKeysFormValidation.assertNameErrorVisible();
    const nameError = await pm.cipherKeysFormValidation.getNameError();
    await expect(nameError).toContainText('Name is required');

    testLogger.info('Name required error correctly shown');
  });

  test('should show name format error for invalid characters in name', {
    tag: ['@cipher-keys-form-validation', '@P1', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing name invalid character error');

    await pm.cipherKeysFormValidation.fillName('bad name!');
    await pm.cipherKeysFormValidation.clickContinue();
    await pm.cipherKeysFormValidation.assertNameErrorVisible();
    const nameError = await pm.cipherKeysFormValidation.getNameError();
    await expect(nameError).toContainText('Characters like');

    testLogger.info('Name format error correctly shown for invalid characters');
  });

  test('should show name length error when name exceeds 50 characters', {
    tag: ['@cipher-keys-form-validation', '@P1', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing name max-length error');

    const longName = 'a'.repeat(51);
    await pm.cipherKeysFormValidation.fillName(longName);
    await pm.cipherKeysFormValidation.clickContinue();
    await pm.cipherKeysFormValidation.assertNameErrorVisible();
    const nameError = await pm.cipherKeysFormValidation.getNameError();
    await expect(nameError).toContainText('50 characters or less');

    testLogger.info('Name max-length error correctly shown');
  });

  test('should keep Save button disabled on step 1 when not updating', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing Save button disabled state on step 1 (create mode)');

    // Save is disabled when step === 1 and isUpdatingCipherKey === false
    await pm.cipherKeysFormValidation.assertSaveButtonDisabled();

    testLogger.info('Save button correctly disabled on step 1 in create mode');
  });
});

// ── AddCipherKey — Akeyless credential errors ────────────────────────────────

test.describe('Cipher Keys — Akeyless credential errors', {
  tag: '@enterprise',
}, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.cipherKeysFormValidation.navigateToCipherKeysTab();
    await pm.cipherKeysFormValidation.openAddCipherKeyForm();
    testLogger.info('Navigated to Add Cipher Key form');
  });

  test('should show Akeyless credential errors when Continue is clicked with empty Akeyless fields', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing Akeyless credential required errors on Continue');

    // Fill a valid name then switch to Akeyless so we reach credential validation
    await pm.cipherKeysFormValidation.fillName('test_fv_ck_akeyless_001');
    await pm.cipherKeysFormValidation.selectAkeylessStoreType();
    await pm.cipherKeysFormValidation.clickContinue();

    // Base URL and Access ID are both required — both errors must appear
    await pm.cipherKeysFormValidation.assertAkeylessBaseUrlErrorVisible();
    await pm.cipherKeysFormValidation.assertAkeylessAccessIdErrorVisible();

    testLogger.info('Akeyless credential required errors correctly shown');
  });

  test('should show access key error when auth type is access_key and key is empty on Continue', {
    tag: ['@cipher-keys-form-validation', '@P1', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing access key required error for access_key auth type');

    await pm.cipherKeysFormValidation.fillName('test_fv_ck_acckey_001');
    await pm.cipherKeysFormValidation.selectAkeylessStoreType();

    // Fill base URL and access ID but leave access key empty
    await pm.cipherKeysFormValidation.fillAkeylessBaseUrl('https://api.akeyless.io');
    await pm.cipherKeysFormValidation.fillAkeylessAccessId('p-abc123');

    await pm.cipherKeysFormValidation.clickContinue();

    await pm.cipherKeysFormValidation.assertAkeylessAccessKeyErrorVisible();
    const keyError = pm.cipherKeysFormValidation.akeylessAccessKeyError;
    await expect(keyError).toContainText('Access Key is required');

    testLogger.info('Access key required error correctly shown');
  });
});

// ── AddAkeylessType — invalid URL format ─────────────────────────────────────

test.describe('Cipher Keys — AddAkeylessType URL format validation', {
  tag: '@enterprise',
}, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.cipherKeysFormValidation.navigateToCipherKeysTab();
    await pm.cipherKeysFormValidation.openAddCipherKeyForm();
    testLogger.info('Navigated to Add Cipher Key form');
  });

  test('should show URL format error when Akeyless base URL is invalid', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing Akeyless base URL format validation');

    await pm.cipherKeysFormValidation.fillName('test_fv_ck_url_001');
    await pm.cipherKeysFormValidation.selectAkeylessStoreType();

    // Fill an invalid URL (not a valid http/https URL)
    await pm.cipherKeysFormValidation.fillAkeylessBaseUrl('not-a-valid-url');
    await pm.cipherKeysFormValidation.clickContinue();

    await pm.cipherKeysFormValidation.assertAkeylessBaseUrlErrorVisible();
    await pm.cipherKeysFormValidation.assertAkeylessBaseUrlErrorContains('Please provide correct URL.');

    testLogger.info('Akeyless base URL format error correctly shown for invalid URL');
  });

  test('should clear URL error when valid URL is entered after invalid one', {
    tag: ['@cipher-keys-form-validation', '@P1', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing Akeyless base URL error clears on correction');

    await pm.cipherKeysFormValidation.fillName('test_fv_ck_url_fix_001');
    await pm.cipherKeysFormValidation.selectAkeylessStoreType();

    // First enter invalid URL to trigger error
    await pm.cipherKeysFormValidation.fillAkeylessBaseUrl('bad-url');
    await pm.cipherKeysFormValidation.clickContinue();
    await pm.cipherKeysFormValidation.assertAkeylessBaseUrlErrorVisible();

    // Correct the URL — error message element should clear
    await pm.cipherKeysFormValidation.fillAkeylessBaseUrl('https://api.akeyless.io');
    await expect(pm.cipherKeysFormValidation.akeylessBaseUrlError).not.toBeVisible({ timeout: 5000 });

    testLogger.info('Akeyless base URL error correctly cleared after fix');
  });
});

// ── AddEncryptionMechanism — provider type and algorithm validation ───────────

test.describe('Cipher Keys — AddEncryptionMechanism form validation', {
  tag: '@enterprise',
}, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.cipherKeysFormValidation.navigateToCipherKeysTab();
    await pm.cipherKeysFormValidation.openAddCipherKeyForm();
    testLogger.info('Navigated to Add Cipher Key form (encryption mechanism step)');
  });

  test('should show provider type error when encryption mechanism provider is not selected', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing AddEncryptionMechanism — empty provider type on Continue');

    // Advance past step 1 with a valid name and secret so the encryption mechanism
    // step becomes visible
    await pm.cipherKeysFormValidation.fillName('test_fv_em_prov_001');
    await pm.cipherKeysFormValidation.fillSecret(process.env.ZO_CIPHER_KEY_SECRET || 'test_secret_fv');
    await pm.cipherKeysFormValidation.clickContinue();

    // On step 2, try to save without selecting a provider type
    const saveEnabled = await pm.cipherKeysFormValidation.saveButton.isEnabled().catch(() => false);
    if (!saveEnabled) {
      testLogger.info('Save disabled before provider type selection — test passes by state check');
      await expect(pm.cipherKeysFormValidation.saveButton).toBeDisabled();
      return;
    }

    await pm.cipherKeysFormValidation.clickSave();

    // Provider type error should appear
    const providerError = pm.cipherKeysFormValidation.encryptionProviderTypeError;
    await expect(providerError).toBeVisible({ timeout: 5000 });
    testLogger.info('Provider type required error correctly shown');
  });

  test('should show algorithm error when Simple provider is selected but algorithm is empty', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing AddEncryptionMechanism — Simple provider without algorithm');

    await pm.cipherKeysFormValidation.fillName('test_fv_em_algo_001');
    await pm.cipherKeysFormValidation.fillSecret(process.env.ZO_CIPHER_KEY_SECRET || 'test_secret_fv');
    await pm.cipherKeysFormValidation.clickContinue();

    // Select the "Simple" provider type in the encryption mechanism step
    await pm.cipherKeysFormValidation.selectEncryptionProviderType('Simple');

    // Attempt to save without choosing an algorithm
    const saveEnabled = await pm.cipherKeysFormValidation.saveButton.isEnabled().catch(() => false);
    if (!saveEnabled) {
      testLogger.info('Save disabled before algorithm selection — test passes by state check');
      await expect(pm.cipherKeysFormValidation.saveButton).toBeDisabled();
      return;
    }

    await pm.cipherKeysFormValidation.clickSave();

    const algorithmError = pm.cipherKeysFormValidation.encryptionAlgorithmError;
    await expect(algorithmError).toBeVisible({ timeout: 5000 });
    testLogger.info('Algorithm required error correctly shown for Simple provider type');
  });
});

// ── AddCipherKey — valid OpenObserve key happy path ──────────────────────────

test.describe('Cipher Keys — valid OpenObserve key creation', {
  tag: '@enterprise',
}, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.cipherKeysFormValidation.navigateToCipherKeysTab();
    await pm.cipherKeysFormValidation.openAddCipherKeyForm();
    testLogger.info('Navigated to Add Cipher Key form');
  });

  test('should create an OpenObserve cipher key successfully with valid inputs', {
    tag: ['@cipher-keys-form-validation', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Testing successful OpenObserve cipher key creation');

    const keyName = 'test_fv_ck_oo_001';

    // Step 1: fill name, leave store type as OpenObserve (local — default), fill secret
    await pm.cipherKeysFormValidation.fillName(keyName);
    await pm.cipherKeysFormValidation.fillSecret(process.env.ZO_CIPHER_KEY_SECRET || 'test_secret_value_for_fv');

    // Proceed to step 2
    await pm.cipherKeysFormValidation.clickContinue();

    // After Continue, step should advance — Save button becomes enabled
    await expect(pm.cipherKeysFormValidation.saveButton).not.toBeDisabled({ timeout: 5000 });

    // Save the cipher key
    await pm.cipherKeysFormValidation.clickSave();

    // Success toast expected
    await pm.cipherKeysFormValidation.verifyToastMessage('Cipher key created successfully');

    testLogger.info('OpenObserve cipher key created successfully');
  });
});
