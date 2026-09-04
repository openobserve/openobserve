// cipher keys.js
import { expect } from '@playwright/test';


export class CipherKeys {

    constructor(page) {

        this.page = page;

        this.settingsMenu = page.locator('[data-test="menu-link-/settings-item"]');
        this.cipherKeyTab = page.locator('[data-test="management-cipher-key-tab"]');
        this.addCipherKeyButton = page.locator('[data-test="cipher-keys-add-btn"]');
        // OInput wrapper: [data-test="add-cipher-key-name-input"]
        // Native <input>:  [data-test="add-cipher-key-name-input-field"] (-field suffix, hidden — use { force: true })
        this.nameInput = page.locator('[data-test="add-cipher-key-name-input-field"]');
        // OTextarea wrapper: [data-test="add-cipher-key-openobserve-secret-input"]
        // Native <textarea>: [data-test="add-cipher-key-openobserve-secret-input-field"] (-field suffix)
        this.secretInput = page.locator('[data-test="add-cipher-key-openobserve-secret-input-field"]');
        this.continueButton = page.locator('[data-test="add-report-step1-continue-btn"]');
        this.saveButton = page.locator('[data-test="add-cipher-key-save-btn"]');
        // OToast: inner description div has data-test="o-toast-message" and contains only {{ message }}.
        // OIcon renders as SVG (no text content), so textContent() of o-toast-message = the message string.
        this.alert = page.locator('[data-test="o-toast-message"]').first();

         this.deleteButton = cipherName => `[data-test="cipherkey-list-${cipherName}-delete"]`;
         this.confirmOkButton = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
         this.cancelButton = '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]';
         this.updateButton = cipherName => `[data-test="cipherkey-list-${cipherName}-update"]`;
         this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
         this.signOutButton = page.locator('[data-test="header-sign-out-btn"]');


    }

    async navigateToSettingsMenu() {
        // Navigate straight to the Cipher Keys settings sub-route instead of clicking
        // the left-nav Settings menu. The revamped Settings landing is a SectionHub
        // (settings/index.vue) whose per-tab data-tests (e.g. `management-cipher-key-tab`)
        // only render once you are INSIDE a section sub-route — landing on the hub left
        // the tab unrendered, so the old `waitForSelector('[data-test="management-cipher-key-tab"]')`
        // could only exhaust the 45s action timeout. Cipher Keys shares the exact same
        // `visible: isEnt` gate as Regex Patterns (settings/index.vue:236/246), and the
        // SDR shard's regex-management tests pass on this same alpha1 cloud env, proving
        // the tab DOES render here — this mirrors the proven direct-goto that
        // regexPatternsPage.navigateToRegexPatterns() uses.
        const orgName = process.env.ORGNAME || 'default';
        const baseUrl = process.env.ZO_BASE_URL;
        await this.page.goto(`${baseUrl}/web/settings/cipher_keys?org_identifier=${orgName}`);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }

      async navigateToCipherKeyTab() {
        // On the cipher_keys sub-route the tab is the active rail item; assert it is
        // rendered (real readiness signal, bounded — not the 45s action timeout) and
        // click it to guarantee we land on the Cipher Keys list. Idempotent: safe when
        // navigateToSettingsMenu() already placed us on the route.
        await expect(this.cipherKeyTab).toBeVisible({ timeout: 30000 });
        await this.cipherKeyTab.click();
      }

      async addCipherKey() {
        await this.addCipherKeyButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.addCipherKeyButton.click();

      }

      async addCipherKeyName(name) {
        // OInput native <input> is hidden from Playwright — use attached + force.
        await this.nameInput.waitFor({ state: 'attached', timeout: 10000 });
        await this.nameInput.fill(name, { force: true });
      }


      async addCipherKeyOO(secret) {
        // OTextarea native <textarea> uses -field suffix; may be hidden — use attached + force.
        await this.secretInput.waitFor({ state: 'attached', timeout: 10000 });
        await this.secretInput.fill(secret, { force: true });
      }

      async addCipherKeyContinue() {
        await this.page.waitForSelector('[data-test="add-report-step1-continue-btn"]');
        await this.continueButton.click();
      }

      async addCipherKeyTink() {
        await this.page.waitForSelector('[data-test="add-cipher-key-auth-method-input"]');
        await this.page.locator('[data-test="cipher-key-encryption-mechanism-step"] [data-test="add-cipher-key-auth-method-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-auth-method-input-option"]', { hasText: /Tink KeySet/i }).first().click();
      }

      async addCipherKeyType() {
        await this.page.waitForSelector('[data-test="add-cipher-key-type-input"]');
        await this.page.locator('[data-test="add-cipher-key-type-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-type-input-option"]', { hasText: /Akeyless/i }).first().click();
      }

      async addCipherKeyTypeURL(abase) {
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-baseurl-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(abase, { force: true });
      }

      async addCipherKeyTypeID(aid) {
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-access-id-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(aid, { force: true });
      }

      async addCipherKeyTypeKey(akey) {
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-access-key-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(akey, { force: true });
      }

      async addCipherKeyStatic() {
        await this.page.waitForSelector('[data-test="add-cipher-key-secret-type-input"]');
        await this.page.locator('[data-test="add-cipher-key-secret-type-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-secret-type-input-option"]', { hasText: /Static Secret/i }).first().click();
    }

      async addCipherKeyStaticName(astatic) {
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-static-secret-name-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(astatic, { force: true });
    }


    async addCipherKeyDFC() {
        await this.page.waitForSelector('[data-test="add-cipher-key-secret-type-input"]');
        await this.page.locator('[data-test="add-cipher-key-secret-type-input"]').click();
        await this.page.locator('[data-test="add-cipher-key-secret-type-input-option"]', { hasText: /DFC/i }).first().click();
    }

    async addCipherKeyNameDFC(nameDFC) {
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-dfc-name-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(nameDFC, { force: true });
    }

    async addCipherKeyEncryDataDFC(encryDFC) {
        // OTextarea -field suffix
        const field = this.page.locator('[data-test="add-cipher-key-akeyless-dfc-encrypted-data-input-field"]');
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(encryDFC, { force: true });
    }

    async addCipherKeySimple() {
        await this.page.locator('[data-test="add-cipher-key-auth-method-input-option"]', { hasText: /Simple/i }).first().click();
     }

    async addCipherKeyStore() {
        await this.page.locator('[data-test="cipher-key-encryption-mechanism-step"]').click();
    }

      async addCipherKeySave() {
        await this.page.waitForSelector('[data-test="add-cipher-key-save-btn"]');
        await this.saveButton.click();
      }

      async updateCipherKeys(cipherName) {
        const updateButtonLocator = this.page.locator(this.updateButton(cipherName));
        await updateButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
        await updateButtonLocator.click({ force: true });

    }

    async updateCipherKeysSecret() {
        await this.page.waitForSelector('[data-test="add-cipher-key-openobserve-secret-input-update"]');
        await this.page.locator('[data-test="add-cipher-key-openobserve-secret-input-update"]').click();

    }

    async updateCipherKeysSecretCancel() {
        await this.page.waitForSelector('[data-test="add-cipher-key-openobserve-secret-input-cancel"]');
        await this.page.locator('[data-test="add-cipher-key-openobserve-secret-input-cancel"]').click();

    }

    async updateCipherKeysCancel() {
        await this.page.waitForSelector('[data-test="add-cipher-key-cancel-btn"]');
        await this.page.locator('[data-test="add-cipher-key-cancel-btn"]').click();

    }

    async deletedCipherKeys(cipherName) {
        const deleteButtonLocator = this.page.locator(this.deleteButton(cipherName));
        await deleteButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
        await deleteButtonLocator.click({ force: true });

    }

    async requestCipherKeysOk() {
        await this.page.locator(this.confirmOkButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.confirmOkButton).click({ force: true });
        await this.page.waitForTimeout(2000);
    }

    async requestCipherKeysCancel() {
        await this.page.locator(this.cancelButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.cancelButton).click({ force: true });
        await this.page.waitForTimeout(2000);
    }

      async verifyAlertMessage(expectedText) {
        // Polls ALL visible [data-test="o-toast-message"] elements (loading + error toasts can
        // coexist or appear sequentially). Using .first() would latch onto the loading toast
        // "Please wait..." and miss the subsequent error toast when the API responds.
        const toasts = this.page.locator('[data-test="o-toast-message"]');
        const timeout = 12000; // extra headroom for API round-trip after loading toast appears
        const interval = 300;
        let elapsed = 0;
        let lastSeenTexts = [];

        const lowerExpected = expectedText.toLowerCase();
        while (elapsed < timeout) {
            const texts = await toasts.allTextContents().catch(() => []);
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
        throw new Error(`Expected alert message "${expectedText}" not found within ${timeout}ms. ${seen}`);
    }

    // OInput inline error: [data-test="<parent>-error"] rendered by OInput when :error=true
    async verifyNameError() {
        const errorEl = this.page.locator('[data-test="add-cipher-key-name-input-error"]');
        await expect(errorEl).toBeVisible({ timeout: 5000 });
    }

    // OTextarea inline error: role="alert" span inside the wrapper (OTextarea has no -error data-test)
    async verifySecretError() {
        const errorEl = this.page.locator('[data-test="add-cipher-key-openobserve-secret-input"] [role="alert"]');
        await expect(errorEl).toBeVisible({ timeout: 5000 });
    }

      async signOut() {
        await this.profileButton.click();
        await this.signOutButton.click();
      }


}
