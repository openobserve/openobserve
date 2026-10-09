const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');
const { getAuthHeaders, getOrgIdentifier, authedRequest, isCloudEnvironment } = require('../utils/cloud-auth.js');

const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const HOUR_US = 3600 * 1000 * 1000;
const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

async function ingest(request, orgId, stream, records) {
    const res = await request.post(`${ingestionBase()}/api/${orgId}/${stream}/_json`, {
        headers: getAuthHeaders(),
        data: records,
    });
    expect(res.ok()).toBeTruthy();
}

// Fluent Bit's snippet writes to the default stream, so its bar watches only that stream: a fresh org keeps it new.
async function withFreshOrg(page, tag, fn) {
    const created = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name: `e2e_${tag}_${Date.now()}` } });
    test.skip(isCloudEnvironment() && !created.ok(), 'Cloud creates orgs only through signup');
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    const orgId = body.identifier || (body.data && body.data.identifier);
    try {
        await fn(orgId);
    } finally {
        await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
    }
}

// The bar's first probe for the guide's own stream, so an ingest never lands before the watch has looked.
const targetProbe = (page, type, stream) =>
    page.waitForResponse((r) => r.url().includes(`/streams?type=${type}&offset=0&limit=20&keyword=${stream}`), { timeout: 20000 });

test.describe('First event bar', () => {
    test.describe.configure({ mode: 'serial' });

    test('turns green within one poll of an API ingest with zero clicks', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const stream = 'default';
        await navigateToBase(page);
        await withFreshOrg(page, 'fe', async (orgId) => {
            const fe = new FirstEventPage(page);
            const baseline = targetProbe(page, 'logs', stream);
            await fe.openGuide('/ingestion/custom/logs/fluentbit', orgId);
            await fe.expectState('waiting');
            await expect(fe.troubleshootBtn).toBeVisible();
            await baseline;

            await ingest(request, orgId, stream, [{ level: 'info', log: 'first event e2e' }]);
            await fe.expectState('received', 6000);
            await expect(fe.summary).toContainText(stream);
            await expect(fe.firstRecord).toContainText('first event e2e');
            await expect(fe.openBtn).toHaveText(/Open in Logs/);
            testLogger.info('First event bar turned green', { stream });
        });
    });

    test('opens Logs on a record back-dated one hour, with the range around it', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const stream = 'default';
        const pastUs = Date.now() * 1000 - HOUR_US;
        await navigateToBase(page);
        await withFreshOrg(page, 'fe_past', async (orgId) => {
            const fe = new FirstEventPage(page);
            const baseline = targetProbe(page, 'logs', stream);
            await fe.openGuide('/ingestion/custom/logs/fluentbit', orgId);
            await fe.expectState('waiting');
            await baseline;

            await ingest(request, orgId, stream, [{ _timestamp: pastUs, level: 'info', log: 'back-dated e2e' }]);
            await fe.expectState('received', 10000);
            await fe.clickOpen();

            await expect(page).toHaveURL(/\/logs\?/);
            const url = new URL(page.url());
            expect(url.searchParams.get('stream')).toBe(stream);
            const from = Number(url.searchParams.get('from'));
            const to = Number(url.searchParams.get('to'));
            expect(from).toBeLessThanOrEqual(pastUs);
            expect(to).toBeGreaterThanOrEqual(pastUs);
            expect(to - from).toBe(30 * 60 * 1000 * 1000);
            await fe.expectLogsRows(1);
            testLogger.info('Open in Logs showed the back-dated record', { stream });
        });
    });

    test('hands Metrics and Traces the same range', {
        tag: ['@onboarding', '@ingestion', '@all', '@P2'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const orgId = getOrgIdentifier();
        const metric = `e2e_fe_metric_${Date.now()}`;
        await navigateToBase(page);
        const fe = new FirstEventPage(page);
        const baseline = fe.firstProbe('metrics');
        await fe.openGuide('/ingestion/custom/metrics/prometheus', orgId);
        await fe.expectState('waiting');
        await baseline;

        const sentUs = Date.now() * 1000;
        const res = await request.post(`${ingestionBase()}/api/${orgId}/ingest/metrics/_json`, {
            headers: getAuthHeaders(),
            data: [{ __name__: metric, __type__: 'gauge', _timestamp: sentUs, value: 1, host: 'e2e' }],
        });
        expect(res.ok()).toBeTruthy();
        await fe.expectState('received', 15000);
        await expect(fe.openBtn).toHaveText(/Open in Metrics/);
        await fe.clickOpen();
        await expect(page).toHaveURL(/\/metrics\?/);
        const url = new URL(page.url());
        expect(url.searchParams.get('metric')).toBe(metric);
        // The bar links in ms; the explorer rewrites its URL state in µs once loaded, so either unit is the same 30 min.
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        const perMs = to - from === 30 * 60 * 1000 ? 1 : 1000;
        expect(to - from).toBe(30 * 60 * 1000 * perMs);
        expect(from).toBeLessThanOrEqual((sentUs / 1000) * perMs);
        expect(to).toBeGreaterThanOrEqual((sentUs / 1000) * perMs);
    });
});

test.describe('First event bar on a keyword card', () => {
    test('confirms new records in an existing match other than the busiest', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const created = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name: `e2e_kw_${Date.now()}` } });
        // Cloud creates orgs only through signup, and this needs an org whose system_* streams are known
        test.skip(isCloudEnvironment() && !created.ok(), 'Cloud creates orgs only through signup');
        expect(created.ok()).toBeTruthy();
        const body = await created.json();
        const orgId = body.identifier || (body.data && body.data.identifier);
        const metric = async (name, tsUs) => {
            const res = await request.post(`${ingestionBase()}/api/${orgId}/ingest/metrics/_json`, {
                headers: getAuthHeaders(),
                data: [{ __name__: name, __type__: 'gauge', _timestamp: tsUs, value: 1, host: 'e2e-kw' }],
            });
            expect(res.ok()).toBeTruthy();
        };
        try {
            const nowUs = Date.now() * 1000;
            await metric('system_cpu_time', nowUs);
            await metric('system_disk_io', nowUs - HOUR_US);
            await metric('system_memory_usage', nowUs - 2 * HOUR_US);
            // the watcher anchors on the match with the newest doc_time_max (list order on a tie); feed only another one
            const list = await (await authedRequest(page, 'get', `${base()}/api/${orgId}/streams?type=metrics&keyword=system_&offset=0&limit=20`)).json();
            const rows = list.list.filter((s) => s.name.startsWith('system_'));
            expect(rows.length).toBe(3);
            const busiest = rows.reduce((b, r) => (!b || Number(r.stats?.doc_time_max ?? 0) > Number(b.stats?.doc_time_max ?? 0) ? r : b), undefined);
            const quiet = rows.map((r) => r.name).filter((n) => n !== busiest.name).at(-1);

            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/recommended/linux', orgId);
            await fe.expectState('waiting', 20000);
            await expect(fe.bar).toHaveAttribute('data-scope', 'since-watch-start', { timeout: 20000 });
            await page.waitForTimeout(3000);
            await metric(quiet, Date.now() * 1000);
            // two existing matches besides the busiest: the rotation reaches either within two polls
            await fe.expectState('received', 20000);
            await expect(fe.summary).toContainText(quiet);
            testLogger.info('Keyword card confirmed a non-busiest match', { busiest: busiest.name, quiet });
        } finally {
            await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
        }
    });
});
