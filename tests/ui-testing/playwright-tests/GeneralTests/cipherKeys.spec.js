const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { CipherKeys } = require('../../pages/generalPages/cipherKeys.js');
const { getOrgIdentifier, isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe("Cipher Keys for security", { tag: '@enterprise' }, () => {

  let cipherKeys;
  const cipherName = `c${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const simpleSecret = process.env['SIMPLE_KEYS'];
  const simpleSecretUp = process.env['SIMPLE_KEYS_UP'];
  const simpleSecretInvalid = 'invalidSecret';

  const tinkeySecretInvalid = `{
          "primaryKeyId": ${process.env['PRIMARY_KEY_ID_VAL']},
      "key": [{
        "keyData": {
          "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
            "value": "${process.env['PRIMARY_KEY_ID_VAL']}",
          "keyMaterialType": "SYMMETRIC"
        },
        "status": "ENABLED",
        "keyId": ${process.env['PRIMARY_KEY_ID_VAL']},
        "outputPrefixType": "TINK"
      }]
    }`;

  const tinkeySecret = `{
      "primaryKeyId": ${process.env['PRIMARY_KEY_ID']},
      "key": [{
        "keyData": {
          "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
          "value": "${process.env['PRIMARY_KEY_ID_VAL']}",
          "keyMaterialType": "SYMMETRIC"
        },
        "status": "ENABLED",
        "keyId": ${process.env['PRIMARY_KEY_ID']},
        "outputPrefixType": "TINK"
      }]
    }`;


  const tinkeySecretUp = `{
      "primaryKeyId": ${process.env['PRIMARY_KEY_ID_UP']},
      "key": [{
        "keyData": {
          "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
          "value": "${process.env['PRIMARY_KEY_ID_VAL_UP']}",
          "keyMaterialType": "SYMMETRIC"
        },
        "status": "ENABLED",
        "keyId": ${process.env['PRIMARY_KEY_ID_UP']},
        "outputPrefixType": "TINK"
      }]
    }`;

  const baseURL = process.env['AKEYLESS_URL'];
  const accessID = process.env['AKEYLESS_ACCESS_ID'];
  const accessKey = process.env['AKEYLESS_ACCESS_KEY'];

  // Static Secrets
  const staticSecretSimple = process.env['STATIC_SECRET_SIMPLE'];
  const staticSecretSimpleUp = process.env['STATIC_SECRET_SIMPLE_UP'];
  const staticSecretTink = process.env['STATIC_SECRET_TINK'];
  const staticSecretTinkUp = process.env['STATIC_SECRET_TINK_UP'];

  const simpleEncryDataDFCInvalid = 'Invalid';

  // DFC Names and Encrypted Data
  const simpleNameDFC = process.env['SIMPLE_NAME_DFC'];
  const simpleEncryDataTedDFC = process.env['SIMPLE_ENCRYPTED_DATA_TED_DFC'];
  const simpleUpNameDFC = process.env['SIMPLE_UP_NAME_DFC'];
  const simpleUpEncryDataTedDFC = process.env['SIMPLE_UP_ENCRYPTED_DATA_TED_DFC'];

  const tinkDFC = process.env['TINK_DFC'];
  const tinkEncryDataTedDFC = process.env['TINK_ENCRYPTED_DATA_TED_DFC'];
  const tinkUpDFC = process.env['TINK_UP_DFC'];
  const tinkUpEncryDataTedDFC = process.env['TINK_UP_ENCRYPTED_DATA_TED_DFC'];


  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    cipherKeys = new CipherKeys(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Cipher keys test setup completed');
  });



  test("Error Message displayed if Simple cipher keys created with invalid secret", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with invalid secret
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO(simpleSecretInvalid);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('warningfailed to decode the key, check if secret value and mechanism match');
    testLogger.info('Test completed successfully');
  });

  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  // Needs additional migration when un-skipped (replace LoginPage, hardcoded org, logsPage references).
  test.skip("Simple cipher keys created, updated and deleted to store at OpenObserve", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO(simpleSecret);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.updateCipherKeysSecretCancel();
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);

    await cipherKeys.signOut();
    await page.waitForTimeout(10000);
    // TODO: Re-login flow needs cloud OIDC migration
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.addCipherKeyOO(simpleSecretUp);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');

    await page.waitForTimeout(1000);
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });

  test("Error Message displayed if Tink cipher keys created with invalid json", async ({ page }) => {
    test.skip(!process.env['PRIMARY_KEY_ID_VAL'], 'Requires PRIMARY_KEY_ID_VAL env var');

    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with invalid secret json
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO(tinkeySecretInvalid);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('warningerror deserializing tink keyset, please check if provided json is valid tink keyset');
    testLogger.info('Test completed successfully');
  });


  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  test.skip("Tink cipher keys created, updated and deleted to store at OpenObserve", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO(tinkeySecret);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.updateCipherKeysSecretCancel();
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);
    // TODO: signOut/re-login needs cloud OIDC migration
    await cipherKeys.signOut();
    await page.waitForTimeout(10000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.addCipherKeyOO(tinkeySecretUp);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.waitForTimeout(1000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });


  test("Error Message displayed if Cipher Key Name Blank", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with blank name
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.verifyAlertMessage('Name is required');
    testLogger.info('Test completed successfully');
  });

  test("Error Message displayed if Cipher Key Secret Blank", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with blank secret
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.verifyAlertMessage('Secret is required');
    testLogger.info('Test completed successfully');
  });

  test("Error Message displayed if Cipher Key Secret Invalid", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with invalid secret
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO('invalidSecret');
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('warningfailed to decode the key, check if secret value and mechanism match');
    testLogger.info('Test completed successfully');
  });

  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  test.skip("Simple cipher keys created, updated and deleted to store at Akeyless with Static Secret", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyType();
    await cipherKeys.addCipherKeyTypeURL(baseURL);
    await cipherKeys.addCipherKeyTypeID(accessID);
    await cipherKeys.addCipherKeyTypeKey(accessKey);
    await cipherKeys.addCipherKeyStaticName(staticSecretSimple);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);
    // TODO: signOut/re-login needs cloud OIDC migration
    await cipherKeys.signOut();
    await page.waitForTimeout(10000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.addCipherKeyStaticName(staticSecretSimpleUp);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.waitForTimeout(1000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });

  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  test.skip("Tink cipher keys created, updated and deleted to store at Akeyless with Static Secret", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyType();
    await cipherKeys.addCipherKeyTypeURL(baseURL);
    await cipherKeys.addCipherKeyTypeID(accessID);
    await cipherKeys.addCipherKeyTypeKey(accessKey);
    await cipherKeys.addCipherKeyStaticName(staticSecretTink);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);
    // TODO: signOut/re-login needs cloud OIDC migration
    await cipherKeys.signOut();
    await page.waitForTimeout(10000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.addCipherKeyStaticName(staticSecretTinkUp);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.waitForTimeout(1000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });

  test("Error Message displayed if DFC Encrypted Data Invalid at Akeyless", async ({ page }) => {
    test.skip(!process.env['AKEYLESS_URL'], 'Requires AKEYLESS env vars');

    await cipherKeys.navigateToSettingsMenu();
    // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();
    // Add Cipher Key with invalid encrypted data

    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyType();
    await cipherKeys.addCipherKeyTypeURL(baseURL);
    await cipherKeys.addCipherKeyTypeID(accessID);
    await cipherKeys.addCipherKeyTypeKey(accessKey);
    await cipherKeys.addCipherKeyDFC();
    await cipherKeys.addCipherKeyNameDFC(simpleNameDFC);
    await cipherKeys.addCipherKeyEncryDataDFC(simpleEncryDataDFCInvalid);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('warningfailed to decode the ciphertext: illegal base64 data at input byte 4');
    testLogger.info('Test completed successfully');
  });

  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  test.skip("Simple cipher keys created, updated and deleted with Akeyless DFC Secret", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyType();
    await cipherKeys.addCipherKeyTypeURL(baseURL);
    await cipherKeys.addCipherKeyTypeID(accessID);
    await cipherKeys.addCipherKeyTypeKey(accessKey);
    await cipherKeys.addCipherKeyDFC();
    await cipherKeys.addCipherKeyNameDFC(simpleNameDFC);
    await cipherKeys.addCipherKeyEncryDataDFC(simpleEncryDataTedDFC);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);
    // TODO: signOut/re-login needs cloud OIDC migration
    await cipherKeys.signOut();
    await page.waitForTimeout(10000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.addCipherKeyNameDFC(simpleUpNameDFC);
    await cipherKeys.addCipherKeyEncryDataDFC(simpleUpEncryDataTedDFC);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.waitForTimeout(1000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });

  // Skipped: Requires signOut/re-login flow not compatible with cloud OIDC auth.
  test.skip("Tink cipher keys created, updated and deleted with Akeyless DFC Secret", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyType();
    await cipherKeys.addCipherKeyTypeURL(baseURL);
    await cipherKeys.addCipherKeyTypeID(accessID);
    await cipherKeys.addCipherKeyTypeKey(accessKey);
    await cipherKeys.addCipherKeyDFC();
    await cipherKeys.addCipherKeyNameDFC(tinkDFC);
    await cipherKeys.addCipherKeyEncryDataDFC(tinkEncryDataTedDFC);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysCancel();
    await page.waitForTimeout(1000);
    // TODO: signOut/re-login needs cloud OIDC migration
    await cipherKeys.signOut();
    await page.waitForTimeout(10000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.addCipherKeyNameDFC(tinkUpDFC);
    await cipherKeys.addCipherKeyEncryDataDFC(tinkUpEncryDataTedDFC);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeyTink();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.waitForTimeout(1000);

    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + `/web/settings/cipher_keys?org_identifier=${getOrgIdentifier()}`);
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key deleted successfully');
  });

});
