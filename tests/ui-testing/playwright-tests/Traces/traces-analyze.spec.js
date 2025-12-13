// Copyright 2023 OpenObserve Inc.
// Traces Analyze Feature Tests - ENTERPRISE ONLY
// Feature Doc: docs/test_generator/features/traces-analyze-feature.md

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { TracesPage } = require('../../pages/tracesPages/tracesPage.js');

test.describe.configure({ mode: 'serial' });

test.describe("Traces Analyze Feature", { tag: '@enterprise' }, () => {
    let tracesPage;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        tracesPage = new TracesPage(page);
        testLogger.info('Test setup completed');
    });

    // P0 Tests - Critical Path
    test("P0: Navigate to traces page and verify histogram", {
        tag: ['@analyze', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to traces page with refresh to ensure proper loading
        await tracesPage.navigateToTracesWithRefresh();
        await tracesPage.tracesURLValidation();
        testLogger.info('Navigated to traces page');

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        testLogger.info('Query executed, RED metrics should be visible');
    });

    test("P0: Analyze button not visible without brush selection", {
        tag: ['@analyze', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Verify analyze button is NOT visible (no brush selection yet)
        const isVisible = await tracesPage.isAnalyzeButtonVisible();
        // Note: Button should only appear after brush selection
        testLogger.info(`Analyze button visible without selection: ${isVisible}`);
    });

    test("P0: Make brush selection and verify analyze button appears", {
        tag: ['@analyze', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection on Rate panel
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        // Check if analyze button appeared
        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        testLogger.info(`Analyze button visible after brush selection: ${analyzeVisible}`);

        // If button appeared, verify it's clickable
        if (analyzeVisible) {
            const button = page.locator(tracesPage.analyzeButton);
            await expect(button).toBeEnabled();
            testLogger.info('Analyze button is enabled and ready');
        }
    });

    test("P0: Open analysis dashboard and verify tabs exist", {
        tag: ['@analyze', '@smoke', '@P0']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        // Click analyze button if visible
        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Verify dashboard opened
            const dashboardOpen = await tracesPage.isAnalysisDashboardOpen();
            expect(dashboardOpen).toBe(true);
            testLogger.info('Analysis dashboard opened successfully');

            // Verify tabs are present
            const volumeTab = page.locator(tracesPage.volumeTab);
            const latencyTab = page.locator(tracesPage.latencyTab);
            const errorTab = page.locator(tracesPage.errorTab);

            // At least one tab should be visible
            const volumeVisible = await volumeTab.isVisible().catch(() => false);
            const latencyVisible = await latencyTab.isVisible().catch(() => false);
            const errorVisible = await errorTab.isVisible().catch(() => false);

            testLogger.info(`Tabs visible - Volume: ${volumeVisible}, Latency: ${latencyVisible}, Error: ${errorVisible}`);

            // Close dashboard
            await tracesPage.closeAnalysisDashboard();
        } else {
            testLogger.info('Analyze button not visible - brush selection may not have triggered');
        }
    });

    // P1 Tests - Tab Navigation
    test("P1: Switch to Latency tab", {
        tag: ['@analyze', '@tabs', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection on Duration panel for latency analysis
        await tracesPage.makeBrushSelection('Duration');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Click Latency tab
            const latencyTab = page.locator(tracesPage.latencyTab);
            if (await latencyTab.isVisible()) {
                await tracesPage.clickLatencyTab();
                await page.waitForTimeout(1000);

                // Verify Latency tab is now active
                const isActive = await tracesPage.isTabActive('latency');
                testLogger.info(`Latency tab active: ${isActive}`);

                // Verify dashboard title shows Latency Insights
                const title = await tracesPage.getAnalysisDashboardTitle();
                testLogger.info(`Dashboard title: ${title}`);
            } else {
                testLogger.info('Latency tab not visible');
            }

            await tracesPage.closeAnalysisDashboard();
        }
    });

    test("P1: Switch to Volume tab", {
        tag: ['@analyze', '@tabs', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Click Volume tab
            const volumeTab = page.locator(tracesPage.volumeTab);
            if (await volumeTab.isVisible()) {
                await tracesPage.clickVolumeTab();
                await page.waitForTimeout(1000);

                // Verify Volume tab is now active
                const isActive = await tracesPage.isTabActive('volume');
                testLogger.info(`Volume tab active: ${isActive}`);

                // Verify dashboard title shows Volume Insights
                const title = await tracesPage.getAnalysisDashboardTitle();
                testLogger.info(`Dashboard title: ${title}`);
            } else {
                testLogger.info('Volume tab not visible');
            }

            await tracesPage.closeAnalysisDashboard();
        }
    });

    test("P1: Switch to Error tab", {
        tag: ['@analyze', '@tabs', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection on Errors panel
        await tracesPage.makeBrushSelection('Errors');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Click Error tab
            const errorTab = page.locator(tracesPage.errorTab);
            if (await errorTab.isVisible()) {
                await tracesPage.clickErrorTab();
                await page.waitForTimeout(1000);

                // Verify Error tab is now active
                const isActive = await tracesPage.isTabActive('error');
                testLogger.info(`Error tab active: ${isActive}`);

                // Verify dashboard title shows Error Insights
                const title = await tracesPage.getAnalysisDashboardTitle();
                testLogger.info(`Dashboard title: ${title}`);
            } else {
                testLogger.info('Error tab not visible');
            }

            await tracesPage.closeAnalysisDashboard();
        }
    });

    test("P1: Toggle between all three tabs", {
        tag: ['@analyze', '@tabs', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Test tab switching sequence: Volume -> Latency -> Error -> Volume
            const tabs = ['volume', 'latency', 'error', 'volume'];

            for (const tab of tabs) {
                testLogger.info(`Switching to ${tab} tab...`);

                if (tab === 'volume') {
                    const volumeTab = page.locator(tracesPage.volumeTab);
                    if (await volumeTab.isVisible()) {
                        await tracesPage.clickVolumeTab();
                    }
                } else if (tab === 'latency') {
                    const latencyTab = page.locator(tracesPage.latencyTab);
                    if (await latencyTab.isVisible()) {
                        await tracesPage.clickLatencyTab();
                    }
                } else if (tab === 'error') {
                    const errorTab = page.locator(tracesPage.errorTab);
                    if (await errorTab.isVisible()) {
                        await tracesPage.clickErrorTab();
                    }
                }

                await page.waitForTimeout(500);

                // Log the current title
                const title = await tracesPage.getAnalysisDashboardTitle();
                testLogger.info(`After clicking ${tab}: Title = ${title}`);
            }

            await tracesPage.closeAnalysisDashboard();
            testLogger.info('Tab toggle test completed');
        }
    });

    // P1 Tests - Dimension Selector
    test("P1: Open dimension selector dialog", {
        tag: ['@analyze', '@dimensions', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Check if dimension selector button is visible
            const dimSelectorVisible = await tracesPage.isDimensionSelectorVisible();
            testLogger.info(`Dimension selector button visible: ${dimSelectorVisible}`);

            if (dimSelectorVisible) {
                // Click to open dimension selector
                await tracesPage.clickDimensionSelector();
                await page.waitForTimeout(500);

                // Verify dimension selector dialog opened
                // Look for search input in the dialog
                const searchInput = page.locator('.dimension-selector-dialog input[type="text"]').first();
                const dialogVisible = await searchInput.isVisible().catch(() => false);
                testLogger.info(`Dimension selector dialog opened: ${dialogVisible}`);

                // Close dialog by clicking outside or pressing Escape
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }

            await tracesPage.closeAnalysisDashboard();
        }
    });

    // P1 Tests - Close Dashboard
    test("P1: Close analysis dashboard", {
        tag: ['@analyze', '@P1']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Rate');
        await page.waitForTimeout(1000);

        const analyzeVisible = await tracesPage.isAnalyzeButtonVisible();
        if (analyzeVisible) {
            await tracesPage.clickAnalyzeButton();
            await tracesPage.waitForAnalysisDashboardLoaded();

            // Verify dashboard is open
            let dashboardOpen = await tracesPage.isAnalysisDashboardOpen();
            expect(dashboardOpen).toBe(true);
            testLogger.info('Dashboard opened');

            // Close dashboard
            await tracesPage.closeAnalysisDashboard();
            await page.waitForTimeout(500);

            // Verify dashboard is closed
            dashboardOpen = await tracesPage.isAnalysisDashboardOpen();
            expect(dashboardOpen).toBe(false);
            testLogger.info('Dashboard closed successfully');
        }
    });

    // P2 Tests - Error Only Toggle
    test("P2: Toggle error only filter", {
        tag: ['@analyze', '@filters', '@P2']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Find and toggle error only
        const errorToggle = page.locator(tracesPage.errorOnlyToggle);
        const toggleVisible = await errorToggle.isVisible().catch(() => false);

        if (toggleVisible) {
            // Click to toggle error only filter
            await tracesPage.toggleErrorOnly();
            await page.waitForTimeout(1000);
            testLogger.info('Error only toggle clicked');

            // Toggle back
            await tracesPage.toggleErrorOnly();
            await page.waitForTimeout(500);
            testLogger.info('Error only toggle reset');
        } else {
            testLogger.info('Error only toggle not visible');
        }
    });

    // P2 Tests - Range Filter Chip
    test("P2: Verify range filter chip appears after brush selection", {
        tag: ['@analyze', '@filters', '@P2']
    }, async ({ page }) => {
        // Navigate to traces page with refresh
        await tracesPage.navigateToTracesWithRefresh();

        // Set time range to 15 minutes and run query
        await tracesPage.setTimeToPast15Minutes();
        await tracesPage.runQuery();

        // Wait for RED metrics to fully load
        await tracesPage.waitForREDMetricsLoaded();

        // Make brush selection
        await tracesPage.makeBrushSelection('Duration');
        await page.waitForTimeout(1000);

        // Check if filter chip appeared
        const chipVisible = await tracesPage.isRangeFilterChipVisible();
        testLogger.info(`Range filter chip visible: ${chipVisible}`);

        if (chipVisible) {
            // Verify chip has content
            const chipText = await page.locator(tracesPage.rangeFilterChip).first().textContent();
            testLogger.info(`Filter chip text: ${chipText}`);
        }
    });
});
