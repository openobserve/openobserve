import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { CipherKeys } from "../pages/cipherKeys.js";



test.describe("Cipher Keys for security", () => {
    let loginPage, cipherKeys;
    const cipherName = `c${Date.now()}`;
    const simpleSecret = `6h/Q/OootEDxfBAYXGSNT5ASinQxjDw0tsBSE6qn40O+0UGw0ToYQFyPJualHGDW35Z7PF6P/wTkW4LV9JrG3w==`;
    const tinkeySecret = `{"primaryKeyId":2736465847,"key":[{"keyData":{"typeUrl":"type.googleapis.com/google.crypto.tink.AesSivKey","value":"EkATbqipZ/Ki/pWbVP/13iabG5tGrWoWZ65FQ/sNdiAShyWgw9La/pPJ1CKVOEvH29U/KAWBaCQ0dq0PkVopgSfc","keyMaterialType":"SYMMETRIC"},"status":"ENABLED","keyId":2736465847,"outputPrefixType":"TINK"}]}`;
    const baseURL = `https://api.akeyless.io`;
    const accessID = `p-c7k3ogiwk1z9am`;
    const accessKey = `tT5/Q0SrSyL80E3g7tU7PSymsG2m24s3EaYiCRl5VFc=`;
    const staticSecretName = `SimpleOO`;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        cipherKeys = new CipherKeys(page);
        await loginPage.gotoLoginPage();
       // await loginPage.loginAsInternalUser();
        await loginPage.login();

    });


    test("Simple cipher keys created", async ({ page }) => {
    await cipherKeys.navigateToSettingsMenu();
      // Navigate to Cipher Key Management
    await cipherKeys.navigateToCipherKeyTab();

      // Add Cipher Key
    
    await cipherKeys.addCipherKey();
    await cipherKeys.addCipherKeyName(cipherName);
    await cipherKeys.addCipherKeyOO(simpleSecret);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');

    });

    test("Tink cipher keys created", async ({ page }) => {
        await cipherKeys.navigateToSettingsMenu();
          // Navigate to Cipher Key Management
        await cipherKeys.navigateToCipherKeyTab();
    
          // Add Cipher Key
        
        await cipherKeys.addCipherKey();
        await cipherKeys.addCipherKeyName(cipherName);
        await cipherKeys.addCipherKeyOO(tinkeySecret);
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.addCipherKeyTink();
        await cipherKeys.addCipherKeySave();
        await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    
        });
    
    test("Error Message displayed if Cipher Key Name Blank", async ({ page }) => {  
        await cipherKeys.navigateToSettingsMenu();
          // Navigate to Cipher Key Management
        await cipherKeys.navigateToCipherKeyTab();
    
          // Add Cipher Key
        
        await cipherKeys.addCipherKey();
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.verifyAlertMessage('Name is required');
    
    });

    test("Error Message displayed if Cipher Key Secret Blank", async ({ page }) => {  
        await cipherKeys.navigateToSettingsMenu();
          // Navigate to Cipher Key Management
        await cipherKeys.navigateToCipherKeyTab();
    
          // Add Cipher Key
        
        await cipherKeys.addCipherKey();
        await cipherKeys.addCipherKeyName(cipherName);
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.verifyAlertMessage('Secret is required');
    
    });

    test("Error Message displayed if Cipher Key Secret Invalid", async ({ page }) => {  
        await cipherKeys.navigateToSettingsMenu();
          // Navigate to Cipher Key Management
        await cipherKeys.navigateToCipherKeyTab();
    
          // Add Cipher Key
        
        await cipherKeys.addCipherKey();
        await cipherKeys.addCipherKeyName(cipherName);
        await cipherKeys.addCipherKeyOO('invalidSecret');
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.addCipherKeySave();
        await cipherKeys.verifyAlertMessage('warningAlgorithm Error : error in decoding key, check if key value and mechanism match');
    
    });

    test("Simple cipher keys created successfully at Akeyless", async ({ page }) => {
        await cipherKeys.navigateToSettingsMenu();
        // Navigate to Cipher Key Management
        await cipherKeys.navigateToCipherKeyTab();
    
        // Add Cipher Key
        
        await cipherKeys.addCipherKey();
        await cipherKeys.addCipherKeyName(cipherName);
        await cipherKeys.addCipherKeyType();
        await cipherKeys.addCipherKeyTypeURL(baseURL);
        await cipherKeys.addCipherKeyTypeID(accessID);
        await cipherKeys.addCipherKeyTypeKey(accessKey);
        await cipherKeys.addCipherKeyStaticName(staticSecretName);
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.addCipherKeySave();
        await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    
        });

            


});
