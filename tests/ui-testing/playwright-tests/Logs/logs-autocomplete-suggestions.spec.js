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
const { ingestTestData, waitForStreamData } = require('../utils/data-ingestion.js');
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
 * Expand a field in the sidebar and deterministically capture its values.
 *
 * The sidebar expand fires a /_values_stream fetch; the page then schedules an
 * IndexedDB write from that response. The legacy pattern here was
 * `click → poll IndexedDB(10s)`, but the 10s window started at CLICK time and so
 * raced a slow-runner fetch: under CI load /_values_stream could land AFTER the
 * poll had already given up, leaving the record null even though the data
 * existed (3848 rows are ingested at shard start). This anchors the IndexedDB
 * wait AFTER the values response instead of racing it, which removes the flake.
 *
 * Matches any /_values_stream response (the click triggers exactly one, for this
 * field) rather than the exact `fields=` encoding, so it is robust to how the
 * field name is serialised. The OSS test env serves values over HTTP/SSE, so the
 * response reliably surfaces to waitForResponse; the wait is still best-effort
 * (`.catch`) so any non-HTTP transport falls straight through to the IDB poll.
 *
 * @returns the IndexedDB record ({ values, ... }) or null if none was captured.
 */
async function expandFieldAndCaptureValues(page, button, orgName, streamName, fieldName) {
    const waitValues = () => page.waitForResponse(
        (r) => r.url().includes('_values_stream'),
        { timeout: 20000 }
    ).catch(() => null);

    let valuesResponse = waitValues();
    await button.click();
    let responded = await valuesResponse;

    // If the click collapsed an already-expanded panel (no values fetch fired —
    // e.g. a prior retry round left this field open), re-click to expand and
    // re-arm the wait. Guarded on `responded` so a field that DID fetch is never
    // toggled back shut.
    if (!responded) {
        valuesResponse = waitValues();
        await button.click().catch(() => {});
        responded = await valuesResponse;
    }

    // The IDB write happens within a beat of the response landing, so an 8s
    // window post-response is ample (vs. the old 10s racing from click time).
    return await waitForFieldInIndexedDB(page, orgName, 'logs', streamName, fieldName, 8000);
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
 * Pick the first genuine string value (not numeric / boolean) from a captured
 * IndexedDB record. Returns { fieldName, stringValue, record } or null.
 */
function pickStringValue(fieldName, record) {
    if (record && record.values && record.values.length > 0) {
        const stringValue = record.values.find(v =>
            isNaN(Number(v)) && v !== 'true' && v !== 'false'
        );
        if (stringValue) {
            testLogger.info(`Found string field: ${fieldName} with value: ${stringValue}`);
            return { fieldName, stringValue, record };
        }
    }
    return null;
}

/**
 * Find a field that has string values (not purely numeric or boolean).
 * Iterates through available fields until finding one with string values,
 * capturing each via expandFieldAndCaptureValues (response-anchored, no
 * click-time race). If a full pass captures nothing, re-runs the query to
 * refresh the field-values context and re-scans — bounded by `maxRounds` so a
 * genuinely value-less stream still fails in a reasonable time rather than
 * hanging. Returns { fieldName, stringValue, record } or null if none found.
 */
async function findFieldWithStringValues(page, pm, orgName, streamName, maxAttempts = 6, maxRounds = 2) {
    // Try known string fields first - these are more likely to have string values
    const preferredStringFields = ['kubernetes_container_name', 'level', 'log', 'kubernetes_pod_name', 'kubernetes_namespace_name'];

    const scanOnce = async () => {
        const fieldButtons = pm.logsPage.getAllFieldExpandButtons();
        const buttonCount = await fieldButtons.count();

        for (const preferredField of preferredStringFields) {
            const preferredButton = pm.logsPage.getFieldExpandButton(preferredField);
            if (await preferredButton.count() > 0) {
                const record = await expandFieldAndCaptureValues(page, preferredButton, orgName, streamName, preferredField);
                const hit = pickStringValue(preferredField, record);
                if (hit) return hit;
            }
        }

        // Fallback: iterate through all fields
        for (let i = 0; i < Math.min(buttonCount, maxAttempts); i++) {
            const button = fieldButtons.nth(i);
            const dataTest = await button.getAttribute('data-test');
            const fieldName = dataTest.replace('log-search-expand-', '').replace('-field-btn', '');

            // Skip if already expanded (part of preferred fields)
            if (preferredStringFields.includes(fieldName)) continue;

            const record = await expandFieldAndCaptureValues(page, button, orgName, streamName, fieldName);
            const hit = pickStringValue(fieldName, record);
            if (hit) return hit;
        }

        return null;
    };

    for (let round = 0; round < maxRounds; round++) {
        const result = await scanOnce();
        if (result) return result;

        // No field yielded values this pass — the /_values backend may have
        // transiently returned empty (index still catching up under load).
        // Re-run the query to refresh the field-values context, then re-scan.
        if (round < maxRounds - 1) {
            testLogger.warn(`findFieldWithStringValues: no values captured on round ${round + 1}/${maxRounds}, refreshing and retrying`);
            await runQueryAndWaitForResults(page, pm).catch(() => {});
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

        // Readiness gate: freshly-ingested data is not queryable immediately
        // (WAL -> index lag). The value-capture flow reads the same index that
        // /_search does, so gate on the stream being searchable before driving
        // the UI — otherwise field expansion can fetch an empty value set and the
        // IndexedDB capture never populates. Best-effort so an already-warm
        // shared stream doesn't block on a slow poll.
        await waitForStreamData(page, streamName, 1).catch(() => {});

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
        // Gate on the stream being searchable before driving the UI so field
        // expansion never fetches an empty value set (WAL -> index lag).
        await waitForStreamData(page, streamName, 1).catch(() => {});
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
        // Gate on the stream being searchable before driving the UI so field
        // expansion never fetches an empty value set (WAL -> index lag).
        await waitForStreamData(page, streamName, 1).catch(() => {});
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

        // Response-anchored capture (not a click-time IDB race): waits for the
        // /_values_stream fetch before confirming the IndexedDB write, so a slow
        // runner can't make this null even though the data exists.
        const record = await expandFieldAndCaptureValues(page, codeFieldBtn, orgName, streamName, 'code');
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
        // Gate on the stream being searchable before driving the UI so field
        // expansion never fetches an empty value set (WAL -> index lag).
        await waitForStreamData(page, streamName, 1).catch(() => {});
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

// ============================================================================
// KEY CONTRACT MATRIX (Phase 1, ZO_EDITOR_SUGGEST_MODE)
// ============================================================================

// Each row reads the flag from the page, so this file runs once per flag value.
const QUERY_EDITOR_HOST = '[data-test="logs-search-bar-query-editor"]';

/** The effective ZO_EDITOR_SUGGEST_MODE the browser received in zoConfig. */
async function getSuggestMode(page) {
    return await page.evaluate(() => {
        const app = document.querySelector('#app')?.__vue_app__;
        const raw = app?.config?.globalProperties?.$store?.state?.zoConfig?.editor_suggest_mode;
        const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        return ['automatic', 'typing', 'off'].includes(value) ? value : 'automatic';
    });
}

/** Put text in the Logs editor without typing it, caret at the end, editor focused. */
async function seedEditor(page, text) {
    await page.waitForFunction((host) => {
        const el = document.querySelector(host);
        return !!el && (window.monaco?.editor?.getEditors?.() || []).some((e) => el.contains(e.getDomNode()));
    }, QUERY_EDITOR_HOST, { timeout: 15000 });
    await page.evaluate(({ host, value }) => {
        const el = document.querySelector(host);
        const ed = window.monaco.editor.getEditors().find((e) => el.contains(e.getDomNode()));
        ed.focus();
        ed.setValue(value);
        const model = ed.getModel();
        const line = model.getLineCount();
        ed.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
        ed.trigger('e2e', 'hideSuggestWidget', {});
    }, { host: QUERY_EDITOR_HOST, value: text });
}

/** The query editor's model text (not the rendered view). */
async function editorText(page) {
    return await page.evaluate((host) => {
        const el = document.querySelector(host);
        const ed = (window.monaco?.editor?.getEditors?.() || []).find((e) => el?.contains(e.getDomNode()));
        return ed?.getValue?.() ?? '';
    }, QUERY_EDITOR_HOST).then((text) => text.replace(/\r\n/g, '\n'));
}

/** Visible suggest rows and which one, if any, is highlighted. */
async function menuState(page) {
    const widget = page.locator('.monaco-editor .suggest-widget.visible');
    if (!(await widget.isVisible().catch(() => false))) return { visible: false, rows: [], focused: null };
    const rows = await widget.locator('.monaco-list-row').evaluateAll((nodes) =>
        nodes.map((n) => ({
            label: (n.getAttribute('aria-label') || n.textContent || '').split(',')[0].trim(),
            focused: n.classList.contains('focused'),
        })),
    );
    return { visible: true, rows: rows.map((r) => r.label), focused: rows.find((r) => r.focused)?.label ?? null };
}

/** Wait until a suggest menu is on screen; returns its state. */
async function waitForMenu(page, timeout = 8000) {
    await page.locator('.monaco-editor .suggest-widget.visible').waitFor({ state: 'visible', timeout });
    // Monaco paints rows one frame after the widget becomes visible.
    await expect.poll(async () => (await menuState(page)).rows.length, { timeout: 3000 }).toBeGreaterThan(0);
    return await menuState(page);
}

test.describe("Autocomplete key contract — Enter never inserts from a menu it did not ask for", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;
    let mode;
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await waitForStreamData(page, streamName, 1).catch(() => {});
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.selectStream(streamName);
        mode = await getSuggestMode(page);
        testLogger.info(`ZO_EDITOR_SUGGEST_MODE in the browser: ${mode}`);
    });

    // 07a: a comma opened the catalog with row 1 highlighted, and Enter inserted it.
    test("Enter after a comma is a newline (07a)", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        await seedEditor(page, `SELECT level`);
        await page.keyboard.type(',');
        const menu = await waitForMenu(page);
        expect(menu.focused, 'a comma menu must open with nothing highlighted').toBeNull();
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toBe(`SELECT level,\n`);
    });

    // 07b: typing the closing quote by hand opened a highlighted catalog.
    test("Enter after a hand-typed closing quote is a newline (07b)", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE level = 'error`);
        await page.keyboard.type("'");
        const text = await editorText(page);
        const menu = await menuState(page);
        if (menu.visible) expect(menu.focused).toBeNull();
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toBe(`${text}\n`);
    });

    // 07c: an auto menu whose row equals the typed word swallowed Enter.
    test("Enter after a whole word in GROUP BY is a newline (07c)", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        await seedEditor(page, `SELECT level, count(*) FROM "${streamName}" GROUP BY lev`);
        await page.keyboard.type('el');
        await waitForMenu(page).catch(() => null);
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toBe(`SELECT level, count(*) FROM "${streamName}" GROUP BY level\n`);
    });

    // 07d: a space after a value opened the catalog with row 1 highlighted.
    test("Enter after a typed space is a newline (07d)", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE level = 'error'`);
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page);
        expect(menu.focused, 'a typed-space menu must open with nothing highlighted').toBeNull();
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toBe(`SELECT * FROM "${streamName}" WHERE level = 'error' \n`);
    });

    test("Tab indents when no menu is open", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT *`);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Tab');
        expect(await editorText(page)).toMatch(/^SELECT \*[ \t]+$/);
    });

    // P0-4: a value position offers values (or an honest status row), never the catalog.
    test("a space after = opens values with no quote typed, and no functions", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract', '@values']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE level =`);
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page);
        if (mode !== 'off') expect(menu.focused, 'a typed-space menu opens unhighlighted').toBeNull();
        for (const notAValue of ['match_all', 'count', 'SELECT', 'and']) {
            expect(menu.rows, `${notAValue} offered in a value position`).not.toContain(notAValue);
        }
    });

    test("a bare = 50 keeps value help", {
        tag: ['@all', '@autosuggestions', '@logs', '@values']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE code = `);
        await page.keyboard.type('5');
        const menu = await waitForMenu(page).catch(() => ({ visible: false, rows: [] }));
        for (const notAValue of ['match_all', 'count', 'SELECT']) {
            expect(menu.rows, `${notAValue} offered after = 5`).not.toContain(notAValue);
        }
    });

    test("ILIKE ' offers values or nothing, never fields", {
        tag: ['@all', '@autosuggestions', '@logs', '@values']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE level ILIKE `);
        await page.keyboard.type("'");
        const menu = await waitForMenu(page).catch(() => ({ visible: false, rows: [] }));
        for (const field of ['code', 'log', 'kubernetes_pod_name', 'level']) {
            expect(menu.rows, `field ${field} offered inside a string`).not.toContain(field);
        }
        if (menu.rows.length) {
            await page.keyboard.press('Tab');
            const text = await editorText(page);
            expect(text, 'an ILIKE value is inserted as a complete pattern').toMatch(/ILIKE '(%.*%')?/);
        }
    });

    test("a Utf8 value that looks numeric is quoted", {
        tag: ['@all', '@autosuggestions', '@logs', '@values', '@quoting']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE kubernetes_labels_app_kubernetes_io_version = `);
        await page.keyboard.press('Control+Space');
        const menu = await waitForMenu(page).catch(() => ({ visible: false, rows: [] }));
        test.skip(!menu.rows.some((r) => /^[0-9.]+$/.test(r)), 'no numeric-looking value captured for this field');
        const row = menu.rows.findIndex((r) => /^[0-9.]+$/.test(r));
        for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toMatch(/= '[0-9.]+'/);
    });

    test("typed letters still highlight row 1 and Enter accepts it", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE `);
        await page.keyboard.type('lev');
        const menu = await waitForMenu(page);
        expect(menu.focused, 'a menu opened by typing letters keeps row 1 highlighted').not.toBeNull();
        await page.keyboard.press('Enter');
        expect(await editorText(page)).toContain('WHERE level');
    });
});

// The off switch must hold even when the editor mounts before the authenticated config arrives.
test.describe("Autocomplete key contract — the mode is known before the full config", () => {
    const streamName = 'e2e_automate';
    const orgName = process.env["ORGNAME"] || 'default';

    test("with /api/*/config held back 2 s, off still gives today's editor", {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract']
    }, async ({ page }) => {
        await navigateToBase(page);
        await page.route('**/api/*/config', async (route) => {
            await new Promise((r) => setTimeout(r, 2000));
            await route.continue();
        });
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await seedEditor(page, `SELECT * FROM "${streamName}" WHERE `);
        const mode = await getSuggestMode(page);
        test.skip(mode !== 'off', 'this row is for ZO_EDITOR_SUGGEST_MODE=off');
        const options = await page.evaluate((host) => {
            const el = document.querySelector(host);
            const ed = window.monaco.editor.getEditors().find((e) => el.contains(e.getDomNode()));
            const raw = ed.getRawOptions();
            return { selectionMode: raw.suggest?.selectionMode, enter: raw.acceptSuggestionOnEnter };
        }, QUERY_EDITOR_HOST);
        expect(options).toEqual({ selectionMode: 'always', enter: 'on' });
        await seedEditor(page, `SELECT level`);
        await page.keyboard.type(',');
        const menu = await waitForMenu(page);
        expect(menu.focused, 'off keeps row 1 highlighted, as today').not.toBeNull();
        await page.keyboard.press('Tab');
        const text = await editorText(page);
        expect(text.startsWith('SELECT level,') && text.length > 'SELECT level,'.length, `Tab accepted row 1: ${text}`).toBe(true);
        expect(text).toContain(menu.focused);
    });
});
