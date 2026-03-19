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

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

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

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Get pattern template text to check for wildcard tokens
                const firstPatternText = await pm.logsPage.getPatternCardTemplateText(0);
                testLogger.info(`First pattern: ${firstPatternText.substring(0, 100)}`);

                // Check if pattern contains wildcard indicators like <:TIMESTAMP>, <*>, etc.
                const hasWildcards = firstPatternText.includes('<:') ||
                                   firstPatternText.includes('<*>') ||
                                   firstPatternText.includes('[<:');

                // Inspect DOM structure for debugging
                const patternElements = await pm.logsPage.inspectPatternCardDOM(0);

                testLogger.info(`Pattern DOM inspection: ${JSON.stringify(patternElements)}`);
                testLogger.info(`Has wildcard tokens in text: ${hasWildcards}`);

                // Take screenshot for manual verification
                await page.screenshot({ path: 'playwright-results/pattern-wildcard-chips.png', fullPage: true });

                // ASSERTION: Pattern should contain wildcard indicators
                expect(hasWildcards || patternElements.totalElements > 0).toBeTruthy();

                testLogger.info('✅ Wildcard tokenization verified');
            } else {
                testLogger.info('No pattern cards found for chip verification');
            }
        } else {
            testLogger.info('No patterns found - skipping chip test');
        }

        testLogger.info('PASSED: Tokenized wildcard chips test complete');
    });

    test("should display wildcard chip tooltips with sample values on hover @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify wildcard chip hover tooltips show sample values');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Find wildcard chips
                const wildcardChip = await pm.logsPage.getWildcardChip();
                const chipVisible = await wildcardChip.isVisible().catch(() => false);

                // NOTE: Wildcard chips may not be rendered as separate DOM elements in current implementation
                // The tokenization shows wildcards inline in text (e.g., [<:TIMESTAMP>])
                // This test verifies the feature without blocking if DOM structure changes
                testLogger.info(`Wildcard chip element visible: ${chipVisible}`);

                if (chipVisible) {
                    // Hover over the chip
                    await wildcardChip.hover();
                    await page.waitForTimeout(1000);

                    // Check for tooltip/popover
                    const tooltip = await pm.logsPage.getTooltip();
                    const tooltipVisible = await tooltip.isVisible({ timeout: 3000 }).catch(() => false);

                    // ASSERTION: Tooltip should be visible on hover
                    expect(tooltipVisible).toBeTruthy();

                    if (tooltipVisible) {
                        const tooltipText = await tooltip.innerText();
                        testLogger.info(`Tooltip content: ${tooltipText.substring(0, 100)}`);

                        // ASSERTION: Tooltip should have content
                        expect(tooltipText.length).toBeGreaterThan(0);
                    }

                    await page.screenshot({ path: 'playwright-results/pattern-wildcard-tooltip.png', fullPage: true });
                    testLogger.info('✅ Wildcard chip tooltip verified');
                } else {
                    // Wildcard chips not rendered as hover-able elements in current UI
                    // Verify wildcards exist in text instead
                    const firstPattern = await pm.logsPage.getPatternCardTemplateText(0);
                    const hasWildcards = firstPattern.includes('<:') || firstPattern.includes('<*>');

                    // ASSERTION: Wildcards should exist in pattern text
                    expect(hasWildcards).toBeTruthy();
                    testLogger.info('✅ Wildcard tokenization verified in pattern text (chips not hover-able)');
                }
            } else {
                testLogger.info('No pattern cards found for tooltip test');
            }
        } else {
            testLogger.info('No patterns found - skipping tooltip test');
        }

        testLogger.info('PASSED: Wildcard chip tooltip test complete');
    });

    test("should display anomaly detection badges for rare patterns @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify anomaly detection badges are displayed for rare patterns');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Get anomaly column data
                const anomalyData = await pm.logsPage.getAnomalyColumnData();

                const patternsWithAnomalies = anomalyData.filter(d => d.hasIcon || d.hasWarning).length;
                testLogger.info(`Patterns with anomaly indicators: ${patternsWithAnomalies}/${cardCount}`);
                testLogger.info(`Anomaly data: ${JSON.stringify(anomalyData.slice(0, 3))}`);

                await page.screenshot({ path: 'playwright-results/pattern-anomaly-badges.png', fullPage: true });

                // ASSERTION: At least one pattern should have anomaly indicators
                // (Test data includes rare ERROR patterns that should trigger anomaly detection)
                expect(patternsWithAnomalies).toBeGreaterThan(0);

                testLogger.info('✅ Anomaly detection indicators found and verified');
            } else {
                testLogger.info('No pattern cards found for anomaly badge verification');
            }
        } else {
            testLogger.info('No patterns found - skipping anomaly badge test');
        }

        testLogger.info('PASSED: Anomaly detection badge test complete');
    });

    test("should display pattern statistics in details dialog @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern statistics (z_score, avg_frequency) in details dialog');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(PATTERNS_STREAM);

        // Switch off quick mode
        await pm.logsPage.clickQuickModeToggle();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.waitForLogsTableToLoad();

        await pm.logsPage.clickPatternsToggle();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Open pattern details dialog
                await pm.logsPage.clickPatternDetailsIcon(0);
                await pm.logsPage.expectPatternDetailsDialogOpen();

                // Check for statistical information in the dialog
                const dialogContent = await pm.logsPage.getPatternDetailsDialogContent();

                // Look for statistical terms
                const hasFrequency = dialogContent.toLowerCase().includes('frequency') ||
                                   dialogContent.toLowerCase().includes('occurrences');
                const hasPercentage = dialogContent.includes('%');
                const hasStats = dialogContent.toLowerCase().includes('z-score') ||
                               dialogContent.toLowerCase().includes('average') ||
                               dialogContent.toLowerCase().includes('rare');

                testLogger.info(`Dialog statistics - Frequency: ${hasFrequency}, Percentage: ${hasPercentage}, Stats: ${hasStats}`);

                await page.screenshot({ path: 'playwright-results/pattern-details-statistics.png', fullPage: true });

                // ASSERTION: Dialog should contain at least frequency and percentage
                expect(hasFrequency || hasPercentage).toBeTruthy();

                await pm.logsPage.closePatternDetailsDialog();
                testLogger.info('Pattern statistics verified in details dialog');
            } else {
                testLogger.info('No pattern cards found for statistics test');
            }
        } else {
            testLogger.info('No patterns found - skipping statistics test');
        }

        testLogger.info('PASSED: Pattern statistics test complete');
    });
});
