import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { ManagementPage } from "../pages/managementPage.js";
import { AlertTemplate } from "../pages/alertTemplate.js";  
import { AlertDestination } from "../pages/alertDestination.js";
import { AlertsPage } from "../pages/alertsPage.js";
import { IngestionPage } from '../pages/ingestionPage';

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
    
    let loginPage, managementPage, alertTemplate, alertDestination, alertsPage, ingestionPage;

    const orgId = process.env["ORGNAME"];
    const streamName = "default";

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        managementPage = new ManagementPage(page);
        alertTemplate = new AlertTemplate(page);
        alertDestination = new AlertDestination(page);
        alertsPage = new AlertsPage(page);
        ingestionPage = new IngestionPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        await ingestionPage.ingestionJoin();
    });


    test("Import Webhook Template, Webhook Destination and Scheduled Alert from JSON file", async ({ page }) => {

        const WebHookTemplateOneJson = generateRandomName();
        const WebHookTemplateTwoJson = generateRandomName();
        const WebHookDestinationOneJson = generateRandomName();
        const WebHookDestinationTwoJson = generateRandomName();
        const ScheduledAlertOneJson = generateRandomName();
        const ScheduledAlertTwoJson = generateRandomName();

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        //file name to be used for import
        const fileTemplateContentPath = "../test-data/AlertMultiTemplateWebHook.json";
        // Locate the file input field and set the JSON file
        const inputTemplateFile = await page.locator('input[type="file"]');
        await inputTemplateFile.setInputFiles(fileTemplateContentPath);
        await page.waitForTimeout(5000);
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
        await page.waitForTimeout(5000);
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.ClickDestinationImportError00Input(WebHookTemplateOneJson);
        await alertDestination.ClickDestinationImportError01Input(WebHookDestinationOneJson);
        await alertDestination.ClickDestinationImportError10Input(WebHookTemplateTwoJson);
        await alertDestination.ClickDestinationImportError11Input(WebHookDestinationTwoJson);   

        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');

        // Import Alert

        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        await page.waitForTimeout(5000);

        const fileAlertContentPath = "../test-data/AlertMultiScheduled.json";  
        await alertsPage.uploadAlertFile(fileAlertContentPath); 
        await alertsPage.ClickAlertImportJsonButton();
        console.log(ScheduledAlertOneJson);
        await alertsPage.ClickAlertImportError00NameInput(ScheduledAlertOneJson);
        await alertsPage.ClickAlertImportError01Input(orgId);
        await alertsPage.ClickAlertImportError02Input(streamName);
        await alertsPage.ClickAlertImportError03Input(WebHookDestinationOneJson);
        await alertsPage.ClickAlertImportError10Input(ScheduledAlertTwoJson);
        await alertsPage.ClickAlertImportError11Input(orgId);
        await alertsPage.ClickAlertImportError12Input(streamName);
        await alertsPage.ClickAlertImportError13Input(WebHookDestinationTwoJson);
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Alert(s) imported successfully');    
    });

    
    test("Import Webhook Template, Webhook Destination and Scheduled Alert from URL", async ({ page }) => {

        const WebHookTemplateOneUrl = generateRandomName();
        const WebHookTemplateTwoUrl = generateRandomName();
        const WebHookDestinationOneUrl = generateRandomName();
        const WebHookDestinationTwoUrl = generateRandomName();
        const ScheduledAlertOneUrl = generateRandomName();
        const ScheduledAlertTwoUrl = generateRandomName();

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
        await alertDestination.ClickDestinationImportError00Input(WebHookTemplateOneUrl);
        await alertDestination.ClickDestinationImportError01Input(WebHookDestinationOneUrl);
        await alertDestination.ClickDestinationImportError10Input(WebHookTemplateTwoUrl);
        await alertDestination.ClickDestinationImportError11Input(WebHookDestinationTwoUrl);

        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');

        // Import Alert

        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        const urlAlert = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/Alert_Multi_Scheduled';
        await alertsPage.importAlertFromUrl(urlAlert);
        await page.waitForTimeout(5000);
        await alertsPage.ClickAlertImportJsonButton();
        await alertsPage.ClickAlertImportError00NameInput(ScheduledAlertOneUrl);
        await alertsPage.ClickAlertImportError01Input(orgId);
        await alertsPage.ClickAlertImportError02Input(streamName);
        await alertsPage.ClickAlertImportError03Input(WebHookDestinationOneUrl);
        await alertsPage.ClickAlertImportError10Input(ScheduledAlertTwoUrl);
        await alertsPage.ClickAlertImportError11Input(orgId);
        await alertsPage.ClickAlertImportError12Input(streamName);
        await alertsPage.ClickAlertImportError13Input(WebHookDestinationTwoUrl);
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Alert(s) imported successfully');

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
    
    test("Download Webhook Template, Webhook Destination and Scheduled Alert after import", async ({ page }) => {

        await managementPage.navigateToManagement();
        await alertTemplate.navigateToAlertTemplate();
        await alertTemplate.importTemplateButton();
        const fileContentPath = "../test-data/AlertMultiTemplateWebHook.json";
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);
        await alertTemplate.ClickTemplateImportJsonButton();
        const WebHookTemplateOneJsonDownload = generateRandomName();
        const WebHookTemplateTwoJsonDownload = generateRandomName();
        await alertTemplate.ClickTemplateImportError00NameInput(WebHookTemplateOneJsonDownload);
        await alertTemplate.ClickTemplateImportError10NameInput(WebHookTemplateTwoJsonDownload);
        await alertTemplate.ClickTemplateImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Successfully imported template(s)');
        await page.waitForTimeout(5000);
        const downloadPromiseTemplate = page.waitForEvent('download');
        await page.getByRole('row', { name: WebHookTemplateOneJsonDownload }).locator('[data-test="destination-export"]').click();
        const downloadedFileTemplate = await downloadPromiseTemplate;
        const filePathTemplate = await downloadedFileTemplate.path();
        console.log(`Downloaded file saved at: ${filePathTemplate}`);


        // Import Destination
        const WebHookDestinationOneJsonDownload = generateRandomName();
        const WebHookDestinationTwoJsonDownload = generateRandomName();
        await managementPage.navigateToManagement();
        await alertDestination.navigateToAlertDestinations();
        await alertDestination.clickImportDestinationButton();
        await page.waitForTimeout(5000);
        // Define file path to the JSON file
        const fileDestinationContentPath = "../test-data/AlertMultiDestinationWebHook.json";
        const inputDestinationFile = await page.locator('input[type="file"]');
        await inputDestinationFile.setInputFiles(fileDestinationContentPath);
        await alertDestination.clickImportDestinationJsonButton();

        await alertDestination.ClickDestinationImportError00Input(WebHookTemplateOneJsonDownload);
        await alertDestination.ClickDestinationImportError01Input(WebHookDestinationOneJsonDownload);
        await alertDestination.ClickDestinationImportError10Input(WebHookTemplateTwoJsonDownload);
        await alertDestination.ClickDestinationImportError11Input(WebHookDestinationTwoJsonDownload);
        await page.waitForTimeout(5000);

        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');
        await page.waitForTimeout(5000);

        const downloadPromiseDestination = page.waitForEvent('download');
        await page.getByRole('row', { name: WebHookDestinationOneJsonDownload }).locator('[data-test="destination-export"]').click();
        const downloadedFileDestination = await downloadPromiseDestination;
        const filePathDestination = await downloadedFileDestination.path();
        console.log(`Downloaded file saved at: ${filePathDestination}`);

        // Import Alert
        const ScheduledAlertOneJsonDownload = generateRandomName();
        const ScheduledAlertTwoJsonDownload = generateRandomName();
        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        await page.waitForTimeout(5000);
        const fileAlertContentPath = "../test-data/AlertMultiScheduled.json";  
        await alertsPage.uploadAlertFile(fileAlertContentPath); 
        await alertsPage.ClickAlertImportJsonButton();
        console.log(ScheduledAlertOneJsonDownload);
        await alertsPage.ClickAlertImportError00NameInput(ScheduledAlertOneJsonDownload);
        await alertsPage.ClickAlertImportError01Input(orgId);
        await alertsPage.ClickAlertImportError02Input(streamName);
        await alertsPage.ClickAlertImportError03Input(WebHookDestinationOneJsonDownload);
        await alertsPage.ClickAlertImportError10Input(ScheduledAlertTwoJsonDownload);
        await alertsPage.ClickAlertImportError11Input(orgId);   
        await alertsPage.ClickAlertImportError12Input(streamName);
        await alertsPage.ClickAlertImportError13Input(WebHookDestinationTwoJsonDownload);
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Alert(s) imported successfully');    
        await page.waitForTimeout(5000);

        await page.locator(`[data-test="alert-list-${ScheduledAlertOneJsonDownload}-more-options"]`).click();
        const downloadPromise = page.waitForEvent('download');
        await page.getByText('Export').click();
        const download = await downloadPromise;
        const filePathAlert = await download.path();
        console.log(`Downloaded file saved at: ${filePathAlert}`);
        

    });
    
    test("Import Email Template, Email Destination and Real Time Alert from JSON file", async ({ page }) => {

        const EmailTemplateOneJson = generateRandomName();
        const EmailTemplateTwoJson = generateRandomName();
        const EmailDestinationOneJson = generateRandomName();
        const EmailDestinationTwoJson = generateRandomName();
        const RealTimeAlertOneJson = generateRandomName();
        const RealTimeAlertTwoJson = generateRandomName();

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


        await alertDestination.ClickDestinationImportError00Input(EmailTemplateOneJson);
        await alertDestination.ClickDestinationImportError01Input(EmailDestinationOneJson);
        await alertDestination.ClickDestinationImportError02Input(process.env["ZO_ROOT_USER_EMAIL"]);
        await alertDestination.ClickDestinationImportError10Input(EmailTemplateTwoJson);
        await alertDestination.ClickDestinationImportError11Input(EmailDestinationTwoJson);
        await alertDestination.ClickDestinationImportError12Input(process.env["ZO_ROOT_USER_EMAIL"]);
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');

        // Import Alert

        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        await page.waitForTimeout(5000);
        const fileAlertContentPath = "../test-data/AlertMultiRealTime.json";  
        await alertsPage.uploadAlertFile(fileAlertContentPath); 
        await alertsPage.ClickAlertImportJsonButton();
        await alertsPage.ClickAlertImportError00NameInput(RealTimeAlertOneJson);
        await alertsPage.ClickAlertImportError01Input(orgId);
        await alertsPage.ClickAlertImportError02Input(streamName);
        await alertsPage.ClickAlertImportError03Input(EmailDestinationOneJson);     
        await alertsPage.ClickAlertImportError10Input(RealTimeAlertTwoJson);
        await alertsPage.ClickAlertImportError11Input(orgId);
        await alertsPage.ClickAlertImportError12Input(streamName);
        await alertsPage.ClickAlertImportError13Input(EmailDestinationTwoJson);
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Alert(s) imported successfully');

    });

    
    test("Import Email Template, email destination and real time alert from URL", async ({ page }) => {

        const EmailTemplateOneUrl = generateRandomName();
        const EmailTemplateTwoUrl = generateRandomName();
        const EmailDestinationOneUrl = generateRandomName();
        const EmailDestinationTwoUrl = generateRandomName();
        const RealTimeAlertOneUrl = generateRandomName();
        const RealTimeAlertTwoUrl = generateRandomName();


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
        await alertDestination.ClickDestinationImportError00Input(EmailTemplateOneUrl);
        await alertDestination.ClickDestinationImportError01Input(EmailDestinationOneUrl);
        await alertDestination.ClickDestinationImportError02Input(process.env["ZO_ROOT_USER_EMAIL"]);
        await alertDestination.ClickDestinationImportError10Input(EmailTemplateTwoUrl);
        await alertDestination.ClickDestinationImportError11Input(EmailDestinationTwoUrl);
        await alertDestination.ClickDestinationImportError12Input(process.env["ZO_ROOT_USER_EMAIL"]);   
        await alertDestination.clickImportDestinationJsonButton();
        await alertDestination.checkForTextInNotification('Successfully imported destination(s)');

        // Import Alert

        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        const urlAlert = 'https://raw.githubusercontent.com/ShyamOOAI/Alerts_test/refs/heads/main/real_multi_alerts';
        await alertsPage.importAlertFromUrl(urlAlert);
        await page.waitForTimeout(5000);
        await alertsPage.ClickAlertImportJsonButton();
        await alertsPage.ClickAlertImportError00NameInput(RealTimeAlertOneUrl);
        await alertsPage.ClickAlertImportError01Input(orgId);
        await alertsPage.ClickAlertImportError02Input(streamName);
        await alertsPage.ClickAlertImportError03Input(EmailDestinationOneUrl);
        await alertsPage.ClickAlertImportError10Input(RealTimeAlertTwoUrl);
        await alertsPage.ClickAlertImportError11Input(orgId);
        await alertsPage.ClickAlertImportError12Input(streamName);
        await alertsPage.ClickAlertImportError13Input(EmailDestinationTwoUrl);
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('Alert(s) imported successfully');


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

    test("Validate Cancel button on Import Alert Page", async ({ page }) => {
        
        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        await alertsPage.ClickAlertImportCancelButton();
        await page.waitForTimeout(5000);
        await expect(page.locator('[data-test="alerts-list-title"]')).toContainText('Alerts');
    });

    test("Validate JSON string is empty on Import Alert Page", async ({ page }) => {
        await alertsPage.navigateToAlerts();
        await alertsPage.importAlertButton();
        await alertsPage.ClickAlertImportJsonButton();
        await expect(page.locator('#q-notify')).toContainText('JSON string is empty');
    });



});
