import { expect } from '@playwright/test';

export const path = require('path');

export
    class LogoManagementPage {

    constructor(page) {
        this.page = page;
        this.homeIcon = page.locator("[name ='home']");
        this.managementMenuItem = page.locator('[data-test="menu-link-settings-item"]');
        this.submitButton = page.locator('[data-test="dashboard-add-submit"]');
        this.editLogoTextButton = page.locator('[data-test="settings_ent_logo_custom_text_edit_btn"]');
        this.customLogoTextBox = page.locator('[data-test="settings_ent_logo_custom_text"]');
        this.customLogoText = page.locator("[aria-label ='Custom Logo Text']");
        this.saveButton = page.locator('[data-test="settings_ent_logo_custom_text_save_btn"]');
        this.deleteLogoButton = page.locator('[data-test="setting_ent_custom_logo_img_delete_btn"]');
        this.confirmDeleteButton = page.locator('[data-test="logs-search-bar-confirm-dialog-ok-btn"]');
        this.fileUploadInput = page.locator('input[data-test="setting_ent_custom_logo_img_file_upload"]');
        this.saveButtonLight = page.locator('[data-test="settings_ent_logo_custom_light_save_btn"]');
        this.enterpriseFeature = page.locator('#enterpriseFeature');
        this.organizationSearchInput = page.locator('[data-test="organization-search-input"]');
        this.organizationMenuItem = page.locator('[data-test="organization-menu-item-label-item-label"]');
        this.navbarOrganizationsSelect = page.locator('[data-test="navbar-organizations-select"]');

        // Dark mode logo locators
        this.fileUploadInputDark = page.locator('[data-test="setting_ent_custom_logo_dark_img_file_upload"]');
        this.saveButtonDark = page.locator('[data-test="settings_ent_logo_custom_dark_save_btn"]');
        this.deleteLogoButtonDark = page.locator('[data-test="setting_ent_custom_logo_dark_img_delete_btn"]');
    }

    async navigateToManagement() {
        await this.page.waitForSelector("[name ='home']");
        await this.homeIcon.hover();
        await this.page.waitForSelector('[data-test="menu-link-settings-item"]');
        await this.managementMenuItem.click({ force: true });
    }

    async goToManagement() {
        await this.managementMenuItem.click({ force: true });
        await expect(this.page.getByRole('main')).toContainText('Management');
    }

    async managementPageDefaultMultiOrg() {
        await this.navbarOrganizationsSelect.getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async managementOrg(orgName) {
        await this.page.waitForTimeout(2000);
        await this.page.reload();
        await this.navbarOrganizationsSelect.getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(2000);

        // Search for the organization
        await this.organizationSearchInput.fill(orgName);
        await this.page.waitForTimeout(2000);

        // Click the organization from search results
        await this.organizationMenuItem.first().click();
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
    await expect(this.page.getByText('Unauthorized Access')).not.toBeVisible(); // Check Unauthorized Access

    // Step 1: Check if the text input is already visible (no existing data scenario)
    try {
        await this.customLogoTextBox.waitFor({ state: 'visible', timeout: 5000 });
        // Input is visible, proceed directly
        await this.customLogoTextBox.click();
        await expect(this.page.getByText('Unauthorized Access')).not.toBeVisible(); // Check Unauthorized Access
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
    await expect(this.page.getByText('Unauthorized Access')).not.toBeVisible(); // Check Unauthorized Access
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
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta");
        await this.fileUploadInput.waitFor({ state: 'visible' });
        await this.page.setInputFiles('input[data-test="setting_ent_custom_logo_img_file_upload"]', filePath);
        // Click the save button after logo upload (light mode)
        await this.saveButtonLight.waitFor({ state: 'visible' });
        await this.saveButtonLight.click({ force: true });
        await expect(this.page.getByText("Logo updated successfully")).toBeVisible({
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
            await expect(this.page.getByText("Dark mode logo deleted")).toBeVisible({
                timeout: 10000,
            });
        }

        // Navigate to the settings page
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta");

        // Upload dark mode logo
        await this.fileUploadInputDark.waitFor({ state: 'visible' });
        await this.fileUploadInputDark.setInputFiles(filePath);

        // Click the save button for dark mode logo
        await this.saveButtonDark.waitFor({ state: 'visible' });
        await this.saveButtonDark.click({ force: true });

        // Verify success message
        await expect(this.page.getByText("Dark mode logo updated")).toBeVisible({
            timeout: 30000,
        });
    }
}
