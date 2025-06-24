import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { ManagementPage } from '../pages/managementPage.js';


// Function to generate a random 5-character alphabetic name
function generateRandomStreamName() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 9; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}

test.describe.configure({ mode: 'parallel' });

test.describe("Pagination for logs", () => {
    let loginPage, logsPage, ingestionPage, managementPage;

    const orgId = "default";
    const streamName = generateRandomStreamName();

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        managementPage = new ManagementPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestionMultiOrgStream(orgId, streamName);
        
    });
    test("Enable Streaming for running query to validate WHERE match_all('[2022-12-27T14:11:27Z INFO  zinc_enl')", {tag: ['@shyam']}, async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000);  

        //await logsPage.selectResultsPerPageAndVerify(10, 'Showing 1 to 10 out of 39 events in');

        // await page.waitForTimeout(20000);
        await page.locator('[data-test="logs-search-search-result"]').getByText('arrow_drop_down').click();
        await page.getByText('10', { exact: true }).click();
        await page.waitForTimeout(2000);
        await expect(page.locator('[data-test="logs-search-search-result"]')).toContainText('Showing 1 to 10 out of 39');
        await page.getByLabel('2').click();
        await page.waitForTimeout(2000);
        await expect(page.locator('[data-test="logs-search-search-result"]')).toContainText('Showing 11 to 20 out of 39');
        await page.getByLabel('3').click();
        await page.waitForTimeout(2000);
        await expect(page.locator('[data-test="logs-search-search-result"]')).toContainText('Showing 21 to 30 out of 39');
        await page.getByLabel('4').click();
        await page.waitForTimeout(2000);
        await expect(page.locator('[data-test="logs-search-search-result"]')).toContainText('Showing 31 to 39 out of 39');
        await page.getByLabel('5').click();
       
     

    });

    test("Enable Streaming for running query to validate match_all('zio*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("[2022-12-27T14:11:27*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validate match_all('us*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("parque*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validatematch_all('ip-10-2-15-197.us-east-2.co*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("2022-12-27T14:1*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validate match_all('[2022-12-27T14:11:27Z INFO  zinc_enl') limit 10", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("[2022-12-27T14:11:27Z INFO  zinc_enl") limit 10');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

   
});
