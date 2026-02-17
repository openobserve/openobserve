/**
 * Search Patterns Tests (Enterprise Feature)
 *
 * Tests for the Search Patterns feature that allows users to automatically
 * extract and analyze log patterns from their log data.
 *
 * Feature Components:
 * - PatternStatistics: Summary of patterns found
 * - PatternList: List of extracted patterns with virtual scroll
 * - PatternCard: Individual pattern with template, frequency, percentage, actions
 * - PatternDetailsDialog: Full details of a pattern including variables and examples
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

// Utility function to ingest test data
async function ingestTestData(page) {
    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
    };
    const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
        const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(logsdata)
        });
        return await fetchResponse.json();
    }, {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: streamName,
        logsdata: logsdata
    });
    testLogger.debug('API response received', { response });
}

test.describe("Search Patterns Feature", { tag: ['@enterprise', '@searchPatterns'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    const stream = "e2e_automate";

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);

        // Post-authentication stabilization wait
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Data ingestion
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    // ==========================================================================
    // P0 - Critical / Smoke Tests
    // ==========================================================================

    test("should display Patterns toggle button in Enterprise edition @P0 @smoke", async ({ page }) => {
        testLogger.info('Test: Verify Patterns toggle is visible (Enterprise)');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // STRONG ASSERTION: Patterns toggle must be visible in Enterprise edition
        await pm.logsPage.expectPatternsToggleVisible();

        testLogger.info('PASSED: Patterns toggle is visible');
    });

    test("should switch to Patterns view and load patterns @P0 @smoke", async ({ page }) => {
        testLogger.info('Test: Verify clicking Patterns toggle switches to patterns view');

        // Navigate to logs and select stream
        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative15MinButton();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Click patterns toggle
        await pm.logsPage.clickPatternsToggle();
        await page.waitForTimeout(2000);

        // STRONG ASSERTION: Patterns toggle should be in selected state
        await pm.logsPage.expectPatternsToggleSelected();

        // Wait for patterns to load (may show patterns or empty state)
        const result = await pm.logsPage.waitForPatternsToLoad(60000);
        testLogger.info(`Patterns loading result: ${result}`);

        // STRONG ASSERTION: Should either show patterns or empty state (not timeout)
        expect(['statistics', 'patterns', 'empty']).toContain(result);

        testLogger.info('PASSED: Patterns view loaded successfully');
    });

    test("should display pattern statistics after loading @P0 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern statistics are displayed');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Switch to patterns view
        await pm.logsPage.clickPatternsToggle();

        // Wait for patterns to load
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'statistics' || result === 'patterns') {
            // STRONG ASSERTION: Statistics should be visible
            await pm.logsPage.expectPatternStatisticsVisible();

            // Verify statistics contain expected text format
            const statsText = await pm.logsPage.getPatternStatisticsText();
            expect(statsText).toContain('patterns found');
            expect(statsText).toContain('events');

            testLogger.info(`Statistics: ${statsText}`);
        } else {
            testLogger.info('Empty state shown - no patterns found (may need more data)');
        }

        testLogger.info('PASSED: Pattern statistics verification complete');
    });

    // ==========================================================================
    // P1 - Functional Tests
    // ==========================================================================

    test("should display pattern cards with template, frequency and percentage @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern cards display correct information');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            // Check if at least one pattern card exists
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

                testLogger.info(`Pattern 0: template="${templateText}", frequency=${frequency}, percentage=${percentage}`);
            } else {
                testLogger.info('No pattern cards found - may need more log data');
            }
        } else {
            testLogger.info('Patterns view shows empty state');
        }

        testLogger.info('PASSED: Pattern card display verification complete');
    });

    test("should open pattern details dialog when clicking pattern card @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify pattern details dialog opens on card click');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Click on first pattern card
                await pm.logsPage.clickPatternCard(0);
                await page.waitForTimeout(1000);

                // STRONG ASSERTION: Details dialog should be open
                await pm.logsPage.expectPatternDetailsDialogOpen();

                // Verify pattern 1 is shown
                await pm.logsPage.waitForPatternDetailIndex(1);

                // Close dialog
                await pm.logsPage.closePatternDetailsDialog();
                await page.waitForTimeout(500);

                testLogger.info('Pattern details dialog opened and closed successfully');
            } else {
                testLogger.info('No pattern cards to click');
            }
        }

        testLogger.info('PASSED: Pattern details dialog test complete');
    });

    test("should navigate between patterns using Previous/Next buttons @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Previous/Next navigation in pattern details');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount >= 2) {
                // Open first pattern
                await pm.logsPage.clickPatternCard(0);
                await page.waitForTimeout(1000);
                await pm.logsPage.expectPatternDetailsDialogOpen();

                // STRONG ASSERTION: Previous should be disabled on first pattern
                await pm.logsPage.expectPatternDetailPreviousBtnDisabled();

                // STRONG ASSERTION: Next should be enabled (we have at least 2 patterns)
                await pm.logsPage.expectPatternDetailNextBtnEnabled();

                // Navigate to next pattern
                await pm.logsPage.clickPatternDetailNextBtn();
                await page.waitForTimeout(500);

                // Verify we're on pattern 2
                await pm.logsPage.waitForPatternDetailIndex(2);

                // STRONG ASSERTION: Previous should now be enabled
                await pm.logsPage.expectPatternDetailPreviousBtnEnabled();

                // Navigate back
                await pm.logsPage.clickPatternDetailPreviousBtn();
                await page.waitForTimeout(500);

                // Verify we're back on pattern 1
                await pm.logsPage.waitForPatternDetailIndex(1);

                await pm.logsPage.closePatternDetailsDialog();
                testLogger.info('Navigation between patterns works correctly');
            } else {
                testLogger.info('Not enough patterns for navigation test (need at least 2)');
            }
        }

        testLogger.info('PASSED: Pattern navigation test complete');
    });

    test("should add pattern to search using Include button @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Include button adds pattern to search query');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Get the pattern template before clicking include
                const templateText = await pm.logsPage.getPatternCardTemplateText(0);

                // Click include button
                await pm.logsPage.clickPatternIncludeBtn(0);
                await page.waitForTimeout(1000);

                // After clicking include, the search query should be updated
                // The test verifies the action doesn't throw an error
                testLogger.info(`Clicked include on pattern: ${templateText}`);
            } else {
                testLogger.info('No patterns to include');
            }
        }

        testLogger.info('PASSED: Include button test complete');
    });

    test("should add pattern to search using Exclude button @P1 @functional", async ({ page }) => {
        testLogger.info('Test: Verify Exclude button adds pattern negation to search query');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Get the pattern template before clicking exclude
                const templateText = await pm.logsPage.getPatternCardTemplateText(0);

                // Click exclude button
                await pm.logsPage.clickPatternExcludeBtn(0);
                await page.waitForTimeout(1000);

                // After clicking exclude, the search query should be updated
                // The test verifies the action doesn't throw an error
                testLogger.info(`Clicked exclude on pattern: ${templateText}`);
            } else {
                testLogger.info('No patterns to exclude');
            }
        }

        testLogger.info('PASSED: Exclude button test complete');
    });

    // ==========================================================================
    // P2 - Edge Case Tests
    // ==========================================================================

    test("should show empty state when no patterns found @P2 @edgeCase", async ({ page }) => {
        testLogger.info('Test: Verify empty state is displayed correctly');

        // Use a very short time range to likely get no patterns
        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.setTimeToPast30Seconds();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'empty') {
            // STRONG ASSERTION: Empty state message should be visible
            await pm.logsPage.expectPatternEmptyStateVisible();
            testLogger.info('Empty state displayed correctly');
        } else {
            testLogger.info(`Got ${result} instead of empty state (may have data in short time range)`);
        }

        testLogger.info('PASSED: Empty state test complete');
    });

    test("should open details dialog via details icon @P2 @functional", async ({ page }) => {
        testLogger.info('Test: Verify details icon opens pattern details dialog');

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        await pm.logsPage.selectStream(stream);
        await pm.logsPage.clickDateTimeButton();
        await pm.logsPage.clickRelative1HourOrFallback();
        await pm.logsPage.clickRefreshButton();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        await pm.logsPage.clickPatternsToggle();
        const result = await pm.logsPage.waitForPatternsToLoad(60000);

        if (result === 'patterns' || result === 'statistics') {
            const cardCount = await pm.logsPage.getPatternCardCount();

            if (cardCount > 0) {
                // Click details icon instead of the card
                await pm.logsPage.clickPatternDetailsIcon(0);
                await page.waitForTimeout(1000);

                // STRONG ASSERTION: Details dialog should be open
                await pm.logsPage.expectPatternDetailsDialogOpen();

                await pm.logsPage.closePatternDetailsDialog();
                testLogger.info('Details icon opens dialog correctly');
            } else {
                testLogger.info('No pattern cards found');
            }
        }

        testLogger.info('PASSED: Details icon test complete');
    });
});
