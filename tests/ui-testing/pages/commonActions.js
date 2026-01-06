import { exec } from 'child_process';
import { test } from '@playwright/test';
import { expect } from '@playwright/test';

// Common Locator exports
export var dateTimeButtonLocator='[data-test="date-time-btn"]';
export var relative30SecondsButtonLocator='[data-test="date-time-relative-30-s-btn"]';
export var absoluteTabLocator='[data-test="date-time-absolute-tab"]';
export var Past30SecondsValue='Past 30 Seconds';
export var startTimeValue='01:01:01';
export var endTimeValue='02:02:02';
export var startDateTimeValue='2024/10/01 01:01:01';
export var endDateTimeValue='2024/10/01 02:02:02';

export class CommonActions {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.alertsMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.homeMenuItem = '[data-test="menu-link-\\/-item"]';
    }

    async navigateToAlerts() {
        await this.page.locator(this.alertsMenuItem).click();
        await this.page.waitForTimeout(2000);
        // Check for alerts page loaded - use alert list page element
        await expect(this.page.locator('[data-test="alert-list-page"]')).toBeVisible();
    }

    async navigateToSettings() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    async navigateToHome() {
        await this.page.locator(this.homeMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    /**
     * Helper method to scroll through a dropdown to find and click an option
     * @param {string} optionName - Name of the option to find
     * @param {string} optionType - Type of option ('template' or 'folder')
     * @returns {Promise<boolean>} - Whether the option was found
     */
    async scrollAndFindOption(optionName, optionType) {
        // Use more specific locator to target the visible dropdown to avoid strict mode violation
        const dropdown = this.page.locator('.q-menu:visible').first();
        let optionFound = false;
        let maxScrolls = 50;
        let scrollAmount = 1000;
        let totalScrolled = 0;

        while (!optionFound && maxScrolls > 0) {
            try {
                // Try to find and click the option
                const option = optionType === 'template' 
                    ? this.page.getByText(optionName, { exact: true })
                    : this.page.getByRole('option', { name: optionName });
                
                if (await option.isVisible()) {
                    if (optionType === 'template') {
                        await option.click();
                    } else {
                        await option.locator('span').click();
                    }
                    optionFound = true;
                    console.log(`Found ${optionType} after scrolling: ${optionName}`);
                    await this.page.waitForTimeout(500);
                } else {
                    // Get the current scroll position and height
                    const { scrollTop, scrollHeight, clientHeight } = await dropdown.evaluate(el => ({
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    }));

                    // If we've scrolled to the bottom, start from the top again
                    if (scrollTop + clientHeight >= scrollHeight) {
                        await dropdown.evaluate(el => el.scrollTop = 0);
                        totalScrolled = 0;
                        await this.page.waitForTimeout(500);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(500);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If option not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForLoadState('networkidle');
                maxScrolls--;
            }
        }

        if (!optionFound) {
            console.error(`Failed to find ${optionType} ${optionName} after scrolling ${totalScrolled}px`);
            throw new Error(`${optionType} ${optionName} not found in dropdown after scrolling`);
        }

        return optionFound;
    }

    async ingestTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/${process.env["ORGNAME"]}/${streamName}/_json -d '[{"level":"info","job":"test","log":"test message for openobserve. this data ingestion has been done using a playwright automation script."}]'`;

        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing curl command:', error);
                    reject(error);
                    return;
                }
                console.log('Curl command response:', stdout);
                console.log('Successfully ingested test data');
                resolve();
            });
        });
    }

    /**
     * Ingest test data with a unique identifier for alert trigger validation
     * This allows us to identify specific test data in the validation stream
     * @param {string} streamName - Name of the stream to ingest data into
     * @param {string} uniqueId - Unique identifier for this test run (e.g., randomValue)
     * @param {string} triggerField - Field name that the alert condition will check (default: 'city')
     * @param {string} triggerValue - Value that will trigger the alert condition (default: 'bangalore')
     * @returns {Promise<{uniqueId: string, timestamp: number}>}
     */
    async ingestTestDataWithUniqueId(streamName, uniqueId, triggerField = 'city', triggerValue = 'bangalore') {
        const timestamp = Date.now();
        // Use custom, predictable columns that we control
        // This eliminates dependency on existing stream columns
        const testData = {
            city: triggerField === 'city' ? triggerValue : 'mumbai',
            country: 'india',
            status: 'active',
            age: 25,
            test_run_id: uniqueId,
            test_timestamp: timestamp,
            message: `Alert trigger test - run_id: ${uniqueId}`
        };

        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = process.env["ORGNAME"];
        const username = process.env["ZO_ROOT_USER_EMAIL"];
        const password = process.env["ZO_ROOT_USER_PASSWORD"];

        const curlCommand = `curl -s -u ${username}:${password} -k "${baseUrl}/api/${orgName}/${streamName}/_json" -d '${JSON.stringify([testData])}'`;

        console.log(`Ingesting test data with unique ID: ${uniqueId}`, { streamName, triggerField, triggerValue });

        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error ingesting test data with unique ID:', error);
                    reject(error);
                    return;
                }
                console.log('Ingested test data response:', stdout);
                console.log(`Successfully ingested test data with unique ID: ${uniqueId}`);
                resolve({ uniqueId, timestamp });
            });
        });
    }

    /**
     * Create and initialize a dedicated alert test stream with custom columns
     * This ensures we have predictable columns for alert condition testing
     * @param {string} streamName - Name of the stream to create/initialize
     * @returns {Promise<{streamName: string, columns: string[]}>}
     */
    async initializeAlertTestStream(streamName) {
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = process.env["ORGNAME"];
        const username = process.env["ZO_ROOT_USER_EMAIL"];
        const password = process.env["ZO_ROOT_USER_PASSWORD"];

        // Ingest initial data to create stream with our custom schema
        const initialData = [
            {
                city: 'delhi',
                country: 'india',
                status: 'inactive',
                age: 30,
                test_run_id: 'init',
                test_timestamp: Date.now(),
                message: 'Stream initialization record'
            }
        ];

        const curlCommand = `curl -s -u ${username}:${password} -k "${baseUrl}/api/${orgName}/${streamName}/_json" -d '${JSON.stringify(initialData)}'`;

        console.log(`Initializing alert test stream: ${streamName}`);

        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error initializing alert test stream:', error);
                    reject(error);
                    return;
                }
                console.log('Stream initialization response:', stdout);
                console.log(`Successfully initialized stream: ${streamName}`);
                resolve({
                    streamName,
                    columns: ['city', 'country', 'status', 'age', 'test_run_id', 'test_timestamp', 'message']
                });
            });
        });
    }

    async ingestCustomTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/${process.env["ORGNAME"]}/${streamName}/_json -d @utils/td150.json`;

        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing curl command:', error);
                    reject(error);
                    return;
                }
                console.log('Custom curl command response:', stdout);
                console.log('Successfully ingested custom test data');
                resolve();
            });
        });
    }

    /**
     * Helper method to conditionally ingest test data based on test title
     * Skips data ingestion for scheduled alert tests
     * @param {string} testTitle - The title of the current test
     * @param {string} streamName - The stream name for data ingestion
     */
    async skipDataIngestionForScheduledAlert(testTitle, streamName = 'auto_playwright_stream') {
        // Skip data ingestion for scheduled alert test
        if (!testTitle.includes('Scheduled Alert')) {
            // Ingest test data using common actions
            await this.ingestTestData(streamName);
        }
    }

    // Dismiss any blocking overlays/modals that might intercept clicks
    async dismissBlockingOverlays() {
        for (let i = 0; i < 3; i += 1) {
            const backdrop = this.page.locator('.q-dialog__backdrop');
            const count = await backdrop.count();
            const visible = count > 0 ? await backdrop.first().isVisible().catch(() => false) : false;
            if (!visible) break;
            await this.page.keyboard.press('Escape').catch(() => {});
            await backdrop.first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
            await this.page.waitForTimeout(150);
        }
    }

    // Return boolean streaming state from Organization settings toggle
    async getStreamingState() {
        const root = this.page.locator('[data-test="general-settings-enable-streaming"]').first();
        await root.waitFor({ state: 'visible', timeout: 10000 });
        const ariaChecked = await root.getAttribute('aria-checked');
        return ariaChecked === 'true';
    }

    // Flip streaming toggle, save, wait for toast, reload, and verify state
    async flipStreaming() {
        await this.dismissBlockingOverlays();
        try {
            await this.page.locator('[data-test="menu-link-settings-item"]').click();
        } catch {
            await this.page.reload().catch(() => {});
            await this.page.waitForTimeout(300);
            await this.dismissBlockingOverlays();
            await this.page.locator('[data-test="menu-link-settings-item"]').click();
        }
        const isOn = await this.getStreamingState();
        await this.page.locator('[data-test="general-settings-enable-streaming"] div').nth(2).click();
        await this.page.locator('[data-test="dashboard-add-submit"]').click();
        await this.page.getByText('Organization settings updated', { exact: false }).waitFor({ timeout: 15000 });
        await this.page.reload();
        const newState = await this.getStreamingState();
        console.log(`[Streaming Toggle] ${isOn ? 'ON' : 'OFF'} -> ${newState ? 'ON' : 'OFF'}`);
    }

    /**
     * Query a stream via OpenObserve API to search for specific data
     * Used for validating alert triggers by searching the validation_stream
     * @param {string} streamName - Name of the stream to query
     * @param {string} searchQuery - SQL query to execute (e.g., "SELECT * FROM stream_name")
     * @param {number} timeRangeMinutes - How far back to search (default: 15 minutes)
     * @returns {Promise<{success: boolean, hits: number, data: any[]}>}
     */
    async queryStream(streamName, searchQuery = null, timeRangeMinutes = 15) {
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = process.env["ORGNAME"];
        const username = process.env["ZO_ROOT_USER_EMAIL"];
        const password = process.env["ZO_ROOT_USER_PASSWORD"];

        // Default query if none provided
        const query = searchQuery || `SELECT * FROM "${streamName}"`;

        // Calculate time range (last N minutes)
        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (timeRangeMinutes * 60 * 1000 * 1000); // microseconds

        const searchPayload = {
            query: {
                sql: query,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 100
            }
        };

        const curlCommand = `curl -s -u ${username}:${password} -k "${baseUrl}/api/${orgName}/_search?type=logs" -H "Content-Type: application/json" -d '${JSON.stringify(searchPayload)}'`;

        return new Promise((resolve) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error querying stream:', error);
                    resolve({ success: false, hits: 0, data: [] });
                    return;
                }

                try {
                    const response = JSON.parse(stdout);
                    const hits = response.hits?.length || response.total || 0;
                    console.log(`Query stream ${streamName}: found ${hits} results`);
                    resolve({
                        success: true,
                        hits: hits,
                        data: response.hits || []
                    });
                } catch (parseError) {
                    console.error('Error parsing query response:', parseError);
                    console.log('Raw response:', stdout);
                    resolve({ success: false, hits: 0, data: [] });
                }
            });
        });
    }

    /**
     * Search validation stream for alert payloads by unique ID
     * Used to verify that an alert successfully triggered and sent data
     * @param {string} validationStreamName - Name of the validation stream to search
     * @param {string} uniqueId - Unique identifier to search for in the payload
     * @param {number} maxWaitSeconds - Maximum time to wait for data (default: 60 seconds)
     * @param {number} pollIntervalSeconds - How often to poll (default: 5 seconds)
     * @returns {Promise<{found: boolean, payload: any, attempts: number}>}
     */
    async waitForAlertInValidationStream(validationStreamName, uniqueId, maxWaitSeconds = 60, pollIntervalSeconds = 5) {
        const maxAttempts = Math.ceil(maxWaitSeconds / pollIntervalSeconds);

        console.log(`Waiting for "${uniqueId}" in stream "${validationStreamName}" (max ${maxWaitSeconds}s)...`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Query for recent data containing the search term
            // Note: The template body is stored in 'text' field, not '_all'
            const result = await this.queryStream(
                validationStreamName,
                `SELECT * FROM "${validationStreamName}" WHERE str_match_ignore_case(text, '${uniqueId}')`,
                10 // Last 10 minutes
            );

            if (result.success && result.hits > 0) {
                console.log(`Found unique ID "${uniqueId}" in validation stream after ${attempt * pollIntervalSeconds}s`);
                return { found: true, payload: result.data[0], attempts: attempt };
            }

            if (attempt < maxAttempts) {
                console.log(`Attempt ${attempt}/${maxAttempts}: Unique ID not found yet, waiting ${pollIntervalSeconds}s...`);
                await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
            }
        }

        console.log(`Unique ID "${uniqueId}" not found in validation stream "${validationStreamName}" after ${maxWaitSeconds}s`);
        return { found: false, payload: null, attempts: maxAttempts };
    }

    /**
     * Generate Basic auth header value
     * @param {string} username
     * @param {string} password
     * @returns {string} Basic auth header value
     */
    static generateBasicAuthHeader(username, password) {
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Count alert notifications in validation stream
     * Used for deduplication testing to verify suppression of duplicate alerts
     * @param {string} validationStreamName - Name of the validation stream to query
     * @param {string} alertName - Alert name to search for (partial match)
     * @param {number} timeRangeMinutes - How far back to search (default: 15 minutes)
     * @returns {Promise<{success: boolean, count: number, data: any[]}>}
     */
    async countAlertNotificationsInStream(validationStreamName, alertName, timeRangeMinutes = 15) {
        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = process.env["ORGNAME"];
        const username = process.env["ZO_ROOT_USER_EMAIL"];
        const password = process.env["ZO_ROOT_USER_PASSWORD"];

        // Query for notifications matching the alert name
        const query = `SELECT * FROM "${validationStreamName}" WHERE str_match_ignore_case(text, '${alertName}')`;

        // Calculate time range (last N minutes)
        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (timeRangeMinutes * 60 * 1000 * 1000); // microseconds

        const searchPayload = {
            query: {
                sql: query,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 1000
            }
        };

        const curlCommand = `curl -s -u ${username}:${password} -k "${baseUrl}/api/${orgName}/_search?type=logs" -H "Content-Type: application/json" -d '${JSON.stringify(searchPayload)}'`;

        return new Promise((resolve) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error counting notifications in stream:', error);
                    resolve({ success: false, count: 0, data: [] });
                    return;
                }

                try {
                    const response = JSON.parse(stdout);
                    const hits = response.hits || [];
                    const count = hits.length;
                    console.log(`Count notifications for "${alertName}" in ${validationStreamName}: found ${count} notifications`);
                    resolve({
                        success: true,
                        count: count,
                        data: hits
                    });
                } catch (parseError) {
                    console.error('Error parsing notification count response:', parseError);
                    console.log('Raw response:', stdout);
                    resolve({ success: false, count: 0, data: [] });
                }
            });
        });
    }

    /**
     * Wait for exact notification count in validation stream
     * Used for deduplication testing to verify the expected number of notifications
     * @param {string} validationStreamName - Name of the validation stream
     * @param {string} alertName - Alert name to search for
     * @param {number} expectedCount - Expected number of notifications
     * @param {number} maxWaitSeconds - Maximum time to wait (default: 120 seconds)
     * @param {number} pollIntervalSeconds - How often to poll (default: 10 seconds)
     * @returns {Promise<{match: boolean, actualCount: number, attempts: number}>}
     */
    async waitForExactNotificationCount(validationStreamName, alertName, expectedCount, maxWaitSeconds = 120, pollIntervalSeconds = 10) {
        const maxAttempts = Math.ceil(maxWaitSeconds / pollIntervalSeconds);

        console.log(`Waiting for exactly ${expectedCount} notifications for "${alertName}" in "${validationStreamName}" (max ${maxWaitSeconds}s)...`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await this.countAlertNotificationsInStream(validationStreamName, alertName, 15);

            if (result.success && result.count === expectedCount) {
                console.log(`Found expected ${expectedCount} notifications after ${attempt * pollIntervalSeconds}s`);
                return { match: true, actualCount: result.count, attempts: attempt };
            }

            if (result.count > expectedCount) {
                console.log(`Found more notifications than expected: ${result.count} > ${expectedCount}`);
                return { match: false, actualCount: result.count, attempts: attempt };
            }

            if (attempt < maxAttempts) {
                console.log(`Attempt ${attempt}/${maxAttempts}: Found ${result.count} notifications, expected ${expectedCount}, waiting ${pollIntervalSeconds}s...`);
                await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
            }
        }

        const finalResult = await this.countAlertNotificationsInStream(validationStreamName, alertName, 15);
        console.log(`Final count: ${finalResult.count} notifications (expected ${expectedCount})`);
        return { match: finalResult.count === expectedCount, actualCount: finalResult.count, attempts: maxAttempts };
    }
} 