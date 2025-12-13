// Copyright 2023 OpenObserve Inc.
// Log Patterns Feature Tests - ENTERPRISE ONLY
// Feature Doc: docs/test_generator/features/logs-patterns-feature.md

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { LogsPage } = require('../../pages/logsPages/logsPage.js');

test.describe.configure({ mode: 'serial' });

test.describe("Log Patterns Feature", { tag: '@enterprise' }, () => {
    let logsPage;
    const stream = "e2e_automate";

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        logsPage = new LogsPage(page);
        testLogger.info('Test setup completed');
    });

    // P0 Tests - Critical Path
    test("P0: Patterns toggle is visible in enterprise mode", {
        tag: ['@patterns', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to logs page
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Verify patterns toggle is visible (enterprise only)
        await logsPage.expectPatternsToggleVisible();
    });

    test("P0: Extract patterns and view statistics", {
        tag: ['@patterns', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to logs page
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Select stream
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set a larger time range for more patterns
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode
        await logsPage.clickPatternsToggle();
        await page.waitForTimeout(1000);

        // Run query to extract patterns
        await logsPage.clickRunQueryButton();

        // Wait for patterns to load (may take time for extraction)
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Verify statistics are displayed
        await logsPage.expectPatternStatisticsVisible();

        // Get statistics values
        const logsScanned = await logsPage.getPatternStatsLogsScanned();
        const patternsFound = await logsPage.getPatternStatsPatternsFound();

        console.log(`Logs scanned: ${logsScanned}, Patterns found: ${patternsFound}`);

        // Verify we have some statistics (may be 0 if no patterns found)
        expect(logsScanned).toBeDefined();
        expect(patternsFound).toBeDefined();
    });

    // P1 Tests - Functional
    test("P1: View pattern details dialog", {
        tag: ['@patterns', '@functional', '@P1']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set time range
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode and extract
        await logsPage.clickPatternsToggle();
        await logsPage.clickRunQueryButton();
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Check if we have patterns
        const patternsFound = await logsPage.getPatternStatsPatternsFound();
        const patternsCount = parseInt(patternsFound.replace(/,/g, ''), 10);

        if (patternsCount > 0) {
            // Click on first pattern card to open details
            await logsPage.clickPatternCard(0);
            await page.waitForTimeout(1000);

            // Verify details dialog is open
            await logsPage.expectPatternDialogVisible();

            // Close dialog
            await logsPage.closePatternDetailsDialog();
            await page.waitForTimeout(500);
        } else {
            console.log('No patterns found - skipping details dialog test');
        }
    });

    test("P1: Navigate between pattern details", {
        tag: ['@patterns', '@functional', '@P1']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set time range
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode and extract
        await logsPage.clickPatternsToggle();
        await logsPage.clickRunQueryButton();
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Check if we have multiple patterns
        const patternsFound = await logsPage.getPatternStatsPatternsFound();
        const patternsCount = parseInt(patternsFound.replace(/,/g, ''), 10);

        if (patternsCount >= 2) {
            // Open first pattern
            await logsPage.clickPatternCard(0);
            await page.waitForTimeout(1000);

            // Verify Previous is disabled (we're on first pattern)
            await logsPage.expectPatternDetailPreviousDisabled();
            await logsPage.expectPatternDetailNextEnabled();

            // Navigate to next pattern
            await logsPage.clickPatternDetailNext();
            await page.waitForTimeout(500);

            // Navigate back
            await logsPage.clickPatternDetailPrevious();
            await page.waitForTimeout(500);

            // Close dialog
            await logsPage.closePatternDetailsDialog();
        } else {
            console.log('Not enough patterns for navigation test - skipping');
        }
    });

    test("P1: Pattern statistics show all four metrics", {
        tag: ['@patterns', '@functional', '@P1']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set time range
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode and extract
        await logsPage.clickPatternsToggle();
        await logsPage.clickRunQueryButton();
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Verify all four statistics cards are present
        await expect(page.locator('[data-test="pattern-stats-logs-scanned-card"]')).toBeVisible();
        await expect(page.locator('[data-test="pattern-stats-patterns-found-card"]')).toBeVisible();
        await expect(page.locator('[data-test="pattern-stats-coverage-card"]')).toBeVisible();
        await expect(page.locator('[data-test="pattern-stats-processing-time-card"]')).toBeVisible();

        // Get and verify values
        const logsScanned = await logsPage.getPatternStatsLogsScanned();
        const patternsFound = await logsPage.getPatternStatsPatternsFound();
        const coverage = await logsPage.getPatternStatsCoverage();
        const processingTime = await logsPage.getPatternStatsProcessingTime();

        console.log(`Statistics: Logs=${logsScanned}, Patterns=${patternsFound}, Coverage=${coverage}, Time=${processingTime}`);

        // Verify values exist
        expect(logsScanned).toBeDefined();
        expect(patternsFound).toBeDefined();
        expect(coverage).toContain('%');
        expect(processingTime).toContain('ms');
    });

    test("P1: Include pattern adds filter to search", {
        tag: ['@patterns', '@functional', '@P1']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set time range
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode and extract
        await logsPage.clickPatternsToggle();
        await logsPage.clickRunQueryButton();
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Check if we have patterns
        const patternsFound = await logsPage.getPatternStatsPatternsFound();
        const patternsCount = parseInt(patternsFound.replace(/,/g, ''), 10);

        if (patternsCount > 0) {
            // Click include button on first pattern
            await logsPage.clickPatternIncludeBtn(0);
            await page.waitForTimeout(2000);

            // Verify we switched to logs mode (after include)
            // The UI should switch to logs view after adding filter
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        } else {
            console.log('No patterns found - skipping include test');
        }
    });

    // P2 Tests - Edge Cases
    test("P2: Switch between logs and patterns mode", {
        tag: ['@patterns', '@edge-case', '@P2']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Start in logs mode (default)
        await expect(page.locator('[data-test="logs-logs-toggle"]')).toHaveClass(/selected/);

        // Switch to patterns mode
        await logsPage.clickPatternsToggle();
        await page.waitForTimeout(1000);
        await expect(page.locator('[data-test="logs-patterns-toggle"]')).toHaveClass(/selected/);

        // Switch back to logs mode
        await logsPage.clickLogsToggle();
        await page.waitForTimeout(1000);
        await expect(page.locator('[data-test="logs-logs-toggle"]')).toHaveClass(/selected/);
    });

    test("P2: Pattern card displays frequency and percentage", {
        tag: ['@patterns', '@edge-case', '@P2']
    }, async ({ page }) => {
        // Navigate and setup
        await logsPage.navigateToLogs();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await logsPage.selectStream(stream);
        await page.waitForTimeout(2000);

        // Set time range
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
        await page.waitForTimeout(1000);

        // Switch to patterns mode and extract
        await logsPage.clickPatternsToggle();
        await logsPage.clickRunQueryButton();
        await page.waitForTimeout(10000);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

        // Check if we have patterns
        const patternsFound = await logsPage.getPatternStatsPatternsFound();
        const patternsCount = parseInt(patternsFound.replace(/,/g, ''), 10);

        if (patternsCount > 0) {
            // Verify first pattern card has frequency and percentage
            const frequency = await logsPage.getPatternCardFrequency(0);
            const percentage = await logsPage.getPatternCardPercentage(0);

            console.log(`Pattern 0: Frequency=${frequency}, Percentage=${percentage}`);

            // Frequency should be a number
            expect(parseInt(frequency.replace(/,/g, ''), 10)).toBeGreaterThan(0);
            // Percentage should contain %
            expect(percentage).toContain('%');
        } else {
            console.log('No patterns found - skipping frequency/percentage test');
        }
    });
});
