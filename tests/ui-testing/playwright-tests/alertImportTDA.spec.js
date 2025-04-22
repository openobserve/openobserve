import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { ManagementPage } from "../pages/managementPage.js";
import { AlertTemplate } from "../pages/alertTemplate.js";  

// Function to generate a random 5-character alphabetic name
function generateRandomName() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 5; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}

test.describe("Import for Template, Destination, Alert", () => {
    
    let loginPage, managementPage, alertTemplate;
    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        managementPage = new ManagementPage(page);
        alertTemplate = new AlertTemplate(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        
    });


    test("Import Webhook Template from JSON file", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        //file name to be used for import
        const fileContentPath = "../test-data/AlertMultiTemplateWebHook.json";
        // Locate the file input field and set the JSON file
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);
        await alertTemplate.ClickTemplateImportJsonButton();
        const WebHookTemplateOne = generateRandomName();
        const WebHookTemplateTwo = generateRandomName();
        console.log(`Generated logo name: ${WebHookTemplateOne}`);
        console.log(`Generated logo name: ${WebHookTemplateTwo}`);
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOne);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwo);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');
    
    });

    
    test("Import Webhook Template from URL", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        const url = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Alert_Multi_Template_Web_Hook';
        await alertTemplate.importTemplateFromUrl(url);
        await page.waitForTimeout(5000);
        await alertTemplate.ClickTemplateImportJsonButton();
        const WebHookTemplateOne = generateRandomName();
        const WebHookTemplateTwo = generateRandomName();
        console.log(`Generated logo name: ${WebHookTemplateOne}`);
        console.log(`Generated logo name: ${WebHookTemplateTwo}`);
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOne);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwo);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

    });


    test("Validate Cancel button on Import Template Page", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        await page.waitForTimeout(5000);
        await alertTemplate.ClickTemplateImportCancelButton();
        await expect(page.locator('[data-test="alert-templates-list-title"]')).toContainText('Templates');

    });
        
    test("Validate JSON string is empty", async ({ page }) => {

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
        const WebHookTemplateOne = generateRandomName();
        const WebHookTemplateTwo = generateRandomName();
        console.log(`Generated logo name: ${WebHookTemplateOne}`);
        console.log(`Generated logo name: ${WebHookTemplateTwo}`);
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOne);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwo);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');
        await page.waitForTimeout(5000);
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('row', { name: WebHookTemplateOne }).locator('[data-test="destination-export"]').click();
        const downloadedFile = await downloadPromise;
        const filePath = await downloadedFile.path();
        console.log(`Downloaded file saved at: ${filePath}`);

    });
    
    



});
