import { test, expect } from "../baseFixtures.js";
import PageManager from "../../pages/page-manager.js";

test.describe("Users and Organizations", () => {
    let pageManager;

    const timestamp = Date.now(); 
    const randomSuffix = Math.floor(Math.random() * 1000); 
    const emailName = `email${timestamp}${randomSuffix}@gmail.com`;
    const orgName = `Organ${timestamp}${randomSuffix}`;

    test.beforeEach(async ({ page }) => {
        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login();
    });

    test("Error Message displayed if Email Blank", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser("");   
        await pageManager.userPage.userCreate(); 
        await pageManager.userPage.verifySuccessMessage('Please enter a valid email address');
    });

    test("Error Message displayed if Add user with missing role", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('Field is required');
    });

    test("User created with password and first name and last name", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
    });

    test("User not created if Email already exists", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.page.waitForTimeout(1000);
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await pageManager.userPage.page.waitForTimeout(5000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.userCreate();   
        await pageManager.userPage.verifySuccessMessage('User is already part of the organization');
    });
    
    test("User not created if Cancel clicked on first Add User Page", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000); 
        await page.locator('[data-test="cancel-user-button"]').click();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(emailName);
        await pageManager.userPage.verifyUserNotExists();
    });

    test("User not created if Cancel clicked on second Add User Page", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.page.waitForTimeout(1000);
        await page.locator('[data-test="cancel-user-button"]').click();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(emailName);
        await pageManager.userPage.verifyUserNotExists();
    });

    test("User Created and deleted", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.deleteUser(emailName);
        await pageManager.userPage.verifySuccessMessage('User deleted successfully.');
    });

    test("User Created and not deleted if cancel clicked", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.deleteUserCancel(emailName);
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(emailName);
        await pageManager.userPage.verifyUserExists(emailName);
    });

    test("User Created and updated First Name and Last Name", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.editUser(emailName);
        await pageManager.userPage.addUserFirstLast('c', 'd');
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User updated successfully.');
    });

    test("User Created and updated Password", async ({ page }) => {
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(emailName);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.userCreate();
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await pageManager.userPage.page.waitForTimeout(1000);   
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.editUser(emailName);
        await pageManager.userPage.addNewPassword('1234567890');
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User updated successfully.');
    });

    test('Add Organization Successfully', async ({ page }) => {
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName(orgName);
        await pageManager.createOrgPage.clickSaveOrg();
        await pageManager.userPage.verifySuccessMessage('Organization added successfully.');
    });

    test('Save button disabled if Add Organization with Empty Name', async ({ page }) => {
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName('');
        await pageManager.createOrgPage.checkSaveEnabled();
    });

    test('Organization not added if Cancel clicked', async ({ page }) => {
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName(orgName);
        await pageManager.createOrgPage.clickCancelButton();
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.searchOrg(orgName);
        await pageManager.createOrgPage.verifyOrgNotExists(expect);
    });

    test('Error Message displayed if Add Organization is blank', async ({ page }) => {
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName('');
        await page.locator('.q-field__bottom').click();
        await pageManager.userPage.verifySuccessMessage('Name is required');
    });
});
