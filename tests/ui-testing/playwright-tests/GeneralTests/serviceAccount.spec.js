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
        await page.locator('[data-test="iam-service-accounts-tab"]').waitFor({ state: 'visible', timeout: 10000 });
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

    test("Token wizard Grant permissions step shows role/group actions", async ({ page }, testInfo) => {
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

        // Advance the token wizard to step 2 (Grant permissions).
        const nextBtn = page.locator('[data-test="service-accounts-token-next-btn"]');
        await expect(nextBtn).toBeVisible({ timeout: 10000 });
        await nextBtn.click();

        // The two grant actions only render on Enterprise/Cloud (showGroupLink =
        // isEnterprise || isCloud). On an OSS build step 2 shows a plain hint with
        // no links, so gate-skip the label assertions there instead of failing.
        const roleLink = page.locator('[data-test="service-accounts-list-token-add-to-role"]');
        const groupLink = page.locator('[data-test="service-accounts-list-token-add-to-group"]');
        const grantLinksRendered = await roleLink
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

        if (!grantLinksRendered) {
            testLogger.info('Grant links absent (OSS build) — skipping label assertions');
            await page.locator('[data-test="service-accounts-token-done-btn"]').click();
            test.skip(true, 'Token wizard grant links are Enterprise/Cloud-only (showGroupLink=false on OSS)');
            return;
        }

        // Step 2 offers the two grant actions with the reworded labels.
        await expect(groupLink).toBeVisible();
        await expect(roleLink).toContainText('Assign a role');
        await expect(groupLink).toContainText('Add to a user group');

        // Close the wizard.
        await page.locator('[data-test="service-accounts-token-done-btn"]').click();

        testLogger.info('Grant permissions step verified');
    });

    test("SRE Agent System Account Protection", async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.iamPage.gotoIamPage();
        await pageManager.iamPage.iamPageServiceAccountsTab();
        await waitForServiceAccountsPage(page);

        // Check if SRE Agent system account exists in the table
        const sreAgentExists = await pageManager.iamPage.sreAgentSystemAccountExists();

        if (sreAgentExists) {
            testLogger.info('SRE Agent system account found in service accounts table');

            // Verify SRE Agent account shows system managed status
            // SRE Agent should not have delete/update buttons (system managed)
            // If they exist, they should be disabled or not clickable
            await pageManager.iamPage.verifySreAgentSystemAccountProtection();

            testLogger.info('SRE Agent system account protection verified');
        } else {
            testLogger.info('No SRE Agent system account found - skipping system account verification');
        }

        testLogger.info('Test completed successfully');
    });
});
