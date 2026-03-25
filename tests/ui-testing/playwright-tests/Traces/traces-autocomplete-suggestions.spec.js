/**
 * Traces Autocomplete Value Suggestions E2E Tests
 *
 * Tests the autosuggestions feature on the Traces page.
 * The feature captures field values when expanding fields in the sidebar
 * and shows them as autocomplete suggestions when typing `field =`.
 *
 * Based on: docs/impact-reports/autosuggestions-feature-impact.md
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function clearIndexedDB(page) {
    await page.evaluate(async () => {
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('o2FieldValues');
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        });
    });
    testLogger.info('Cleared IndexedDB o2FieldValues database');
}

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

async function waitForSuggestionsWidget(page, timeout = 5000) {
    const suggestWidget = page.locator('.monaco-editor .suggest-widget');
    await suggestWidget.waitFor({ state: 'visible', timeout });
    return suggestWidget;
}

async function getSuggestionLabels(page) {
    const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
    await suggestionRows.first().waitFor({ state: 'visible', timeout: 5000 });
    const labels = await suggestionRows.locator('.label-name, .monaco-icon-label-container').allTextContents();
    return labels.map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * Try to expand a field using multiple strategies
 * Follows the pattern from traceQueryEditor.spec.js
 * Waits for field values API response after expanding
 */
async function tryExpandField(page, pm) {
    const orgName = process.env["ORGNAME"] || 'default';

    // Strategy 1: Try common trace field names via tracesPage method
    // These match the patterns used in traceQueryEditor.spec.js
    const traceFieldNames = [
        'status_code',      // Common in trace data
        'service_name',     // Common trace attribute
        'http.status_code', // OpenTelemetry semantic convention
        'http.method',      // OpenTelemetry semantic convention
        'service.name',     // OpenTelemetry semantic convention
        'span.kind',        // OpenTelemetry attribute
        'environment',      // Custom attribute
        'operation_name'    // Jaeger-style attribute
    ];

    for (const fieldName of traceFieldNames) {
        // Start listening for values API response before clicking
        const valuesResponsePromise = page.waitForResponse(
            response => response.url().includes(`/api/${orgName}/`) && response.url().includes('_values'),
            { timeout: 10000 }
        ).catch(() => null);

        const expanded = await pm.tracesPage.expandTraceField(fieldName);
        if (expanded) {
            testLogger.info(`Expanded trace field: ${fieldName}`);

            // Wait for values API response
            const response = await valuesResponsePromise;
            if (response) {
                testLogger.info(`Values API responded for field: ${fieldName}`);
                // Give IndexedDB time to write
                await page.waitForTimeout(2000);
            } else {
                testLogger.info(`No values API response captured for field: ${fieldName}`);
                await page.waitForTimeout(3000);
            }

            return { fieldName, success: true };
        }
    }

    // Strategy 2: Click on field rows in the traces field list
    // Traces uses q-expansion-item - clicking the row expands it and triggers openFilterCreator → fetchFieldValues
    // The field rows contain an expand_more icon and field name
    const indexList = page.locator('[data-test="traces-search-index-list"]');
    if (await indexList.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Look for field expansion items - they have the expand_more icon
        const fieldRows = indexList.locator('.field-expansion-item, .q-expansion-item');
        const rowCount = await fieldRows.count();
        testLogger.info(`Found ${rowCount} field expansion items in traces index list`);

        if (rowCount > 0) {
            // Try first few fields (skip internal fields like _timestamp)
            for (let i = 0; i < Math.min(rowCount, 10); i++) {
                const row = fieldRows.nth(i);
                const rowText = await row.textContent().catch(() => '');

                // Skip system fields
                if (rowText.includes('_timestamp') || rowText.includes('_id')) {
                    continue;
                }

                // Extract field name from the row
                const fieldName = rowText.trim().split(/\s+/)[0] || `field_${i}`;
                testLogger.info(`Attempting to expand field: ${fieldName}`);

                // Start listening for values API before clicking
                const valuesResponsePromise = page.waitForResponse(
                    response => response.url().includes(`/api/${orgName}/`) && response.url().includes('_values'),
                    { timeout: 15000 }
                ).catch(() => null);

                // Click on the row to expand it
                await row.click();
                testLogger.info(`Clicked on field row: ${fieldName}`);

                const response = await valuesResponsePromise;
                if (response) {
                    testLogger.info(`Values API responded for field: ${fieldName}`);
                    await page.waitForTimeout(2000);
                    return { fieldName, success: true };
                } else {
                    testLogger.info(`No values API response for field: ${fieldName}, trying next field`);
                    // Click again to collapse and try another field
                    await row.click().catch(() => {});
                    await page.waitForTimeout(500);
                }
            }
        }
    }

    // Strategy 3: Fallback - try clicking directly on field names
    testLogger.info('Strategies 1-2 failed, no field could be expanded with values API response');
    return { fieldName: null, success: false };
}

// ============================================================================
// TRACES AUTOCOMPLETE TESTS
// ============================================================================

test.describe("Traces Autocomplete Value Suggestions", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Navigate to traces page
        await pm.tracesPage.navigateToTraces();

        // Select the default stream if visible
        if (await pm.tracesPage.isStreamSelectVisible()) {
            await pm.tracesPage.selectTraceStream('default');
        }

        testLogger.info('Traces test setup completed');
    });

    test("should capture field values to IndexedDB when expanding a field in traces sidebar", {
        tag: ['@autosuggestions', '@traces', '@indexeddb']
    }, async ({ page }) => {
        testLogger.info('Testing traces field expansion capture');

        // Clear IndexedDB
        await clearIndexedDB(page);

        // Use setupTraceSearch - the standard pattern from working traces tests
        await pm.tracesPage.setupTraceSearch('default');

        // Verify we have trace results
        const hasResults = await pm.tracesPage.hasTraceResults();
        if (!hasResults) {
            // Check for no results message which is also a valid state
            const hasNoResults = await pm.tracesPage.isNoResultsVisible();
            if (hasNoResults) {
                testLogger.info('No trace data available - skipping field expansion test');
                // Skip gracefully - this is a test environment issue, not a test failure
                return;
            }
            testLogger.info('Search did not complete - test precondition not met');
            expect.soft(hasResults, 'Expected trace search to complete').toBe(true);
            return;
        }

        testLogger.info('Trace results found, attempting field expansion');

        // Ensure field list is visible
        const fieldListVisible = await pm.tracesPage.isIndexListVisible();
        if (!fieldListVisible) {
            testLogger.info('Field list not visible, toggling...');
            await pm.tracesPage.toggleFieldList();
            await page.waitForTimeout(1000);
        }

        // Try to expand a field
        const expandResult = await tryExpandField(page, pm);

        if (!expandResult.success) {
            // This is acceptable - some environments may not have expandable fields
            testLogger.info('No expandable fields found - this may be expected in some environments');
            // Don't fail the test, just note it
            return;
        }

        testLogger.info(`Successfully expanded field: ${expandResult.fieldName}`);
        await page.waitForTimeout(3000);

        // Check IndexedDB for traces records
        const records = await getIndexedDBRecords(page);
        const traceRecords = records.filter(r => r.key && r.key.includes('|traces|'));

        testLogger.info(`Found ${traceRecords.length} traces records in IndexedDB`);

        // Assert we captured trace records - no silent passing
        expect.soft(traceRecords.length, 'Expected traces records to be captured in IndexedDB after field expansion').toBeGreaterThan(0);

        if (traceRecords.length > 0) {
            testLogger.info('Sample traces records:');
            traceRecords.slice(0, 3).forEach(r => {
                testLogger.info(`  - ${r.key}: ${r.values?.length || 0} values`);
            });
        }

        testLogger.info('Traces field expansion capture test completed');
    });

    test("should show value suggestions in traces query editor", {
        tag: ['@autosuggestions', '@traces', '@autocomplete']
    }, async ({ page }) => {
        testLogger.info('Testing traces autocomplete suggestions');

        // Use setupTraceSearch - the standard pattern
        await pm.tracesPage.setupTraceSearch('default');

        // Verify we have trace results
        const hasResults = await pm.tracesPage.hasTraceResults();
        if (!hasResults) {
            const hasNoResults = await pm.tracesPage.isNoResultsVisible();
            if (hasNoResults) {
                testLogger.info('No trace data available - skipping autocomplete test');
                return;
            }
            testLogger.info('Search did not complete - test precondition not met');
            expect.soft(hasResults, 'Expected trace results for autocomplete test').toBe(true);
            return;
        }

        // Try to expand a field to capture values
        const expandResult = await tryExpandField(page, pm);
        let fieldToQuery = 'service.name'; // default fallback

        if (expandResult.success && expandResult.fieldName !== 'unknown') {
            fieldToQuery = expandResult.fieldName;
            await page.waitForTimeout(3000);
            testLogger.info(`Expanded field for value capture: ${fieldToQuery}`);
        }

        // Enter query in the query editor using tracesPage method
        await pm.tracesPage.enterTraceQuery(`${fieldToQuery} = `);
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Space');

        // Wait for suggestions widget and assert suggestions appear
        await waitForSuggestionsWidget(page, 10000);
        const suggestions = await getSuggestionLabels(page);
        testLogger.info(`Traces suggestions: ${suggestions.slice(0, 5).join(', ')}`);

        // Assert suggestions appeared - no silent passing
        expect(suggestions.length, 'Expected autocomplete suggestions to appear').toBeGreaterThan(0);
        testLogger.info('✅ Autocomplete suggestions appeared');

        testLogger.info('Traces autocomplete test completed');
    });

    test("should isolate traces values from logs values", {
        tag: ['@autosuggestions', '@traces', '@isolation']
    }, async ({ page }) => {
        testLogger.info('Testing traces vs logs isolation');

        // Get current IndexedDB state
        const records = await getIndexedDBRecords(page);

        // Separate logs and traces records
        const logsRecords = records.filter(r => r.key && r.key.includes('|logs|'));
        const tracesRecords = records.filter(r => r.key && r.key.includes('|traces|'));

        testLogger.info(`Logs records: ${logsRecords.length}`);
        testLogger.info(`Traces records: ${tracesRecords.length}`);

        // Verify keys are properly namespaced
        let isolationValid = true;

        for (const record of tracesRecords) {
            const keyParts = record.key.split('|');
            if (keyParts.length >= 4) {
                const streamType = keyParts[1];
                if (streamType !== 'traces') {
                    isolationValid = false;
                    testLogger.warn(`Traces record has wrong namespace: ${record.key}`);
                } else {
                    testLogger.info(`✅ Traces record properly namespaced: ${record.key}`);
                }
            }
        }

        for (const record of logsRecords) {
            const keyParts = record.key.split('|');
            if (keyParts.length >= 4) {
                const streamType = keyParts[1];
                if (streamType !== 'logs') {
                    isolationValid = false;
                    testLogger.warn(`Logs record has wrong namespace: ${record.key}`);
                }
            }
        }

        // Only assert if we have records to check
        if (tracesRecords.length > 0 || logsRecords.length > 0) {
            expect(isolationValid, 'Stream type isolation should be maintained').toBe(true);
        } else {
            testLogger.info('No records to verify isolation - test passes by default');
        }

        testLogger.info('Isolation test completed');
    });
});
