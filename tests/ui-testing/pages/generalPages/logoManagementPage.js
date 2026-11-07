import { expect } from '@playwright/test';
import path from 'path';
import { reauthenticateAlpha1 } from '../../playwright-tests/utils/reauth-alpha1.js';

export
    class LogoManagementPage {

    constructor(page) {
        this.page = page;
        this.homeIcon = page.locator("[name ='home']");
        this.managementMenuItem = page.locator('[data-test="menu-link-/settings-item"]');
        this.submitButton = page.locator('[data-test="dashboard-add-submit"]');
        this.editLogoTextButton = page.locator('[data-test="settings_ent_logo_custom_text_edit_btn"]');
        this.customLogoTextBox = page.locator('[data-test="settings_ent_logo_custom_text-field"]');
        this.customLogoText = page.locator("[aria-label ='Custom Logo Text']");
        this.saveButton = page.locator('[data-test="settings_ent_logo_custom_text_save_btn"]');
        this.deleteLogoButton = page.locator('[data-test="setting_ent_custom_logo_img_delete_btn"]');
        this.confirmDeleteButton = page.locator('[data-test="general-delete-image-dialog"] [data-test="o-dialog-primary-btn"]');
        this.fileUploadInput = page.locator('[data-test="setting_ent_custom_logo_img_file_upload-field"]');
        this.saveButtonLight = page.locator('[data-test="settings_ent_logo_custom_light_save_btn"]');
        this.enterpriseFeature = page.locator('#enterpriseFeature');
        this.organizationSearchInput = page.locator('[data-test="organization-search-input-field"]');
        this.organizationMenuList = page.locator('[data-test="organization-menu-list"]');
        this.organizationMenuOpen = page.locator('[role="menu"][data-state="open"]', { has: this.organizationMenuList });
        this.organizationMenuItem = page.locator('[data-test="organization-menu-item-label-item-label"]');
        this.organizationLoadedRow = this.organizationMenuItem.and(page.locator('[data-test-org-identifier]'));
        this.navbarOrganizationsSelect = page.locator('[data-test="navbar-organizations-select"]');

        // Dark mode logo locators
        this.fileUploadInputDark = page.locator('[data-test="setting_ent_custom_logo_dark_img_file_upload-field"]');
        this.saveButtonDark = page.locator('[data-test="settings_ent_logo_custom_dark_save_btn"]');
        this.deleteLogoButtonDark = page.locator('[data-test="setting_ent_custom_logo_dark_img_delete_btn"]');
    }

    async navigateToManagement() {
        await this.page.waitForSelector("[name ='home']");
        await this.homeIcon.hover();
        await this.page.waitForSelector('[data-test="menu-link-/settings-item"]');
        await this.managementMenuItem.click({ force: true });
    }

    async goToManagement() {
        await this.managementMenuItem.click({ force: true });
        await expect(this.page.locator('[data-test="menu-link-/settings-item"]')).toBeVisible();
    }

    async managementPageDefaultMultiOrg() {
        await this.navbarOrganizationsSelect.click();
        await this.page.locator('[data-test="navbar-organizations-select-option"]', { hasText: /defaulttestmulti/i }).first().click();
    }

    async managementOrg(orgName) {
        await this.page.waitForTimeout(2000);
        await this.page.reload();

        const targetRow = this.organizationMenuItem.and(this.page.locator(`[data-test-org-identifier="${orgName}"]`));

        // The menu can close with no click from the test just after load, so each attempt reopens it.
        await expect(async () => {
            if (!(await this.organizationMenuOpen.isVisible())) {
                await this.navbarOrganizationsSelect.click({ timeout: 5000 });
                await this.organizationMenuOpen.waitFor({ state: 'visible', timeout: 3000 });
            }
            // Until the org list loads the menu holds one placeholder row with no identifier, and searching it throws in the menu's filter.
            await this.organizationLoadedRow.first().waitFor({ state: 'visible', timeout: 10000 });
            await this.organizationSearchInput.fill(orgName, { force: true, timeout: 3000 });
            // The virtualized rows' translateY transforms defeat Playwright's stability check.
            await targetRow.click({ force: true, timeout: 5000 });
            await expect(this.page).toHaveURL(new RegExp(`[?&]org_identifier=${orgName}(&|$)`), { timeout: 5000 });
            await expect(this.navbarOrganizationsSelect).toContainText(orgName, { timeout: 5000 });
        }).toPass({ timeout: 35000 });
    }

    // Hard-navigate to the _meta general settings page and confirm we stayed
    // there. The preceding org switch can still be redirecting to /web/, so a
    // bare goto races that redirect and gets "interrupted by navigation to
    // /web/" (or lands on /web/ and drops the org). Retry the goto until the URL
    // sticks on _meta settings and the page's submit button has rendered.
    async openMetaGeneralSettings() {
        const url = process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta";
        await expect(async () => {
            await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            // The shared alpha1 session can expire mid-run (minted once, reused by every shard); self-heal like navigateToBase() does, since this goto bypasses that helper and would otherwise dead-end on the Dex login page.
            if (/\/dex\/|\/web\/login/.test(this.page.url())) {
                await reauthenticateAlpha1(this.page);
                await this.page.goto(url, { waitUntil: 'domcontentloaded' });
            }
            await expect(this.page).toHaveURL(/settings\/general\?org_identifier=_meta/, { timeout: 5000 });
            await this.submitButton.waitFor({ state: 'visible', timeout: 10000 });
        }).toPass({ timeout: 45000 });
    }

    async managementPageURLValidation() {
        await expect(this.page).toHaveURL(/defaulttestmulti/);
    }

    async managementURLValidation() {
        await expect(this.page).toHaveURL(/settings/);
    }

    async clickSaveSubmit() {
        await this.submitButton.waitFor({ state: 'visible' });
        await this.submitButton.click({ force: true });   
    }

    async updateCustomLogoText(text) {
    await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Unauthorized/i }).first()).not.toBeVisible(); // Check Unauthorized Access

    // Step 1: Check if the text input is already visible (no existing data scenario)
    try {
        await this.customLogoTextBox.waitFor({ state: 'visible', timeout: 5000 });
        // Input is visible, proceed directly
        await this.customLogoTextBox.click();
        await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Unauthorized/i }).first()).not.toBeVisible(); // Check Unauthorized Access
        await this.customLogoTextBox.fill(text);
        await this.saveButton.first().waitFor({ state: 'visible' });
        await this.saveButton.first().click({ force: true });
        return;
    } catch (error) {
        // Input not visible, continue to check for existing data
    }

    // Step 2: Check if there is existing data in #enterpriseFeature
    const existingDataText = await this.enterpriseFeature.first().textContent();

    if (existingDataText && existingDataText.trim().length > 0) {
        // Step 3: There is existing data, click edit button
        await this.editLogoTextButton.waitFor({ state: 'visible' });
        await this.editLogoTextButton.click();
        await this.page.waitForTimeout(2000);
    }

    // Step 4: Enter the text
    await this.customLogoTextBox.waitFor({ state: 'visible', timeout: 30000 });
    await this.customLogoTextBox.click();
    await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Unauthorized/i }).first()).not.toBeVisible(); // Check Unauthorized Access
    await this.customLogoTextBox.fill(text);
    await this.saveButton.first().waitFor({ state: 'visible' });
    await this.saveButton.first().click({ force: true });
}

    async uploadLogo(filePath) {
        const isVisible = await this.deleteLogoButton.isVisible();
        if (isVisible) {
            await this.deleteLogoButton.waitFor({ state: 'visible' });
            await this.deleteLogoButton.click({ force: true });
            await this.confirmDeleteButton.waitFor({ state: 'visible' });
            await this.confirmDeleteButton.click({ force: true });
        }
        await this.openMetaGeneralSettings();
        await this.fileUploadInput.waitFor({ state: 'attached' });
        await this.fileUploadInput.setInputFiles(filePath);
        // wait for Vue reactivity to process the file change before clicking save
        await this.page.waitForTimeout(500);
        // Click the save button after logo upload (light mode)
        await this.saveButtonLight.waitFor({ state: 'visible' });
        await this.saveButtonLight.click({ force: true });
        await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Logo updated successfully/i }).first()).toBeVisible({
            timeout: 30000,
        });
    }

    async uploadLogoDarkMode(filePath) {
        // Delete existing dark mode logo if present
        const isVisible = await this.deleteLogoButtonDark.isVisible();
        if (isVisible) {
            await this.deleteLogoButtonDark.waitFor({ state: 'visible' });
            await this.deleteLogoButtonDark.click({ force: true });
            await this.confirmDeleteButton.waitFor({ state: 'visible' });
            await this.confirmDeleteButton.click({ force: true });
            await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Dark mode logo deleted/i }).first()).toBeVisible({
                timeout: 10000,
            });
        }

        // Navigate to the settings page
        await this.openMetaGeneralSettings();

        // Upload dark mode logo
        await this.fileUploadInputDark.waitFor({ state: 'attached' });
        await this.fileUploadInputDark.setInputFiles(filePath);

        // Click the save button for dark mode logo
        await this.saveButtonDark.waitFor({ state: 'visible' });
        await this.saveButtonDark.click({ force: true });

        // Verify success message
        await expect(this.page.locator('[data-test="o-toast-message"]').filter({ hasText: /Dark mode logo updated/i }).first()).toBeVisible({
            timeout: 30000,
        });
    }
}
