/**
 * MonacoEditorHelper - Utility class for Monaco editor interactions
 *
 * Encapsulates Monaco-specific selectors and interactions to:
 * 1. Keep spec files clean (POM compliance)
 * 2. Centralize Monaco selector changes if Monaco version updates
 * 3. Provide consistent interaction patterns across tests
 *
 * Note: Monaco editor is a third-party component. These selectors
 * may need updates when Monaco version changes.
 */

class MonacoEditorHelper {
    /**
     * @param {import('@playwright/test').Page} page - Playwright page object
     */
    constructor(page) {
        this.page = page;

        // Monaco editor selectors (third-party component)
        this.selectors = {
            editor: '.monaco-editor',
            viewLines: '.monaco-editor .view-lines',
            inputArea: '.monaco-editor textarea.inputarea',
            suggestWidget: '.monaco-editor .suggest-widget',
            suggestionRows: '.monaco-editor .suggest-widget .monaco-list-row',
            suggestionLabel: '.label-name, .monaco-icon-label-container',
        };
    }

    /**
     * Get the Monaco editor within a container
     * @param {import('@playwright/test').Locator} container - Container locator with data-test attribute
     * @returns {import('@playwright/test').Locator}
     */
    getEditor(container) {
        return container.locator(this.selectors.viewLines).first();
    }

    /**
     * Get the input area (textarea) within a container
     * @param {import('@playwright/test').Locator} container - Container locator
     * @returns {import('@playwright/test').Locator}
     */
    getInputArea(container) {
        return container.locator(this.selectors.inputArea);
    }

    /**
     * Click into the Monaco editor to focus it
     * @param {import('@playwright/test').Locator} container - Container locator
     */
    async focus(container) {
        const inputArea = this.getInputArea(container);
        if (await inputArea.count() > 0) {
            await inputArea.focus();
        } else {
            const editor = this.getEditor(container);
            await editor.click({ force: true });
        }
    }

    /**
     * Clear all content from the Monaco editor
     * @param {import('@playwright/test').Locator} container - Container locator
     */
    async clear(container) {
        await this.focus(container);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Backspace');
    }

    /**
     * Type text into the Monaco editor
     * @param {import('@playwright/test').Locator} container - Container locator
     * @param {string} text - Text to type
     */
    async type(container, text) {
        await this.focus(container);
        await this.page.keyboard.type(text);
    }

    /**
     * Set content in the Monaco editor (clears first, then types)
     * @param {import('@playwright/test').Locator} container - Container locator
     * @param {string} content - Content to set
     */
    async setContent(container, content) {
        await this.clear(container);
        await this.page.keyboard.type(content);
    }

    /**
     * Get the text content of the Monaco editor
     * @param {import('@playwright/test').Locator} container - Container locator
     * @returns {Promise<string>}
     */
    async getContent(container) {
        const viewLines = container.locator(this.selectors.viewLines);
        return await viewLines.textContent();
    }

    /**
     * Trigger autocomplete suggestions (Ctrl+Space)
     */
    async triggerSuggestions() {
        await this.page.keyboard.press('Control+Space');
    }

    /**
     * Wait for the suggestions widget to be visible
     * @param {number} timeout - Timeout in milliseconds (default 5000)
     * @returns {Promise<import('@playwright/test').Locator>}
     */
    async waitForSuggestions(timeout = 5000) {
        const suggestWidget = this.page.locator(this.selectors.suggestWidget);
        await suggestWidget.waitFor({ state: 'visible', timeout });
        return suggestWidget;
    }

    /**
     * Check if suggestions widget is visible
     * @returns {Promise<boolean>}
     */
    async isSuggestionsVisible() {
        const suggestWidget = this.page.locator(this.selectors.suggestWidget);
        return await suggestWidget.isVisible();
    }

    /**
     * Get all suggestion labels from the autocomplete widget
     * @param {number} timeout - Timeout to wait for suggestions (default 5000)
     * @returns {Promise<string[]>}
     */
    async getSuggestionLabels(timeout = 5000) {
        const suggestionRows = this.page.locator(this.selectors.suggestionRows);
        await suggestionRows.first().waitFor({ state: 'visible', timeout });

        const labels = await suggestionRows
            .locator(this.selectors.suggestionLabel)
            .allTextContents();

        return labels.map(l => l.trim()).filter(l => l.length > 0);
    }

    /**
     * Check if suggestions contain a specific value
     * @param {string} value - Value to search for
     * @returns {Promise<boolean>}
     */
    async suggestionsContain(value) {
        const labels = await this.getSuggestionLabels();
        return labels.some(label => label.includes(value));
    }

    /**
     * Select a suggestion by text
     * @param {string} text - Text of the suggestion to select
     */
    async selectSuggestion(text) {
        const suggestionRow = this.page.locator(
            `${this.selectors.suggestionRows}:has-text("${text}")`
        ).first();
        await suggestionRow.click();
    }

    /**
     * Dismiss the suggestions widget by pressing Escape
     */
    async dismissSuggestions() {
        await this.page.keyboard.press('Escape');
    }
}

module.exports = MonacoEditorHelper;
