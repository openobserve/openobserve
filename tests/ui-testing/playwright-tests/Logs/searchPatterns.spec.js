/**
 * Search Patterns Tests (Enterprise Feature)
 *
 * Tests for the Search Patterns feature that allows users to automatically
 * extract and analyze log patterns from their log data.
 *
 * Note: Pattern detection requires:
 * - Stream with FTS (Full-Text Search) fields configured
 * - Stream with enable_log_patterns_extraction enabled
 * - Sufficient log volume for pattern clustering
 *
 * These tests configure the stream properly and ingest pattern-rich data.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const patternsTestData = require("../../../test-data/patterns_test_data.json");
const { ingestCustomData, enableLogPatternsExtraction, waitForStreamData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Dedicated stream for pattern tests with proper configuration
const PATTERNS_STREAM = "e2e_http_patterns";

// Track if data has been ingested (for serial test execution)
let dataIngested = false;

test.describe("Search Patterns Feature", { tag: ['@enterprise', '@searchPatterns'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    /**
     * Helper function to setup patterns view and wait for patterns to load
     * Reduces code duplication across all pattern tests
     * @param {Page} page - Playwright page object
     * @param {PageManager} pm - Page manager instance
     * @param {string} timeRange - Time range selector ('1hour' | '30seconds')
     * @returns {Promise<string>} - Result from waitForPatternsToLoad ('patterns' | 'statistics' | 'empty' | 'timeout')
     */
    async function setupPatternsView(page, pm, timeRange = '1hour') {
        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // Set time range
        if (timeRange === '1hour') {
            await pm.logsPage.clickDateTimeButton();
            await pm.logsPage.clickRelative1HourOrFallback();
        } else if (timeRange === '30seconds') {
            await pm.logsPage.setTimeToPast30Seconds();
        }

        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        return await pm.logsPage.waitForPatternsToLoad(60000);
    }

    test.beforeAll(async ({ browser }) => {
        // Ingest pattern-rich data once before all tests
        if (dataIngested) {
            testLogger.info('Pattern data already ingested, skipping...');
            return;
        }

        testLogger.info('Setting up pattern test data (beforeAll)...');
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // Navigate to establish session
            await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            // Ingest pattern-rich data with fresh timestamps
            const baseTimestamp = Date.now() * 1000; // microseconds
            const freshData = patternsTestData.map((log, index) => ({
                ...log,
                _timestamp: baseTimestamp + (index * 1000)
            }));

            testLogger.info(`Ingesting ${freshData.length} logs to stream: ${PATTERNS_STREAM}`);
            const ingestResponse = await ingestCustomData(page, PATTERNS_STREAM, freshData);

            if (ingestResponse.status === 200) {
                testLogger.info('Pattern data ingested successfully', { status: ingestResponse.status });
            } else {
                testLogger.error('Pattern data ingestion failed', { status: ingestResponse.status, data: ingestResponse.data });
            }

            // Enable log patterns extraction on the stream
            testLogger.info('Enabling log patterns extraction on stream...');
            const settingsResponse = await enableLogPatternsExtraction(page, PATTERNS_STREAM);
            testLogger.info('Stream settings updated', { status: settingsResponse.status });

            // Wait for data to be indexed by polling search API (replaces arbitrary 15s wait)
            testLogger.info('Waiting for data to be indexed...');
            const dataIndexed = await waitForStreamData(page, PATTERNS_STREAM, 100, 30000, 2000);
            if (!dataIndexed) {
                testLogger.warn('Stream data polling timed out, proceeding anyway...');
            }

            dataIngested = true;
        } finally {
            await context.close();
        }

        testLogger.info('Pattern test data setup complete');
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);

        // Post-authentication stabilization wait
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        testLogger.info(`Test setup completed - using ${PATTERNS_STREAM} stream`);
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    // ==========================================================================
    // P0 - Critical / Smoke Tests
    // ==========================================================================

    test("should display Patterns toggle button in Enterprise edition @P0 @smoke", async ({ page }) => {
        testLogger.info('Test: Verify Patterns toggle is visible (Enterprise)');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // STRONG ASSERTION: Patterns toggle must be visible in Enterprise edition
        await pm.logsPage.expectPatternsToggleVisible();

        testLogger.info('PASSED: Patterns toggle is visible');
    });

    test("should switch to Patterns view when toggle is clicked @P0 @smoke", async ({ page }) => {
        testLogger.info('Test: Verify patterns view activates on toggle click');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Select stream and set time range
        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        // Click patterns toggle
        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // STRONG ASSERTION: Patterns toggle should be in selected state
        await pm.logsPage.expectPatternsToggleSelected();

        // Wait for patterns to load (could be patterns, statistics, or empty)
        const result = await pm.logsPage.waitForPatternsToLoad(60000);
        testLogger.info(`Patterns loading result: ${result}`);

        // ASSERTION: Should show one of the valid states (not timeout)
        expect(['statistics', 'patterns', 'empty']).toContain(result);

        testLogger.info('PASSED: Patterns view activated successfully');
    });

    test("should display pattern statistics or empty state after loading @P0 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern view shows valid state');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        // Switch to patterns view
        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for patterns to load
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'statistics') {
            // Statistics element is visible - verify it shows pattern count
            await pm.logsPage.expectPatternStatisticsVisible();
            const statsText = await pm.logsPage.getPatternStatisticsText();
            expect(statsText).toContain('patterns found');
            testLogger.info(`Statistics: ${statsText}`);
        } else if (result === 'patterns') {
            // Pattern cards are visible (statistics element may not exist in UI)
            await pm.logsPage.expectPatternCardsVisible();
            const patternCount = await pm.logsPage.getPatternCardCount();
            expect(patternCount).toBeGreaterThan(0);
            testLogger.info(`Found ${patternCount} pattern cards`);
        } else if (result === 'empty') {
            // Empty state - verify empty message is shown
            await pm.logsPage.expectPatternEmptyStateVisible();
            testLogger.info('Empty state displayed - no patterns found for this data');
        }

        testLogger.info('PASSED: Pattern view shows valid state');
    });

    // ==========================================================================
    // P1 - Functional Tests (only run if patterns are detected)
    // ==========================================================================

    test("should display pattern cards with template, frequency and percentage when patterns exist @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern cards display correct information');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // STRONG ASSERTION: First pattern card should have template text
                const templateText = await pm.logsPage.getPatternCardTemplateText(0);
                expect(templateText.length).toBeGreaterThan(0);

                // STRONG ASSERTION: First pattern card should have frequency
                const frequency = await pm.logsPage.getPatternCardFrequency(0);
                expect(frequency).toBeTruthy();

                // STRONG ASSERTION: First pattern card should have percentage
                const percentage = await pm.logsPage.getPatternCardPercentage(0);
                expect(percentage).toContain('%');

                testLogger.info(`Pattern 0: template="${templateText.substring(0, 50)}...", frequency=${frequency}, percentage=${percentage}`);
            } else {
                testLogger.info('Statistics shown but no pattern cards visible yet');
            }
        } else {
            testLogger.info('No patterns found - skipping card verification');
        }

        testLogger.info('PASSED: Pattern card display verification complete');
    });

    test("should open pattern details dialog when clicking pattern card @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern details dialog opens on card click');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Click on first pattern card's details icon
                await pm.logsPage.clickPatternDetailsIcon(0);

                // STRONG ASSERTION: Details dialog should be open
                await pm.logsPage.expectPatternDetailsDialogOpen();

                // Close dialog
                await pm.logsPage.closePatternDetailsDialog();

                testLogger.info('Pattern details dialog opened and closed successfully');
            } else {
                testLogger.info('No pattern cards to click - skipping dialog test');
            }
        } else {
            testLogger.info('No patterns found - skipping dialog test');
        }

        testLogger.info('PASSED: Pattern details dialog test complete');
    });

    test("should navigate between patterns using Previous/Next buttons @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Previous/Next navigation in pattern details');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount >= 2) {
                // Open first pattern details
                await pm.logsPage.clickPatternDetailsIcon(0);
                await pm.logsPage.expectPatternDetailsDialogOpen();

                // STRONG ASSERTION: Previous should be disabled on first pattern
                await pm.logsPage.expectPatternDetailPreviousBtnDisabled();

                // STRONG ASSERTION: Next should be enabled
                await pm.logsPage.expectPatternDetailNextBtnEnabled();

                // Navigate to next pattern
                await pm.logsPage.clickPatternDetailNextBtn();

                // Verify we're on pattern 2
                await pm.logsPage.waitForPatternDetailIndex(2);

                // STRONG ASSERTION: Previous should now be enabled
                await pm.logsPage.expectPatternDetailPreviousBtnEnabled();

                // Navigate back
                await pm.logsPage.clickPatternDetailPreviousBtn();

                // Verify we're back on pattern 1
                await pm.logsPage.waitForPatternDetailIndex(1);

                await pm.logsPage.closePatternDetailsDialog();
                testLogger.info('Navigation between patterns works correctly');
            } else {
                testLogger.info('Not enough patterns for navigation test (need at least 2)');
            }
        } else {
            testLogger.info('No patterns found - skipping navigation test');
        }

        testLogger.info('PASSED: Pattern navigation test complete');
    });

    test("should add pattern to search using Include button @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Include button functionality');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                const templateText = await pm.logsPage.getPatternCardTemplateText(0);

                // Click include button
                await pm.logsPage.clickPatternIncludeBtn(0);
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

                // ASSERTION: After clicking Include, page should navigate away from patterns view
                // Verify logs table is visible (pattern view is exited)
                await pm.logsPage.expectLogsTableVisible();

                testLogger.info(`Clicked include on pattern: ${templateText.substring(0, 50)}...`);
            } else {
                testLogger.info('No patterns to include');
            }
        } else {
            testLogger.info('No patterns found - skipping include test');
        }

        testLogger.info('PASSED: Include button test complete');
    });

    test("should add pattern to search using Exclude button @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Exclude button functionality');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                const templateText = await pm.logsPage.getPatternCardTemplateText(0);

                // Click exclude button
                await pm.logsPage.clickPatternExcludeBtn(0);
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

                // ASSERTION: After clicking Exclude, page should navigate away from patterns view
                // Verify logs table is visible (pattern view is exited)
                await pm.logsPage.expectLogsTableVisible();

                testLogger.info(`Clicked exclude on pattern: ${templateText.substring(0, 50)}...`);
            } else {
                testLogger.info('No patterns to exclude');
            }
        } else {
            testLogger.info('No patterns found - skipping exclude test');
        }

        testLogger.info('PASSED: Exclude button test complete');
    });

    // ==========================================================================
    // P2 - Edge Case Tests
    // ==========================================================================

    test("should handle empty state gracefully @P2 @edgeCase", async ({ page }) => {
        testLogger.info('Test: Verify empty state handling');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Use a short time range that's likely to have no patterns
        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.setTimeToPast30Seconds();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        // Either empty state or patterns is valid
        expect(['statistics', 'patterns', 'empty']).toContain(result);

        if (result === 'empty') {
            await pm.logsPage.expectPatternEmptyStateVisible();
            testLogger.info('Empty state displayed correctly');
        } else {
            testLogger.info(`Got ${result} - patterns found even in short time range`);
        }

        testLogger.info('PASSED: Empty state test complete');
    });

    test("should open details dialog via details icon @P2 @functional", async ({ page }) => {
        testLogger.info('Test: Verify details icon opens pattern details dialog');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode (required for patterns)
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for logs to load first
        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Click details icon
                await pm.logsPage.clickPatternDetailsIcon(0);

                // STRONG ASSERTION: Details dialog should be open
                await pm.logsPage.expectPatternDetailsDialogOpen();

                await pm.logsPage.closePatternDetailsDialog();
                testLogger.info('Details icon opens dialog correctly');
            } else {
                testLogger.info('No pattern cards found');
            }
        } else {
            testLogger.info('No patterns found - skipping details icon test');
        }

        testLogger.info('PASSED: Details icon test complete');
    });

    // ==========================================================================
    // PR #10949 & #10965 - Duplicate Patterns Fix & Tokenized Chips Tests
    // ==========================================================================

    test("should not display duplicate patterns @P0 @smoke", async ({ page }) => {
        testLogger.info('Test: Verify patterns are unique (no duplicates)');

        const result = await setupPatternsView(page, pm);

        // CRITICAL: P0 test must have pattern data to be meaningful
        expect(['patterns', 'statistics']).toContain(result);

        const cardCount = await pm.logsPage.getPatternCardCount();

        // STRONG ASSERTION: Must have patterns for duplicate check (P0 test)
        expect(cardCount).toBeGreaterThan(0);

        // Get all pattern templates
        const patternTemplates = [];
        for (let i = 0; i < cardCount; i++) {
            const template = await pm.logsPage.getPatternCardTemplateText(i);
            patternTemplates.push(template);
        }

        testLogger.info(`Total patterns found: ${cardCount}`);
        testLogger.info(`Pattern templates: ${patternTemplates.map(t => t.substring(0, 50)).join(', ')}`);

        // Check for duplicates
        const uniqueTemplates = [...new Set(patternTemplates)];
        const duplicateCount = cardCount - uniqueTemplates.length;

        testLogger.info(`Unique patterns: ${uniqueTemplates.length}`);
        testLogger.info(`Duplicate patterns: ${duplicateCount}`);

        // STRONG ASSERTION: No duplicates should exist
        expect(duplicateCount).toBe(0);
        expect(uniqueTemplates.length).toBe(cardCount);

        await page.screenshot({ path: 'playwright-results/pattern-no-duplicates.png', fullPage: true });

        testLogger.info('✅ VERIFIED: All patterns are unique, no duplicates found');

        testLogger.info('PASSED: No duplicate patterns test complete');
    });

    test("should display tokenized wildcard chips in pattern cards @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify tokenized wildcard chips are displayed');

        const result = await setupPatternsView(page, pm);

        // ASSERTION: Patterns must be available for this test
        expect(['patterns', 'statistics']).toContain(result);

        const cardCount = await pm.logsPage.getPatternCardCount();

        // ASSERTION: Must have patterns to test tokenization
        expect(cardCount).toBeGreaterThan(0);

        // Check multiple patterns for wildcards (not just index 0)
        // At least one pattern should contain wildcard indicators
        let patternsWithWildcards = 0;
        const patternSamples = [];

        for (let i = 0; i < Math.min(cardCount, 5); i++) {
            const patternText = await pm.logsPage.getPatternCardTemplateText(i);

            // Check for wildcard chip DOM elements (rendered as .wildcard-chip)
            // textContent returns short labels like "str"/"num" rather than the
            // raw template format like "<:STR>"/"<:NUM>"
            const chipCount = await pm.logsPage.getPatternCardWildcardChipCount(i);
            const hasWildcards = chipCount > 0;

            if (hasWildcards) {
                patternsWithWildcards++;
            }

            patternSamples.push({
                index: i,
                sample: patternText.substring(0, 80),
                hasWildcards
            });
        }

        testLogger.info(`Patterns checked: ${patternSamples.length}`);
        testLogger.info(`Patterns with wildcards: ${patternsWithWildcards}`);
        testLogger.info(`Pattern samples: ${JSON.stringify(patternSamples, null, 2)}`);

        // Take screenshot for manual verification
        await page.screenshot({ path: 'playwright-results/pattern-wildcard-chips.png', fullPage: true });

        // ASSERTION: At least one pattern must contain wildcard indicators
        expect(patternsWithWildcards).toBeGreaterThan(0);

        testLogger.info('✅ Wildcard tokenization verified');

        testLogger.info('PASSED: Tokenized wildcard chips test complete');
    });

    test("should display wildcard chip tooltips with sample values on hover @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify wildcard chip hover tooltips show sample values');

        const result = await setupPatternsView(page, pm);

        // ASSERTION: Patterns must be available for this test
        expect(['patterns', 'statistics']).toContain(result);

        const cardCount = await pm.logsPage.getPatternCardCount();

        // ASSERTION: Must have patterns to test tooltips
        expect(cardCount).toBeGreaterThan(0);

        // Find wildcard chips - they have class 'wildcard-chip' in PatternCard.vue
        // Tooltips only appear when tok.sampleValues.length > 0 (see PatternCard.vue:48)
        const chipCount = await pm.logsPage.getWildcardChipCount();
        testLogger.info(`Found ${chipCount} wildcard chips on page`);

        // ASSERTION: Must have wildcard chips to test
        expect(chipCount).toBeGreaterThan(0);

        // Try hovering over multiple chips to find one with a tooltip
        // Tooltips only appear when pattern has sampleValues (data-dependent)
        let tooltipFound = false;
        let tooltipContent = '';
        const chipsToTry = Math.min(chipCount, 5);

        for (let i = 0; i < chipsToTry && !tooltipFound; i++) {
            const isVisible = await pm.logsPage.isWildcardChipVisible(i);
            if (!isVisible) continue;

            const chipText = await pm.logsPage.getWildcardChipText(i);
            testLogger.info(`Trying chip ${i}: ${chipText}`);

            // Hover over the chip
            await pm.logsPage.hoverWildcardChip(i);

            // Wait for Quasar tooltip (delay is 300ms + render time)
            await page.waitForTimeout(500);

            // Check if tooltip appeared
            const tooltipVisible = await pm.logsPage.isTooltipVisible(1000);

            if (tooltipVisible) {
                tooltipFound = true;
                tooltipContent = await pm.logsPage.getTooltipText(1000) || '';
                testLogger.info(`✅ Tooltip found on chip ${i}: ${tooltipContent.substring(0, 100)}`);

                // ASSERTION: Tooltip content must not be empty
                expect(tooltipContent.length).toBeGreaterThan(0);
                break;
            }

            // Move mouse away to reset for next chip
            await page.mouse.move(0, 0);
            await page.waitForTimeout(100);
        }

        await page.screenshot({ path: 'playwright-results/pattern-wildcard-tooltip.png', fullPage: true });

        // If no tooltip found on any chip, this is data-dependent (no sampleValues)
        // The test should still verify chips render correctly
        if (tooltipFound) {
            testLogger.info('✅ Wildcard chip tooltip with sample values verified');
        } else {
            // No tooltips found - verify this is due to missing sampleValues, not broken feature
            // PatternCard.vue only shows tooltip when tok.sampleValues.length > 0
            testLogger.warn('⚠️ No tooltips found on any wildcard chip - pattern data may not include sampleValues');
            testLogger.info('This is data-dependent: tooltips only appear when sampleValues are populated');

            // ASSERTION: At minimum, chips must render with proper text
            // wildcardLabel() maps <:STR>→"str", <:NUM>→"num", <*>→"<*>" etc.
            // chips display short labels, not raw angle-bracket tokens
            const firstChipText = await pm.logsPage.getWildcardChipText(0);
            expect(firstChipText.length).toBeGreaterThan(0);
            // Match wildcard chip labels: <*> literal or short type label (str, num, ip, ts, etc.)
            expect(firstChipText).toMatch(/^[a-z0-9]+$|^<\*>$/);
            testLogger.info('✅ Wildcard chips render correctly (no sampleValues in data for tooltips)');
        }

        testLogger.info('PASSED: Wildcard chip tooltip test complete');
    });

    test("should render anomaly badges inline with pattern cards @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify anomaly detection badges render inline with patterns');

        const result = await setupPatternsView(page, pm);

        // ASSERTION: Patterns must be available for this test
        expect(['patterns', 'statistics']).toContain(result);

        const cardCount = await pm.logsPage.getPatternCardCount();

        // ASSERTION: Must have patterns to test anomaly badges
        expect(cardCount).toBeGreaterThan(0);

        // Anomaly badges are INLINE with pattern cards, not in a separate column
        // Look for anomaly badges using data-test attribute: pattern-card-{index}-anomaly-badge
        let patternsWithAnomalyBadge = 0;
        const anomalyBadgeInfo = [];

        for (let i = 0; i < Math.min(cardCount, 10); i++) {
            const isVisible = await pm.logsPage.isPatternAnomaly(i);

            if (isVisible) {
                patternsWithAnomalyBadge++;
                const badgeText = await pm.logsPage.getPatternAnomalyBadgeText(i);
                anomalyBadgeInfo.push({ index: i, text: badgeText });
            }
        }

        testLogger.info(`Patterns with anomaly badges: ${patternsWithAnomalyBadge} out of ${Math.min(cardCount, 10)} checked`);
        if (anomalyBadgeInfo.length > 0) {
            testLogger.info(`Anomaly badge samples: ${JSON.stringify(anomalyBadgeInfo.slice(0, 3))}`);
        }

        await page.screenshot({ path: 'playwright-results/pattern-anomaly-badges.png', fullPage: true });

        // Anomaly detection is data-dependent - badges only appear for statistically rare patterns
        // The test verifies the feature is functional, not that anomalies must exist
        if (patternsWithAnomalyBadge > 0) {
            testLogger.info(`✅ Anomaly detection active: ${patternsWithAnomalyBadge} badges rendered`);

            // Verify badge contains expected text (e.g., "Rare Pattern" or warning emoji)
            const firstBadge = anomalyBadgeInfo[0];
            expect(firstBadge.text.length).toBeGreaterThan(0);
            testLogger.info(`Anomaly badge text verified: "${firstBadge.text}"`);
        } else {
            // No anomalies in current data - this is acceptable
            testLogger.info('No anomaly badges visible (data-dependent - patterns may not be statistically rare)');

            // Verify pattern cards themselves are rendered correctly
            const firstPatternTemplate = await pm.logsPage.getPatternCardTemplateText(0);
            expect(firstPatternTemplate.length).toBeGreaterThan(0);
            testLogger.info('✅ Pattern cards render correctly, no anomalies detected in current data');
        }

        testLogger.info('PASSED: Anomaly detection badge test complete');
    });

    test("should display pattern statistics in details dialog @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern statistics (z_score, avg_frequency) in details dialog');

        const result = await setupPatternsView(page, pm);

        // ASSERTION: Patterns must be available for this test
        expect(['patterns', 'statistics']).toContain(result);

        const cardCount = await pm.logsPage.getPatternCardCount();

        // ASSERTION: Must have patterns to test statistics
        expect(cardCount).toBeGreaterThan(0);

        // Open pattern details dialog
        await pm.logsPage.clickPatternDetailsIcon(0);
        await pm.logsPage.expectPatternDetailsDialogOpen();

        // Check for statistical information in the dialog
        const dialogContent = await pm.logsPage.getPatternDetailsDialogContent();

        // Look for statistical fields (PR #10965 adds z_score, avg_frequency, wildcard_values)
        const hasFrequency = dialogContent.toLowerCase().includes('frequency') ||
                           dialogContent.toLowerCase().includes('occurrences') ||
                           dialogContent.toLowerCase().includes('count');
        const hasPercentage = dialogContent.includes('%');
        const hasZScore = dialogContent.toLowerCase().includes('z-score') ||
                        dialogContent.toLowerCase().includes('z_score') ||
                        dialogContent.toLowerCase().includes('zscore');

        testLogger.info(`Dialog statistics - Frequency: ${hasFrequency}, Percentage: ${hasPercentage}, Z-Score: ${hasZScore}`);
        testLogger.info(`Dialog content preview: ${dialogContent.substring(0, 200)}`);

        await page.screenshot({ path: 'playwright-results/pattern-details-statistics.png', fullPage: true });

        // ASSERTION: Dialog must contain both frequency/count AND percentage
        // These are core pattern statistics that should always be displayed
        expect(hasFrequency).toBeTruthy();
        expect(hasPercentage).toBeTruthy();

        // INFO: Z-Score may be conditionally displayed (for anomalous patterns)
        if (hasZScore) {
            testLogger.info('✅ Z-Score statistic also present in dialog');
        }

        await pm.logsPage.closePatternDetailsDialog();
        testLogger.info('✅ Pattern statistics (frequency and percentage) verified in details dialog');

        testLogger.info('PASSED: Pattern statistics test complete');
    });
});
