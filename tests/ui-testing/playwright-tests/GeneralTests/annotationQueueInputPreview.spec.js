const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// The Queue Workbench enqueues items with a server-side captured input preview,
// but the public API exposes no way to seed a machine score / canned preview. So
// the spec serves deterministic fixture responses via route interception and
// asserts the real rendered DOM (routing, layout, OTab tree) against them.

const ORG = () => process.env['ORGNAME'] || 'default';

function queueFixture(queueId) {
    return {
        id: queueId,
        name: 'Fixture Queue',
        description: null,
        target_dataset_id: null,
        target_dataset_name: null,
        allowed_ref_types: ['trace', 'span', 'session'],
        score_configs: [],
        reviewed_count: 0,
        total_count: 0,
    };
}

function itemFixture({ id, refId, inputPreview }) {
    return {
        id,
        queue_id: null,
        queue_name: 'Fixture Queue',
        ref_type: 'trace',
        ref_id: refId,
        ref_trace_id: null,
        ref_trace_start_time: 1700000000000000,
        input_preview: inputPreview,
        status: 'pending',
        reviewed_at: null,
        archived_at: null,
        created_at: 1700000000000000,
        updated_at: 1700000000000000,
    };
}

function detailFixture(item) {
    return {
        item,
        source_stream: '',
        content: { input: null, output: null, trace: [] },
        machine_scores: [],
        reviews: [],
    };
}

async function stubWorkbenchApi(page, { queueId, items, detailItem }) {
    const org = ORG();
    const itemMap = new Map(items.map((it) => [it.id, it]));

    await page.route(
        (url) => url.pathname === `/api/${org}/annotation_queues/${queueId}`,
        (route) => route.fulfill({ json: queueFixture(queueId) }),
    );

    await page.route(
        (url) => url.pathname === `/api/${org}/annotation_queues/items`,
        (route) => route.fulfill({ json: { list: items } }),
    );

    await page.route(
        (url) => url.pathname === `/api/${org}/score_configs`,
        (route) => route.fulfill({ json: { list: [] } }),
    );

    await page.route(
        (url) => url.pathname.startsWith(`/api/${org}/annotation_queues/${queueId}/items/`),
        (route) => {
            const itemId = route.request().url().split('/').pop();
            const item =
                detailItem && detailItem.id === itemId ? detailItem : itemMap.get(itemId) || {};
            return route.fulfill({ json: detailFixture(item) });
        },
    );
}

test.describe("LLM Annotation Queue Input Preview testcases", () => {
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

        testLogger.info('Opening the Queue Workbench with two previewed items');
        await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-1');

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

        testLogger.info('Opening the Queue Workbench with a null-preview item');
        await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-2');

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

        testLogger.info('Opening the Queue Workbench with a null-preview item whose detail carries a preview');
        await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-3');

        await pm.queueWorkbenchPage.expectNavPreviewText(0, 'Why is the chart flat?');
        await pm.queueWorkbenchPage.expectNavItemContainsText(0, 'trace-old');

        testLogger.info('Test completed');
    });

    test("renders the empty state when the queue has no items", {
        tag: ['@annotationQueueInputPreview', '@emptyState', '@P2', '@all'],
    }, async ({ page }) => {
        await stubWorkbenchApi(page, { queueId: 'fixture-queue-4', items: [] });

        testLogger.info('Opening the Queue Workbench with an empty queue');
        await pm.queueWorkbenchPage.gotoWorkbench('fixture-queue-4');

        await pm.queueWorkbenchPage.expectEmptyVisible();
        await pm.queueWorkbenchPage.expectNavItemAbsent(0);

        testLogger.info('Test completed');
    });
});
