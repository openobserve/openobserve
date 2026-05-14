const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

// Service accounts tab (data-test="iam-service-accounts-tab") does not exist on cloud UI
test.describe("Service Account for API access", () => {
    test.skip(isCloudEnvironment(), 'Service accounts tab not available on cloud UI');
    let pageManager;

    // Helper to wait for page to load and handle any existing SRE Agent accounts.
    // Avoid waitForLoadState('networkidle') — deployed envs continuously poll RUM/
    // analytics endpoints so the network never idles.
    async function waitForServiceAccountsPage(page) {
        await page.waitForSelector('[data-test="iam-service-accounts-tab"]', { timeout: 10000 });
        await page.waitForTimeout(1000); // Brief pause to allow any system accounts to load
    }

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
        await waitForServiceAccountsPage(page);
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await waitForServiceAccountsPage(page);
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
        await waitForServiceAccountsPage(page);
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await waitForServiceAccountsPage(page);
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
        await waitForServiceAccountsPage(page);
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await waitForServiceAccountsPage(page);
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
        await waitForServiceAccountsPage(page);
        await pageManager.iamPage.iamPageAddServiceAccount();
        await pageManager.iamPage.enterEmailServiceAccount(uniqueEmail);
        await pageManager.iamPage.clickSaveServiceAccount();
        await pageManager.iamPage.verifySuccessMessage('Service Account created successfully.');
        await pageManager.iamPage.clickServiceAccountPopUpClosed();
        await pageManager.iamPage.reloadServiceAccountPage();
        await waitForServiceAccountsPage(page);
        await pageManager.iamPage.refreshServiceAccount(uniqueEmail);
        await pageManager.iamPage.requestServiceAccountOk();
        await pageManager.iamPage.verifySuccessMessage('Service token refreshed successfully.');

        testLogger.info('Test completed successfully');
    });

    test("SRE Agent System Account Protection", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await waitForServiceAccountsPage(page);

        // Check if SRE Agent system account exists in the table
        const sreAgentSelector = 'td:has-text("o2-sre-agent.")';
        const sreAgentExists = await page.locator(sreAgentSelector).count() > 0;

        if (sreAgentExists) {
            testLogger.info('SRE Agent system account found in service accounts table');

            // Verify SRE Agent account shows system managed status
            const sreAgentRow = page.locator('tr').filter({ hasText: 'o2-sre-agent.' });
            await expect(sreAgentRow).toBeVisible();

            // SRE Agent should not have delete/update buttons (system managed)
            // If they exist, they should be disabled or not clickable
            const deleteButton = sreAgentRow.locator('button[title="Delete Service Account"]');
            const updateButton = sreAgentRow.locator('button[title="Update Service Account"]');

            if (await deleteButton.count() > 0) {
                await expect(deleteButton).toBeDisabled();
            }
            if (await updateButton.count() > 0) {
                await expect(updateButton).toBeDisabled();
            }

            testLogger.info('SRE Agent system account protection verified');
        } else {
            testLogger.info('No SRE Agent system account found - skipping system account verification');
        }

        testLogger.info('Test completed successfully');
    });
});
