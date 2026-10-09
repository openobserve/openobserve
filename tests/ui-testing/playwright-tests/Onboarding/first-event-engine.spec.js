const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const HOUR_US = 3600 * 1000 * 1000;
const FILTER = 'k8s_namespace_name IS NOT NULL';

async function sql(request, orgId, query, startUs, endUs) {
    const res = await request.post(`${base()}/api/${orgId}/_search?type=logs`, {
        headers: getAuthHeaders(),
        data: { query: { sql: query, start_time: startUs, end_time: endUs, from: 0, size: 1 } },
    });
    return { ok: res.ok(), hits: res.ok() ? (await res.json()).hits ?? [] : [] };
}

test.describe('First event confirming queries on the engine', () => {
    test('the ingest-window and since-anchor COUNTs confirm, and a stream without the field never does', {
        tag: ['@onboarding', '@ingestion', '@all', '@P2'],
    }, async ({ request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const orgId = getOrgIdentifier();
        const withField = `e2e_eng_k8s_${Date.now()}`;
        const withoutField = `e2e_eng_plain_${Date.now()}`;
        const nowUs = Date.now() * 1000;
        for (const [stream, record] of [
            [withField, { k8s_namespace_name: 'checkout', log: 'with field', _timestamp: nowUs - HOUR_US }],
            [withoutField, { log: 'without field' }],
        ]) {
            const res = await request.post(`${ingestionBase()}/api/${orgId}/${stream}/_json`, {
                headers: getAuthHeaders(),
                data: [record],
            });
            expect(res.ok()).toBeTruthy();
        }

        const windowStart = nowUs - 6 * HOUR_US;
        const windowEnd = nowUs + 25 * HOUR_US;
        const confirm = await sql(
            request,
            orgId,
            `SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM "${withField}" WHERE (${FILTER})`,
            windowStart,
            windowEnd,
        );
        expect(confirm.ok).toBeTruthy();
        expect(Number(confirm.hits[0].zo_count)).toBe(1);
        expect(Number(confirm.hits[0].zo_min)).toBe(nowUs - HOUR_US);

        const anchor = await sql(
            request,
            orgId,
            `SELECT COUNT(*) AS zo_count, CAST(to_unixtime(now()) AS BIGINT) AS zo_now FROM "${withField}"`,
            Date.now() * 1000 - 1_000_000,
            Date.now() * 1000,
        );
        expect(anchor.ok).toBeTruthy();
        const zoNowUs = Number(anchor.hits[0].zo_now) * 1_000_000;
        expect(Math.abs(zoNowUs - Date.now() * 1000)).toBeLessThan(5 * 60 * 1_000_000);

        const late = await request.post(`${ingestionBase()}/api/${orgId}/${withField}/_json`, {
            headers: getAuthHeaders(),
            data: [{ k8s_namespace_name: 'checkout', log: 'after the anchor' }],
        });
        expect(late.ok()).toBeTruthy();
        await expect.poll(async () => {
            const since = await sql(
                request,
                orgId,
                `SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM "${withField}" WHERE (${FILTER}) AND _timestamp >= ${zoNowUs}`,
                zoNowUs,
                zoNowUs + 2 * HOUR_US,
            );
            return since.ok ? Number(since.hits[0].zo_count) : -1;
        }, { timeout: 15000 }).toBe(1);

        const schema = await request.get(`${base()}/api/${orgId}/streams/${withoutField}/schema?type=logs`, {
            headers: getAuthHeaders(),
        });
        const fields = ((await schema.json()).schema ?? []).map((f) => f.name);
        expect(fields).not.toContain('k8s_namespace_name');
        const gated = await sql(
            request,
            orgId,
            `SELECT COUNT(*) AS zo_count FROM "${withoutField}" WHERE (${FILTER})`,
            windowStart,
            windowEnd,
        );
        expect(!gated.ok || Number(gated.hits[0]?.zo_count ?? 0) === 0).toBeTruthy();
        testLogger.info('Engine shapes verified', { withField, withoutField });
    });
});
