import { expect } from '@playwright/test';

export const path = require('path');
export
    class ManagementPage {

    constructor(page) {
        this.page = page;

        this.homeIcon = page.locator("[name ='home']");

        //this.managementMenuItem = page.locator('[data-test="menu-link-/settings/-item"]');

         this.managementMenuItem = page.locator('[data-test="menu-link-settings-item"]');


        this.submitButton = page.locator('[data-test="dashboard-add-submit"]'); // Add appropriate data-test attribute
        this.customLogoText = page.locator("[aria-label ='Custom Logo Text']");
        this.saveButton = page.locator('[data-test="settings_ent_logo_custom_text_save_btn"]');
        this.deleteLogoButton = page.locator('[data-test="setting_ent_custom_logo_img_delete_btn"]');
        this.confirmDeleteButton = page.locator('[data-test="logs-search-bar-confirm-dialog-ok-btn"]');
        this.fileUploadInput = page.locator('input[data-test="setting_ent_custom_logo_img_file_upload"]');
    }

    async navigateToManagement() {
        await this.page.waitForSelector("[name ='home']");
        await this.homeIcon.hover();
        await this.page.waitForSelector('[data-test="menu-link-settings-item"]');
        await this.managementMenuItem.click({ force: true });
    }

    async goToManagement() {
 // Follow same pattern as navigateToManagement() but with validation
    await this.page.waitForSelector("[name ='home']");
    await this.homeIcon.hover();
    await this.page.waitForSelector('[data-test="menu-link-settings-item"]');
        await this.managementMenuItem.click({ force: true });
        await expect(this.page.getByRole('main')).toContainText('General Settings');
    }

    async managementPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async managementPageURLValidation(org_name) {
        await expect(this.page).toHaveURL(new RegExp(`org_identifier=${org_name}`));
    }

    async managementURLValidation() {
        await expect(this.page).toHaveURL(/settings/);
    } 
    
    async checkAndEnableWebSocket() {
        // Selector for the WebSocket toggle
        const toggleSelector = '[data-test="general-settings-enable-websocket"]';
        
        // Wait for the toggle element to be visible
        await this.page.waitForSelector(toggleSelector);
    
        // Get the current state of the toggle
        const isChecked = await this.page.$eval(toggleSelector, (toggle) => {
            return toggle.getAttribute('aria-checked') === 'true';
        });
    
        // Log the current state
        console.log(`WebSocket is currently ${isChecked ? 'enabled' : 'disabled'}.`);
    
        // If the WebSocket is not enabled, click to enable it
        if (!isChecked) {
            console.log('Enabling WebSocket...');
            await this.page.click(toggleSelector);
            
            // Optionally, wait for a brief moment to ensure the toggle action is completed
            await this.page.waitForTimeout(500); // Adjust the timeout as needed
    
            // Verify if the toggle is now enabled
            const newCheckedState = await this.page.$eval(toggleSelector, (toggle) => {
                return toggle.getAttribute('aria-checked') === 'true';
            });
    
            if (newCheckedState) {
                console.log('WebSocket has been successfully enabled.');
            } else {
                console.log('Failed to enable WebSocket.');
            }
        } else {
            console.log('WebSocket is already enabled.');
        }
    }

    async checkStreaming() {

        await this.page.goto(
            process.env["ZO_BASE_URL"] + "/web/logs?org_identifier=" + process.env["ORGNAME"]
          );
          await this.page.waitForLoadState('networkidle');

          // Wait for logs page to fully load before navigating away
          await this.page.waitForTimeout(2000);

          await this.page.locator('[data-test="menu-link-settings-item"]').click();
          await this.page.goto(
            process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=" + process.env["ORGNAME"]
          );
          await this.page.waitForLoadState('networkidle');
        
        const toggleSelector = '[data-test="general-settings-enable-streaming"]';
        
        // Wait for the toggle element to be visible
        await this.page.waitForSelector(toggleSelector);
      
        // Get the current state of the toggle
        const isChecked = await this.page.$eval(toggleSelector, (toggle) => {
            return toggle.getAttribute('aria-checked') === 'true';
        });
      
        // Log the current state
        console.log(`Streaming is currently ${isChecked ? 'enabled' : 'disabled'}.`);
      
        // If the Streaming is not enabled, click to enable it
        if (!isChecked) {
            console.log('Enabling Streaming...');
            await this.page.click(toggleSelector);
            
            // Optionally, wait for a brief moment to ensure the toggle action is completed
            await this.page.waitForTimeout(500); // Adjust the timeout as needed
        }
    }
  async ensureStreamingDisabled() {
    // Navigate to logs page first to ensure we are in the correct org context
    await this.page.goto(
      process.env["ZO_BASE_URL"] + "/web/logs?org_identifier=default"
    );
    await this.page.waitForLoadState("networkidle");

    // Navigate to the General Settings page
    await this.page.locator('[data-test="menu-link-settings-item"]').click();
    await this.page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/settings/general?org_identifier=default"
    );
    await this.page.waitForLoadState("networkidle");

    const toggleSelector = '[data-test="general-settings-enable-streaming"]';

    // Wait for the toggle element to be visible
    await this.page.waitForSelector(toggleSelector);

    // Determine current toggle state
    const isChecked = await this.page.$eval(toggleSelector, (toggle) => {
      return toggle.getAttribute("aria-checked") === "true";
    });

    // If Streaming is enabled, click to disable it
    if (isChecked) {
      await this.page.click(toggleSelector);
      await this.page.waitForTimeout(500); // allow UI to update

      // Verify toggle is now disabled

      await this.page.locator('[data-test="dashboard-add-submit"]').click();
    }
  }

  // Set the streaming state to the desired state (enabled or disabled) eg: enabled = true, disabled = false
  async setStreamingState(enabled) {
    await this.page.goto(
      process.env["ZO_BASE_URL"] + "/web/logs?org_identifier=default"
    );
    await this.page.waitForLoadState("networkidle");

    await this.page.locator('[data-test="menu-link-settings-item"]').click();
    await this.page.goto(
      process.env["ZO_BASE_URL"] +
        "/web/settings/general?org_identifier=default"
    );
    await this.page.waitForLoadState("networkidle");

    const toggleSelector = '[data-test="general-settings-enable-streaming"]';

    // Wait for the toggle element to be visible
    await this.page.waitForSelector(toggleSelector);

    // Get the current state of the toggle
    const isCurrentlyChecked = await this.page.$eval(
      toggleSelector,
      (toggle) => {
        return toggle.getAttribute("aria-checked") === "true";
      }
    );

    if (isCurrentlyChecked !== enabled) {
      await this.page.click(toggleSelector);
      await this.page.waitForLoadState("networkidle");

      await this.page.locator('[data-test="dashboard-add-submit"]').click();
      await this.page.waitForLoadState("networkidle");

      // Verify the new state
      const newCheckedState = await this.page.$eval(
        toggleSelector,
        (toggle) => {
          return toggle.getAttribute("aria-checked") === "true";
        }
      );

      if (newCheckedState !== enabled) {
        throw new Error(`Failed to set streaming state to ${enabled}`);
      }
    }
  }
}
