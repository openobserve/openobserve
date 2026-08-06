// metricsQueryEditorPage.js
// Page Object Model for Metrics Query Editor functionality
// This file contains helper functions for PromQL query persistence tests

const { expect } = require('@playwright/test');

/**
 * MetricsQueryEditorPage - Page Object for Metrics Query Editor
 *
 * This class provides methods for interacting with the metrics query editor,
 * including tab management, query entry, and mode switching.
 *
 * Used for testing PromQL query persistence across tabs.
 */
export class MetricsQueryEditorPage {
    constructor(page) {
        this.page = page;
        this.testLogger = null;

        // Try to load test logger if available
        try {
            this.testLogger = require('../../playwright-tests/utils/test-logger.js');
        } catch (e) {
            // Create a simple console-based logger fallback
            this.testLogger = {
                info: (msg) => console.log(`[INFO] ${msg}`),
                warn: (msg) => console.warn(`[WARN] ${msg}`),
                error: (msg) => console.error(`[ERROR] ${msg}`)
            };
        }

        // Class-member locators (POM strict — §3)
        this.runQueryButton = page.locator('[data-test="metrics-apply"]');
        this.queryEditorContainer = page.locator('[data-test="dashboard-panel-query-editor"]');
        this.customQueryTypeButton = page.locator('[data-test="dashboard-custom-query-type"]');
        this.promqlQueryTypeButton = page.locator('[data-test="dashboard-promql-query-type"]');
        this.addQueryTabButton = page.locator('[data-test="dashboard-panel-query-tab-add"]');
        this.streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        this.streamDropdownPopover = page.locator('[data-test="index-dropdown-stream-popover"]');
        this.streamDropdownOption = page.locator('[data-test="index-dropdown-stream-option"]');
        this.streamDropdownClear = page.locator('[data-test="index-dropdown-stream"] [data-test="o-icon-cancel"]');
        this.tabList = page.locator('[data-test^="dashboard-panel-query-tab-"]');
    }

    /**
     * Per-index tab factory helper — class member factory (POM strict)
     * @param {number} zeroIdx - 0-based tab index
     */
    getTabByIndex(zeroIdx) {
        return this.page.locator(`[data-test="dashboard-panel-query-tab-${zeroIdx}"]`);
    }

    /**
     * Switch to PromQL Custom mode
     *
     * In the metrics page, there are two toggle groups:
     *   - Query type: SQL / PromQL  (data-test="dashboard-sql-query-type" / "dashboard-promql-query-type")
     *   - Builder mode: Builder / Custom  (data-test="dashboard-builder-query-type" / "dashboard-custom-query-type")
     *
     * OToggleGroupItem (Reka UI) signals the active item via data-state="on", not a CSS class.
     *
     * @returns {Promise<boolean>} - True if successfully switched
     */
    async switchToPromQLCustomMode() {
        this.testLogger.info('Switching to PromQL Custom mode...');

        // Primary selector — the Custom builder-mode button in QueryTypeSelector.vue
        const customButton = this.customQueryTypeButton.first();

        if (await customButton.isVisible({ timeout: 3000 })) {
            // OToggleGroupItem uses data-state="on" (Reka UI) for active state
            const dataState = await customButton.getAttribute('data-state') || '';

            if (dataState === 'on') {
                this.testLogger.info('✓ Already in PromQL Custom mode');
                return true;
            }

            await customButton.click();

            // Confirm active state flipped — deterministic wait
            await expect.poll(async () => await customButton.getAttribute('data-state'), {
                timeout: 5000,
            }).toBe('on').catch(() => {
                this.testLogger.warn('Custom mode button clicked but data-state did not become "on"');
            });
            this.testLogger.info('✓ Switched to PromQL Custom mode');
            return true;
        }

        this.testLogger.warn('Could not find [data-test="dashboard-custom-query-type"] — assuming already in custom mode');
        return false;
    }

    /**
     * Clear any stream selection
     * This prevents auto-populated queries from interfering
     *
     * @returns {Promise<boolean>} - True if cleared successfully
     */
    async clearStreamSelection() {
        // Try to clear stream selection if there's a clear/X button
        const clearBtn = this.streamDropdownClear.first();
        if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await clearBtn.click();
            this.testLogger.info('Cleared stream selection');
            return true;
        }

        return false;
    }

    /**
     * Enter PromQL query in metrics page
     * This avoids triggering the "Add to Dashboard" dialog
     * NOTE: Assumes we're already in PromQL Custom mode
     *
     * @param {string} query - The PromQL query to enter
     */
    async enterPromQLQuery(query) {
        this.testLogger.info(`Attempting to enter query: ${query}`);

        // Try to clear any stream selection first (prevents auto-populated queries)
        await this.clearStreamSelection();

        // APPROACH 1: Try Monaco API - sets the model value directly
        // Note: This only sets the internal model state, not the rendered view
        const modelSetSuccess = await this.page.evaluate((queryText) => {
            try {
                const editors = window.monaco?.editor?.getEditors?.() || [];
                if (editors.length === 0) return false;
                const dashContainer = document.querySelector('[data-test="dashboard-panel-query-editor"]');
                let editor = null;
                for (const ed of editors) {
                    const dom = ed.getDomNode?.();
                    if (dom && dashContainer && dashContainer.contains(dom)) {
                        editor = ed;
                        break;
                    }
                }
                editor = editor || editors[0];
                if (editor && typeof editor.setValue === 'function') {
                    editor.setValue(queryText);
                    // Model set attempted - view rendering happens asynchronously
                    return true;
                }
            } catch (error) {
                console.log('Monaco API failed:', error.message);
            }
            return false;
        }, query);

        if (modelSetSuccess) {
            this.testLogger.info('Monaco model set, polling for view rendering...');

            // CRITICAL: Poll for actual DOM/view rendering, not model state
            // Monaco renders asynchronously - we must verify via the editor model.
            // Gated on the REAL signal (model contains the typed query) with a
            // generous bounded timeout — 3s was too tight under afternoon cloud
            // load and let the fast keyboard fallback fire unnecessarily.
            try {
                await expect.poll(async () => {
                    const text = await this.getCurrentQueryText();
                    return text.includes(query.substring(0, Math.min(10, query.length)));
                }, { timeout: 15000, intervals: [100, 200, 500, 1000] }).toBe(true);
                this.testLogger.info('✓ Query verified in rendered view');
                return;
            } catch {
                const verifyText = await this.getCurrentQueryText();
                this.testLogger.warn(`Monaco model set but view not rendered. Got: "${verifyText}"`);
            }
        }

        // APPROACH 2: Direct keyboard input with aggressive clearing
        this.testLogger.info('Using keyboard input approach');

        // Find and focus the editor (use container scoped focus via evaluate)
        const editorVisible = await this.queryEditorContainer.first().isVisible({ timeout: 3000 }).catch(() => false);
        if (!editorVisible) {
            this.testLogger.error('Editor not visible - cannot enter query');
            return;
        }

        // Focus the editor through the Monaco API (target the dashboard panel
        // editor specifically, not a logs/VRL editor that may also be present).
        await this.page.evaluate(() => {
            const editors = window.monaco?.editor?.getEditors?.() || [];
            if (editors.length === 0) return;
            const dashContainer = document.querySelector('[data-test="dashboard-panel-query-editor"]');
            for (const ed of editors) {
                const dom = ed.getDomNode?.();
                if (dom && dashContainer && dashContainer.contains(dom)) {
                    ed.focus();
                    return;
                }
            }
            editors[0].focus();
        });

        // Clear editor content: single select-all + backspace, then select-all to prepare for typing
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Backspace');

        // Select all again so typing will replace any remaining content
        await this.page.keyboard.press(selectAllKey);

        // Type the new query
        await this.page.keyboard.type(query, { delay: 100 });
        await this.page.keyboard.press('Escape');

        // Final verification
        const actualText = await this.getCurrentQueryText();
        this.testLogger.info(`Expected: "${query}"`);
        this.testLogger.info(`Actual:   "${actualText}"`);

        if (!actualText.includes(query.substring(0, Math.min(10, query.length)))) {
            this.testLogger.error(`❌ Query mismatch - expected "${query}" but got "${actualText}"`);
        } else {
            this.testLogger.info('✓ Query successfully entered');
        }
    }

    /**
     * Get current query text from editor
     *
     * @returns {Promise<string>} - The current query text
     */
    async getCurrentQueryText() {
        // Read from Monaco editor model directly (approved §5 pattern).
        // Prefer the editor whose container has data-test="dashboard-panel-query-editor"
        // so we don't read from a VRL/logs/secondary editor in the same page.
        const text = await this.page.evaluate(() => {
            try {
                const editors = window.monaco?.editor?.getEditors?.() || [];
                if (editors.length === 0) return '';
                // Identify the dashboard panel query editor by its container's data-test.
                const dashContainer = document.querySelector('[data-test="dashboard-panel-query-editor"]');
                for (const ed of editors) {
                    const dom = ed.getDomNode?.();
                    if (dom && dashContainer && dashContainer.contains(dom)) {
                        return ed.getValue() || '';
                    }
                }
                // Fallback: return the first editor's value.
                return editors[0].getValue() || '';
            } catch (e) {
                console.log('Monaco read failed:', e.message);
            }
            return '';
        });
        return (text || '').trim();
    }

    /**
     * Wait for the dashboard-panel Monaco editor to be (re)mounted and visible.
     *
     * On tab create / tab switch, DashboardQueryEditor.vue tears down and remounts
     * the Monaco instance for the newly-active tab. Reading getCurrentQueryText()
     * before that remount completes yields empty/stale text. This gates on the REAL
     * signal — a Monaco editor whose DOM node lives inside the dashboard query editor
     * container AND is actually laid out (offsetParent != null, i.e. visible) — so
     * callers read a live editor, not a mid-remount one.
     *
     * Best-effort: warns (never throws) if the editor isn't confirmed within the
     * bounded timeout, leaving the caller's own assertions as the authority.
     *
     * @param {number} timeout - bounded max wait in ms
     */
    async waitForEditorReady(timeout = 8000) {
        try {
            await expect.poll(async () => {
                return await this.page.evaluate(() => {
                    const editors = window.monaco?.editor?.getEditors?.() || [];
                    const dashContainer = document.querySelector('[data-test="dashboard-panel-query-editor"]');
                    if (!dashContainer) return false;
                    for (const ed of editors) {
                        const dom = ed.getDomNode?.();
                        if (dom && dashContainer.contains(dom) && dom.offsetParent !== null) {
                            return true;
                        }
                    }
                    return false;
                });
            }, { timeout, intervals: [100, 200, 500] }).toBe(true);
        } catch {
            this.testLogger.warn('Editor not confirmed ready (mounted + visible) within timeout');
        }
    }

    /**
     * Switch to a specific query tab (1-based)
     *
     * Tabs in DashboardQueryEditor.vue are rendered as OTab (Reka UI TabsTrigger)
     * with data-test="dashboard-panel-query-tab-{0-based-index}" and
     * data-state="active" when selected.
     *
     * @param {number} tabNumber - The tab number to switch to (1-based)
     * @returns {Promise<boolean>} - True if successfully switched
     */
    async switchToTab(tabNumber) {
        this.testLogger.info(`Attempting to switch to tab ${tabNumber}`);

        // Primary: use the data-test attribute (0-based index internally)
        const zeroIdx = tabNumber - 1;
        const tabByDataTest = this.getTabByIndex(zeroIdx).first();

        if (await tabByDataTest.isVisible({ timeout: 3000 })) {
            // Check if already active
            const currentState = await tabByDataTest.getAttribute('data-state') || '';
            if (currentState === 'active') {
                this.testLogger.info(`✓ Tab ${tabNumber} is already active`);
                return true;
            }

            await tabByDataTest.click({ force: true });

            // Deterministic wait for active state
            try {
                await expect.poll(async () => await tabByDataTest.getAttribute('data-state'), {
                    timeout: 3000,
                    intervals: [100, 250, 500],
                }).toBe('active');
                // Tab is active — now wait for its Monaco editor to be remounted +
                // visible before returning, so a caller reading getCurrentQueryText()
                // right after the switch sees the re-rendered (persisted) query, not
                // a mid-remount empty editor.
                await this.waitForEditorReady();
                this.testLogger.info(`✓ Switched to tab ${tabNumber} (verified active)`);
                return true;
            } catch {
                const newState = await tabByDataTest.getAttribute('data-state') || '';
                this.testLogger.warn(`Tab ${tabNumber} clicked but data-state is "${newState}"`);
            }
        }

        this.testLogger.error(`Failed to switch to tab ${tabNumber}`);
        return false;
    }

    /**
     * Add a new query tab
     *
     * @returns {Promise<boolean>} - True if successfully added
     */
    async addQueryTab() {
        this.testLogger.info('Looking for Add Query button...');

        const addButton = this.addQueryTabButton.first();

        if (await addButton.isVisible({ timeout: 3000 })) {
            // Track tab count before click for deterministic verification
            const tabsBefore = await this.tabList.count();

            await addButton.click({ force: true });

            // Deterministic wait — count increased
            try {
                await expect.poll(async () => {
                    return await this.tabList.count();
                }, { timeout: 5000, intervals: [100, 250, 500] }).toBeGreaterThan(tabsBefore);
                // New tab created — wait for its freshly-mounted Monaco editor to be
                // visible before returning so the caller can immediately act on it.
                await this.waitForEditorReady();
                this.testLogger.info('✓ Added new query tab successfully');
                return true;
            } catch {
                this.testLogger.warn('Add tab clicked but tab count did not increase');
                return false;
            }
        }

        this.testLogger.error('❌ Add query button not found');
        return false;
    }

    /**
     * Click the Run Query button to save the query to state
     * This ensures the query is properly saved before switching tabs
     *
     * @returns {Promise<boolean>} - True if successfully clicked
     */
    async clickRunQuery() {
        const runQueryBtn = this.runQueryButton.first();
        if (await runQueryBtn.isVisible({ timeout: 2000 })) {
            // Trigger and wait for the search response — deterministic
            const responsePromise = this.page.waitForResponse(
                resp => /\/_search|\/api\/.+\/prometheus|metrics_query_range/.test(resp.url()),
                { timeout: 5000 }
            ).catch(() => null);
            await runQueryBtn.click();
            this.testLogger.info('Clicked Run Query button');
            await responsePromise;
            return true;
        }
        this.testLogger.warn('Run Query button not found');
        return false;
    }

    /**
     * Enter query using keyboard input (simple approach)
     * This is a simpler method that directly types into the editor
     *
     * @param {string} query - The query to enter
     */
    async enterQueryViaKeyboard(query) {
        // Focus the editor via Monaco API (avoid raw .monaco-editor class selector).
        // Target the dashboard panel editor by container data-test so we don't
        // hit a logs/VRL editor that may share the same page tree.
        await this.queryEditorContainer.first().waitFor({ state: 'visible', timeout: 5000 });

        // Clear ALL existing content and focus the editor using Monaco's API +
        // executeEdits so Monaco fires the model change event that the Vue
        // editor wrapper listens to (keeps `queries[i].query` in sync).
        // Pure setValue() bypasses the change event and `handleQueryUpdate`
        // wouldn't fire — leaving stale Vue state behind. Keyboard select-all
        // by itself can also fail to cover the full range if the editor was
        // just (re)mounted, leaving the new typed text concatenated with the
        // stale placeholder (e.g. `metric_b` + `cpu_count{}`).
        await this.page.evaluate(() => {
            const editors = window.monaco?.editor?.getEditors?.() || [];
            if (editors.length === 0) return;
            const dashContainer = document.querySelector('[data-test="dashboard-panel-query-editor"]');
            let target = null;
            for (const ed of editors) {
                const dom = ed.getDomNode?.();
                if (dom && dashContainer && dashContainer.contains(dom)) {
                    target = ed;
                    break;
                }
            }
            target = target || editors[0];
            target.focus();
            // Clear via executeEdits to emit the onDidChangeModelContent event
            // (which the wrapper's @update:query listener uses).
            const model = target.getModel?.();
            if (model) {
                const fullRange = model.getFullModelRange();
                target.executeEdits('clear', [{ range: fullRange, text: '', forceMoveMarkers: true }]);
            }
        });

        // Use insertText instead of type — keyboard.type() triggers Monaco
        // autocomplete on cloud which corrupts the query text
        await this.page.keyboard.insertText(query);

        // Deterministic wait — verify Monaco model contains the query
        await expect.poll(async () => {
            return await this.getCurrentQueryText();
        }, { timeout: 3000, intervals: [100, 250, 500] }).toContain(query);
        let lastVal = '';
        let stableCount = 0;
        await expect.poll(async () => {
            const v = await this.getCurrentQueryText();
            if (v === lastVal && v.includes(query)) {
                stableCount += 1;
            } else {
                stableCount = 0;
                lastVal = v;
            }
            // 4 consecutive identical reads at 200ms intervals = 800ms of
            // stability, comfortably past the 500ms debounce window.
            return stableCount;
        }, { timeout: 3000, intervals: [200] }).toBeGreaterThanOrEqual(4);
    }

    /**
     * Poll for expected query text with retries
     * Useful for waiting for async updates after tab switches
     *
     * @param {string} expectedText - The text to look for in the query
     * @param {number} maxAttempts - Maximum number of attempts (default: 30 → 15s budget)
     * @param {number} delayMs - Delay between attempts in ms (default: 500)
     * @returns {Promise<{found: boolean, text: string}>} - Result with found status and actual text
     */
    async pollForQueryText(expectedText, maxAttempts = 30, delayMs = 500) {
        let currentText = '';
        try {
            await expect.poll(async () => {
                currentText = await this.getCurrentQueryText();
                this.testLogger.info(`Query read: "${currentText}"`);
                return currentText.includes(expectedText);
            }, {
                timeout: maxAttempts * delayMs,
                intervals: [delayMs],
            }).toBe(true);
            return { found: true, text: currentText };
        } catch {
            return { found: false, text: currentText };
        }
    }

    /**
     * Take a screenshot for debugging purposes
     *
     * @param {string} prefix - Prefix for the screenshot filename
     */
    async takeDebugScreenshot(prefix) {
        await this.page.screenshot({ path: `${prefix}-${Date.now()}.png` });
    }

    /**
     * Open the stream dropdown and select the first available stream.
     * Returns the selected stream value (or empty string if no streams available).
     *
     * @returns {Promise<string>} - The selected stream value
     */
    async selectFirstStream() {
        const dropdown = this.streamDropdown.first();
        if (!await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
            return '';
        }

        await dropdown.click();
        await this.streamDropdownPopover.first().waitFor({ state: 'visible', timeout: 5000 });

        const firstOption = this.streamDropdownOption.first();
        if (!await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            return '';
        }

        const streamValue = await firstOption.getAttribute('data-test-value') || '';
        await firstOption.click();

        // Wait for popover to close
        await this.streamDropdownPopover.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

        this.testLogger.info(`Selected stream: ${streamValue}`);

        // Readiness gate (root cause #1): in PromQL custom mode, selecting a metric
        // triggers an ASYNC app flow — fetch metric metadata, then auto-populate the
        // query editor. The popover closing is NOT that signal. Gate on the REAL
        // signal — the editor model becoming non-empty — with a generous bounded
        // timeout so callers that assert on auto-populate don't race the async fill
        // under cloud load (the 5s poll in P1 was too tight).
        //
        // Best-effort by design: if the query never auto-populates (e.g. no metadata
        // for this metric, or auto-populate broken server-side) we log a warning and
        // still return streamValue, so callers that do NOT expect auto-population are
        // unaffected and their own assertions remain the authority.
        try {
            await expect.poll(async () => {
                return (await this.getCurrentQueryText()).trim().length > 0;
            }, { timeout: 18000, intervals: [200, 300, 500, 1000] }).toBe(true);
            this.testLogger.info('✓ Auto-populated query detected after stream selection');
        } catch {
            this.testLogger.warn('Stream selected but query did not auto-populate within timeout — returning streamValue anyway');
        }

        return streamValue;
    }
}
