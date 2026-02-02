const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

// Generate a unique run ID at the start of test execution (shared across all workers)
// This ensures stream names are unique across test runs, not just within a run
const testRunId = Date.now().toString(36).slice(-4);

test.describe("Schema Load testcases", () => {
    let pm;

    // Ingestion helper function for large payloads
    async function largePayloadIngestion(page, streamName, logData) {
        testLogger.debug('Starting large payload ingestion', { streamName, fieldCount: Object.keys(logData[0]).length });
        
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
            const responseText = await fetchResponse.text();
            return { 
                status: fetchResponse.status, 
                statusText: fetchResponse.statusText,
                body: responseText,
                ok: fetchResponse.ok
            };
        }, {
            url: process.env.INGESTION_URL,
            headers: headers,
            orgId: orgId,
            streamName: streamName,
            logsdata: logData
        });
        
        testLogger.debug('Large payload ingestion response', { response });
        
        // Check if ingestion was actually successful
        if (!response.ok) {
            throw new Error(`Ingestion failed: ${response.status} ${response.statusText} - ${response.body}`);
        }
        
        return response;
    }

    // Generate manageable log data for schema load testing (100 fields for practical testing)
    function generateLogData() {
        testLogger.debug('Generating schema load test data with 100 fields');
        
        // Base structure similar to the working logs_data.json
        const logData = [{
            // Core kubernetes-like fields (similar to working test data)
            "kubernetes.container_name": "schema-test-container",
            "kubernetes.namespace_name": "schema-test",
            "kubernetes.host": "test-host.internal",
            "kubernetes.pod_name": "schema-test-pod",
            "stream": "stdout",
            "level": "info",
            "message": "Schema load testing message",
            "log": "Schema load test log entry for field testing",
            
            // Generate additional fields for schema testing
            ...Array.from({ length: 90 }, (_, i) => ({
                [`schema_field_${i + 1}`]: `Schema test value ${i + 1} - Lorem ipsum dolor sit amet`
            })).reduce((acc, obj) => ({ ...acc, ...obj }), {}),
            
            // Timestamp
            "_timestamp": new Date().toISOString()
        }];

        testLogger.debug('Generated schema load test data successfully', { 
            fieldCount: Object.keys(logData[0]).length 
        });
        return logData;
    }

    test('should send a large log payload to the API and verify success', async ({ page }, testInfo) => {
        // Generate unique stream name using testRunId and worker index to avoid conflicts
        // in parallel execution and across test runs
        const streamName = `stress_test_${testRunId}_w${testInfo.parallelIndex}`;

        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        testLogger.info('Using unique stream name for this test run', { streamName, testRunId, workerIndex: testInfo.parallelIndex });
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle');
        
        // Generate and send large payload
        const logData = generateLogData();
        await largePayloadIngestion(page, streamName, logData);
        
        testLogger.info('Large payload ingestion completed successfully');
        
        // Wait for indexing to complete - crucial for large payloads
        testLogger.debug('Waiting for indexing to complete after large payload ingestion');
        await page.waitForTimeout(5000);
        
        // Navigate to logs page and verify data
        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });
        await page.goto(logsUrl);
        await page.waitForLoadState('domcontentloaded');
        
        // Complete schema load verification workflow
        await pm.schemaLoadPage.completeSchemaLoadVerificationWorkflow(streamName);
        
        testLogger.info('Schema load test completed successfully');
    });
});