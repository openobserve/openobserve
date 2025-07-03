import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { ManagementPage } from '../pages/managementPage.js';

// Function to generate a random 9-character alphabetic name
function generateRandomStreamName() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 9; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}

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

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of 39');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of 39');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 39 out of 39');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('zin*')", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("zin*")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T1*')", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T1*")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("HTTP for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", async ({ page }) => {
        
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl") limit 10`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.pageNotVisible();
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", async ({ page }) => {

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
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of 39');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of 39');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 39 out of 39');
    });

    test("Enable Streaming for running query to validate WHERE match_all('zin*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("zin*")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T1*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T1*")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:2*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:2*")`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.clickResultsPerPage();
        await logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl") limit 10`);
        await page.waitForTimeout(2000);
        await logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await logsPage.pageNotVisible();
    });
      
});
