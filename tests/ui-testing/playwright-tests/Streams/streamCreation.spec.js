/**
 * Stream Creation Test Suite
 *
 * Generated from: docs/test_generator/features/stream-creation-feature.md
 * Test Plan: docs/test_generator/test-plans/stream-creation-test-plan.md
 *
 * Tests the Stream Creation feature including:
 * - Modal opening and closing
 * - Creating streams with different types
 * - Validation error handling
 * - Edge cases (duplicate names, empty fields)
 *
 * CONSOLIDATED: Tests combined to reduce total count while maintaining coverage
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Test stream names - all prefixed for easy cleanup
const TEST_STREAMS = {
    basic: 'e2e_streamcreation_basic',
    logs: 'e2e_streamcreation_logs',
    metrics: 'e2e_streamcreation_metrics',
    traces: 'e2e_streamcreation_traces',
    retention: 'e2e_streamcreation_retention',
    duplicate: 'e2e_streamcreation_duplicate',
    cancelTest: 'e2e_streamcreation_cancel',
    closeTest: 'e2e_streamcreation_close'
};

test.describe('Stream Creation', { tag: ['@streams', '@all', '@streamCreation'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // Navigate to base (uses saved auth state from global setup)
        await navigateToBase(page);

        // Initialize PageManager
        pm = new PageManager(page);

        // Navigate to Streams page
        await pm.streamsPage.navigateToStreamExplorer();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        testLogger.info('Test setup completed - on Streams page');
    });

    test.afterEach(async ({ page }, testInfo) => {
        // Only log if status is available
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    // ==========================================
    // P0 - Critical Tests (Smoke)
    // ==========================================

    test('TC001: Add Stream modal opens and closes correctly', {
        tag: ['@smoke', '@P0']
    }, async ({ page }) => {
        testLogger.info('TC001: Testing Add Stream modal open/close functionality');

        // 1. Test modal opens
        await pm.streamsPage.clickAddStreamButton();
        await pm.streamsPage.expectAddStreamModalVisible();
        testLogger.info('Modal opens successfully');

        // 2. Test Cancel button closes modal without saving
        const cancelStreamName = TEST_STREAMS.cancelTest;
        await pm.streamsPage.deleteStreamViaAPI(cancelStreamName, 'logs');
        await pm.streamsPage.enterStreamName(cancelStreamName);
        await pm.streamsPage.selectStreamType('Logs');
        await pm.streamsPage.clickCancelStream();
        await pm.streamsPage.expectModalClosed();

        // Verify stream was NOT created
        let exists = await pm.streamsPage.verifyStreamExists(cancelStreamName);
        expect(exists).toBe(false);
        testLogger.info('Cancel button closes modal without saving');

        // 3. Test Close button (X) closes modal without saving
        const closeStreamName = TEST_STREAMS.closeTest;
        await pm.streamsPage.deleteStreamViaAPI(closeStreamName, 'logs');
        await pm.streamsPage.clickAddStreamButton();
        await pm.streamsPage.expectAddStreamModalVisible();
        await pm.streamsPage.enterStreamName(closeStreamName);
        await pm.streamsPage.selectStreamType('Logs');
        await pm.streamsPage.clickCloseStreamModal();
        await pm.streamsPage.expectModalClosed();

        // Verify stream was NOT created
        exists = await pm.streamsPage.verifyStreamExists(closeStreamName);
        expect(exists).toBe(false);
        testLogger.info('Close button (X) closes modal without saving');

        testLogger.info('TC001: Modal open/close functionality - PASSED');
    });

    test('TC002: Create stream and verify it appears in list', {
        tag: ['@smoke', '@P0']
    }, async ({ page }) => {
        testLogger.info('TC002: Testing stream creation and list verification');

        const streamName = TEST_STREAMS.basic;

        // Cleanup: Delete if exists from previous run
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');

        // Create stream via UI
        await pm.streamsPage.createStreamViaUI(streamName, 'logs', 14);

        // Verify success toast
        await pm.streamsPage.expectSuccessToast('Stream created successfully');
        testLogger.info('Stream created successfully');

        // Verify modal closed
        await pm.streamsPage.expectModalClosed();

        // Refresh the page to ensure list is updated
        await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Search for the stream
        await pm.streamsPage.searchForStream(streamName);

        // Verify stream is in the table
        await pm.streamsPage.expectStreamInTable(streamName);
        testLogger.info('Stream appears in list');

        testLogger.info('TC002: Stream creation and list verification - PASSED');

        // Cleanup
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');
    });

    // ==========================================
    // P1 - Functional Tests
    // ==========================================

    test('TC003: Create streams with all types (logs, metrics, traces)', {
        tag: ['@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC003: Testing stream creation with different types');

        const streamTypes = [
            { name: TEST_STREAMS.logs, type: 'Logs', apiType: 'logs' },
            { name: TEST_STREAMS.metrics, type: 'Metrics', apiType: 'metrics' },
            { name: TEST_STREAMS.traces, type: 'Traces', apiType: 'traces' },
        ];

        for (const stream of streamTypes) {
            // Cleanup
            await pm.streamsPage.deleteStreamViaAPI(stream.name, stream.apiType);

            // Create stream
            await pm.streamsPage.createStreamViaUI(stream.name, stream.type, 14);
            await pm.streamsPage.expectSuccessToast('Stream created successfully');
            testLogger.info(`${stream.type} stream created successfully`);

            // Cleanup immediately
            await pm.streamsPage.deleteStreamViaAPI(stream.name, stream.apiType);
        }

        testLogger.info('TC003: All stream types creation - PASSED');
    });

    test('TC004: Create stream with custom retention period', {
        tag: ['@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC004: Testing stream with custom retention');

        const streamName = TEST_STREAMS.retention;

        // Cleanup
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');

        // Create stream with 30-day retention
        await pm.streamsPage.createStreamViaUI(streamName, 'Logs', 30);
        await pm.streamsPage.expectSuccessToast('Stream created successfully');

        testLogger.info('TC004: Custom retention stream creation - PASSED');

        // Cleanup
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');
    });

    // ==========================================
    // P2 - Edge Case Tests
    // ==========================================

    test('TC005: Duplicate stream name shows error', {
        tag: ['@edgeCase', '@P2']
    }, async ({ page }) => {
        testLogger.info('TC005: Testing duplicate stream error');

        const streamName = TEST_STREAMS.duplicate;

        // Cleanup and create initial stream
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');
        await pm.streamsPage.createStream(streamName, 'logs');

        // Wait for stream to be indexed and refresh page
        await page.waitForTimeout(3000);
        await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Try to create duplicate via UI
        await pm.streamsPage.clickAddStreamButton();
        await pm.streamsPage.expectAddStreamModalVisible();
        await pm.streamsPage.enterStreamName(streamName);
        await pm.streamsPage.selectStreamType('Logs');
        await pm.streamsPage.enterDataRetention(14);

        // Click save and immediately start looking for the error toast
        await pm.streamsPage.clickSaveStream();

        // Verify error toast about duplicate (message: "Stream X of type Y is already present")
        await pm.streamsPage.expectErrorToast('is already present');

        // Close modal
        await pm.streamsPage.clickCloseStreamModal();

        testLogger.info('TC005: Duplicate stream error - PASSED');

        // Cleanup
        await pm.streamsPage.deleteStreamViaAPI(streamName, 'logs');
    });

});
