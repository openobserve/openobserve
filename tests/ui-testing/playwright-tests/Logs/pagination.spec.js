import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

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
    let pageManager;

    const orgId = "default";
    const streamName = generateRandomStreamName();

    test.beforeEach(async ({ page }) => {

        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login(); // Login as root user
        await pageManager.ingestionPage.ingestionMultiOrgStream(orgId, streamName);
        
    });

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl")`);
        await page.waitForTimeout(3000); // Wait for query preparation
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(3000); // Wait for query results
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await page.waitForTimeout(1000); // Wait for pagination change
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await page.waitForTimeout(1000); // Wait for pagination change
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('zin*')", async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("zin*")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T1*')", async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T1*")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("HTTP for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", async ({ page }) => {
        
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl") limit 10`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.pageNotVisible();
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", async ({ page }) => {

        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkStreaming();
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to');
    });

    test("Enable Streaming for running query to validate WHERE match_all('zin*')", async ({ page }) => {

        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkStreaming();
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("zin*")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T1*')", async ({ page }) => {

        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkStreaming();
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T1*")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:2*')", async ({ page }) => {

        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkStreaming();
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:2*")`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', 'Showing 11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', 'Showing 21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', 'Showing 31 to 40 out of');
    });

    test("Enable Streaming for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", async ({ page }) => {

        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkStreaming();
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        console.log(streamName);
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all("2022-12-27T14:11:27Z INFO  zinc_enl") limit 10`);
        await page.waitForTimeout(2000);
        await pageManager.logsPage.selectRunQuery();
        await page.waitForTimeout(2000); 
        await pageManager.logsPage.pageNotVisible();
    });
      
});
