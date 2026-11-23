// Network stubs and org lookup for the Home first-data and Overview specs.
const { expect } = require('@playwright/test');

const DAY_US = 24 * 60 * 60 * 1_000_000;
const OVERVIEW_SECTIONS = [
    /\/api\/v2\/[^/]+\/alerts\/history/,
    /\/api\/[^/]+\/anomaly_detection(\/history)?(\?.*)?$/,
    /\/api\/v2\/[^/]+\/alerts\/incidents/,
    /\/api\/[^/]+\/traces\/service_graph\/topology\/current/,
];
const OVERVIEW_ENDPOINT = /\/api\/[^/]+\/overview(\?.*)?$/;
const FIRING_RULE = 'checkout_latency_p95';

// one firing rule, pipelines refused and streams failed, so every section state shows on one page
function overviewWithGaps() {
    const nowUs = Date.now() * 1000;
    return {
        streams: { status: 'error', error: 'stubbed failure' },
        alerts: {
            status: 'ok',
            data: {
                total: 4,
                enabled: 4,
                disabled: 0,
                by_state: { firing: 1, normal: 3, notify_failed: 0 },
                by_level: { ok: 0, warning: 0, critical: 1, no_data: 0, unclassified: 0 },
                failed_evaluation: 0,
                firing: [{ name: FIRING_RULE, stream: 'checkout_traces', level: 'critical', since: nowUs - 25 * 60 * 1_000_000 }],
                firing_by_level: { ok: 0, warning: 0, critical: 1, no_data: 0, unclassified: 0 },
            },
        },
        pipelines: { status: 'forbidden' },
        limits: { status: 'locked' },
        generated_at: nowUs,
        cached: false,
    };
}

// Cloud lets only root create orgs, so the empty screens use the stack's one empty org and never write to it.
async function emptyOrgId(page, name) {
    const id = await page.evaluate(async (n) => {
        const orgs = (await (await fetch('/api/organizations?page_num=0&page_size=100')).json()).data || [];
        return (orgs.find((o) => o.name === n) || {}).identifier;
    }, name);
    expect(id, `org ${name} on the stack`).toBeTruthy();
    return id;
}

// The first stream appears only after the watcher's baseline probe, the way a real first send lands.
async function stubFirstStream(page, orgId) {
    const state = { arrived: false };
    const nowUs = Date.now() * 1000;
    await page.route(new RegExp(`/api/${orgId}/streams\\?`), async (route) => {
        const url = new URL(route.request().url());
        const type = url.searchParams.get('type');
        if (!state.arrived || (type && type !== 'logs')) return route.fulfill({ json: { list: [], total: 0 } });
        return route.fulfill({
            json: {
                total: 1,
                list: [{
                    name: 'default',
                    stream_type: 'logs',
                    storage_type: 'disk',
                    stats: { created_at: nowUs, doc_time_min: nowUs, doc_time_max: nowUs + 1e6, doc_num: 1204, file_num: 1, storage_size: 0.1, compressed_size: 0.01 },
                    settings: {},
                }],
            },
        });
    });
    return state;
}

// The org list and the config read the flag the takeover is gated on; the flag-off screens pin it off on the flag-on stack.
async function pinConfig(page, overrides) {
    await page.route(/\/api\/[^/]+\/config(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, ...overrides } });
    });
}

// A fresh org on the local Cloud stack has no trial; the strip needs one, as Billing's own screens do.
async function pinTrial(page) {
    await page.route(/\/api\/[^/]+\/settings(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json().catch(() => ({ data: {} }));
        body.data = { ...(body.data || {}), free_trial_expiry: Date.now() * 1000 + 14.5 * DAY_US };
        await route.fulfill({ response, json: body });
    });
    await page.route(/\/billings\/list_subscription(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, provider: 'stripe' } });
    });
}

async function failSections(page, status, which = OVERVIEW_SECTIONS) {
    for (const pattern of which) {
        await page.route(pattern, (route) => route.fulfill({ status, json: { code: status, message: 'stubbed failure' } }));
    }
}

// the page-level error shows only when the overview cards fail as well; otherwise each section keeps its own Retry
async function failOverview(page, status) {
    await page.route(OVERVIEW_ENDPOINT, (route) => route.fulfill({ status, json: { code: status, message: 'stubbed failure' } }));
}

async function answerSectionsEmpty(page) {
    await page.route(OVERVIEW_SECTIONS[0], (route) => route.fulfill({ json: { total: 0, hits: [] } }));
    await page.route(OVERVIEW_SECTIONS[1], (route) => route.fulfill({ json: [] }));
    await page.route(OVERVIEW_SECTIONS[2], (route) => route.fulfill({ json: { incidents: [], total: 0 } }));
    await page.route(OVERVIEW_SECTIONS[3], (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
}

async function stubOverview(page, reply) {
    await page.route(OVERVIEW_ENDPOINT, (route) => route.fulfill(reply));
}

// an org whose summary counts no rules takes the not-monitored hero, which would hide the cards under test
async function pinSummaryRules(page) {
    await page.route(/\/api\/[^/]+\/summary(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, alerts: { ...(body.alerts || {}), num_realtime: 4, num_scheduled: 0 } } });
    });
}

module.exports = {
    OVERVIEW_SECTIONS,
    FIRING_RULE,
    overviewWithGaps,
    emptyOrgId,
    stubFirstStream,
    pinConfig,
    pinTrial,
    failSections,
    failOverview,
    answerSectionsEmpty,
    stubOverview,
    pinSummaryRules,
};
