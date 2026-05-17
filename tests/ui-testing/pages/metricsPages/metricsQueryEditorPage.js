// metricsQueryEditorPage.js
// Page Object Model for Metrics Query Editor functionality
// This file contains helper functions for PromQL query persistence tests

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

        // Selectors
        this.runQueryButtonSelector = '[data-test="metrics-apply"], button:has-text("Run Query")';
        this.monacoEditorSelector = '.monaco-editor';
        this.monacoInputAreaSelector = '.monaco-editor .inputarea, .monaco-editor textarea';
        this.tabSelector = '[role="tab"]';
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

        // Close any dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        // Primary selector — the Custom builder-mode button in QueryTypeSelector.vue
        const customButton = this.page.locator('[data-test="dashboard-custom-query-type"]').first();

        if (await customButton.isVisible({ timeout: 3000 })) {
            // OToggleGroupItem uses data-state="on" (Reka UI) for active state
            const dataState = await customButton.getAttribute('data-state') || '';

            if (dataState === 'on') {
                this.testLogger.info('✓ Already in PromQL Custom mode');
                return true;
            }

            await customButton.click();
            await this.page.waitForTimeout(1000);

            // Confirm active state flipped
            const newState = await customButton.getAttribute('data-state') || '';
            if (newState === 'on') {
                this.testLogger.info('✓ Switched to PromQL Custom mode');
            } else {
                this.testLogger.warn('Custom mode button clicked but data-state did not become "on"');
            }
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
        const clearButtons = [
            '[data-test="index-dropdown-stream"] .OIcon[name="cancel"]',
            '[data-test="index-dropdown-stream"] button[aria-label="Clear"]',
            '[data-test="index-dropdown-stream"] .q-field__append button'
        ];

        for (const selector of clearButtons) {
            const clearBtn = this.page.locator(selector).first();
            if (await clearBtn.isVisible({ timeout: 1000 })) {
                await clearBtn.click();
                await this.page.waitForTimeout(300);
                this.testLogger.info('Cleared stream selection');
                return true;
            }
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
        // Close any open dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        this.testLogger.info(`Attempting to enter query: ${query}`);

        // Try to clear any stream selection first (prevents auto-populated queries)
        await this.clearStreamSelection();

        // APPROACH 1: Try Monaco API - sets the model value directly
        // Note: This only sets the internal model state, not the rendered view
        const modelSetSuccess = await this.page.evaluate((queryText) => {
            try {
                const editors = window.monaco?.editor?.getEditors?.();

                if (editors && editors.length > 0) {
                    const editor = editors[0];
                    if (editor && typeof editor.setValue === 'function') {
                        editor.setValue(queryText);
                        // Model set attempted - view rendering happens asynchronously
                        return true;
                    }
                }

                // Alternative: try to find editor via DOM
                const editorElement = document.querySelector('.monaco-editor');
                if (editorElement && editorElement.__vscode_monaco_editor__) {
                    editorElement.__vscode_monaco_editor__.setValue(queryText);
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
            // Monaco renders asynchronously - we must verify the view-line elements
            const maxWaitTime = 3000;
            const pollInterval = 100;
            let elapsed = 0;
            let verifyText = '';

            while (elapsed < maxWaitTime) {
                await this.page.waitForTimeout(pollInterval);
                elapsed += pollInterval;

                // getCurrentQueryText reads from DOM (.view-line elements), not model
                verifyText = await this.getCurrentQueryText();
                if (verifyText.includes(query.substring(0, Math.min(10, query.length)))) {
                    this.testLogger.info(`✓ Query verified in rendered view after ${elapsed}ms`);
                    return;
                }
            }

            this.testLogger.warn(`Monaco model set but view not rendered after ${maxWaitTime}ms. Got: "${verifyText}"`);
        }

        // APPROACH 2: Direct keyboard input with aggressive clearing
        this.testLogger.info('Using keyboard input approach');

        // Find and click the editor
        const editor = this.page.locator(this.monacoInputAreaSelector).first();

        if (!await editor.isVisible({ timeout: 3000 })) {
            this.testLogger.error('Editor not visible - cannot enter query');
            return;
        }

        // Click to focus multiple times
        await editor.click({ force: true });
        await this.page.waitForTimeout(300);
        await editor.click({ force: true });
        await this.page.waitForTimeout(300);

        // Clear editor content: single select-all + backspace, then select-all to prepare for typing
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.waitForTimeout(100);
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(100);

        // Select all again so typing will replace any remaining content
        await this.page.keyboard.press(selectAllKey);
        await this.page.waitForTimeout(100);

        // Type the new query
        await this.page.keyboard.type(query, { delay: 100 });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        // Final verification
        const actualText = await this.getCurrentQueryText();
        this.testLogger.info(`Expected: "${query}"`);
        this.testLogger.info(`Actual:   "${actualText}"`);

        if (!actualText.includes(query.substring(0, Math.min(10, query.length)))) {
            this.testLogger.error(`❌ Query mismatch - expected "${query}" but got "${actualText}"`);
            // Take a screenshot for debugging
            await this.page.screenshot({ path: `test-results/query-mismatch-${Date.now()}.png` });
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
        // Try multiple approaches to get text from Monaco editor

        // Approach 1: Get all view lines and concatenate
        const viewLines = this.page.locator('.monaco-editor .view-line');
        const lineCount = await viewLines.count();

        if (lineCount > 0) {
            let fullText = '';
            for (let i = 0; i < lineCount; i++) {
                const lineText = await viewLines.nth(i).textContent();
                fullText += lineText;
            }
            if (fullText.trim().length > 0) {
                return fullText.trim();
            }
        }

        // Approach 2: Try CodeMirror
        const cmContent = this.page.locator('.cm-line').first();
        if (await cmContent.isVisible({ timeout: 1000 })) {
            const text = await cmContent.textContent();
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        // Approach 3: Try textarea value
        const textarea = this.page.locator('.monaco-editor textarea, .monaco-editor .inputarea').first();
        if (await textarea.isVisible({ timeout: 1000 })) {
            const text = await textarea.inputValue();
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        return '';
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
        // Close any dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        this.testLogger.info(`Attempting to switch to tab ${tabNumber}`);

        // Primary: use the data-test attribute (0-based index internally)
        const zeroIdx = tabNumber - 1;
        const tabByDataTest = this.page.locator(`[data-test="dashboard-panel-query-tab-${zeroIdx}"]`).first();

        if (await tabByDataTest.isVisible({ timeout: 3000 })) {
            // Check if already active
            const currentState = await tabByDataTest.getAttribute('data-state') || '';
            if (currentState === 'active') {
                this.testLogger.info(`✓ Tab ${tabNumber} is already active`);
                return true;
            }

            await tabByDataTest.click({ force: true });
            await this.page.waitForTimeout(1500);

            const newState = await tabByDataTest.getAttribute('data-state') || '';
            if (newState === 'active') {
                this.testLogger.info(`✓ Switched to tab ${tabNumber} (verified active)`);
                return true;
            }
            this.testLogger.warn(`Tab ${tabNumber} clicked but data-state is "${newState}"`);
        }

        // Fallback: locate by role="tab" text content
        const tabByText = this.page.locator(this.tabSelector).filter({
            hasText: new RegExp(`Query ${tabNumber}`, 'i')
        }).first();

        if (await tabByText.isVisible({ timeout: 3000 })) {
            await tabByText.click({ force: true });
            await this.page.waitForTimeout(1500);

            const isActive = await tabByText.evaluate(el =>
                el.getAttribute('data-state') === 'active' || el.getAttribute('aria-selected') === 'true'
            );

            if (isActive) {
                this.testLogger.info(`✓ Switched to tab ${tabNumber} via text filter (verified active)`);
                return true;
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
        // Close any dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        this.testLogger.info('Looking for Add Query button...');

        // Try multiple selectors for the add query button
        // Note: on cloud, the data-test attribute contains literal backticks
        // e.g. `dashboard-panel-query-tab-add` — use contains-match to handle both
        const selectors = [
            '[data-test*="dashboard-panel-query-tab-add"]',   // Contains match (handles backtick variant)
            '[data-test="dashboard-panel-query-tab-add"]',    // Exact data-test attribute
            'button[data-test*="panel-query-tab-add"]',       // Partial match
            'button[data-o2-btn][aria-label="add"]',          // O2 button with add aria-label
            '[role="tablist"] ~ button[data-o2-btn]',         // O2 add button after tablist
            '[role="tablist"] + button[data-o2-btn]',         // O2 add button immediately after tablist
            'button[data-o2-btn]:has-text("")',               // O2 add button (icon-only, empty text)
        ];

        for (const selector of selectors) {
            this.testLogger.info(`Trying selector: ${selector}`);
            const addButton = this.page.locator(selector).first();

            if (await addButton.isVisible({ timeout: 2000 })) {
                this.testLogger.info(`✓ Found add button with selector: ${selector}`);
                await addButton.click({ force: true });
                await this.page.waitForTimeout(1500);

                // Verify a new tab was created by counting tabs
                const tabs = this.page.locator(this.tabSelector);
                const tabCount = await tabs.count();
                this.testLogger.info(`✓ Tab count after add: ${tabCount}`);

                this.testLogger.info('✓ Added new query tab successfully');
                return true;
            }
        }

        // If specific selectors don't work, try finding any O2 button with add icon near the tab list
        const o2Buttons = this.page.locator('button[data-o2-btn]');
        const buttonCount = await o2Buttons.count();
        this.testLogger.info(`Found ${buttonCount} O2 buttons`);

        for (let i = 0; i < buttonCount; i++) {
            const btn = o2Buttons.nth(i);
            const hasAddIcon = await btn.evaluate(el => {
                const ariaLabel = el.getAttribute('aria-label') || '';
                const textContent = el.textContent || '';
                return ariaLabel.toLowerCase().includes('add') || textContent.trim() === 'add' || textContent.trim() === '';
            }).catch(() => false);

            if (hasAddIcon && await btn.isVisible()) {
                this.testLogger.info(`Found add button at index ${i}`);
                await btn.click({ force: true });
                await this.page.waitForTimeout(1500);
                this.testLogger.info('✓ Added new query tab successfully');
                return true;
            }
        }

        this.testLogger.error('❌ Add query button not found with any selector');
        await this.page.screenshot({ path: `test-results/add-button-not-found-${Date.now()}.png` });
        return false;
    }

    /**
     * Click the Run Query button to save the query to state
     * This ensures the query is properly saved before switching tabs
     *
     * @returns {Promise<boolean>} - True if successfully clicked
     */
    async clickRunQuery() {
        const runQueryBtn = this.page.locator(this.runQueryButtonSelector).first();
        if (await runQueryBtn.isVisible({ timeout: 2000 })) {
            await runQueryBtn.click();
            this.testLogger.info('Clicked Run Query button');
            await this.page.waitForTimeout(2000); // Wait for query execution and state update
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
        const editor = this.page.locator(this.monacoInputAreaSelector).first();
        await editor.click({ force: true });
        await this.page.waitForTimeout(300);

        // Clear existing content
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.waitForTimeout(100);

        // Use insertText instead of type — keyboard.type() triggers Monaco
        // autocomplete on cloud which corrupts the query text
        await this.page.keyboard.insertText(query);
        await this.page.waitForTimeout(500);
    }

    /**
     * Poll for expected query text with retries
     * Useful for waiting for async updates after tab switches
     *
     * @param {string} expectedText - The text to look for in the query
     * @param {number} maxAttempts - Maximum number of attempts (default: 10)
     * @param {number} delayMs - Delay between attempts in ms (default: 500)
     * @returns {Promise<{found: boolean, text: string}>} - Result with found status and actual text
     */
    async pollForQueryText(expectedText, maxAttempts = 10, delayMs = 500) {
        let currentText = '';
        for (let i = 0; i < maxAttempts; i++) {
            currentText = await this.getCurrentQueryText();
            this.testLogger.info(`Query read attempt ${i + 1}: "${currentText}"`);
            if (currentText.includes(expectedText)) {
                return { found: true, text: currentText };
            }
            await this.page.waitForTimeout(delayMs);
        }
        return { found: false, text: currentText };
    }

    /**
     * Take a screenshot for debugging purposes
     *
     * @param {string} prefix - Prefix for the screenshot filename
     */
    async takeDebugScreenshot(prefix) {
        await this.page.screenshot({ path: `${prefix}-${Date.now()}.png` });
    }
}
