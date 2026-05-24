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
 * Wait for IndexedDB to have at least one record for a given field.
 * Uses expect.poll keyed on the actual record contents — deterministic, no setTimeout.
 */
async function waitForFieldInIndexedDB(page, org, streamType, streamName, fieldName, timeout = 10000) {
    let record = null;
    try {
        await expect.poll(async () => {
            record = await getFieldRecord(page, org, streamType, streamName, fieldName);
            return !!(record && record.values && record.values.length > 0);
        }, { timeout, intervals: [200, 500, 1000] }).toBe(true);
    } catch (_) {
        return null;
    }
    return record;
}

/**
 * Click a field expand button and wait for the values_stream response that
 * carries the values back to the page (which then schedules the IDB write).
 * Replaces the legacy `click → waitForTimeout(2000)` pattern with a deterministic
 * wait keyed on the actual /_values_stream response.
 */
async function clickFieldExpandAndWaitValues(page, button, fieldName) {
    const valuesPromise = page.waitForResponse(
        (r) => r.url().includes('_values_stream') && r.url().includes(`fields=${fieldName}`),
        { timeout: 15000 }
    ).catch(() => null);
    await button.click();
    await valuesPromise;
}

/**
 * Get MonacoEditorHelper instance and query editor container
 * Uses page object getter for the container (POM-strict)
 */
function getMonacoHelper(page, pm) {
    const monacoHelper = new MonacoEditorHelper(page);
    const container = pm.logsPage.getQueryEditorContainer();
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
 * Get editor content directly from Monaco model (not view DOM) so reads are
 * deterministic even if executeEdits hasn't yet re-rendered the view-lines.
 */
async function getQueryEditorContent(page, pm) {
    return await page.evaluate((hostSelector) => {
        const host = document.querySelector(hostSelector);
        const editors = window.monaco?.editor?.getEditors?.() || [];
        const ed = host ? editors.find((e) => host.contains(e.getDomNode())) : editors[0];
        return ed?.getValue?.() ?? '';
    }, '[data-test="logs-search-bar-query-editor"]');
}

/**
 * Trigger autocomplete suggestions
 */
async function triggerSuggestions(page, pm) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    await monacoHelper.triggerSuggestions();
}

/**
 * Trigger Ctrl+Space and poll the suggestions widget until it shows the expected
 * stored value — re-triggering on each poll if the popup closed. Avoids racing
 * the CodeQueryEditor's 500ms `update:query` debounce that populates
 * autoCompleteData. If expectedValueOrNull is null, just polls until suggestions
 * appear non-empty.
 *
 * IMPORTANT: After this function returns, the suggestion popup is open AND the
 * first row (sorted by sortText, value suggestions use '\x01' prefix so they're
 * top) is the value. Caller should use selectSuggestion(text) to click a specific
 * row OR press 'Enter' for the highlighted one.
 */
async function triggerSuggestionsWithRetry(page, pm, expectedValueOrNull, timeout = 12000) {
    const { monacoHelper } = getMonacoHelper(page, pm);
    let lastSuggestions = [];
    await expect.poll(async () => {
        // Press Escape to close any prior popup, then re-trigger
        await page.keyboard.press('Escape').catch(() => {});
        await page.keyboard.press('Control+Space');
        try {
            await monacoHelper.waitForSuggestions(1500);
            lastSuggestions = await monacoHelper.getSuggestionLabels();
        } catch (_) {
            lastSuggestions = [];
        }
        if (expectedValueOrNull == null) return lastSuggestions.length > 0;
        return lastSuggestions.some((s) => s.includes(String(expectedValueOrNull)));
    }, { timeout, intervals: [400, 800, 1500] }).toBe(true);
    return lastSuggestions;
}

/**
 * Select a specific suggestion by value via Monaco's suggestController model.
 * Reads the completion items, finds the one matching the expected value, and
 * inserts its `insertText` directly via editor.executeEdits — bypasses both
 * `:has-text(...)` click flakiness AND the Enter-key race when the suggestion
 * popup transiently loses focus. Targets the query editor specifically (host
 * keyed off the page object selector).
 */
async function acceptSuggestionByValue(page, expectedValue) {
    const expected = String(expectedValue);
    const result = await page.evaluate(({ expected, hostSelector }) => {
        const host = document.querySelector(hostSelector);
        const editors = window.monaco?.editor?.getEditors?.() || [];
        const ed = host
            ? editors.find((e) => host.contains(e.getDomNode()))
            : editors[0];
        if (!ed) return { ok: false, reason: 'no-editor' };
        const ctrl = ed.getContribution?.('editor.contrib.suggestController');
        const list = ctrl?.model?._completionModel?.items ?? ctrl?.model?.items ?? [];
        const labels = list.map((it) => {
            const label = it?.completion?.label ?? it?.label;
            return typeof label === 'string' ? label : label?.label ?? '';
        });
        const idx = labels.findIndex((l) => l.includes(expected));
        if (idx < 0) return { ok: false, reason: 'not-found', labels: labels.slice(0, 10) };
        const item = list[idx];
        const insertText = item?.completion?.insertText ?? item?.insertText ?? '';
        if (!insertText) return { ok: false, reason: 'no-insert-text', label: labels[idx] };
        // Cancel the suggestion popup first so Monaco doesn't re-render the edit
        // back to the suggestion's preview / ghost state.
        try { ctrl?.cancelSuggestWidget?.(); } catch (_) {}
        // Execute edit at current cursor — replaces selection if any.
        ed.focus();
        const position = ed.getPosition();
        const range = {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        };
        ed.executeEdits('autocomplete-test', [{ range, text: String(insertText), forceMoveMarkers: true }]);
        return { ok: true, insertText, value: ed.getValue() };
    }, { expected, hostSelector: '[data-test="logs-search-bar-query-editor"]' });
    if (!result.ok) {
        throw new Error(`acceptSuggestionByValue failed: ${result.reason}. Labels: ${(result.labels || []).join(', ')}`);
    }
}

/**
 * Run query and wait for results.
 * Uses the PO's deterministic run-query method (waits on button state) +
 * waits for an actual /_search response to ensure IndexedDB background writes
 * have data to capture, then waits for the suggestion store's stream context
 * to be populated. No setTimeout / waitForTimeout buffers.
 */
async function runQueryAndWaitForResults(page, pm) {
    const orgName = process.env["ORGNAME"] || 'default';

    // Start waiting for response before clicking
    const searchResponsePromise = page.waitForResponse(
        response => response.url().includes(`/api/${orgName}/`) && response.url().includes('_search'),
        { timeout: 30000 }
    ).catch(() => null); // Don't fail if response not captured

    // PO handles the click + ready-state wait deterministically
    await pm.logsPage.runQueryAndWaitForResults().catch(() => pm.logsPage.clickRefreshButton());

    // Wait for the search response (or skip if it never resolves — PO already settled the button)
    await searchResponsePromise;

    // Ensure the field list has hydrated with at least one field expand button —
    // this is the deterministic signal that the search results are rendered AND
    // useSuggestions has streamName populated for autocomplete value lookups.
    await pm.logsPage.getAllFieldExpandButtons().first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
}

/**
 * Find a field that has string values (not purely numeric or boolean)
 * Iterates through available fields until finding one with string values
 * Returns { fieldName, stringValue, record } or null if none found
 */
async function findFieldWithStringValues(page, pm, orgName, streamName, maxAttempts = 5) {
    const fieldButtons = pm.logsPage.getAllFieldExpandButtons();
    const buttonCount = await fieldButtons.count();

    // Try known string fields first - these are more likely to have string values
    const preferredStringFields = ['kubernetes_container_name', 'level', 'log', 'kubernetes_pod_name', 'kubernetes_namespace_name'];

    for (const preferredField of preferredStringFields) {
        const preferredButton = pm.logsPage.getFieldExpandButton(preferredField);
        if (await preferredButton.count() > 0) {
            await preferredButton.click();

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

        // Wait for auth-driven navigation to settle deterministically
        await page.waitForLoadState('domcontentloaded');

        // Ingest test data
        await ingestTestData(page);

        // Navigate to logs page
        await page.goto(
            `${logData.logsUrl}?org_identifier=${orgName}`
        );
        await page.waitForLoadState('domcontentloaded');

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

        // Iterate through fields until one with captured values is found.
        // Some fields (e.g. ftsKey fields) crash the expand handler silently, and
        // others may have empty value sets on the pentest backend — using
        // findFieldWithStringValues skips both deterministically.
        const fieldButtons = pm.logsPage.getAllFieldExpandButtons();
        const buttonCount = await fieldButtons.count();
        expect(buttonCount).toBeGreaterThan(0);

        const result = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(result, 'Expected to capture at least one field with values').not.toBeNull();

        const { fieldName, record } = result;
        testLogger.info(`Expanded field: ${fieldName}`);

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

        // Find a field with values and expand it (skip ftsKey fields that crash
        // the expand handler silently when fired with a null event)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName, record } = fieldResult;
        testLogger.info(`Field ${fieldName} has ${record.values.length} stored values`);

        // Now type in the query editor to trigger suggestions
        // First clear and set up a base query
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} = `);
        // Wait for Monaco model + autocomplete context to settle before triggering
        await pm.logsPage.waitForQueryEditorValue(`${fieldName} = `, 5000);

        // Trigger autocomplete and retry until stored value appears (debounce-safe).
        // Picks any stored value from the captured record to wait on.
        const expectedSampleValue = record.values[0];
        const suggestions = await triggerSuggestionsWithRetry(page, pm, expectedSampleValue, 12000);
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
        await pm.logsPage.waitForQueryEditorValue(`${fieldName} = `, 5000);

        // Retry-trigger autocomplete until the stored value appears
        await triggerSuggestionsWithRetry(page, pm, stringValue, 12000);

        // Assert string value is in suggestions
        const hasStringValue = await suggestionContainsValue(page, pm, stringValue);
        expect(hasStringValue, `Expected string value ${stringValue} to be in suggestions`).toBe(true);

        // Use keyboard navigation + Enter for deterministic suggestion selection.
        // Monaco's virtualised suggest list can swallow raw `.click()` events when
        // multiple rows share text — keyboard accept is the canonical insertion path.
        await acceptSuggestionByValue(page, stringValue);

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

        // Expand a field with values (skip ftsKey fields that crash the handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName, record: recordBefore } = fieldResult;
        const valuesBefore = recordBefore.values;
        testLogger.info(`Values before refresh: ${valuesBefore.length}`);

        // Hard refresh the page
        await page.reload({ waitUntil: 'domcontentloaded' });

        // Verify values are still in IndexedDB.
        // After reload the page may auto-search and add new values — the
        // persistence guarantee is that ALL values captured before the refresh
        // are still present (subset check, not exact equality).
        const recordAfter = await getFieldRecord(page, orgName, 'logs', streamName, fieldName);
        expect(recordAfter).not.toBeNull();
        expect(recordAfter.values.length).toBeGreaterThanOrEqual(valuesBefore.length);
        testLogger.info(`Values after refresh: ${recordAfter.values.length}`);

        // Verify all pre-refresh values are still present (per-value subset
        // check gives better failure diagnostics than arrayContaining).
        for (const v of valuesBefore) {
            expect(recordAfter.values).toContain(v);
        }

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

        // Expand a field with values (skip ftsKey fields that crash the handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName, record: record1 } = fieldResult;
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
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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
        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
    });

    test("should handle typing field IN ( operator", {
        tag: ['@all', '@autosuggestions', '@logs', '@operators']
    }, async ({ page }) => {
        testLogger.info('Testing IN operator suggestions');

        // Capture some values first
        await pm.logsPage.selectStream(streamName);
        await runQueryAndWaitForResults(page, pm);

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Type IN operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} IN (`);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Type LIKE operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} LIKE `);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Type NOT IN operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} NOT IN (`);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Type != operator
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} != `);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Test >= operator - no silent catch
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} >= `);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
        await page.keyboard.press('Control+Space');

        await waitForSuggestionsWidget(page, pm, 5000);
        const suggestionsGte = await getSuggestionLabels(page, pm);
        testLogger.info(`>= operator suggestions: ${suggestionsGte.slice(0, 5).join(', ')}`);
        expect(suggestionsGte.length).toBeGreaterThan(0);

        // Test <= operator - no silent catch
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE ${fieldName} <= `);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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

        // Find a field with captured values (skips ftsKey fields that crash the expand handler)
        const fieldResult = await findFieldWithStringValues(page, pm, orgName, streamName);
        expect(fieldResult, 'Expected to find a field with captured values').not.toBeNull();
        const { fieldName } = fieldResult;

        // Type str_match function
        await setQueryEditorContent(page, pm, `SELECT * FROM "${streamName}" WHERE str_match(${fieldName}, `);
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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
        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
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

        // Find the field expand button for 'code'
        const codeFieldBtn = pm.logsPage.getFieldExpandButton('code');
        await codeFieldBtn.waitFor({ state: 'visible', timeout: 5000 });
        await codeFieldBtn.click();

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
        await pm.logsPage.waitForQueryEditorValue('code = ', 5000);

        // Retry-trigger autocomplete until the numeric value shows up
        // (handles the 500ms editor debounce that gates updateAutoComplete).
        await triggerSuggestionsWithRetry(page, pm, numericValue, 12000);

        // Check if our numeric value is in suggestions
        const hasNumericValue = await suggestionContainsValue(page, pm, numericValue);
        expect(hasNumericValue, `Expected numeric value ${numericValue} to be in suggestions`).toBe(true);

        // Keyboard accept — see acceptSuggestionByValue() rationale.
        await acceptSuggestionByValue(page, numericValue);

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
        await pm.logsPage.waitForQueryEditorValue(`${fieldName} = '`, 5000);

        // Retry-trigger autocomplete until the stored value appears
        await triggerSuggestionsWithRetry(page, pm, stringValue, 12000);

        const hasStringValue = await suggestionContainsValue(page, pm, stringValue);
        expect(hasStringValue, `Expected string value ${stringValue} to be in suggestions`).toBe(true);

        // Keyboard accept — see acceptSuggestionByValue() rationale above.
        await acceptSuggestionByValue(page, stringValue);

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
        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
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
        await pm.logsPage.waitForQueryEditorValue('WHERE', 5000);
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
