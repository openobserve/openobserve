import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { ManagementPage } from "../pages/managementPage.js";
import { AlertTemplate } from "../pages/alertTemplate.js";  
import { AlertDestination } from "../pages/alertDestination.js";

// Function to generate a random 5-character alphabetic name
function generateRandomName() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 5; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}


    const WebHookTemplateOneJson = generateRandomName();
    const WebHookTemplateTwoJson = generateRandomName();
    const WebHookTemplateOneUrl = generateRandomName();
    const WebHookTemplateTwoUrl = generateRandomName();
    const EmailTemplateOneJson = generateRandomName();
    const EmailTemplateTwoJson = generateRandomName();
    const EmailTemplateOneUrl = generateRandomName();
    const EmailTemplateTwoUrl = generateRandomName();
    const WebHookDestinationOneJson = generateRandomName();
    const WebHookDestinationTwoJson = generateRandomName();
    const WebHookDestinationOneUrl = generateRandomName();
    const WebHookDestinationTwoUrl = generateRandomName();
    const EmailDestinationOneJson = generateRandomName();
    const EmailDestinationTwoJson = generateRandomName();
    const EmailDestinationOneUrl = generateRandomName();
    const EmailDestinationTwoUrl = generateRandomName();
      


test.describe("Import for Template, Destination, Alert", () => {
    
    let loginPage, managementPage, alertTemplate, alertDestination;
    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        managementPage = new ManagementPage(page);
        alertTemplate = new AlertTemplate(page);
        alertDestination = new AlertDestination(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        
    });


    test("Import Webhook Template, Destination and Alert from JSON file", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        //file name to be used for import
        const fileTemplateContentPath = "../test-data/AlertMultiTemplateWebHook.json";
        // Locate the file input field and set the JSON file
        const inputTemplateFile = await page.locator('input[type="file"]');
        await inputTemplateFile.setInputFiles(fileTemplateContentPath);
        await alertTemplate.ClickTemplateImportJsonButton();
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOneJson);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwoJson);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

        // Import Destination

        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        // Define file path to the JSON file
        const fileDestinationContentPath = "../test-data/AlertMultiDestinationWebHook.json";
        const inputDestinationFile = await page.locator('input[type="file"]');
        await inputDestinationFile.setInputFiles(fileDestinationContentPath);
        await alertDestination.clickImportDestinationJsonButton();
        await page.locator('[data-test="destination-import-error-0-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: WebHookTemplateOneJson }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').fill(WebHookDestinationOneJson);

        await page.locator('[data-test="destination-import-error-1-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: WebHookTemplateTwoJson }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').fill(WebHookDestinationTwoJson);

        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');

    });

    
    test("Import Webhook Template, Destination and Alert from URL", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        const urlTemplate = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Alert_Multi_Template_Web_Hook';
        await alertTemplate.importTemplateFromUrl(urlTemplate);
        await page.waitForTimeout(5000);
        await alertTemplate.ClickTemplateImportJsonButton();
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOneUrl);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwoUrl);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

        // Import Destination

        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        const urlDestination = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Alert_destination_Web_Hook_tls';
        await alertDestination.importDestinationFromUrl(urlDestination);
        await page.waitForTimeout(5000);
        await alertDestination.clickImportDestinationJsonButton();
        await page.locator('[data-test="destination-import-error-0-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: WebHookTemplateOneUrl }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').fill(WebHookDestinationOneUrl);

        await page.locator('[data-test="destination-import-error-1-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: WebHookTemplateTwoUrl }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').fill(WebHookDestinationTwoUrl);

        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');



    });


    test("Validate Cancel button on Import Template Page", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        await page.waitForTimeout(5000);
        await alertTemplate.ClickTemplateImportCancelButton();
        await expect(page.locator('[data-test="alert-templates-list-title"]')).toContainText('Templates');

    });
        
    test("Validate JSON string is empty on Import Template Page", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('JSON string is empty');


    });
    
    test("Download Webhook Template after import", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        const fileContentPath = "../test-data/AlertMultiTemplateWebHook.json";
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);
        await alertTemplate.ClickTemplateImportJsonButton();
        const WebHookTemplateOneJsonDownload = generateRandomName();
        const WebHookTemplateTwoJsonDownload = generateRandomName();
        console.log(`Generated logo name: ${WebHookTemplateOneJsonDownload}`);
        console.log(`Generated logo name: ${WebHookTemplateTwoJsonDownload}`);
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOneJsonDownload);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwoJsonDownload);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');
        await page.waitForTimeout(5000);
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('row', { name: WebHookTemplateOneJsonDownload }).locator('[data-test="destination-export"]').click();
        const downloadedFile = await downloadPromise;
        const filePath = await downloadedFile.path();
        console.log(`Downloaded file saved at: ${filePath}`);

    });
    
    test("Import Email Template, Destination and Alert from JSON file", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        //file name to be used for import
        const fileContentPath = "../test-data/AlertMultiTemplateEmail.json";
        // Locate the file input field and set the JSON file
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);
        await alertTemplate.ClickTemplateImportJsonButton();
        await alertTemplate.ClickTemplateImportError00NameInput(EmailTemplateOneJson);
        await alertTemplate.ClickTemplateImportError10NameInput(EmailTemplateTwoJson);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

        // Import Destination

        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        const fileDestinationContentPath = "../test-data/AlertMultiDestinationEmail.json";
        const inputDestinationFile = await page.locator('input[type="file"]');
        await inputDestinationFile.setInputFiles(fileDestinationContentPath);
        await alertDestination.clickImportDestinationJsonButton();


        await page.locator('[data-test="destination-import-error-0-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: EmailTemplateOneJson }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').fill(EmailDestinationOneJson);
        await page.locator('[data-test="destination-import-error-0-2"] [data-test="destination-import-emails-input"]').click();
        await page.locator('[data-test="destination-import-error-0-2"] [data-test="destination-import-emails-input"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
        await page.locator('[data-test="destination-import-error-1-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: EmailTemplateTwoJson }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').fill(EmailDestinationTwoJson);
        await page.locator('[data-test="destination-import-error-1-2"] [data-test="destination-import-emails-input"]').click();
        await page.locator('[data-test="destination-import-error-1-2"] [data-test="destination-import-emails-input"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');
    
    });

    
    test("Import Email Template, Destination and Alert from URL", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        const urlTemplate = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Alert_Multi_Template_Email';
        await alertTemplate.importTemplateFromUrl(urlTemplate);
        await page.waitForTimeout(5000);
        await alertTemplate.ClickTemplateImportJsonButton();
        await alertTemplate.ClickTemplateImportError00NameInput(EmailTemplateOneUrl);
        await alertTemplate.ClickTemplateImportError10NameInput(EmailTemplateTwoUrl);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

        // Import Destination

        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        const urlDestination = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Des_email_multi.json';
        await alertDestination.importDestinationFromUrl(urlDestination);
        await page.waitForTimeout(5000);
        await alertDestination.clickImportDestinationJsonButton();
        await page.locator('[data-test="destination-import-error-0-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: EmailTemplateOneUrl }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]').fill(EmailDestinationOneUrl);
        await page.locator('[data-test="destination-import-error-0-2"] [data-test="destination-import-emails-input"]').click();
        await page.locator('[data-test="destination-import-error-0-2"] [data-test="destination-import-emails-input"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
        await page.locator('[data-test="destination-import-error-1-0"] [data-test="destination-import-template-input"]').click();
        await page.getByRole('option', { name: EmailTemplateTwoUrl }).locator('div').nth(2).click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').click();
        await page.locator('[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]').fill(EmailDestinationTwoUrl);
        await page.locator('[data-test="destination-import-error-1-2"] [data-test="destination-import-emails-input"]').click();
        await page.locator('[data-test="destination-import-error-1-2"] [data-test="destination-import-emails-input"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');
    


    });

    test("Validate Cancel button on Import Destination Page", async ({ page }) => {
        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        await alertDestination.clickCancelDestinationImportButton();
        await expect(page.locator(alertDestination.alertDestinationsListTitle)).toContainText('Alert Destinations');
    });

    test("Validate JSON string is empty on Import Destination Page", async ({ page }) => {
        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('JSON string is empty');
    });





});
