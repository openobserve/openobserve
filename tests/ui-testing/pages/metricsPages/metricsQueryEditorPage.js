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
     * In the metrics page, there are mode buttons: SQL, PromQL, Builder, Custom
     * This function clicks the "Custom" button to enable free-form PromQL query typing.
     *
     * @returns {Promise<boolean>} - True if successfully switched
     */
    async switchToPromQLCustomMode() {
        this.testLogger.info('Switching to PromQL Custom mode...');

        // Close any dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        // Look for the "Custom" button - try multiple selector strategies
        const customButtonSelectors = [
            'button:has-text("Custom")',
            '.q-btn:has-text("Custom")',
            '[data-test*="custom"]',
            'button[class*="custom"]'
        ];

        for (const selector of customButtonSelectors) {
            const customButton = this.page.locator(selector).first();

            if (await customButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                // Check if already active
                const classes = await customButton.getAttribute('class').catch(() => '');
                const isActive = classes.includes('active') || classes.includes('text-primary');

                if (!isActive) {
                    await customButton.click();
                    await this.page.waitForTimeout(1000);
                    this.testLogger.info('✓ Switched to PromQL Custom mode');
                } else {
                    this.testLogger.info('✓ Already in PromQL Custom mode');
                }

                return true;
            }
        }

        // Fallback: Try to find by exact text match
        const exactCustomButton = this.page.getByRole('button', { name: 'Custom', exact: true });
        if (await exactCustomButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await exactCustomButton.click();
            await this.page.waitForTimeout(1000);
            this.testLogger.info('✓ Switched to PromQL Custom mode (via exact match)');
            return true;
        }

        this.testLogger.warn('Could not find Custom mode button - assuming already in custom mode');
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
            '[data-test="index-dropdown-stream"] .q-icon[name="cancel"]',
            '[data-test="index-dropdown-stream"] button[aria-label="Clear"]',
            '[data-test="index-dropdown-stream"] .q-field__append button'
        ];

        for (const selector of clearButtons) {
            const clearBtn = this.page.locator(selector).first();
            if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
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

        // APPROACH 1: Try Monaco API with better error handling
        const monacoSuccess = await this.page.evaluate((queryText) => {
            try {
                // Try multiple ways to access Monaco editor
                const editors = window.monaco?.editor?.getEditors?.();

                if (editors && editors.length > 0) {
                    const editor = editors[0];
                    if (editor && typeof editor.setValue === 'function') {
                        editor.setValue(queryText);
                        // Trigger change event
                        editor.trigger('keyboard', 'type', { text: '' });
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
        }, query).catch(() => false);

        if (monacoSuccess) {
            await this.page.waitForTimeout(800);
            this.testLogger.info('✓ Set query via Monaco API');

            // Verify it worked
            const verifyText = await this.getCurrentQueryText();
            if (verifyText.includes(query.substring(0, 10))) {
                this.testLogger.info('✓ Query verified in editor');
                return;
            } else {
                this.testLogger.warn(`Monaco API succeeded but query doesn't match. Got: ${verifyText}`);
            }
        }

        // APPROACH 2: Direct keyboard input with aggressive clearing
        this.testLogger.info('Using keyboard input approach');

        // Find and click the editor
        const editor = this.page.locator(this.monacoInputAreaSelector).first();

        if (!await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
            this.testLogger.error('Editor not visible - cannot enter query');
            return;
        }

        // Click to focus multiple times
        await editor.click({ force: true });
        await this.page.waitForTimeout(300);
        await editor.click({ force: true });
        await this.page.waitForTimeout(300);

        // Ultra-aggressive clear: try multiple methods
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

        // Method 1: Select all and delete (5 times!)
        for (let i = 0; i < 5; i++) {
            await this.page.keyboard.press(selectAllKey);
            await this.page.waitForTimeout(100);
            await this.page.keyboard.press('Backspace');
            await this.page.waitForTimeout(100);
            await this.page.keyboard.press('Delete');
            await this.page.waitForTimeout(100);
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(100);
        }

        // Method 2: Try to clear via Ctrl+A then type over
        await this.page.keyboard.press(selectAllKey);
        await this.page.waitForTimeout(200);

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
            await this.page.screenshot({ path: `query-mismatch-${Date.now()}.png` }).catch(() => {});
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
                const lineText = await viewLines.nth(i).textContent().catch(() => '');
                fullText += lineText;
            }
            if (fullText.trim().length > 0) {
                return fullText.trim();
            }
        }

        // Approach 2: Try CodeMirror
        const cmContent = this.page.locator('.cm-line').first();
        if (await cmContent.isVisible({ timeout: 1000 }).catch(() => false)) {
            const text = await cmContent.textContent().catch(() => '');
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        // Approach 3: Try textarea value
        const textarea = this.page.locator('.monaco-editor textarea, .monaco-editor .inputarea').first();
        if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
            const text = await textarea.inputValue().catch(() => '');
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        return '';
    }

    /**
     * Switch to a specific query tab
     *
     * @param {number} tabNumber - The tab number to switch to (1-based)
     * @returns {Promise<boolean>} - True if successfully switched
     */
    async switchToTab(tabNumber) {
        // Close any dialogs first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        this.testLogger.info(`Attempting to switch to tab ${tabNumber}`);

        // First, try to find tab by text (Query 1, Query 2, etc.)
        const tabSelector = this.page.locator(this.tabSelector).filter({
            hasText: new RegExp(`Query ${tabNumber}|Tab ${tabNumber}`, 'i')
        }).first();

        if (await tabSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
            await tabSelector.click({ force: true });
            await this.page.waitForTimeout(1500); // Increased wait for UI to update

            // Verify we're on the right tab by checking active state
            const isActive = await tabSelector.evaluate(el => {
                return el.classList.contains('q-tab--active') ||
                       el.getAttribute('aria-selected') === 'true';
            }).catch(() => false);

            if (isActive) {
                this.testLogger.info(`✓ Switched to tab ${tabNumber} (verified active)`);
                return true;
            } else {
                this.testLogger.warn(`Tab ${tabNumber} clicked but not active`);
            }
        }

        // Alternative: try nth-child approach
        // Note: tabs might start at index 0 or have other tabs before query tabs
        const allTabs = this.page.locator(this.tabSelector);
        const tabCount = await allTabs.count();
        this.testLogger.info(`Found ${tabCount} total tabs`);

        // Try to click the specific index (adjusting for 0-based indexing)
        if (tabNumber <= tabCount) {
            const nthTab = allTabs.nth(tabNumber - 1);
            const tabText = await nthTab.textContent().catch(() => '');
            this.testLogger.info(`Clicking tab at index ${tabNumber - 1}: "${tabText}"`);

            await nthTab.click({ force: true });
            await this.page.waitForTimeout(1500);

            // Verify active
            const isActive = await nthTab.evaluate(el => {
                return el.classList.contains('q-tab--active') ||
                       el.getAttribute('aria-selected') === 'true';
            }).catch(() => false);

            if (isActive) {
                this.testLogger.info(`✓ Switched to tab ${tabNumber} via nth (verified active)`);
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
        const selectors = [
            '[data-test="`dashboard-panel-query-tab-add`"]',  // Exact data-test attribute
            'button[data-test*="panel-query-tab-add"]',        // Partial match
            'button.q-btn[icon="add"]',                        // Button with add icon
            'button.q-btn.q-btn--round.q-btn--flat',          // Round flat button (likely the add button)
            '.q-tab__content + button[icon="add"]',           // Add button next to tabs
            'button.q-btn:has(.q-icon[name="add"])',          // Button containing add icon
        ];

        for (const selector of selectors) {
            this.testLogger.info(`Trying selector: ${selector}`);
            const addButton = this.page.locator(selector).first();

            if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
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

        // If specific selectors don't work, try finding any round button with add icon
        const roundButtons = this.page.locator('button.q-btn--round');
        const buttonCount = await roundButtons.count();
        this.testLogger.info(`Found ${buttonCount} round buttons`);

        for (let i = 0; i < buttonCount; i++) {
            const btn = roundButtons.nth(i);
            const hasAddIcon = await btn.locator('.q-icon').evaluate(icon => {
                return icon.textContent === 'add' || icon.getAttribute('aria-label')?.includes('add');
            }).catch(() => false);

            if (hasAddIcon && await btn.isVisible().catch(() => false)) {
                this.testLogger.info(`Found add button at index ${i}`);
                await btn.click({ force: true });
                await this.page.waitForTimeout(1500);
                this.testLogger.info('✓ Added new query tab successfully');
                return true;
            }
        }

        this.testLogger.error('❌ Add query button not found with any selector');
        await this.page.screenshot({ path: `add-button-not-found-${Date.now()}.png` }).catch(() => {});
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
        if (await runQueryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
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

        // Type the new query
        await this.page.keyboard.type(query, { delay: 50 });
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
        await this.page.screenshot({ path: `${prefix}-${Date.now()}.png` }).catch(() => {});
    }
}
