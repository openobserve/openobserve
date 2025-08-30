// userPage.js
import { expect } from '@playwright/test';


export class UserPage {
    constructor(page) {
        this.page = page;
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');

        this.addUserButton = '[data-test="add-basic-user"]';
        this.userEmailField = '[data-test="user-email-field"]';
        this.userRoleField = '[data-test="user-role-field"]';
        this.saveUserButton = '[data-test="save-user-button"]';

        // Removed deprecated alert reference - use specific alert verification in methods


    }

    async gotoIamPage() {
        await this.iamPageMenu.click();
        await this.page.waitForSelector('[data-test="iam-users-tab"]', { state: 'visible' });
        await this.page.locator('[data-test="iam-users-tab"]').click();
    }


    async addUser(email) {
        await this.page.click(this.addUserButton);
        await this.page.fill(this.userEmailField, email);
        
    }

    
    async selectUserRole(role) {
        // Wait for the role field to be visible and in viewport
        const roleField = this.page.locator('[data-test="user-role-field"]');
        await roleField.waitFor({ state: 'visible', timeout: 10000 });
        await roleField.scrollIntoViewIfNeeded();
        
        // Wait for any animations or layout shifts to complete
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(500); // Brief wait for UI stability
        
        // Now safely interact with the element
        await roleField.dblclick({ force: true });
        await this.page.waitForLoadState("networkidle");
        await roleField.pressSequentially(role, { delay: 100 });
        await this.page.getByRole('option', { name: role }).click({ force: true });
      }
    
    async userCreate() {
      
        await this.page.click(this.saveUserButton);
    }

    async editUser(email) {
        // Escape the '@' character in the email to create a valid selector
        const escapedEmail = email.replace('@', '\\@');
        
        // Construct the selector using the data-test attribute
        const editButtonSelector = `[data-test="edit-basic-user-${escapedEmail}"]`;
        
        // Click the edit button
        await this.page.locator(editButtonSelector).click();
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/iam/users?action=update&org_identifier=default&email=" + email);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle');
        
        // Wait for edit form elements to be available
        await this.page.waitForSelector('[data-test="user-first-name-field"]', { state: 'visible', timeout: 15000 });
    }
    

    async deleteUser(email) {
        await this.page.locator(`[data-test="delete-basic-user-${email.replace('@', '\\@')}"]`).click();
        await this.page.getByRole('button', { name: 'OK' }).click();
    }

    async deleteUserCancel(email) {
        // Logic to simulate unauthorized deletion
        await this.page.locator(`[data-test="delete-basic-user-${email.replace('@', '\\@')}"]`).click();
        await this.page.getByRole('button', { name: 'Cancel' }).click();
    }

    async verifySuccessMessage(expectedMessage) {
        // Wait for alert to appear and verify the message
        await this.page.waitForSelector('div[role="alert"]', { state: 'visible', timeout: 10000 });
        
        // Find the alert that contains the expected message (instead of just checking the first one)
        const specificAlert = this.page.getByRole('alert').filter({ hasText: expectedMessage });
        
        // Verify the specific alert with our expected message is visible
        await expect(specificAlert).toBeVisible({ timeout: 5000 });
    }

    async addUserFirstLast(firstName, lastName) {
        
        await this.page.locator('[data-test="user-first-name-field"]').click();
        await this.page.locator('[data-test="user-first-name-field"]').fill(firstName);
        await this.page.locator('[data-test="user-last-name-field"]').click();
        await this.page.locator('[data-test="user-last-name-field"]').fill(lastName);
       
    }

    async addUserPassword(password) {
       
        
        await this.page.locator('[data-test="user-password-field"]').click();
        await this.page.locator('[data-test="user-password-field"]').fill(password);
        
    }


    async addNewPassword(password) {
        // Ensure the "Change Password" toggle is checked
        const toggleSelector = '[data-test="user-change-password-field"]';
        
        // Click the toggle if it's not checked
        const isChecked = await this.page.locator(toggleSelector).getAttribute('aria-checked');
        if (isChecked === 'false') {
            await this.page.locator(toggleSelector).click();
        }
        
        // Fill in the new password
        await this.page.locator('[data-test="user-new-password-field"]').fill(password);
    }
    
    async searchUser(email) {
        await this.page.getByPlaceholder('Search User').click();
        await this.page.getByPlaceholder('Search User').fill(email);
        await this.page.waitForTimeout(5000);
       

    }

    async verifyUserNotExists() {
        
        await expect(this.page.locator('[data-test="iam-page"]').getByRole('main')).toContainText('No data available');

    }

    async verifyUserExists(email) {

        await expect(this.page.locator('tbody')).toContainText(email);
        

    }

}