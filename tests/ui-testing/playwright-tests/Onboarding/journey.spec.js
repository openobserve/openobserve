const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { authedRequest, getAuthHeaders } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { OnboardingPage } = require('../../pages/generalPages/getStartedPage.js');
const { generateHexId } = require('../utils/trace-ingestion.js');

const apiBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const uiBase = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const CLICK_LOG = 'e2e.journey.clicks';
const FORBIDDEN_CLICK = /(reveal-btn|troubleshoot|test-btn|recheck)/;

async function createOrg(page) {
    const res = await authedRequest(page, 'post', `${uiBase()}/api/organizations`, { data: { name: `e2e_journey_${Date.now()}` } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return body.identifier || (body.data && body.data.identifier);
}

// The token the setup card puts in its commands: base64(email:org passcode).
async function orgToken(request, orgId) {
    const res = await request.get(`${apiBase()}/api/${orgId}/passcode`, { headers: getAuthHeaders() });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const { user, passcode } = body?.data ?? {};
    return Buffer.from(`${user || process.env.ZO_ROOT_USER_EMAIL}:${passcode}`).toString('base64');
}

// One span over OTLP HTTP, as an app with the OpenTelemetry SDK sends it.
async function sendTrace(request, orgId, token) {
    const nowNs = BigInt(Date.now()) * 1000000n;
    const res = await request.post(`${apiBase()}/api/${orgId}/v1/traces`, {
        headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json', 'stream-name': 'default' },
        data: {
            resourceSpans: [{
                resource: { attributes: [{ key: 'service.name', value: { stringValue: 'e2e-onboarding-journey' } }] },
                scopeSpans: [{
                    scope: { name: 'e2e' },
                    spans: [{
                        traceId: generateHexId(16),
                        spanId: generateHexId(8),
                        name: 'GET /checkout',
                        kind: 2,
                        startTimeUnixNano: String(nowNs - 5000000n),
                        endTimeUnixNano: String(nowNs),
                        attributes: [],
                        status: { code: 1 },
                    }],
                }],
            }],
        },
    });
    expect(res.status()).toBe(200);
}

// Every trusted pointer press and Enter key, logged by the page itself so the count does not trust the test's own tally.
async function recordInteractions(page) {
    await page.addInitScript((key) => {
        const log = (kind, target) => {
            const path = [];
            for (let el = target; el && el.getAttribute; el = el.parentElement) {
                const id = el.getAttribute('data-test');
                if (id) path.push(id);
            }
            const entries = JSON.parse(sessionStorage.getItem(key) || '[]');
            entries.push({ kind, path });
            sessionStorage.setItem(key, JSON.stringify(entries));
        };
        window.addEventListener('pointerdown', (e) => { if (e.isTrusted) log('pointer', e.target); }, true);
        window.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Enter') log('enter', e.target); }, true);
    }, CLICK_LOG);
}

// First login to the first trace in Traces, inside onboarding: pick, guide, data, Explore Your Traces.
test.describe('First data journey', () => {
    let orgId;

    test.afterEach(async ({ page }) => {
        if (orgId) await authedRequest(page, 'delete', `${uiBase()}/api/organizations/${orgId}`).catch(() => {});
    });

    test('Backend, any language with OpenTelemetry, a trace arrives, Explore Your Traces', {
        tag: ['@onboarding', '@journey', '@cloud', '@P1'],
    }, async ({ page, request }, testInfo) => {
        test.skip(!isCloudEnvironment(), 'Onboarding is cloud-only');
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        // Onboarding serves only an org with no data, so the journey runs in a fresh one.
        orgId = await createOrg(page);
        const ob = new OnboardingPage(page);
        await ob.captureAttribution({ passThrough: true });
        await recordInteractions(page);
        await ob.openAsFirstLogin(`${uiBase()}/web/?org_identifier=${orgId}`, { orgId });
        await ob.expectStepOne();
        await page.evaluate((key) => sessionStorage.removeItem(key), CLICK_LOG);

        let interactions = 0;
        await ob.choice('backend').click(); interactions += 1;
        await ob.row('any-language-with-opentelemetry').click(); interactions += 1;
        await page.waitForURL(/\/onboarding\/backend\/any-language-with-opentelemetry/, { timeout: 20000 });
        await expect(ob.guide).toBeVisible();
        await ob.expectGuideStatus('waiting');
        await expect.poll(() => ob.attributionBodies.length).toBe(1);
        expect(ob.attributionBodies[0]).toEqual({ from: '', company: '', first_source: 'otel', skipped: false });

        await sendTrace(request, orgId, await orgToken(request, orgId));

        await expect(ob.firstData).toBeVisible({ timeout: 60000 });
        await expect(ob.firstDataOpen).toHaveText('Explore Your Traces');
        await ob.firstDataOpen.click(); interactions += 1;
        await expect(page).toHaveURL(/\/traces\?/);
        expect(new URL(page.url()).searchParams.get('stream')).toBe('default');

        const logged = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || '[]'), CLICK_LOG);
        expect(logged.filter((e) => e.path.some((id) => FORBIDDEN_CLICK.test(id)))).toEqual([]);
        expect(logged).toHaveLength(interactions);
        expect(interactions).toBe(3);
        testLogger.info('Journey reached the first trace', { interactions, logged: logged.map((e) => e.path[0]) });
    });
});
