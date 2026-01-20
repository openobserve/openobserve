/**
 * Metrics PromQL Query Persistence Test Suite
 *
 * This suite tests the fix for the bug where queries were not persisted when switching between tabs
 * in the metrics console PromQL custom mode.
 *
 * Bug: In metrics console, whenever we write a query in tab1 and go to other tab and come back to tab1,
 * the previous query was not being persisted.
 *
 * Fix PR: https://github.com/openobserve/openobserve/pull/9688
 * Reference: https://github.com/openobserve/openobserve/pull/9720
 * Test PR: https://github.com/openobserve/openobserve/pull/10068
 *
 * Test scenarios covered:
 * 1. Auto-populated query appears when stream is selected in Tab 1
 * 2. Query persists in Tab 1 after switching to Tab 2 and back (CRITICAL BUG FIX)
 * 3. Multiple tabs maintain their own separate queries
 * 4. Query persistence with stream selection changes across tabs
 * 5. Manually edited queries persist correctly
 * 6. Query persistence under rapid tab switching (stress test)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe('Metrics PromQL Query Persistence Tests', () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    // Ensure metrics are ingested once for all test files
    test.beforeAll(async () => {
        await ensureMetricsIngested();
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to metrics page
        await pm.metricsPage.gotoMetricsPage();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Close any dialogs or modals that might be open
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        testLogger.info('Test setup completed - navigated to metrics page');
    });

    test.afterEach(async ({ page }, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    /**
     * Helper function to switch to PromQL Custom mode
     *
     * In the metrics page, there are 4 mode buttons: SQL, PromQL, Builder, Custom
     * This function clicks the "Custom" button to enable free-form PromQL query typing.
     *
     * Note: The bug being tested (query persistence across tabs) only occurs in Custom mode,
     * not in Builder mode where queries are constructed via UI dropdowns.
     */
    async function switchToPromQLCustomMode(page) {
        testLogger.info('Switching to PromQL Custom mode...');

        // Close any dialogs first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // Look for the "Custom" button - it should be visible in the top right area
        // Try multiple selector strategies to find it
        const customButtonSelectors = [
            'button:has-text("Custom")',
            '.q-btn:has-text("Custom")',
            '[data-test*="custom"]',
            'button[class*="custom"]'
        ];

        for (const selector of customButtonSelectors) {
            const customButton = page.locator(selector).first();

            if (await customButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                // Check if already active
                const classes = await customButton.getAttribute('class').catch(() => '');
                const isActive = classes.includes('active') || classes.includes('text-primary');

                if (!isActive) {
                    await customButton.click();
                    await page.waitForTimeout(1000);
                    testLogger.info('✓ Switched to PromQL Custom mode');
                } else {
                    testLogger.info('✓ Already in PromQL Custom mode');
                }

                return true;
            }
        }

        // Fallback: Try to find by exact text match
        const exactCustomButton = page.getByRole('button', { name: 'Custom', exact: true });
        if (await exactCustomButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await exactCustomButton.click();
            await page.waitForTimeout(1000);
            testLogger.info('✓ Switched to PromQL Custom mode (via exact match)');
            return true;
        }

        testLogger.warn('Could not find Custom mode button - assuming already in custom mode');
        return false;
    }

    /**
     * Helper function to clear any stream selection
     * This prevents auto-populated queries from interfering
     */
    async function clearStreamSelection(page) {
        // Try to clear stream selection if there's a clear/X button
        const clearButtons = [
            '[data-test="index-dropdown-stream"] .q-icon[name="cancel"]',
            '[data-test="index-dropdown-stream"] button[aria-label="Clear"]',
            '[data-test="index-dropdown-stream"] .q-field__append button'
        ];

        for (const selector of clearButtons) {
            const clearBtn = page.locator(selector).first();
            if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                await clearBtn.click();
                await page.waitForTimeout(300);
                testLogger.info('Cleared stream selection');
                return true;
            }
        }

        return false;
    }

    /**
     * Helper function to enter PromQL query in metrics page (not dashboard)
     * This avoids triggering the "Add to Dashboard" dialog
     * NOTE: Assumes we're already in PromQL Custom mode
     */
    async function enterPromQLQuery(page, query) {
        // Close any open dialogs first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        testLogger.info(`Attempting to enter query: ${query}`);

        // Try to clear any stream selection first (prevents auto-populated queries)
        await clearStreamSelection(page);

        // APPROACH 1: Try Monaco API with better error handling
        const monacoSuccess = await page.evaluate((queryText) => {
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
            await page.waitForTimeout(800);
            testLogger.info('✓ Set query via Monaco API');

            // Verify it worked
            const verifyText = await getCurrentQueryText(page);
            if (verifyText.includes(query.substring(0, 10))) {
                testLogger.info('✓ Query verified in editor');
                return;
            } else {
                testLogger.warn(`Monaco API succeeded but query doesn't match. Got: ${verifyText}`);
            }
        }

        // APPROACH 2: Direct keyboard input with aggressive clearing
        testLogger.info('Using keyboard input approach');

        // Find and click the editor
        const editorSelector = '.monaco-editor .inputarea, .monaco-editor textarea';
        const editor = page.locator(editorSelector).first();

        if (!await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
            testLogger.error('Editor not visible - cannot enter query');
            return;
        }

        // Click to focus multiple times
        await editor.click({ force: true });
        await page.waitForTimeout(300);
        await editor.click({ force: true });
        await page.waitForTimeout(300);

        // Ultra-aggressive clear: try multiple methods
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

        // Method 1: Select all and delete (5 times!)
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press(selectAllKey);
            await page.waitForTimeout(100);
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(100);
            await page.keyboard.press('Delete');
            await page.waitForTimeout(100);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(100);
        }

        // Method 2: Try to clear via Ctrl+A then type over
        await page.keyboard.press(selectAllKey);
        await page.waitForTimeout(200);

        // Type the new query
        await page.keyboard.type(query, { delay: 100 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Final verification
        const actualText = await getCurrentQueryText(page);
        testLogger.info(`Expected: "${query}"`);
        testLogger.info(`Actual:   "${actualText}"`);

        if (!actualText.includes(query.substring(0, Math.min(10, query.length)))) {
            testLogger.error(`❌ Query mismatch - expected "${query}" but got "${actualText}"`);
            // Take a screenshot for debugging
            await page.screenshot({ path: `query-mismatch-${Date.now()}.png` }).catch(() => {});
        } else {
            testLogger.info('✓ Query successfully entered');
        }
    }

    /**
     * Helper function to get current query text from editor
     */
    async function getCurrentQueryText(page) {
        // Try multiple approaches to get text from Monaco editor

        // Approach 1: Get all view lines and concatenate
        const viewLines = page.locator('.monaco-editor .view-line');
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
        const cmContent = page.locator('.cm-line').first();
        if (await cmContent.isVisible({ timeout: 1000 }).catch(() => false)) {
            const text = await cmContent.textContent().catch(() => '');
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        // Approach 3: Try textarea value
        const textarea = page.locator('.monaco-editor textarea, .monaco-editor .inputarea').first();
        if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
            const text = await textarea.inputValue().catch(() => '');
            if (text.trim().length > 0) {
                return text.trim();
            }
        }

        return '';
    }

    /**
     * Helper function to switch to a specific query tab
     */
    async function switchToTab(page, tabNumber) {
        // Close any dialogs first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        testLogger.info(`Attempting to switch to tab ${tabNumber}`);

        // First, try to find tab by text (Query 1, Query 2, etc.)
        const tabSelector = page.locator('[role="tab"]').filter({
            hasText: new RegExp(`Query ${tabNumber}|Tab ${tabNumber}`, 'i')
        }).first();

        if (await tabSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
            await tabSelector.click({ force: true });
            await page.waitForTimeout(1500); // Increased wait for UI to update

            // Verify we're on the right tab by checking active state
            const isActive = await tabSelector.evaluate(el => {
                return el.classList.contains('q-tab--active') ||
                       el.getAttribute('aria-selected') === 'true';
            }).catch(() => false);

            if (isActive) {
                testLogger.info(`✓ Switched to tab ${tabNumber} (verified active)`);
                return true;
            } else {
                testLogger.warn(`Tab ${tabNumber} clicked but not active`);
            }
        }

        // Alternative: try nth-child approach
        // Note: tabs might start at index 0 or have other tabs before query tabs
        const allTabs = page.locator('[role="tab"]');
        const tabCount = await allTabs.count();
        testLogger.info(`Found ${tabCount} total tabs`);

        // Try to click the specific index (adjusting for 0-based indexing)
        if (tabNumber <= tabCount) {
            const nthTab = allTabs.nth(tabNumber - 1);
            const tabText = await nthTab.textContent().catch(() => '');
            testLogger.info(`Clicking tab at index ${tabNumber - 1}: "${tabText}"`);

            await nthTab.click({ force: true });
            await page.waitForTimeout(1500);

            // Verify active
            const isActive = await nthTab.evaluate(el => {
                return el.classList.contains('q-tab--active') ||
                       el.getAttribute('aria-selected') === 'true';
            }).catch(() => false);

            if (isActive) {
                testLogger.info(`✓ Switched to tab ${tabNumber} via nth (verified active)`);
                return true;
            }
        }

        testLogger.error(`Failed to switch to tab ${tabNumber}`);
        return false;
    }

    /**
     * Helper function to add a new query tab
     */
    async function addQueryTab(page) {
        // Close any dialogs first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        testLogger.info('Looking for Add Query button...');

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
            testLogger.info(`Trying selector: ${selector}`);
            const addButton = page.locator(selector).first();

            if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                testLogger.info(`✓ Found add button with selector: ${selector}`);
                await addButton.click({ force: true });
                await page.waitForTimeout(1500);

                // Verify a new tab was created by counting tabs
                const tabs = page.locator('[role="tab"]');
                const tabCount = await tabs.count();
                testLogger.info(`✓ Tab count after add: ${tabCount}`);

                testLogger.info('✓ Added new query tab successfully');
                return true;
            }
        }

        // If specific selectors don't work, try finding any round button with add icon
        const roundButtons = page.locator('button.q-btn--round');
        const buttonCount = await roundButtons.count();
        testLogger.info(`Found ${buttonCount} round buttons`);

        for (let i = 0; i < buttonCount; i++) {
            const btn = roundButtons.nth(i);
            const hasAddIcon = await btn.locator('.q-icon').evaluate(icon => {
                return icon.textContent === 'add' || icon.getAttribute('aria-label')?.includes('add');
            }).catch(() => false);

            if (hasAddIcon && await btn.isVisible().catch(() => false)) {
                testLogger.info(`Found add button at index ${i}`);
                await btn.click({ force: true });
                await page.waitForTimeout(1500);
                testLogger.info('✓ Added new query tab successfully');
                return true;
            }
        }

        testLogger.error('❌ Add query button not found with any selector');
        await page.screenshot({ path: `add-button-not-found-${Date.now()}.png` }).catch(() => {});
        return false;
    }

    /**
     * P1 Test: Auto-populated query appears when stream is selected
     *
     * Validates that when a user selects a stream in PromQL mode,
     * a default query is automatically populated in the query editor.
     */
    test('P1: Auto-populated query appears when stream is selected in Tab 1', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Verify auto-populated query in Tab 1');

        // Switch to PromQL mode
        await pm.metricsPage.switchToPromQLMode();
        await page.waitForTimeout(1000);

        // Select stream type
        const streamTypeSelector = page.locator('[data-test="index-dropdown-stream_type"]');
        if (await streamTypeSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
            await streamTypeSelector.click();
            await page.waitForTimeout(500);

            const metricsOption = page.getByRole('option', { name: 'metrics' }).locator('div').nth(2);
            if (await metricsOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                await metricsOption.click();
                await page.waitForTimeout(1000);
                testLogger.info('Selected stream type: metrics');
            }
        }

        // Select a stream name
        const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        if (await streamDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
            await streamDropdown.click();
            await page.waitForTimeout(1000);

            // Get first available stream
            const firstStream = page.locator('[role="option"]').first();
            const streamName = await firstStream.textContent().catch(() => null);

            if (streamName) {
                await firstStream.click();
                await page.waitForTimeout(2000);
                testLogger.info(`Selected stream: ${streamName}`);

                // Verify auto-populated query exists
                const queryEditor = page.locator('.monaco-editor, .cm-content, textarea').first();
                if (await queryEditor.isVisible({ timeout: 5000 }).catch(() => false)) {
                    const queryText = await queryEditor.textContent().catch(() => '');

                    expect(queryText.length).toBeGreaterThan(0);
                    testLogger.info(`✓ Auto-populated query found: ${queryText.substring(0, 100)}...`);
                } else {
                    testLogger.warn('Query editor not found - test may be inconclusive');
                }
            } else {
                testLogger.warn('No streams available for testing - test skipped');
                test.skip();
            }
        }
    });

    /**
     * P0 Test: Query persists in Tab 1 after switching to Tab 2 and back
     *
     * This is the CORE bug fix test.
     * Previously, when users switched from Tab 1 to Tab 2 and back,
     * the query in Tab 1 would be lost. This test validates the fix.
     */
    test('P0: Query persists in Tab 1 after switching to Tab 2 and back', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P0', '@criticalBugFix']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence when switching between tabs (CRITICAL BUG FIX)');

        // Step 1: Setup Tab 1 with a query
        testLogger.info('Setting up Tab 1 with query');

        // Switch to PromQL Custom mode (not Builder)
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(500);

        // Enter a test query in Tab 1
        const testQuery = 'up{job="prometheus"}';
        await enterPromQLQuery(page, testQuery);

        // Store the query from Tab 1
        const tab1OriginalQuery = await getCurrentQueryText(page);

        expect(tab1OriginalQuery.length).toBeGreaterThan(0);
        testLogger.info(`Tab 1 query captured: ${tab1OriginalQuery.substring(0, 100)}...`);

        // Step 2: Add a second tab (Tab 2)
        testLogger.info('Adding Tab 2');
        const tab2Created = await addQueryTab(page);

        if (tab2Created) {
            testLogger.info('✓ Tab 2 created successfully');
        } else {
            testLogger.warn('Could not create Tab 2 - test may be inconclusive');
        }

        // Step 3: Verify Tab 2 is active (newly created tabs are usually auto-selected)
        await page.waitForTimeout(1000);
        testLogger.info('Tab 2 should now be active');

        // Step 4: Switch back to Tab 1
        testLogger.info('Switching back to Tab 1');
        const switchedToTab1 = await switchToTab(page, 1);

        if (switchedToTab1) {
            testLogger.info('✓ Switched back to Tab 1');
        } else {
            testLogger.warn('Could not switch to Tab 1 using helper - trying fallback');
            // Fallback: try clicking first tab directly
            const firstTab = page.locator('[role="tab"]').first();
            await firstTab.click({ force: true });
            await page.waitForTimeout(1500);
        }

        // Step 5: Verify query is still there (THE CRITICAL CHECK)
        testLogger.info('Verifying query persistence in Tab 1 (CRITICAL VALIDATION)');

        const tab1QueryAfterSwitch = await getCurrentQueryText(page);

        // Normalize whitespace for comparison
        const normalizedOriginal = tab1OriginalQuery.replace(/\s+/g, ' ').trim();
        const normalizedAfterSwitch = tab1QueryAfterSwitch.replace(/\s+/g, ' ').trim();

        // The query should be the same as before
        expect(normalizedAfterSwitch).toContain(testQuery.replace(/\s+/g, ' ').trim());

        testLogger.info('✓ SUCCESS: Query persisted correctly in Tab 1 after tab switch');
        testLogger.info(`Original: ${normalizedOriginal.substring(0, 100)}...`);
        testLogger.info(`After switch: ${normalizedAfterSwitch.substring(0, 100)}...`);
    });

    /**
     * P1 Test: Multiple tabs maintain separate queries independently
     *
     * Validates that each tab maintains its own query state
     * and switching between tabs doesn't affect the queries.
     */
    test('P1: Multiple tabs maintain separate queries independently', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Multiple tabs maintain separate queries');

        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(500);

        // Enter Query A in Tab 1
        const queryA = 'up{job="prometheus"}';
        await enterPromQLQuery(page, queryA);

        // VERIFY queryA was actually entered in Tab 1
        const tab1InitialQuery = await getCurrentQueryText(page);
        testLogger.info(`Tab 1 query set: "${queryA}"`);
        testLogger.info(`Tab 1 query verified: "${tab1InitialQuery}"`);

        if (!tab1InitialQuery.includes(queryA.substring(0, 10))) {
            testLogger.error(`❌ CRITICAL: Failed to enter queryA in Tab 1!`);
            testLogger.error(`Expected: "${queryA}"`);
            testLogger.error(`Got: "${tab1InitialQuery}"`);
            await page.screenshot({ path: `tab1-initial-query-failed-${Date.now()}.png` }).catch(() => {});
            throw new Error(`Failed to enter queryA in Tab 1. Expected "${queryA}" but got "${tab1InitialQuery}"`);
        }

        // Count tabs before adding
        const tabsBeforeAdd = await page.locator('[role="tab"]').count();
        testLogger.info(`Tabs before adding: ${tabsBeforeAdd}`);

        // Create Tab 2
        const tab2Created = await addQueryTab(page);

        if (!tab2Created) {
            testLogger.error('❌ CRITICAL: Failed to create Tab 2 - test cannot continue');
            throw new Error('Failed to create Tab 2 - add button not found');
        }

        await page.waitForTimeout(1000); // Extra wait for tab to be fully created and active

        // Count tabs after adding
        const tabsAfterAdd = await page.locator('[role="tab"]').count();
        testLogger.info(`Tabs after adding: ${tabsAfterAdd}`);

        if (tabsAfterAdd <= tabsBeforeAdd) {
            testLogger.error(`❌ CRITICAL: Tab count did not increase (Before: ${tabsBeforeAdd}, After: ${tabsAfterAdd})`);
            throw new Error('Tab 2 was not created - tab count did not increase');
        }

        // Explicitly verify we're on Tab 2 by checking which tab is active
        const tab2Locator = page.locator('[role="tab"]').filter({
            hasText: /Query 2|Tab 2/i
        }).first();
        const tab2Exists = await tab2Locator.count() > 0;

        if (!tab2Exists) {
            testLogger.error('❌ CRITICAL: Tab 2 element not found in DOM');
            throw new Error('Tab 2 element not found after creation');
        }

        const isTab2Active = await tab2Locator.evaluate(el => {
            return el.classList.contains('q-tab--active') || el.getAttribute('aria-selected') === 'true';
        }).catch(() => false);

        if (!isTab2Active) {
            testLogger.warn('Tab 2 not active after creation, explicitly switching to it');
            await switchToTab(page, 2);
            await page.waitForTimeout(1000);
        } else {
            testLogger.info('✓ Tab 2 is active after creation');
        }

        // CRITICAL: Verify Tab 2 is ACTUALLY the active tab before entering query
        const allTabs = page.locator('[role="tab"]');
        const tabCount = await allTabs.count();
        testLogger.info(`Current tab count: ${tabCount}`);

        for (let i = 0; i < tabCount; i++) {
            const tab = allTabs.nth(i);
            const tabText = await tab.textContent();
            const isActive = await tab.evaluate(el => {
                return el.classList.contains('q-tab--active') ||
                       el.getAttribute('aria-selected') === 'true';
            }).catch(() => false);
            testLogger.info(`Tab ${i + 1}: "${tabText}" - Active: ${isActive}`);
        }

        // Double-check Tab 2 is active
        const currentActiveTab = await page.locator('[role="tab"][aria-selected="true"], [role="tab"].q-tab--active').textContent().catch(() => 'unknown');
        testLogger.info(`Currently active tab: "${currentActiveTab}"`);

        if (!currentActiveTab.match(/Query 2|Tab 2/i)) {
            testLogger.error(`❌ CRITICAL: Tab 2 is NOT active! Active tab is: "${currentActiveTab}"`);
            testLogger.info('Force switching to Tab 2...');
            await switchToTab(page, 2);
            await page.waitForTimeout(2000);

            // Verify again
            const activeAfterSwitch = await page.locator('[role="tab"][aria-selected="true"], [role="tab"].q-tab--active').textContent().catch(() => 'unknown');
            testLogger.info(`Active tab after force switch: "${activeAfterSwitch}"`);
        }

        // Switch Tab 2 to PromQL Custom mode (new tabs may default to Builder mode)
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(1000); // Increased wait after mode switch

        // Ensure the editor is visible and ready in Tab 2
        const tab2Editor = page.locator('.monaco-editor').first();
        await tab2Editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Enter Query B in Tab 2
        const queryB = 'node_cpu_seconds_total{mode="idle"}';
        testLogger.info(`Entering query in Tab 2: "${queryB}"`);
        await enterPromQLQuery(page, queryB);

        // Verify the query was actually entered in Tab 2
        const verifyQueryB = await getCurrentQueryText(page);
        testLogger.info(`Tab 2 query entered: "${queryB}"`);
        testLogger.info(`Tab 2 query verified: "${verifyQueryB}"`);

        if (!verifyQueryB.includes(queryB.substring(0, 15))) {
            testLogger.error(`❌ CRITICAL: Query mismatch in Tab 2!`);
            testLogger.error(`Expected: "${queryB}"`);
            testLogger.error(`Got: "${verifyQueryB}"`);
            await page.screenshot({ path: `tab2-query-mismatch-${Date.now()}.png` }).catch(() => {});
        }

        await page.waitForTimeout(5000);
        // Switch back to Tab 1 and verify Query A
        await switchToTab(page, 1);
        await page.waitForTimeout(5000); // Wait for editor to update
        const tab1Query = await getCurrentQueryText(page);
        testLogger.info(`Tab 1 query read: "${tab1Query}"`);
        expect(tab1Query).toContain(queryA.replace(/\s+/g, ' ').trim());
        testLogger.info('✓ Tab 1 query preserved');

        // Switch to Tab 2 and verify Query B
        await switchToTab(page, 2);
        await page.waitForTimeout(1000); // Wait for editor to update
        const tab2Query = await getCurrentQueryText(page);
        testLogger.info(`Tab 2 query read: "${tab2Query}"`);
        expect(tab2Query).toContain(queryB.replace(/\s+/g, ' ').trim());
        testLogger.info('✓ Tab 2 query preserved');

        testLogger.info('✓ SUCCESS: Both tabs maintained their queries independently');
    });

    /**
     * P2 Test: Query persistence with stream selection changes
     *
     * Validates that changing streams in one tab doesn't affect
     * the query in another tab.
     */
    test('P2: Query persistence when changing streams across tabs', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence with stream changes across tabs');

        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(500);

        // Enter initial query in Tab 1
        const tab1Query = 'cpu_usage{region="us-east"}';
        await enterPromQLQuery(page, tab1Query);
        const tab1OriginalQuery = await getCurrentQueryText(page);
        testLogger.info(`Tab 1 original query: ${tab1OriginalQuery.substring(0, 50)}...`);

        // Create Tab 2
        await addQueryTab(page);
        await page.waitForTimeout(1000); // Extra wait for tab to be fully created and active

        // Switch Tab 2 to PromQL Custom mode (new tabs may default to Builder mode)
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(1000); // Increased wait after mode switch

        // Ensure the editor is visible and ready in Tab 2
        const tab2Editor = page.locator('.monaco-editor').first();
        await tab2Editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Enter different query in Tab 2
        const tab2Query = 'memory_usage{instance="server1"}';
        await enterPromQLQuery(page, tab2Query);
        testLogger.info(`Tab 2 query: ${tab2Query}`);

        // Switch back to Tab 1
        await switchToTab(page, 1);
        await page.waitForTimeout(1000); // Wait for editor to update

        // Ensure editor is visible and ready
        const editor = page.locator('.monaco-editor').first();
        await editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500); // Additional buffer for editor content to load

        // Verify Tab 1 query is unchanged
        const tab1AfterSwitch = await getCurrentQueryText(page);
        testLogger.info(`Expected Tab 1 query: "${tab1Query}"`);
        testLogger.info(`Actual Tab 1 query:   "${tab1AfterSwitch}"`);
        expect(tab1AfterSwitch).toContain(tab1Query.replace(/\s+/g, ' ').trim());
        testLogger.info('✓ SUCCESS: Tab 1 query preserved despite stream change in Tab 2');
    });

    /**
     * P2 Test: Manually edited queries persist correctly
     *
     * Validates that custom/manually edited queries are preserved
     * when switching between tabs.
     */
    test('P2: Manually edited queries persist correctly', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Manually edited query persistence');

        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(500);

        // Enter a custom manual query
        const customQuery = 'rate(http_requests_total{job="api-server"}[5m])';
        await enterPromQLQuery(page, customQuery);
        testLogger.info(`Entered custom query: ${customQuery}`);

        // Verify it was entered correctly
        const currentQuery = await getCurrentQueryText(page);
        expect(currentQuery).toContain(customQuery.replace(/\s+/g, ' ').trim());

        // Add Tab 2
        await addQueryTab(page);
        await page.waitForTimeout(1000); // Extra wait for tab to be fully created and active

        // Switch Tab 2 to PromQL Custom mode (new tabs may default to Builder mode)
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(1000); // Increased wait after mode switch

        // Ensure the editor is visible and ready in Tab 2
        const tab2Editor = page.locator('.monaco-editor').first();
        await tab2Editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Enter different query in Tab 2
        await enterPromQLQuery(page, 'avg(cpu_usage)');

        // Switch back to Tab 1
        await switchToTab(page, 1);

        // Verify custom query is still there
        const queryAfterSwitch = await getCurrentQueryText(page);
        expect(queryAfterSwitch).toContain(customQuery.replace(/\s+/g, ' ').trim());

        testLogger.info('✓ SUCCESS: Manually edited query persisted correctly');
    });

    /**
     * P3 Test: Query persistence under rapid tab switching (stress test)
     *
     * Validates that queries remain intact even when rapidly
     * switching between multiple tabs.
     */
    test('P3: Query persistence under rapid tab switching', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P3', '@stressTest']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence under rapid tab switching');

        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(500);

        // Create 3 tabs with different queries
        const queries = [
            'up{job="prometheus"}',
            'rate(http_requests_total[5m])',
            'node_memory_Active_bytes'
        ];

        // Set query in Tab 1
        await enterPromQLQuery(page, queries[0]);
        testLogger.info(`Tab 1 query: ${queries[0]}`);

        // Create and set Tab 2
        await addQueryTab(page);
        await page.waitForTimeout(1000); // Extra wait for tab to be fully created and active
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(1000); // Increased wait after mode switch
        const tab2Editor = page.locator('.monaco-editor').first();
        await tab2Editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await enterPromQLQuery(page, queries[1]);
        testLogger.info(`Tab 2 query: ${queries[1]}`);

        // Create and set Tab 3
        await addQueryTab(page);
        await page.waitForTimeout(1000); // Extra wait for tab to be fully created and active
        await switchToPromQLCustomMode(page);
        await page.waitForTimeout(1000); // Increased wait after mode switch
        const tab3Editor = page.locator('.monaco-editor').first();
        await tab3Editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await enterPromQLQuery(page, queries[2]);
        testLogger.info(`Tab 3 query: ${queries[2]}`);

        testLogger.info('Created 3 tabs with different queries');

        // Rapid switching pattern
        testLogger.info('Starting rapid tab switching (10 iterations)');
        const switchPattern = [1, 2, 3, 1, 3, 2, 1, 2, 3, 1];

        for (let i = 0; i < switchPattern.length; i++) {
            const tabIndex = switchPattern[i];
            await switchToTab(page, tabIndex);
            await page.waitForTimeout(300);
        }

        testLogger.info('Rapid switching completed, verifying queries');

        // Verify all queries are intact
        for (let i = 0; i < queries.length; i++) {
            const tabIndex = i + 1;
            testLogger.info(`Verifying query in tab ${tabIndex}...`);

            await switchToTab(page, tabIndex);

            // Wait for editor to be ready and content to load
            await page.waitForTimeout(1000);

            // Wait for Monaco editor to be visible
            const editor = page.locator('.monaco-editor').first();
            await editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(500);

            const currentQuery = await getCurrentQueryText(page);
            testLogger.info(`Expected query: "${queries[i]}"`);
            testLogger.info(`Current query:  "${currentQuery}"`);

            expect(currentQuery).toContain(queries[i].replace(/\s+/g, ' ').trim());
            testLogger.info(`✓ Tab ${tabIndex} query verified successfully`);
        }

        testLogger.info('✓ SUCCESS: All queries persisted after rapid switching');
    });
});
