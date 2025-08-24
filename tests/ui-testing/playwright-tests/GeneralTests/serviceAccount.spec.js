const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Service Account for API access", () => {
    let pageManager;

    test("Error Message displayed if Email Blank", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamURLValidation();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.iamPageAddServiceAccountEmailValidation();
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account created", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account not created if Email already exists", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterSameEmailServiceAccount();
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('User already exists');
        
        testLogger.info('Test completed successfully');
    });
    
    test("Service Account not created if Cancel clicked", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.enterDescriptionSA();
        await pageManager.iamPage.clickCancelServiceAccount();
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account Token copied", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickCopyToken();
        
        testLogger.info('Test completed successfully');
    });
    
    test("Service Account Download Token", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickDownloadToken();
        
        testLogger.info('Test completed successfully');
    });
    
    test("Service Account Token Pop Up Closed", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account Created and deleted", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.deletedServiceAccount(uniqueEmail);
        await pageManager.iamPage.requestServiceAccountOk();
        await pageManager.iamPage.verifySuccessMessage('Service Account deleted successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account Created and not deleted if cancel clicked", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.deletedServiceAccount(uniqueEmail);
        await pageManager.iamPage.requestServiceAccountCancel();
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account Created and updated details", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.updatedServiceAccount(uniqueEmail);
        await pageManager.iamPage.enterDescriptionSA();
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account updated successfully.');
        
        testLogger.info('Test completed successfully');
    });

    test("Service Account Created and refresh token", async ({ page }, testInfo) => {
        const uniqueEmail = `email${Date.now()}_${Math.floor(Math.random() * 10000)}@gmail.com`;
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.refreshServiceAccount(uniqueEmail);
        await pageManager.iamPage.requestServiceAccountOk();
        await pageManager.iamPage.verifySuccessMessage('Service token refreshed successfully.');
        
        testLogger.info('Test completed successfully');
    });
});
