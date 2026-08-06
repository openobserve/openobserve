import { test } from "../baseFixtures.js";
import PageManager from "../../pages/page-manager.js";
const testLogger = require('../utils/test-logger.js');
// (duplicate import removed)

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
    // One stream per worker process: every test asserts pagination counts against the
    // record count of a single ingestion, so ingesting the same fixture once and reusing
    // the stream across the worker's tests yields identical validations while removing
    // a redundant ingest + index-wait from every test. Module state is per worker
    // (workers are separate processes), so parallel workers stay isolated.
    let streamName;
    let streamReady = false;

    const orgId = process.env.ORGNAME || "default";

    test.beforeEach(async ({ page }) => {

        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login(); // Login as root user
        if (!streamReady) {
            streamName = generateRandomStreamName();
            await pageManager.ingestionPage.ingestionMultiOrgStream(orgId, streamName);
            // Wait for stream to be indexed — cloud can take 30-60s
            await pageManager.logsPage.waitForStreamAvailable(streamName, 120000, 1000);
            streamReady = true;
        }
    });

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", { tag: ['@pagination', '@functional', '@P1'] }, async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')`);
        // Strategic 1000ms wait for query preparation - this is functionally necessary
        await page.waitForTimeout(1000);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 1000ms wait for query results - this is functionally necessary
        await page.waitForTimeout(1000);
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        // Strategic 500ms wait for pagination change - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        // Strategic 500ms wait for pagination change - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('zin*')", { tag: ['@pagination', '@functional', '@P1'] }, async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('zin*')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to 40 out of');
    });

    test("HTTP Pagination for running query to validate WHERE match_all('2022-12-27T1*')", { tag: ['@pagination', '@functional', '@P1'] }, async ({ page }) => {

        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T1*')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to 40 out of');
    });

    test("HTTP for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", { tag: ['@pagination', '@functional', '@P1'] }, async ({ page }) => {
        
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit 10`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.pageNotVisible();
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')", { tag: ['@pagination', '@streaming', '@functional', '@P1'] }, async ({ page }) => {

        // Streaming is enabled via ZO_STREAMING_ENABLED env var — no need to toggle
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to');
    });

    test("Enable Streaming for running query to validate WHERE match_all('zin*')", { tag: ['@pagination', '@streaming', '@functional', '@P1'] }, async ({ page }) => {

        // Streaming is enabled via ZO_STREAMING_ENABLED env var — no need to toggle
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('zin*')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T1*')", { tag: ['@pagination', '@streaming', '@functional', '@P1'] }, async ({ page }) => {

        // Streaming is enabled via ZO_STREAMING_ENABLED env var — no need to toggle
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T1*')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to 40 out of');
    });

    test("Enable Streaming for running query to validate WHERE match_all('2022-12-27T14:11:2*')", { tag: ['@pagination', '@streaming', '@functional', '@P1'] }, async ({ page }) => {

        // Streaming is enabled via ZO_STREAMING_ENABLED env var — no need to toggle
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T14:11:2*')`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.clickResultsPerPage();
        await pageManager.logsPage.selectResultsPerPageAndVerify('2', '11 to 20 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('3', '21 to 30 out of');
        await pageManager.logsPage.selectResultsPerPageAndVerify('4', '31 to 40 out of');
    });

    test("Enable Streaming for running query to validate pagination is not visible WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit`", { tag: ['@pagination', '@streaming', '@functional', '@P1'] }, async ({ page }) => {

        // Streaming is enabled via ZO_STREAMING_ENABLED env var — no need to toggle
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStream(streamName);
        testLogger.debug('Stream name generated', { streamName });
        await pageManager.logsPage.typeQuery(`SELECT * FROM "${streamName}" WHERE match_all('2022-12-27T14:11:27Z INFO  zinc_enl') limit 10`);
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500);
        await pageManager.logsPage.selectRunQuery();
        // Strategic 500ms wait for operation completion - this is functionally necessary
        await page.waitForTimeout(500); 
        await pageManager.logsPage.pageNotVisible();
    });
    
    test.afterEach(async ({ page }) => {
        // await pageManager.commonActions.flipStreaming();
    });
});
