// cipher keys.js
import { expect } from '@playwright/test';


export class CipherKeys {

    constructor(page) {

        this.page = page;

        this.settingsMenu = page.locator('[data-test="menu-link-settings-item"]');
        this.cipherKeyTab = page.locator('[data-test="management-cipher-key-tab"]');
        this.addCipherKeyButton = page.getByRole('button', { name: 'Add Cipher Key' });
        this.nameInput = page.locator('[data-test="add-cipher-key-name-input"]');
        this.secretInput = page.locator('[data-test="add-cipher-key-openobserve-secret-input"]');
        this.continueButton = page.locator('[data-test="add-report-step1-continue-btn"]');
        this.saveButton = page.locator('[data-test="add-cipher-key-save-btn"]');
        this.alert = page.getByRole('alert').first();


    }

    async navigateToSettingsMenu() {
        await this.page.waitForSelector('[data-test="menu-link-settings-item"]');
        await this.settingsMenu.click();
      }
    
      async navigateToCipherKeyTab() {
        await this.page.waitForSelector('[data-test="management-cipher-key-tab"]');
        await this.cipherKeyTab.click();
      }

      async addCipherKey() {
        await this.page.waitForSelector('button', { name: 'Add Cipher Key' });
        await this.addCipherKeyButton.click();
       
      }

      async addCipherKeyName(name) {
    
        await this.page.waitForSelector('[data-test="add-cipher-key-name-input"]');
        await this.nameInput.fill(name);  
      }
    

      async addCipherKeyOO(secret) {
        await this.page.waitForSelector('[data-test="add-cipher-key-openobserve-secret-input"]');
        await this.secretInput.fill(secret);
      }

      async addCipherKeyContinue() {
        await this.page.waitForSelector('[data-test="add-report-step1-continue-btn"]');
        await this.continueButton.click();
      }

      async addCipherKeyTink() {
        await this.page.waitForSelector('[data-test="add-cipher-key-auth-method-input"]');
        await this.page.locator('[data-test="add-cipher-key-auth-method-input"]').click();
        await this.page.getByRole('option', { name: 'Tink KeySet' }).click();
      }

      async addCipherKeyType() {
        await this.page.waitForSelector('[data-test="add-cipher-key-type-input"]');
        await this.page.locator('[data-test="add-cipher-key-type-input"]').getByText('OpenObserve').click();
        await this.page.getByText('Akeyless').click();
      }

      async addCipherKeyTypeURL(abase) {
        await this.page.waitForSelector('[data-test="add-cipher-key-akeyless-baseurl-input"]');
        await this.page.locator('[data-test="add-cipher-key-akeyless-baseurl-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-akeyless-baseurl-input"]').fill(abase);
      }

      async addCipherKeyTypeID(aid) {
        await this.page.waitForSelector('[data-test="add-cipher-key-akeyless-access-id-input"]');
        await this.page.locator('[data-test="add-cipher-key-akeyless-access-id-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-akeyless-access-id-input"]').fill(aid);
      }

      async addCipherKeyTypeKey(akey) {
        await this.page.waitForSelector('[data-test="add-cipher-key-akeyless-access-key-input"]');
        await this.page.locator('[data-test="add-cipher-key-akeyless-access-key-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-akeyless-access-key-input"]').fill(akey);
      }

      async addCipherKeyStatic() {
        await this.page.waitForSelector('[data-test="add-cipher-key-secret-type-input"]');
        await this.page.locator('[data-test="add-cipher-key-secret-type-input"]').click();
        await this.page.getByRole('option', { name: 'Static Secret' }).locator('span').click();
    }

      async addCipherKeyStaticName(astatic) {
        await this.page.waitForSelector('[data-test="add-cipher-key-akeyless-static-secret-name-input"]');
        await this.page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input"]').fill(astatic);
    }

      async addCipherKeySave() {
        await this.page.waitForSelector('[data-test="add-cipher-key-save-btn"]');
        await this.saveButton.click();
      }


      async verifyAlertMessage(expectedText) {
    
        await expect(this.alert).toContainText(expectedText);
      }
    



}
