import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { CipherKeys } from "../pages/cipherKeys.js";



test.describe("Cipher Keys for security", () => {
    let loginPage, cipherKeys;
    const cipherName = `c${Date.now()}`;
    const simpleSecret = `6h/Q/OootEDxfBAYXGSNT5ASinQxjDw0tsBSE6qn40O+0UGw0ToYQFyPJualHGDW35Z7PF6P/wTkW4LV9JrG3w==`;
    const simpleSecretUp = `GNf6McCq0Sm7LCrnnPr4ge+6TG4V1XOGRqXW8m7s5cL50xq4oQEQFDFHevng2UQ8LYUnqwZDPCivlpenqJtpMw==`;
    const tinkeySecret = `{"primaryKeyId":2736465847,"key":[{"keyData":{"typeUrl":"type.googleapis.com/google.crypto.tink.AesSivKey","value":"EkATbqipZ/Ki/pWbVP/13iabG5tGrWoWZ65FQ/sNdiAShyWgw9La/pPJ1CKVOEvH29U/KAWBaCQ0dq0PkVopgSfc","keyMaterialType":"SYMMETRIC"},"status":"ENABLED","keyId":2736465847,"outputPrefixType":"TINK"}]}`;
    const baseURL = `https://api.akeyless.io`;
    const accessID = `p-c7k3ogiwk1z9am`;
    const accessKey = `tT5/Q0SrSyL80E3g7tU7PSymsG2m24s3EaYiCRl5VFc=`;
    const staticSecretSimple = `SimpleOO`;
    const staticSecretTink = `Test`;
    const simpleNameDFC = `TeD`;
    const simpleEncryDataDFCInvalid = 'Invalid';
    const simpleEncryDataTedDFC = 'AQAAAAEIAUcEh+OcmRtihrzgoqFOsjEvf0DARDAaYoSW1ihdKi2jjaZH4F9Zdd0fhgb8vnt+jj4BVeYvIZidsKOPqvEmnWmsxf+5sv/6WLgN07f3g80TiKfKEkmmuddB7SUFwCabKiXdS2EIF+g6kyE6HqXsY/p+69977ws4yxoMtcQ=';
    const tinkDFC = `loc/tinkfolder`;
 
    const tinkEncryDataTedDFC = 'AQAAAAEIAUnK/tp8YfW+dOTV6LPj4b9xYj3aN3c1hEFKB3TxxwRqE8gBLZFN/vg+Q9zxoTD5UqXNRyX2WuAXh5Qwuh3fz9kNwM9wUP47/Ju/ZYMIhEM+ENRRfoMnV5txR0IBoU0k7H1KD59EPptx6S/+B1/bRO4h+HDjYhsPeZFLtP7JmV+lksLpbkia3OGHAtXqYIOnhRTkIuAF5ILbrNGruUm4xVNxuZFKltDcB+4X0DWW5IAUC45TXR2OOAO7skPKjiDAgCF493MjXrTYh6AaPTXN/zMIAvF1NzK8BOTe2KGidCKJ0oNKKarA5gyToAAkkKcWEqjW3RsWqkQF1Yip4xZYM+TQvMa/vhUQW1hWAumOJKqbWqvLifPfOERkFW3AgxVQH4RtMN9/gtXjI6OvmPYiEQIgK0c3GldtKYfQA+aAuzm6fVR0D6y0miH9+F1U0/o9tHIJTg==';



    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        cipherKeys = new CipherKeys(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();

    });


    test("Simple cipher keys created and Updated to store at OpenObserve", async ({ page }) => {
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
    await page.goto(process.env["ZO_BASE_URL"] + "/web/settings/cipher_keys?org_identifier=default");
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.updateCipherKeysSecretCancel();
    await cipherKeys.updateCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + "/web/settings/cipher_keys?org_identifier=default");
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.updateCipherKeys(cipherName);
    await cipherKeys.updateCipherKeysSecret();
    await cipherKeys.addCipherKeyOO(simpleSecretUp);
    await cipherKeys.addCipherKeyContinue();
    await cipherKeys.addCipherKeySave();
    await cipherKeys.verifyAlertMessage('check_circleCipher key updated successfully');
    await page.goto(process.env["ZO_BASE_URL"] + "/web/settings/cipher_keys?org_identifier=default");
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysCancel();
    await page.goto(process.env["ZO_BASE_URL"] + "/web/settings/cipher_keys?org_identifier=default");
    await cipherKeys.navigateToSettingsMenu();
    await cipherKeys.navigateToCipherKeyTab();
    await cipherKeys.deletedCipherKeys(cipherName);
    await cipherKeys.requestCipherKeysOk();
    await cipherKeys.verifyAlertMessage('check_circleCipher Key ${cipherName} deleted successfully');



    });

    test("Tink cipher keys created to store at OpenObserve", async ({ page }) => {
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

    test("Simple cipher keys created successfully to store at Akeyless with Static Secret", async ({ page }) => {
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
        await cipherKeys.addCipherKeyStaticName(staticSecretSimple);
        await cipherKeys.addCipherKeyContinue();
        await cipherKeys.addCipherKeySave();
        await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
    
        });

        test("Tink cipher keys created successfully to store at Akeyless with Static Secret", async ({ page }) => {
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
          await cipherKeys.addCipherKeyStaticName(staticSecretTink);
          await cipherKeys.addCipherKeyContinue();
          await cipherKeys.addCipherKeyTink();
          await cipherKeys.addCipherKeySave();
          await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
      
          });

        test("Error Message displayed if DFC Encrypted Data Invalid at Akeyless", async ({ page }) => {
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
          await cipherKeys.addCipherKeyDFC();
          await cipherKeys.addCipherKeyNameDFC(simpleNameDFC);
          await cipherKeys.addCipherKeyEncryDataDFC(simpleEncryDataDFCInvalid);
          await cipherKeys.addCipherKeyContinue();
          await cipherKeys.addCipherKeySave();
          await cipherKeys.verifyAlertMessage('warningAuthentication Error : failed to decode the ciphertext: illegal base64 data at input byte 4');
      
          });

          test("Simple cipher keys created successfully at Akeyless with DFC Secret", async ({ page }) => {
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
            await cipherKeys.addCipherKeyDFC();
            await cipherKeys.addCipherKeyNameDFC(simpleNameDFC);
            await cipherKeys.addCipherKeyEncryDataDFC(simpleEncryDataTedDFC);
            await cipherKeys.addCipherKeyContinue();
            await cipherKeys.addCipherKeySave();
            await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
        
            }); 

            test("Tink cipher keys created successfully at Akeyless with DFC Secret", async ({ page }) => {
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
              await cipherKeys.addCipherKeyDFC();
              await cipherKeys.addCipherKeyNameDFC(tinkDFC);
              await cipherKeys.addCipherKeyEncryDataDFC(tinkEncryDataTedDFC);
              await cipherKeys.addCipherKeyContinue();
              await cipherKeys.addCipherKeyTink();
              await cipherKeys.addCipherKeySave();
              await cipherKeys.verifyAlertMessage('check_circleCipher key created successfully');
          
              }); 

});
