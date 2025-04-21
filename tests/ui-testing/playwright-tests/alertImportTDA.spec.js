import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { ManagementPage } from "../pages/managementPage.js";
import { AlertTemplate } from "../pages/alertTemplate.js";  


// Function to generate a random 5-character alphabetic name
function generateRandomLogoName() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 5; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}


test.describe("Import for Template, Destination, Alert", () => {
    let loginPage, managementPage, alertTemplate;
    const emailName = `email${Date.now()}@gmail.com`;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        managementPage = new ManagementPage(page);
        alertTemplate = new AlertTemplate(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        
    });


    test("Import Template from JSON file", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();

        //file name to be used for import
        const fileContentPath = "../test-data/AlertMultiTemplateWebHook.json";

        // Locate the file input field and set the JSON file
        const inputFile = await page.locator('input[type="file"]');
        //is used for setting the file to be imported
        await inputFile.setInputFiles(fileContentPath);

        // await page.locator('.view-lines').click();
        await alertTemplate.ClickTemplateImportJsonButton();
        // Example usage in Playwright POM
        const WebHookTemplateOne = generateRandomLogoName();
        const WebHookTemplateTwo = generateRandomLogoName();
        console.log(`Generated logo name: ${WebHookTemplateOne}`);
        console.log(`Generated logo name: ${WebHookTemplateTwo}`);
        
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOne);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwo);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');

    });

    

        

    

    
    



});
