const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const logsdata = require("../../../test-data/logs_data.json");

test.describe.configure({ mode: 'parallel' });

test.describe("Schema testcases", () => {
    let pm;
    const streamName = `stream${Date.now()}`;

    // Ingestion helper function
    async function ingestion(page, testStreamName) {
        testLogger.debug('Starting ingestion for test stream', { testStreamName });
        const orgId = "automationtesting";
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };
        
        const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
            const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(logsdata)
            });
            return await fetchResponse.json();
        }, {
            url: process.env.INGESTION_URL,
            headers: headers,
            orgId: orgId,
            streamName: testStreamName,
            logsdata: logsdata
        });
        
        testLogger.debug('Ingestion response', { response });
    }

    test('stream schema settings updated to be displayed under logs', async ({ page }, testInfo) => {
        const testStreamName = "test1";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle');
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page
        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=automationtesting`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });
        await page.goto(logsUrl);
        
        const allsearch = page.waitForResponse("**/api/automationtesting/_search**");
        await pm.logsPage.selectStream(testStreamName); 
        await pm.schemaPage.applyQuery();
        
        // Start of actual test - simplified schema workflow
        await pm.schemaPage.completeStreamSettingsSchemaWorkflow(testStreamName);
        
        // Basic verification that schema configuration worked
        testLogger.info('Schema configuration completed successfully');
        
        testLogger.info('Stream schema settings test completed');
    });

    test('should display stream details on navigating from blank stream to stream with details', async ({ page }, testInfo) => {
        const testStreamName = "test2";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle');
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page
        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=automationtesting`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });
        await page.goto(logsUrl);
        
        await pm.logsPage.selectStream(testStreamName); 
        await pm.schemaPage.applyQuery();
        
        // Start of actual test - complete blank to detailed stream workflow
        await pm.schemaPage.completeBlankToDetailedStreamWorkflow(streamName, testStreamName);
        
        testLogger.info('Blank to detailed stream navigation test completed');
    });

    test('should add a new field and delete it from schema', async ({ page }, testInfo) => {
        const testStreamName = "test3";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle');
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page
        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=automationtesting`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });
        await page.goto(logsUrl);
        
        await pm.logsPage.selectStream(testStreamName); 
        await pm.schemaPage.applyQuery();
        
        // Start of actual test - complete add and delete field workflow
        await pm.schemaPage.completeAddAndDeleteFieldWorkflow(testStreamName);
        
        testLogger.info('Add and delete field from schema test completed');
    });
});
