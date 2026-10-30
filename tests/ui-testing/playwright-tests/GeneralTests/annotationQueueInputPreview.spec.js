const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { itemFixture, stubWorkbenchApi } = require('../utils/queue-workbench-fixtures.js');

// Queue Workbench captures the input preview server-side with no API to seed a canned
// preview, so the spec stubs deterministic responses (see queue-workbench-fixtures.js)
// and asserts the real rendered DOM. The feature is enterprise-only — its route is absent
// on the OSS binary, so tests probe availability once and skip on OSS.
const featureAvailable = {};
const WORKBENCH_ENT_ONLY =
    'AI Queue Workbench is an enterprise-only feature — absent in the OSS build';

test.describe("LLM Annotation Queue Input Preview testcases", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    test("renders the input preview as the primary label with the ref id demoted to secondary text", {
        tag: ['@annotationQueueInputPreview', '@rendering', '@P0', '@all'],
    }, async ({ page }) => {
        const items = [
            itemFixture({ id: 'item-preview-1', refId: 'trace-a', inputPreview: 'How do I rotate keys?' }),
            itemFixture({ id: 'item-preview-2', refId: 'trace-b', inputPreview: 'Why is the chart flat?' }),
        ];
        await stubWorkbenchApi(page, { queueId: 'fixture-queue-1', items });

        if (featureAvailable.workbench === false) test.skip(true, WORKBENCH_ENT_ONLY);
        testLogger.info('Opening the Queue Workbench with two previewed items');
        featureAvailable.workbench = await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-1');
        test.skip(!featureAvailable.workbench, WORKBENCH_ENT_ONLY);

        await pm.queueWorkbenchPage.expectNavPreviewText(0, 'How do I rotate keys?');
        await pm.queueWorkbenchPage.expectNavItemContainsText(0, 'trace-a');
        await pm.queueWorkbenchPage.expectNavPreviewText(1, 'Why is the chart flat?');

        testLogger.info('Test completed');
    });

    test("falls back to the ref id when no input preview was captured", {
        tag: ['@annotationQueueInputPreview', '@rendering', '@fallback', '@P0', '@all'],
    }, async ({ page }) => {
        const items = [
            itemFixture({ id: 'item-null-1', refId: 'trace-a', inputPreview: null }),
        ];
        await stubWorkbenchApi(page, { queueId: 'fixture-queue-2', items });

        if (featureAvailable.workbench === false) test.skip(true, WORKBENCH_ENT_ONLY);
        testLogger.info('Opening the Queue Workbench with a null-preview item');
        featureAvailable.workbench = await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-2');
        test.skip(!featureAvailable.workbench, WORKBENCH_ENT_ONLY);

        await pm.queueWorkbenchPage.expectNavItemContainsText(0, 'trace-a');
        await pm.queueWorkbenchPage.expectNavPreviewAbsent(0);

        testLogger.info('Test completed');
    });

    test("backfills the navigator with the preview returned by the detail endpoint for an older item", {
        tag: ['@annotationQueueInputPreview', '@backfill', '@P1', '@all'],
    }, async ({ page }) => {
        const listItem = itemFixture({ id: 'item-old-1', refId: 'trace-old', inputPreview: null });
        const detailItem = itemFixture({
            id: 'item-old-1',
            refId: 'trace-old',
            inputPreview: 'Why is the chart flat?',
        });
        await stubWorkbenchApi(page, {
            queueId: 'fixture-queue-3',
            items: [listItem],
            detailItem,
        });

        if (featureAvailable.workbench === false) test.skip(true, WORKBENCH_ENT_ONLY);
        testLogger.info('Opening the Queue Workbench with a null-preview item whose detail carries a preview');
        featureAvailable.workbench = await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-3');
        test.skip(!featureAvailable.workbench, WORKBENCH_ENT_ONLY);

        await pm.queueWorkbenchPage.expectNavPreviewText(0, 'Why is the chart flat?');
        await pm.queueWorkbenchPage.expectNavItemContainsText(0, 'trace-old');

        testLogger.info('Test completed');
    });

    test("renders the empty state when the queue has no items", {
        tag: ['@annotationQueueInputPreview', '@emptyState', '@P2', '@all'],
    }, async ({ page }) => {
        await stubWorkbenchApi(page, { queueId: 'fixture-queue-4', items: [] });

        if (featureAvailable.workbench === false) test.skip(true, WORKBENCH_ENT_ONLY);
        testLogger.info('Opening the Queue Workbench with an empty queue');
        featureAvailable.workbench = await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-4');
        test.skip(!featureAvailable.workbench, WORKBENCH_ENT_ONLY);

        await pm.queueWorkbenchPage.expectEmptyVisible();
        await pm.queueWorkbenchPage.expectNavItemAbsent(0);

        testLogger.info('Test completed');
    });
});
