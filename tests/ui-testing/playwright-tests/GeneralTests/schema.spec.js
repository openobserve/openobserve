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
        const orgId = process.env["ORGNAME"];
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

            const contentType = fetchResponse.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await fetchResponse.json();
            } else {
                const text = await fetchResponse.text();
                return { error: text, status: fetchResponse.status };
            }
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

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(process.env["ORGNAME"]);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(testStreamName);
        await page.waitForTimeout(1000);

        const allsearch = page.waitForResponse(`**/api/${process.env["ORGNAME"]}/_search**`, { timeout: 60000 });
        await pm.schemaPage.applyQuery();
        await allsearch;
        
        // Start of actual test - simplified schema workflow
        await pm.schemaPage.completeStreamSettingsSchemaWorkflow(testStreamName);
        
        // Verify schema workflow completed by checking no error messages are present
        await pm.schemaPage.verifyNoErrorMessages();
        testLogger.assertion('Schema workflow completed without errors', true);
        
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

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(process.env["ORGNAME"]);
        
        await pm.logsPage.selectStream(testStreamName); 
        await pm.schemaPage.applyQuery();
        
        // Start of actual test - complete blank to detailed stream workflow
        await pm.schemaPage.completeBlankToDetailedStreamWorkflow(streamName, testStreamName);
        
        // Verify navigation workflow completed by checking streams page is accessible
        await pm.schemaPage.verifyStreamsPageAccessible();
        testLogger.assertion('Stream navigation workflow completed successfully', true);
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

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(process.env["ORGNAME"]);
        
        await pm.logsPage.selectStream(testStreamName); 
        await pm.schemaPage.applyQuery();
        
        // Start of actual test - use original working enhanced framework method
        await pm.schemaPage.completeAddAndDeleteFieldWorkflow(testStreamName);
        
        testLogger.assertion('Add/delete field workflow completed successfully', true);
    });
});
