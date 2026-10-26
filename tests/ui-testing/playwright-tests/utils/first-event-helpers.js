const { test, expect } = require('@playwright/test');
const { getAuthHeaders, authedRequest, isCloudEnvironment } = require('./cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

async function ingest(page, orgId, stream, records) {
    const res = await page.request.post(`${ingestionBase()}/api/${orgId}/${stream}/_json`, {
        headers: getAuthHeaders(),
        data: records,
    });
    expect(res.ok()).toBeTruthy();
}

async function withFreshOrg(page, tag, fn) {
    const created = await authedRequest(page, 'post', `${base()}/api/organizations`, {
        data: { name: `e2e_${tag}_${Date.now()}` },
    });
    // Cloud creates orgs only through signup, so a non-200 there means this env cannot stage the scenario.
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

// The bar's baseline probe for its own stream, so an ingest never lands before the watch has looked.
const targetProbe = (page, type, stream) =>
    page.waitForResponse(
        (r) => r.url().includes(`/streams?type=${type}&offset=0&limit=20&keyword=${stream}`),
        { timeout: 20000 },
    );

// The watcher's idle gate reads doc_num from the stream list (not search), so wait for it to be non-zero.
async function waitForStreamWithRecords(page, orgId, streamName, type = 'logs', maxWaitMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const res = await page.request.get(`${ingestionBase()}/api/${orgId}/streams?type=${type}`, {
            headers: getAuthHeaders(),
        });
        if (res.ok()) {
            const data = await res.json().catch(() => null);
            const list = Array.isArray(data?.list) ? data.list : [];
            const row = list.find((s) => s?.name === streamName);
            if (row && Number(row.stats?.doc_num ?? 0) > 0) return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
}

module.exports = { ingest, withFreshOrg, targetProbe, waitForStreamWithRecords };
