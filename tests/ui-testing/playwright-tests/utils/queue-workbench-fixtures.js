// Fixtures + API route stubs for the enterprise Queue Workbench input-preview spec.
// The Workbench captures the input preview server-side and exposes no API to seed a
// canned preview, so the spec serves deterministic responses via route interception
// and asserts the real rendered DOM against them.

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

module.exports = { queueFixture, itemFixture, detailFixture, stubWorkbenchApi };
