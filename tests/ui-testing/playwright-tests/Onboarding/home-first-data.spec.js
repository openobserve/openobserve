const fs = require('fs');
const path = require('path');
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { EmptyPagesPage } = require('../../pages/generalPages/emptyPagesPage.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const DAY_US = 24 * 60 * 60 * 1_000_000;
const THEMES = ['light', 'dark'];
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

async function openHome(page, orgId, tab) {
    await page.evaluate((t) => localStorage.setItem('o2_home_active_tab', t), tab);
    await page.goto(`${base()}/web/?org_identifier=${orgId}`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
}

const tid = (page, id) => page.locator(`[data-test="${id}"]`);

async function expectNoOverviewToolbar(page) {
    await expect(tid(page, 'date-time-btn')).toHaveCount(0);
}

const SCREENS = [
    {
        id: 'h-home-overview-empty',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const sectionRequests = [];
            page.on('request', (r) => { if (OVERVIEW_SECTIONS.some((p) => p.test(r.url()))) sectionRequests.push(r.url()); });
            await openHome(page, orgId, 'overview');
            const card = page.locator('[data-test="first-data-panel"][data-variant="compact"]');
            await expect(card).toHaveAttribute('data-pick', 'kubernetes', { timeout: 30000 });
            await expect(card).toContainText('Incidents, anomalies and service health show here once your Kubernetes setup');
            await expect(card).not.toContainText(orgId);
            await expect(tid(page, 'first-data-panel-copy-btn')).toBeVisible();
            await expect(tid(page, 'home-first-data-alternatives')).toContainText('Or start another way');
            await expect(tid(page, 'home-no-data-all-sources-link')).toBeVisible();
            await expectNoOverviewToolbar(page);
            expect(sectionRequests).toEqual([]);
        },
    },
    {
        id: 'h-home-overview-empty-no-pick',
        emptyOrg: true,
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            const hero = tid(page, 'home-first-data-hero');
            await expect(hero).toContainText('Start sending data to OpenObserve', { timeout: 30000 });
            await expect(hero.locator('[data-test="first-event-status"]')).toHaveAttribute('data-state', 'waiting');
            await expect(hero.locator('[data-test="home-no-data-description"]')).not.toContainText(orgId);
            await expect(tid(page, 'home-no-data-logs-card')).toBeVisible();
            await expect(tid(page, 'home-no-data-all-sources-link')).toBeVisible();
            await expectNoOverviewToolbar(page);
        },
    },
    {
        id: 'h-home-usage-empty',
        emptyOrg: true,
        pick: 'kubernetes',
        async init({ page }) { await pinTrial(page); },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'usage');
            await expect(page.locator('[data-test="first-data-panel"][data-variant="compact"]')).toContainText('Streams, events and ingested size show here', { timeout: 30000 });
            await expect(tid(page, 'trial-period-compare-plans-btn')).toBeVisible({ timeout: 20000 });
            await expect(tid(page, 'home-first-data-alternatives')).toBeVisible();
            await expect(tid(page, 'home-usage-tab-no-data')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-usage-empty-no-pick',
        emptyOrg: true,
        async init({ page }) { await pinTrial(page); },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'usage');
            await expect(tid(page, 'home-first-data-hero')).toContainText('Streams, events and ingested size show here', { timeout: 30000 });
            await expect(tid(page, 'trial-period-compare-plans-btn')).toBeVisible({ timeout: 20000 });
            await expect(tid(page, 'home-first-data-hero').locator('[data-test="first-event-status"]')).toBeVisible();
        },
    },
    {
        id: 'h-home-overview-arrived',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const stream = await stubFirstStream(page, orgId);
            await openHome(page, orgId, 'overview');
            await expect(page.locator('[data-test="first-data-panel"][data-variant="compact"]')).toBeVisible({ timeout: 30000 });
            await page.waitForTimeout(6000);
            const loads = [];
            page.on('load', () => loads.push(Date.now()));
            stream.arrived = true;
            await expect(tid(page, 'first-data-panel-arrived')).toBeVisible({ timeout: 40000 });
            await expect(tid(page, 'first-data-panel-arrived-open-btn')).toHaveText(/Open in Logs/);
            await expect(tid(page, 'first-data-panel-arrived-summary')).toHaveText('1,204 records in stream default');
            await expect(tid(page, 'overview-not-monitored-empty-state')).toBeVisible({ timeout: 20000 });
            await expect(tid(page, 'overview-not-monitored-alert-card')).toBeVisible();
            expect(loads).toEqual([]);
        },
    },
    {
        id: 'h-home-overview-error',
        async run({ page, orgId }) {
            await failSections(page, 500);
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'overview-load-error-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'overview-load-error-retry-card')).toBeVisible();
            await expect(tid(page, 'first-data-panel')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-summary-error',
        async init({ page }) {
            await answerSectionsEmpty(page);
            await page.route(/\/api\/[^/]+\/summary(\?.*)?$/, (route) => route.fulfill({ status: 500, json: { code: 500, message: 'stubbed failure' } }));
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'overview-load-error-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'overview-load-error-retry-card')).toBeVisible();
            await expect(tid(page, 'overview-not-monitored-empty-state')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-check-again',
        emptyOrg: true,
        pick: 'kubernetes',
        async init({ page }) { await page.clock.install(); },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            const status = page.locator('[data-test="first-data-panel"] [data-test="first-event-status"]');
            await expect(status).toHaveAttribute('data-state', 'waiting', { timeout: 30000 });
            await page.clock.fastForward(61 * 60 * 1000);
            await expect(status).toHaveAttribute('data-state', 'stopped', { timeout: 20000 });
            await expect(status).toContainText('No data arrived in 60 minutes');
            await expect(tid(page, 'first-event-status-restart-btn')).toBeVisible();
        },
    },
    {
        id: 'h-home-overview-check-again-restarted',
        emptyOrg: true,
        pick: 'kubernetes',
        async init({ page }) { await page.clock.install(); },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            const status = page.locator('[data-test="first-data-panel"] [data-test="first-event-status"]');
            await expect(status).toHaveAttribute('data-state', 'waiting', { timeout: 30000 });
            await page.clock.fastForward(61 * 60 * 1000);
            await expect(status).toHaveAttribute('data-state', 'stopped', { timeout: 20000 });
            await tid(page, 'first-event-status-restart-btn').click();
            await expect(status).toHaveAttribute('data-state', 'waiting', { timeout: 10000 });
            await page.clock.fastForward(12 * 1000);
            await expect(status).toContainText('Checking every 5 s');
            await expect(status).toContainText('started 12 s ago');
            await expect(tid(page, 'first-event-status-restart-btn')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-no-permission',
        emptyOrg: true,
        pick: 'kubernetes',
        async init({ page }) {
            await page.route(/\/api\/[^/]+\/streams\?.*type=logs/, (route) => route.fulfill({ status: 403, json: { code: 403, message: 'Unauthorized Access' } }));
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'home-no-access-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'first-data-panel')).toHaveCount(0);
            await expect(tid(page, 'first-event-status')).toHaveCount(0);
            await expectNoOverviewToolbar(page);
        },
    },
    {
        id: 'h-home-usage-no-permission',
        emptyOrg: true,
        pick: 'kubernetes',
        async init({ page }) {
            await pinTrial(page);
            await page.route(/\/api\/[^/]+\/streams\?.*type=logs/, (route) => route.fulfill({ status: 403, json: { code: 403, message: 'Unauthorized Access' } }));
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'usage');
            await expect(tid(page, 'home-no-access-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'trial-period-container')).toBeVisible({ timeout: 20000 });
            await expect(tid(page, 'first-event-status')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-usage-data-trial',
        async init({ page }) { await pinTrial(page); },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'usage');
            await expect(tid(page, 'trial-period-compare-plans-btn')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'trial-period-contact-support-btn')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-error-flag-off',
        async init({ page }) {
            await pinConfig(page, { restricted_routes_on_empty_data: false });
            await failSections(page, 500);
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'overview-load-error-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'first-data-panel')).toHaveCount(0);
            await expect(tid(page, 'first-event-status')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-empty-flag-off',
        emptyOrg: true,
        async init({ page }) { await pinConfig(page, { restricted_routes_on_empty_data: false }); },
        async run({ page, orgId }) {
            const streamReads = [];
            page.on('request', (r) => { if (/\/api\/[^/]+\/streams\?/.test(r.url())) streamReads.push(r.url()); });
            await openHome(page, orgId, 'overview');
            const hero = tid(page, 'home-first-data-hero');
            await expect(hero).toBeVisible({ timeout: 30000 });
            await expect(hero).toContainText('Start sending data to OpenObserve');
            await expect(hero).toContainText('Alerts and recent events show here once it arrives. Pick how you want to start.');
            await expect(hero).not.toContainText(orgId);
            for (const id of ['logs-card', 'traces-card', 'metrics-card', 'otel-btn', 'kubernetes-btn', 'aws-btn', 'all-sources-link']) {
                await expect(tid(page, `home-no-data-${id}`)).toBeVisible();
            }
            await expect(tid(page, 'date-time-btn')).toBeVisible();
            await expect(page.locator('[data-test="home-page"] [data-test="refresh-button"]')).toBeVisible();
            await expect(page.locator('[data-test="home-page"]').getByText('just now')).toBeVisible();
            await expect(tid(page, 'first-data-panel')).toHaveCount(0);
            await expect(tid(page, 'first-event-status')).toHaveCount(0);
            // the load's one-shot first-data notice probes are all; no watcher polls behind the flag-off hero
            await page.waitForTimeout(2000);
            const settled = streamReads.length;
            await page.waitForTimeout(10000);
            expect(streamReads.slice(settled)).toEqual([]);
            await page.locator('[data-test="home-page"] [data-test="refresh-button"]').click();
            await expect(hero).toBeVisible({ timeout: 30000 });
            await expect(page.locator('[data-test="home-page"]').getByText('just now')).toBeVisible();
            await page.mouse.move(760, 880);
        },
    },
    {
        id: 'h-home-overview-empty-flag-off-probe-error',
        emptyOrg: true,
        async init({ page }) {
            await pinConfig(page, { restricted_routes_on_empty_data: false });
            await page.route(/\/api\/[^/]+\/streams\?/, (route) => route.fulfill({ status: 500, json: { code: 500, message: 'stubbed failure' } }));
        },
        async run({ page, orgId }) {
            const streamReads = [];
            page.on('request', (r) => { if (/\/api\/[^/]+\/streams\?/.test(r.url())) streamReads.push(r.url()); });
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'overview-load-error-empty-state')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'overview-load-error-retry-card')).toBeVisible();
            await expect(tid(page, 'home-first-data-hero')).toHaveCount(0);
            await expect(tid(page, 'first-data-panel')).toHaveCount(0);
            await expect(page.locator('[data-test="home-page"]').getByText('just now')).toHaveCount(0);
            const beforeRetry = streamReads.length;
            await tid(page, 'overview-load-error-retry-card').click();
            await expect.poll(() => streamReads.length, { timeout: 15000 }).toBeGreaterThan(beforeRetry);
            await expect(tid(page, 'overview-load-error-empty-state')).toBeVisible({ timeout: 30000 });
            await page.mouse.move(760, 880);
        },
    },
    {
        id: 'h-home-overview-section-error',
        async init({ page }) {
            await pinConfig(page, { restricted_routes_on_empty_data: false, anomaly_detection_enabled: true });
            await failSections(page, 500, [OVERVIEW_SECTIONS[1]]);
            const now = Date.now() * 1000;
            await page.route(OVERVIEW_SECTIONS[0], (route) => route.fulfill({
                json: {
                    total: 4,
                    hits: [
                        { id: 'h1', alert_name: 'Pod restarts above 5 in 10 minutes', stream_name: 'k8s_logs', status: 'firing', timestamp: now - 120e6 },
                        { id: 'h2', alert_name: 'Checkout p95 latency over 800 ms', stream_name: 'checkout_traces', status: 'firing', timestamp: now - 360e6 },
                        { id: 'h3', alert_name: '5xx rate on ingress', stream_name: 'nginx_access', status: 'error', timestamp: now - 540e6 },
                        { id: 'h4', alert_name: 'Card declines spike', stream_name: 'payments_logs', status: 'firing', timestamp: now - 720e6 },
                    ],
                },
            }));
            const node = (id, error_rate, requests) => ({ id, label: id, error_rate, requests, p95_latency_ns: 0 });
            await page.route(OVERVIEW_SECTIONS[3], (route) => route.fulfill({
                json: {
                    nodes: [node('checkout', 6.2, 1800), node('payments', 0.4, 940), node('frontend', 0.1, 12600), node('cart', 0, 2100), node('inventory', 0.2, 610)],
                    edges: [],
                },
            }));
            await page.route(OVERVIEW_SECTIONS[2], (route) => route.fulfill({ json: { incidents: [], total: 0 } }));
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            await expect(tid(page, 'overview-anomalies-load-error')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'overview-anomalies-load-error-retry-btn')).toBeVisible();
            await expect(tid(page, 'overview-recent-events-section')).toBeVisible();
            await expect(tid(page, 'overview-services-section')).toBeVisible();
            await expect(tid(page, 'overview-load-error-empty-state')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-section-states',
        async init({ page }) {
            await answerSectionsEmpty(page);
            await pinSummaryRules(page);
            await stubOverview(page, { json: overviewWithGaps() });
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            const tileValue = (key) => page.locator(`[data-test="overview-headline-${key}"] [data-test="overview-tile-value"]`);
            const tileNote = (key) => page.locator(`[data-test="overview-headline-${key}"] [data-test="overview-tile-note"]`);

            await expect(tid(page, 'overview-status-danger')).toBeVisible({ timeout: 30000 });
            await expect(tid(page, 'overview-status-text')).toHaveText('Needs attention');
            await expect(page.locator('[data-test^="overview-status-item-"]')).toHaveText(['1 alert firing']);
            await expect(tid(page, 'overview-status-clear')).toHaveCount(0);

            await expect(tileValue('firing')).toHaveText('1');
            await expect(tileValue('failing')).toHaveText('0');
            await expect(tileValue('delivery')).toHaveText('0');
            await expect(tileValue('pipelines')).toHaveText('—');
            await expect(tileNote('pipelines')).toHaveText('No access');
            await expect(tileValue('quiet')).toHaveText('—');
            await expect(tileNote('quiet')).toHaveText('Could not load');

            await expect(tid(page, `overview-alerts-firing-${FIRING_RULE}`)).toBeVisible();
            await expect(tid(page, 'overview-alerts-error')).toHaveCount(0);
            await expect(tid(page, 'overview-alerts-forbidden')).toHaveCount(0);

            await expect(tid(page, 'overview-data-health-status-pipelines')).toHaveText('No access');
            await expect(tid(page, 'overview-data-health-value-pipelines')).toHaveText('—');
            await expect(tid(page, 'overview-data-health-status-quiet')).toHaveText('Could not load');
            await expect(tid(page, 'overview-data-health-value-quiet')).toHaveText('—');
            await expect(tid(page, 'overview-data-health-retry-btn')).toHaveCount(0);

            await expect(tid(page, 'overview-streams-error')).toBeVisible();
            await expect(tid(page, 'overview-streams-retry-btn')).toBeVisible();
            await expect(tid(page, 'overview-streams-top')).toHaveCount(0);

            await expect(tid(page, 'overview-load-error-empty-state')).toHaveCount(0);
            await expect(tid(page, 'overview-no-access-empty-state')).toHaveCount(0);
        },
    },
    {
        id: 'h-home-overview-forbidden',
        async init({ page }) {
            await failSections(page, 403);
            await stubOverview(page, { status: 403, json: { code: 403, message: 'Unauthorized Access' } });
        },
        async run({ page, orgId }) {
            await openHome(page, orgId, 'overview');
            const noAccess = tid(page, 'overview-no-access-empty-state');
            await expect(noAccess).toBeVisible({ timeout: 30000 });
            await expect(noAccess).toContainText("You don't have access");
            await expect(tid(page, 'overview-load-error-empty-state')).toHaveCount(0);
            await expect(tid(page, 'overview-load-error-retry-card')).toHaveCount(0);
            await expect(page.locator('[data-test$="-retry-btn"]')).toHaveCount(0);
            await expect(tid(page, 'overview-headline-strip')).toHaveCount(0);
            await expect(page.locator('[data-test="home-page"] [data-test="refresh-button"]')).toHaveCount(0);
            await expectNoOverviewToolbar(page);
            await expect(page.locator('[data-test^="o-toast-"]')).toHaveCount(0);
        },
    },
];

test.describe('Home before and at first data', () => {
    const only = (process.env.SHOTS_ONLY || '').split(',').filter(Boolean);
    const shotsDir = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', 'playwright-results', 'onboarding-shots');

    for (const theme of THEMES) {
        for (const screen of SCREENS) {
            if (only.length && !only.some((p) => screen.id === p)) continue;
            test(`${screen.id} ${theme}`, { tag: ['@onboarding', '@screenshots', '@P2'] }, async ({ page, request }, testInfo) => {
                test.setTimeout(180000);
                await page.setViewportSize({ width: 1440, height: 900 });
                testLogger.testStart(testInfo.title, testInfo.file);
                await page.addInitScript(({ th, email }) => {
                    localStorage.setItem('theme', th);
                    if (email) sessionStorage.setItem(`connectDataSourcePromptShown:${email}`, 'true');
                }, { th: theme, email: process.env.ZO_ROOT_USER_EMAIL });
                if (screen.init) await screen.init({ page });
                await navigateToBase(page);
                const ctx = { page, request, orgId: getOrgIdentifier() };
                if (screen.emptyOrg) ctx.orgId = await emptyOrgId(page, process.env.HOME_EMPTY_ORG || 'onboarding_test');
                const ep = new EmptyPagesPage(page);
                // read outside the page, so a flag-off screen's pinned config does not hide the stack's real flag
                const cfg = await page.context().request.get(`${base()}/api/${ctx.orgId}/config`);
                const flagOn = cfg.ok() && (await cfg.json()).restricted_routes_on_empty_data === true;
                test.skip(!flagOn, 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA on (flag-off screens pin it off per page)');
                if (screen.pick) await ep.setPick(ctx.orgId, screen.pick);
                else await page.addInitScript((k) => localStorage.removeItem(k), `o2.onboarding.firstSource.${ctx.orgId}`);
                await screen.run(ctx);
                await page.waitForTimeout(800);
                fs.mkdirSync(shotsDir, { recursive: true });
                const file = path.join(shotsDir, `${screen.id}-${theme}.png`);
                await page.screenshot({ path: file });
                await testInfo.attach(`${screen.id}-${theme}`, { path: file, contentType: 'image/png' });
                await page.unrouteAll({ behavior: 'ignoreErrors' });
            });
        }
    }
});
