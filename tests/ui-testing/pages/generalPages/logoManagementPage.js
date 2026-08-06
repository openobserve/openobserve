import { expect } from '@playwright/test';
import path from 'path';

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
        this.organizationMenuItem = page.locator('[data-test="organization-menu-item-label-item-label"]');
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

        // Open the org dropdown and confirm the popover actually rendered before
        // typing. The menu is a virtualized reka-ui popper that animates in, so a
        // blind waitForTimeout can race ahead of the open and leave the search
        // input un-rendered (the CI failure mode). Retry the open until the menu
        // list is visible instead.
        await expect(async () => {
            await this.navbarOrganizationsSelect.click();
            await this.organizationMenuList.waitFor({ state: 'visible', timeout: 3000 });
        }).toPass({ timeout: 15000 });

        // Search for the organization. The OInput wrapper's outer node is a
        // <div>; fill the inner native input via the -field suffix.
        await this.organizationSearchInput.waitFor({ state: 'attached', timeout: 10000 });
        await this.organizationSearchInput.fill(orgName, { force: true });

        // Click the matching row, tolerating the virtualized list re-positioning
        // underneath — the translateY transforms defeat Playwright's stability
        // check, so scroll into view and force the click past it.
        const row = this.organizationMenuItem.first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await expect(async () => {
            await row.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await row.click({ force: true, timeout: 5000 });
            // Selecting a row closes the menu; if the click missed mid-reflow the
            // popover stays open, so gate on it hiding and let toPass retry.
            await this.organizationMenuList.waitFor({ state: 'hidden', timeout: 3000 });
        }).toPass({ timeout: 20000 });
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
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta");
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
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta");

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
