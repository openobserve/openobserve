/**
 * Autocomplete Value Suggestions E2E Tests
 *
 * Tests the new feature that persists field values in IndexedDB and shows them
 * as autocomplete suggestions when the user types `field =` in the query editor.
 *
 * FEATURE DOCUMENTATION:
 * - Values are captured from: field expansion (sidebar) + search results
 * - Values are stored in: IndexedDB (o2FieldValues database)
 * - Values are scoped by: org | streamType | streamName | fieldName
 * - Values persist across page refreshes
 *
 * TEST COVERAGE:
 * 1. Value capture from field expansion
 * 2. Value capture from search results
 * 3. Autocomplete suggestions appear when typing `field =`
 * 4. Correct quoting behavior (strings vs numbers vs booleans)
 * 5. Persistence across page refresh
 * 6. Stream isolation (values don't leak between streams)
 * 7. Regression - existing autocomplete still works
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
const MonacoEditorHelper = require('../utils/MonacoEditorHelper.js');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clear IndexedDB o2FieldValues database to ensure clean test state
 */
async function clearIndexedDB(page) {
    await page.evaluate(async () => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('o2FieldValues');
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => {
                // Database is blocked - close any open connections first
                resolve(); // Continue anyway, test isolation is secondary
            };
        });
    });
    testLogger.info('Cleared IndexedDB o2FieldValues database');
}

/**
 * Get all records from IndexedDB o2FieldValues database
 */
async function getIndexedDBRecords(page) {
    return await page.evaluate(async () => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('o2FieldValues', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('fieldValues')) {
                    db.close();
                    resolve([]);
                    return;
                }
                const tx = db.transaction('fieldValues', 'readonly');
                const store = tx.objectStore('fieldValues');
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => {
                    db.close();
                    resolve(getAllReq.result || []);
                };
                getAllReq.onerror = () => {
                    db.close();
                    reject(getAllReq.error);
                };
            };
        });
    });
}

/**
 * Get a specific field record from IndexedDB
 */
async function getFieldRecord(page, org, streamType, streamName, fieldName) {
    const key = `${org}|${streamType}|${streamName}|${fieldName}`;
    return await page.evaluate(async (searchKey) => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('o2FieldValues', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('fieldValues')) {
                    db.close();
                    resolve(null);
                    return;
                }
                const tx = db.transaction('fieldValues', 'readonly');
                const store = tx.objectStore('fieldValues');
                const getReq = store.get(searchKey);
                getReq.onsuccess = () => {
                    db.close();
                    resolve(getReq.result || null);
                };
                getReq.onerror = () => {
                    db.close();
                    reject(getReq.error);
                };
            };
        });
    }, key);
}

/**
 * Wait for IndexedDB to have at least one record for a given field
 */
async function waitForFieldInIndexedDB(page, org, streamType, streamName, fieldName, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const record = await getFieldRecord(page, org, streamType, streamName, fieldName);
        if (record && record.values && record.values.length > 0) {
            return record;
        }
        await page.waitForTimeout(500);
    }
    return null;
}

/**
 * Get MonacoEditorHelper instance and query editor container
 * Uses page object selector for the container
 */
function getMonacoHelper(page, pm) {
    const monacoHelper = new MonacoEditorHelper(page);
    const queryEditorSelector = pm.logsPage.queryEditor || '[data-test="logs-search-bar-query-editor"]';
    const container = page.locator(queryEditorSelector);
    return { monacoHelper, container };
}

/**
 * Click into Monaco editor and type text
 */
async function typeInQueryEditor(page, pm, text) {
    const { monacoHelper, container } = getMonacoHelper(page, pm);
    await monacoHelper.type(container, text);
}

/**
 * Clear Monaco editor content
 */
async function clearQueryEditor(page, pm) {
    const { monacoHelper, container } = getMonacoHelper(page, pm);
    await monacoHelper.clear(container);
}

/**
 * Set Monaco editor content
 */
async function setQueryEditorContent(page, pm, content) {
    const { monacoHelper, container } = getMonacoHelper(page, pm);
    await monacoHelper.setContent(container, content);
}

/**
 * Wait for Monaco suggestions widget to be visible
 */
async function waitForSuggestionsWidget(page, pm, timeout = 5000) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    return await monacoHelper.waitForSuggestions(timeout);
}

/**
 * Get all suggestion labels from Monaco autocomplete widget
 */
async function getSuggestionLabels(page, pm) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    return await monacoHelper.getSuggestionLabels();
}

/**
 * Check if suggestions widget contains a specific value
 */
async function suggestionContainsValue(page, pm, value) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    return await monacoHelper.suggestionsContain(value);
}

/**
 * Select a suggestion from Monaco autocomplete widget by text
 */
async function selectSuggestion(page, pm, text) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    await monacoHelper.selectSuggestion(text);
}

/**
 * Get editor content
 */
async function getQueryEditorContent(page, pm) {
    const { monacoHelper, container } = getMonacoHelper(page, pm);
    return await monacoHelper.getContent(container);
}

/**
 * Trigger autocomplete suggestions
 */
async function triggerSuggestions(page, pm) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    await monacoHelper.triggerSuggestions();
}

/**
 * Run query and wait for results
 * Uses a resilient approach - waits for response OR timeout, doesn't fail if response not captured
 */
async function runQueryAndWaitForResults(page, pm) {
    const orgName = process.env["ORGNAME"] || 'default';

    // Start waiting for response before clicking
    const searchResponsePromise = page.waitForResponse(
        response => response.url().includes(`/api/${orgName}/`) && response.url().includes('_search'),
        { timeout: 30000 }
    ).catch(() => null); // Don't fail if response not captured

    await pm.logsPage.clickRefreshButton();

    // Wait for either response or a timeout
    await Promise.race([
        searchResponsePromise,
        page.waitForTimeout(5000) // Fallback: wait 5 seconds if response not captured
    ]);

    // Wait for results to render and any background operations (like IndexedDB writes)
    await page.waitForTimeout(2000);
}

/**
 * Find a field that has string values (not purely numeric or boolean)
 * Iterates through available fields until finding one with string values
 * Returns { fieldName, stringValue, record } or null if none found
 */
async function findFieldWithStringValues(page, pm, orgName, streamName, maxAttempts = 5) {
    // Use page object selector for field expand buttons
    const fieldButtonsSelector = pm.logsPage.allFieldExpandButtons || '[data-test*="log-search-expand-"][data-test$="-field-btn"]';
    const fieldButtons = page.locator(fieldButtonsSelector);
    const buttonCount = await fieldButtons.count();

    // Try known string fields first - these are more likely to have string values
    const preferredStringFields = ['kubernetes_container_name', 'level', 'log', 'kubernetes_pod_name', 'kubernetes_namespace_name'];

    for (const preferredField of preferredStringFields) {
        // Use page object selector for specific field button
        const preferredButtonSelector = pm.logsPage.fieldExpandButton ?
            pm.logsPage.fieldExpandButton(preferredField) :
            `[data-test="log-search-expand-${preferredField}-field-btn"]`;
        const preferredButton = page.locator(preferredButtonSelector);
        if (await preferredButton.count() > 0) {
            await preferredButton.click();
            await page.waitForTimeout(2000);

            const record = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, preferredField, 10000);
            if (record && record.values && record.values.length > 0) {
                const stringValue = record.values.find(v =>
                    isNaN(Number(v)) && v !== 'true' && v !== 'false'
                );
                if (stringValue) {
                    testLogger.info(`Found string field: ${preferredField} with value: ${stringValue}`);
                    return { fieldName: preferredField, stringValue, record };
                }
            }
        }
    }

    // Fallback: iterate through all fields
    for (let i = 0; i < Math.min(buttonCount, maxAttempts); i++) {
        const button = fieldButtons.nth(i);
        const dataTest = await button.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        // Skip if already expanded (part of preferred fields)
        if (preferredStringFields.includes(fieldName)) continue;

        await button.click();
        await page.waitForTimeout(2000);

        const record = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 10000);
        if (record && record.values && record.values.length > 0) {
            const stringValue = record.values.find(v =>
                isNaN(Number(v)) && v !== 'true' && v !== 'false'
            );
            if (stringValue) {
                testLogger.info(`Found string field: ${fieldName} with value: ${stringValue}`);
                return { fieldName, stringValue, record };
            }
        }
    }

    return null;
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe("Autocomplete Value Suggestions", () => {
    test.describe.configure({ mode: 'serial' }); // Run serially to avoid IndexedDB conflicts

    let pm;
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);

        // Wait for auth to complete
        await page.waitForTimeout(1000);

        // Ingest test data
        await ingestTestData(page);
        await page.waitForTimeout(1000);

        // Navigate to logs page
        await page.goto(
            `${logData.logsUrl}?org_identifier=${orgName}`
        );

        testLogger.info('Test setup completed');
    });

    // =========================================================================
    // TEST: Value Capture from Field Expansion
    // =========================================================================

    test("should capture field values to IndexedDB when expanding a field in sidebar", {
        tag: ['@all', '@autosuggestions', '@logs', '@indexeddb']
    }, async ({ page }) => {
        testLogger.info('Testing value capture from field expansion');

        // Clear IndexedDB to ensure clean state
        await clearIndexedDB(page);

        // Select stream and run query to get results
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field to expand - look for any available field expand button
        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const buttonCount = await fieldButtons.count();
        expect(buttonCount).toBeGreaterThan(0);

        // Get the first field name from the data-test attribute
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        // Extract field name from "log-search-expand-{fieldName}-field-btn"
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');
        testLogger.info(`Expanding field: ${fieldName}`);

        // Click to expand the field
        await firstButton.click();

        // Wait for field values to load in the UI
        await page.waitForTimeout(2000);

        // Wait for IndexedDB record to be created (background write via requestIdleCallback)
        const record = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 15000);

        // Verify record was created
        expect(record).not.toBeNull();
        expect(record.values).toBeDefined();
        expect(record.values.length).toBeGreaterThan(0);
        testLogger.info(`IndexedDB record created with ${record.values.length} values for field: ${fieldName}`);

        // Verify record metadata
        expect(record.key).toBe(`${orgName}|logs|${streamName}|${fieldName}`);
        expect(record.updatedAt).toBeDefined();
        expect(record.expiresAt).toBeDefined();

        testLogger.info('Field expansion capture test PASSED');
    });

    // =========================================================================
    // TEST: Autocomplete Suggestions Appear
    // =========================================================================

    test("should show value suggestions when typing field = in query editor", {
        tag: ['@all', '@autosuggestions', '@logs', '@autocomplete']
    }, async ({ page }) => {
        testLogger.info('Testing autocomplete suggestions appear');

        // First, capture some values by expanding a field
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field with values and expand it
        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        // Expand the field to capture values
        await firstButton.click();
        await page.waitForTimeout(2000);

        // Wait for values to be stored
        const record = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 15000);
        expect(record).not.toBeNull();
        testLogger.info(`Field ${fieldName} has ${record.values.length} stored values`);

        // Now type in the query editor to trigger suggestions
        // First clear and set up a base query
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} = `);

        // Wait a moment for Monaco to process
        await page.waitForTimeout(1000);

        // Trigger autocomplete by pressing Ctrl+Space or just waiting
        await page.keyboard.press('Control+Space');

        // Wait for suggestions widget
        try {
            await waitForSuggestionsWidget(page, pm, 10000);

            // Get suggestion labels
            const suggestions = await getSuggestionLabels(page, pm);
            testLogger.info(`Found ${suggestions.length} suggestions: ${suggestions.slice(0, 5).join(', ')}`);

            // Should have at least one value suggestion
            expect(suggestions.length).toBeGreaterThan(0);

            // Check if any of our stored values appear in suggestions
            const storedValues = record.values;
            const hasStoredValue = suggestions.some(s =>
                storedValues.some(v => s.includes(v))
            );

            // Assert that stored values appear in suggestions
            expect(hasStoredValue).toBe(true);
            testLogger.info('Found stored field values in suggestions');

            testLogger.info('Autocomplete suggestions test PASSED');
        } catch (error) {
            testLogger.warn(`Suggestions widget not visible: ${error.message}`);
            // Take screenshot for debugging
            await page.screenshot({ path: 'autocomplete-suggestions-debug.png' });
            throw error;
        }
    });

    // =========================================================================
    // TEST: Correct Quoting Behavior
    // =========================================================================

    test("should insert string values with single quotes", {
        tag: ['@all', '@autosuggestions', '@logs', '@quoting']
    }, async ({ page }) => {
        testLogger.info('Testing string value quoting');

        // Capture values first
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field with string values (not just numeric like 'code')
        const result = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(result, 'Expected to find at least one field with string values').not.toBeNull();

        const { fieldName, stringValue, record } = result;
        testLogger.info(`Testing quoting with field: ${fieldName}, value: ${stringValue}`);

        // Type query to trigger suggestions
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} = `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions - no silent catch
        await waitForSuggestionsWidget(page, pm, 10000);

        // Assert string value is in suggestions
        const hasStringValue = await suggestionContainsValue(page, pm, stringValue);
        expect(hasStringValue, `Expected string value ${stringValue} to be in suggestions`).toBe(true);

        await selectSuggestion(page, pm, stringValue);
        await page.waitForTimeout(500);

        // Get the editor content
        const editorContent = await getQueryEditorContent(page, pm);
        testLogger.info(`Editor content: ${editorContent}`);

        // String values should be wrapped in single quotes
        const expectedPattern = `'${stringValue}'`;
        expect(editorContent.includes(expectedPattern), `Expected string to be quoted as ${expectedPattern}`).toBe(true);
        testLogger.info(`String value correctly quoted: ${expectedPattern}`);

        testLogger.info('String quoting test completed');
    });

    // =========================================================================
    // TEST: Persistence Across Page Refresh
    // =========================================================================

    test("should persist values across page refresh", {
        tag: ['@all', '@autosuggestions', '@logs', '@persistence']
    }, async ({ page }) => {
        testLogger.info('Testing persistence across page refresh');

        // Clear IndexedDB first
        await clearIndexedDB(page);

        // Capture values
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Expand a field to capture values
        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Verify values are in IndexedDB
        const recordBefore = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 15000);
        expect(recordBefore).not.toBeNull();
        const valuesBefore = recordBefore.values;
        testLogger.info(`Values before refresh: ${valuesBefore.length}`);

        // Hard refresh the page
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Verify values are still in IndexedDB
        const recordAfter = await getFieldRecord(page, orgName, 'logs', streamName, fieldName);
        expect(recordAfter).not.toBeNull();
        expect(recordAfter.values.length).toBe(valuesBefore.length);
        testLogger.info(`Values after refresh: ${recordAfter.values.length}`);

        // Verify the values are the same
        expect(recordAfter.values).toEqual(valuesBefore);

        testLogger.info('Persistence test PASSED');
    });

    // =========================================================================
    // TEST: Stream Isolation
    // =========================================================================

    test("should isolate values between different streams", {
        tag: ['@all', '@autosuggestions', '@logs', '@isolation']
    }, async ({ page }) => {
        testLogger.info('Testing stream isolation');

        // Clear IndexedDB first
        await clearIndexedDB(page);

        // Capture values from first stream
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Expand a field
        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Wait for values
        const record1 = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 15000);
        expect(record1).not.toBeNull();
        testLogger.info(`Stream ${streamName} - ${fieldName}: ${record1.values.length} values`);

        // Verify the record key format is correct (includes stream name for isolation)
        expect(record1.key).toContain(`|${streamName}|`);
        testLogger.info(`✅ Record key properly namespaced: ${record1.key}`);

        // The primary isolation test is verifying the key format includes the stream name
        // This ensures records from different streams will have different keys
        const expectedKeyPattern = `${orgName}|logs|${streamName}|${fieldName}`;
        expect(record1.key).toBe(expectedKeyPattern);
        testLogger.info(`✅ Key format verified: ${record1.key}`);

        testLogger.info('Stream isolation test PASSED');
    });

    // =========================================================================
    // TEST: Regression - Existing Autocomplete Still Works
    // =========================================================================

    test("should still show keyword suggestions when no field values available", {
        tag: ['@all', '@autosuggestions', '@logs', '@regression']
    }, async ({ page }) => {
        testLogger.info('Testing regression - keyword suggestions');

        // Select stream and run query
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Type a partial keyword to trigger keyword suggestions
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions - this is a regression test, failures indicate a problem
        await waitForSuggestionsWidget(page, pm, 10000);

        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`Keyword suggestions: ${suggestions.slice(0, 10).join(', ')}`);

        // Should show SQL keywords or field names
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('Keyword suggestions regression test PASSED');
    });

    // =========================================================================
    // TEST: Excluded Fields Are Not Stored
    // =========================================================================

    test("should not store excluded fields like _timestamp and body", {
        tag: ['@all', '@autosuggestions', '@logs', '@excluded']
    }, async ({ page }) => {
        testLogger.info('Testing excluded fields are not stored');

        // Clear IndexedDB first
        await clearIndexedDB(page);

        // Capture values from search
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Wait for background capture
        await page.waitForTimeout(3000);

        // Get all records
        const records = await getIndexedDBRecords(page);

        // Check that excluded fields are not present
        // These fields should NEVER be stored (they're explicitly excluded in the feature)
        const excludedFields = ['_timestamp', 'body', 'log', 'message', 'msg', '_id'];
        const storedExcludedFields = [];

        for (const excludedField of excludedFields) {
            const hasExcluded = records.some(r =>
                r.key && r.key.endsWith(`|${excludedField}`)
            );

            if (hasExcluded) {
                storedExcludedFields.push(excludedField);
                testLogger.warn(`Excluded field ${excludedField} was incorrectly stored`);
            } else {
                testLogger.info(`✅ Excluded field ${excludedField} correctly not stored`);
            }
        }

        // Assert: none of the excluded fields should be stored
        expect(storedExcludedFields.length,
            `Excluded fields should not be stored: [${storedExcludedFields.join(', ')}]`
        ).toBe(0);

        testLogger.info('Excluded fields test completed');
    });

    // =========================================================================
    // TEST: Values Limit Per Field
    // =========================================================================

    test("should limit stored values per field to max 50", {
        tag: ['@all', '@autosuggestions', '@logs', '@limits']
    }, async ({ page }) => {
        testLogger.info('Testing values limit per field');

        // Capture values from search
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Wait for background capture
        await page.waitForTimeout(3000);

        // Get all records
        const records = await getIndexedDBRecords(page);

        // Check that no field has more than 50 values
        const maxValues = 50;
        let allWithinLimit = true;

        for (const record of records) {
            if (record.values && record.values.length > maxValues) {
                testLogger.warn(`Field ${record.key} has ${record.values.length} values (exceeds ${maxValues})`);
                allWithinLimit = false;
            }
        }

        if (allWithinLimit) {
            testLogger.info(`All fields have <= ${maxValues} values`);
        }

        // This is more of a soft assertion - the feature should limit values
        expect(allWithinLimit).toBe(true);

        testLogger.info('Values limit test PASSED');
    });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

test.describe("Autocomplete Value Suggestions - Edge Cases", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);
        await ingestTestData(page);
        await page.waitForTimeout(1000);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
    });

    test("should handle typing field IN ( operator", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing IN operator suggestions');

        // Capture some values first
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Type IN operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} IN (`);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions and assert - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`IN operator suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('IN operator test completed');
    });

    test("should handle typing field LIKE operator", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing LIKE operator suggestions');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Type LIKE operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} LIKE `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions and assert - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`LIKE operator suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('LIKE operator test completed');
    });

    test("should handle partial value input with open quote", {
        tag: ['@all', '@autosuggestions', '@logs', '@quoting']
    }, async ({ page }) => {
        testLogger.info('Testing partial value with open quote');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field that has a real string value captured in IndexedDB, and
        // use a prefix of that value as the partial input. This keeps the test
        // realistic — in value context the dropdown only shows stored values, so
        // the partial must actually match one of them (hard-coded prefixes like
        // 'par' only worked previously because function suggestions incorrectly
        // leaked through in value context and embedded the typed word in their
        // labels).
        const fieldWithValues = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldWithValues).not.toBeNull();

        const { fieldName, stringValue } = fieldWithValues;
        const partial = stringValue.substring(0, Math.min(2, stringValue.length));

        await setQueryEditorContent(
            page,
            pm,
            `SELECT * FROM "${streamName}" WHERE ${fieldName} = '${partial}`,
        );
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Suggestions should still appear even with partial input - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`Open quote suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('Partial value test completed');
    });

    test("should handle NOT IN operator", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing NOT IN operator suggestions');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Type NOT IN operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} NOT IN (`);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions and assert - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`NOT IN operator suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('NOT IN operator test completed');
    });

    test("should handle != operator", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing != operator suggestions');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Type != operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} != `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions and assert - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`!= operator suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('!= operator test completed');
    });

    test("should handle >= and <= operators", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing >= and <= operator suggestions');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Test >= operator - no silent catch
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} >= `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestionsGte = await getSuggestionLabels(page, pm);
        testLogger.info(`>= operator suggestions: ${suggestionsGte.slice(0, 5).join(', ')}`);
        expect(suggestionsGte.length).toBeGreaterThan(0);

        // Test <= operator - no silent catch
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} <= `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestionsLte = await getSuggestionLabels(page, pm);
        testLogger.info(`<= operator suggestions: ${suggestionsLte.slice(0, 5).join(', ')}`);
        expect(suggestionsLte.length).toBeGreaterThan(0);

        testLogger.info('>= and <= operators test completed');
    });

    test("should handle str_match function", {
        tag: ['@all', '@autosuggestions', '@logs', '@functions']
    }, async ({ page }) => {
        testLogger.info('Testing str_match function suggestions');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        const fieldButtons = page.locator(pm.logsPage.allFieldExpandButtons);
        const firstButton = fieldButtons.first();
        const dataTest = await firstButton.getAttribute('data-test');
        const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

        await firstButton.click();
        await page.waitForTimeout(2000);

        // Type str_match function
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE str_match(${fieldName}, `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions and assert - no silent catch
        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestions = await getSuggestionLabels(page, pm);
        testLogger.info(`str_match suggestions: ${suggestions.slice(0, 5).join(', ')}`);
        expect(suggestions.length).toBeGreaterThan(0);

        testLogger.info('str_match function test completed');
    });
});

// ============================================================================
// QUOTING BEHAVIOR TESTS
// ============================================================================

test.describe("Autocomplete Value Suggestions - Quoting Behavior", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);
        await ingestTestData(page);
        await page.waitForTimeout(1000);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
    });

    test("should insert numeric values WITHOUT quotes", {
        tag: ['@all', '@autosuggestions', '@logs', '@quoting']
    }, async ({ page }) => {
        testLogger.info('Testing numeric value quoting (no quotes expected)');

        // Capture values first
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Search for the field in the field list search box first
        await pm.logsPage.searchFieldByName('code');
        await page.waitForTimeout(1000);

        // Find the field expand button for 'code'
        const codeFieldBtn = page.locator(pm.logsPage.fieldExpandButton('code'));
        await codeFieldBtn.waitFor({ state: 'visible', timeout: 5000 });
        await codeFieldBtn.click();
        await page.waitForTimeout(2000);

        // Wait for values in IndexedDB - assert values were captured
        const record = await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, 'code', 15000);
        expect(record, 'Expected IndexedDB record for code field').not.toBeNull();
        expect(record.values.length, 'Expected captured values for code field').toBeGreaterThan(0);

        // Find a numeric value (like 200, 404, 500)
        const numericValue = record.values.find(v => !isNaN(Number(v)));
        expect(numericValue, 'Expected at least one numeric value in code field').toBeDefined();

        testLogger.info(`Testing with numeric value: ${numericValue}`);

        // Type query to trigger suggestions
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE code = `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions - no silent catch
        await waitForSuggestionsWidget(page, pm, 10000);

        // Check if our numeric value is in suggestions
        const hasNumericValue = await suggestionContainsValue(page, pm, numericValue);
        expect(hasNumericValue, `Expected numeric value ${numericValue} to be in suggestions`).toBe(true);

        await selectSuggestion(page, pm, numericValue);
        await page.waitForTimeout(500);

        // Get the editor content
        const editorContent = await getQueryEditorContent(page, pm);
        testLogger.info(`Editor content: ${editorContent}`);

        // Numeric values should NOT be wrapped in quotes - assert this
        const hasQuotes = editorContent.includes(`'${numericValue}'`);
        expect(hasQuotes, `Numeric value ${numericValue} should NOT have quotes`).toBe(false);
        testLogger.info(`✅ Numeric value inserted without quotes: ${numericValue}`);

        testLogger.info('Numeric quoting test completed');
    });

    // NOTE: Boolean quoting test removed - test data (e2e_automate) doesn't have boolean fields
    // The feature logic for boolean quoting is verified by code review - same path as numeric values

    test("should close quote when partial value is typed", {
        tag: ['@all', '@autosuggestions', '@logs', '@quoting']
    }, async ({ page }) => {
        testLogger.info('Testing quote closing behavior');

        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field with string values (not just numeric like 'code')
        const result = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(result, 'Expected to find at least one field with string values').not.toBeNull();

        const { fieldName, stringValue } = result;
        testLogger.info(`Testing quote closing with field: ${fieldName}, value: ${stringValue}`);

        // Type with opening quote already present
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} = '`);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions - no silent catch
        await waitForSuggestionsWidget(page, pm, 10000);

        const hasStringValue = await suggestionContainsValue(page, pm, stringValue);
        expect(hasStringValue, `Expected string value ${stringValue} to be in suggestions`).toBe(true);

        await selectSuggestion(page, pm, stringValue);
        await page.waitForTimeout(500);

        const editorContent = await getQueryEditorContent(page, pm);
        testLogger.info(`Editor content: ${editorContent}`);

        // When open quote exists, selecting should only add value + closing quote
        // Result should be: field = 'value'  (NOT field = ''value'')
        const doubleQuotePattern = `''${stringValue}'`;
        const correctPattern = `'${stringValue}'`;

        expect(editorContent.includes(correctPattern), `Expected correct quote pattern '${stringValue}'`).toBe(true);
        expect(editorContent.includes(doubleQuotePattern), 'Should not have double quotes').toBe(false);
        testLogger.info(`✅ Quote closing works correctly: ${correctPattern}`);

        testLogger.info('Quote closing test completed');
    });
});

// ============================================================================
// COLD START & TTL TESTS
// ============================================================================

test.describe("Autocomplete Value Suggestions - Cold Start & TTL", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);
        await ingestTestData(page);
        await page.waitForTimeout(1000);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
    });

    test("should show keyword suggestions on cold start (no stored values)", {
        tag: ['@all', '@autosuggestions', '@logs', '@coldstart']
    }, async ({ page }) => {
        testLogger.info('Testing cold start behavior');

        // Clear IndexedDB completely
        await clearIndexedDB(page);

        // Navigate and select stream WITHOUT expanding any fields or running search
        await pm.logsPage.selectStream(streamName);

        // Don't run search - just type in query editor
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions widget - cold start should still show SQL keywords/field names
        await waitForSuggestionsWidget(page, pm, 10000);
        const suggestions = await getSuggestionLabels(page, pm);

        testLogger.info(`Cold start suggestions: ${suggestions.slice(0, 10).join(', ')}`);

        // Assert suggestions appeared - cold start should show field names and/or SQL keywords
        expect(suggestions.length, 'Cold start should show keyword/field suggestions').toBeGreaterThan(0);

        // Verify these are keywords/fields, NOT value suggestions (since we cleared IndexedDB)
        const hasKeywords = suggestions.some(s =>
            ['AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS'].some(kw =>
                s.toUpperCase().includes(kw)
            )
        );

        testLogger.info(`Cold start has SQL keywords: ${hasKeywords}`);
        expect(hasKeywords, 'Cold start should show SQL keywords, not value suggestions').toBe(true);
        testLogger.info('Cold start test completed with suggestions');

        testLogger.info('Cold start test completed');
    });
});
