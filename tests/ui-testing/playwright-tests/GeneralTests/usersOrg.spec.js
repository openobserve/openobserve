const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Users and Organizations", () => {
    let pageManager;

    test("Error Message displayed if Email Blank", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser("");   
        await pageManager.userPage.userCreate(); 
        await pageManager.userPage.verifySuccessMessage('Please enter a valid email address');
        
        testLogger.info('Test completed successfully');
    });

    test("Error Message displayed if Add user with missing role", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('Field is required');
        
        testLogger.info('Test completed successfully');
    });

    test("User created with password and first name and last name", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("User not created if Email already exists", async ({ page }, testInfo) => {
        const duplicateEmail = `duplicate${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(duplicateEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await page.waitForLoadState('networkidle');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(duplicateEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await pageManager.userPage.userCreate();   
        await pageManager.userPage.verifySuccessMessage('User is already part of the organization');
        
        testLogger.info('Test completed successfully');
    });
    
    test("User not created if Cancel clicked on first Add User Page", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await page.locator('[data-test="cancel-user-button"]').click();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(uniqueEmail);
        await pageManager.userPage.verifyUserNotExists();
        
        testLogger.info('Test completed successfully');
    });

    test("User not created if Cancel clicked on second Add User Page", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await page.waitForLoadState('domcontentloaded');
        await page.locator('[data-test="cancel-user-button"]').click();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(uniqueEmail);
        await pageManager.userPage.verifyUserNotExists();
        
        testLogger.info('Test completed successfully');
    });

    test("User Created and deleted", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.deleteUser(uniqueEmail);
        await pageManager.userPage.verifySuccessMessage('User deleted successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("User Created and not deleted if cancel clicked", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.deleteUserCancel(uniqueEmail);
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.searchUser(uniqueEmail);
        await pageManager.userPage.verifyUserExists(uniqueEmail);
        
        testLogger.info('Test completed successfully');
    });

    test("User Created and updated First Name and Last Name", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.editUser(uniqueEmail);
        await pageManager.userPage.addUserFirstLast('c', 'd');
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User updated successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("User Created and updated Password", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.addUser(uniqueEmail);
        await pageManager.userPage.selectUserRole('Admin');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.userCreate();
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.addUserPassword(process.env["ZO_ROOT_USER_PASSWORD"]);
        await pageManager.userPage.addUserFirstLast('a', 'b');
        await pageManager.userPage.userCreate();

        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.verifySuccessMessage('User added successfully.');
        await page.waitForLoadState('domcontentloaded');
        await pageManager.userPage.gotoIamPage();
        await pageManager.userPage.editUser(uniqueEmail);
        await pageManager.userPage.addNewPassword('1234567890');
        await pageManager.userPage.userCreate();
        await pageManager.userPage.verifySuccessMessage('User updated successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test('Add Organization Successfully', async ({ page }, testInfo) => {
        const uniqueOrgName = `Org${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName(uniqueOrgName);
        await pageManager.createOrgPage.clickSaveOrg();
        await pageManager.userPage.verifySuccessMessage('Organization added successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test('Save button disabled if Add Organization with Empty Name', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName('');
        await pageManager.createOrgPage.checkSaveEnabled();
        
        testLogger.info('Test completed successfully');
    });

    test('Organization not added if Cancel clicked', async ({ page }, testInfo) => {
        const uniqueOrgName = `Org${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName(uniqueOrgName);
        await pageManager.createOrgPage.clickCancelButton();
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.searchOrg(uniqueOrgName);
        await pageManager.createOrgPage.verifyOrgNotExists();
        
        testLogger.info('Test completed successfully');
    });

    test('Error Message displayed if Add Organization is blank', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.createOrgPage.navigateToOrg();
        await pageManager.createOrgPage.clickAddOrg();
        await pageManager.createOrgPage.fillOrgName('');
        await page.locator('.q-field__bottom').click();
        await pageManager.userPage.verifySuccessMessage('Name is required');
        
        testLogger.info('Test completed successfully');
    });
});
