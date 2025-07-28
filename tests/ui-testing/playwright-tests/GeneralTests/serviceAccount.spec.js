import { test, expect } from "../baseFixtures.js";
import PageManager from "../../pages/page-manager.js";

test.describe("Service Account for API access", () => {
    let pageManager;

    const timestamp = Date.now(); 
    const randomSuffix = Math.floor(Math.random() * 1000); 
    const emailName = `email${timestamp}${randomSuffix}@gmail.com`;

    test.beforeEach(async ({ page }) => {
        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login();
    });

    test("Error Message displayed if Email Blank", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamURLValidation();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.iamPageAddServiceAccountEmailValidation();
    });

    test("Service Account created", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
    });

    test("Service Account not created if Email already exists", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterSameEmailServiceAccount();
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('User already exists');
    });
    
    test("Service Account not created if Cancel clicked", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.enterDescriptionSA();
        await pageManager.iamPage.clickCancelServiceAccount();
    });

    test("Service Account Token copied", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickCopyToken();
    });
    
    test("Service Account Download Token", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickDownloadToken();
    });
    
    test("Service Account Token Pop Up Closed", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
    });

    test("Service Account Created and deleted", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.deletedServiceAccount(emailName);
        await pageManager.iamPage.requestServiceAccountOk();
        await pageManager.iamPage.verifySuccessMessage('Service Account deleted successfully.');
    });

    test("Service Account Created and not deleted if cancel clicked", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.deletedServiceAccount(emailName);
        await pageManager.iamPage.requestServiceAccountCancel();
    });

    test("Service Account Created and updated details", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.updatedServiceAccount(emailName);
        await pageManager.iamPage.enterDescriptionSA();
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account updated successfully.');
    });

    test("Service Account Created and refresh token", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(emailName);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await pageManager.iamPage.refreshServiceAccount(emailName);
        await pageManager.iamPage.requestServiceAccountOk();
        await pageManager.iamPage.verifySuccessMessage('Service token refreshed successfully.');
    });
});
