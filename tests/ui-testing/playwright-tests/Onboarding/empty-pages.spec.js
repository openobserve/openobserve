const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { EmptyPagesPage } = require('../../pages/generalPages/emptyPagesPage.js');
const { getAuthHeaders, authedRequest, isCloudEnvironment } = require('../utils/cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

async function createEmptyOrg(page, prefix) {
    const res = await authedRequest(page, 'post', `${base()}/api/organizations`, {
        data: { name: `${prefix}_${Date.now()}` },
    });
    // Cloud answers 400 "Only root user can create organization"; its orgs come from signup only.
    test.skip(isCloudEnvironment() && !res.ok(), 'Cloud creates orgs only through signup');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return body.identifier || (body.data && body.data.identifier);
}

async function deleteOrg(page, orgId) {
    await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
}

// With ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA=true, empty pages open directly and carry the first-data panel.
test.describe('Pages before data', () => {
    test.describe.configure({ mode: 'serial' });

    test('opens Logs, Metrics, Traces, Dashboards, Home and Billing on an empty org with zero redirects', {
        tag: ['@onboarding', '@all', '@P1'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const orgId = await createEmptyOrg(page, 'e2e_empty');
        const ep = new EmptyPagesPage(page);
        try {
            test.skip(!(await ep.restrictedRoutesOn(orgId)), 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA=true');
            await ep.setPick(orgId, 'kubernetes');

            await ep.open('logs', orgId);
            await ep.expectNoRedirect('logs');
            // the empty-page suite cannot pass without the first-data panel
            await expect(ep.panelFor('logs')).toBeVisible({ timeout: 20000 });
            await expect(ep.panelFor('logs')).toHaveAttribute('data-pick', 'kubernetes');
            await expect(ep.codeBlock).toBeVisible();
            await expect(ep.status).toHaveAttribute('data-state', 'waiting');
            await expect(ep.logsCurlCard).toBeVisible();

            await ep.open('metrics', orgId);
            await ep.expectNoRedirect('metrics');
            await expect(ep.panelFor('metrics')).toBeVisible({ timeout: 20000 });

            await ep.open('traces', orgId);
            await ep.expectNoRedirect('traces');
            await expect(ep.panelFor('traces')).toBeVisible({ timeout: 20000 });

            await ep.open('dashboards', orgId);
            await ep.expectNoRedirect('dashboards');
            await expect(ep.panelFor('any')).toHaveAttribute('data-variant', 'compact', { timeout: 20000 });
            await expect(ep.copyBtn).toBeVisible();
            await expect(ep.openGuideBtn).toBeVisible();

            // the first Home tab is the AI assistant where AI is on, and the panel mounts only on Overview and Usage
            await page.evaluate(() => localStorage.setItem('o2_home_active_tab', 'overview'));
            await ep.open('', orgId);
            await expect(ep.panelFor('any')).toHaveAttribute('data-variant', 'compact', { timeout: 20000 });
            expect(ep.ingestionRedirects()).toEqual([]);

            if (isCloudEnvironment()) {
                await ep.open('billings/usage', orgId);
                await ep.expectNoRedirect('billings');
            }

            await ep.open('ingestion', orgId);
            await page.waitForTimeout(2000);
            await expect(ep.redirectionBanner).toHaveCount(0);
        } finally {
            await deleteOrg(page, orgId);
        }
    });

    test('an org without data but with a saved dashboard mounts no first-data watcher on Dashboards', {
        tag: ['@onboarding', '@all', '@P2'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const orgId = await createEmptyOrg(page, 'e2e_dash_nodata');
        const ep = new EmptyPagesPage(page);
        try {
            test.skip(!(await ep.restrictedRoutesOn(orgId)), 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA=true');
            await ep.setPick(orgId, 'kubernetes');
            const created = await authedRequest(page, 'post', `${base()}/api/${orgId}/dashboards?folder=default`, {
                data: { version: 8, title: 'Imported before data', description: '', tabs: [{ tabId: 'default', name: 'Default', panels: [] }] },
            });
            expect(created.ok()).toBeTruthy();

            const probes = [];
            page.on('request', (req) => {
                const url = new URL(req.url());
                if (url.pathname === `/api/${orgId}/streams` && url.searchParams.get('limit') === '1') probes.push(req.url());
            });
            await ep.open('dashboards', orgId);
            await expect(page.locator('[data-test="dashboard-table"]').getByText('Imported before data')).toBeVisible({ timeout: 20000 });
            // the watcher probes at once and then every 5 s; the flag-on notice reuses the layout's list and sends none
            await page.waitForTimeout(7000);
            expect(probes).toEqual([]);
            await expect(page.locator('[data-test="first-data-panel"]')).toHaveCount(0);
            await expect(ep.status).toHaveCount(0);
        } finally {
            await deleteOrg(page, orgId);
        }
    });

    test('a metrics-only org still shows the Logs panel, and the first logs re-query the page in place', {
        tag: ['@onboarding', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const orgId = await createEmptyOrg(page, 'e2e_metrics_only');
        const ep = new EmptyPagesPage(page);
        try {
            test.skip(!(await ep.restrictedRoutesOn(orgId)), 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA=true');
            const metric = await request.post(`${ingestionBase()}/api/${orgId}/ingest/metrics/_json`, {
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                data: [{ __name__: 'e2e_first_data_gauge', __type__: 'gauge', _timestamp: Date.now(), value: 1 }],
            });
            expect(metric.ok()).toBeTruthy();
            await ep.setPick(orgId, 'kubernetes');

            await ep.open('logs', orgId);
            await ep.expectNoRedirect('logs');
            await expect(ep.panelFor('logs')).toBeVisible({ timeout: 20000 });
            await expect(ep.status).toHaveAttribute('data-state', 'waiting');
            const loadsBefore = ep.loads;

            const logs = await request.post(`${ingestionBase()}/api/${orgId}/default/_json`, {
                headers: getAuthHeaders(),
                data: [{ level: 'info', log: 'first logs while Logs is open' }],
            });
            expect(logs.ok()).toBeTruthy();

            await expect(ep.arrived).toBeVisible({ timeout: 30000 });
            await expect(ep.arrived).toContainText('in stream default');
            await expect(ep.panelFor('logs')).toHaveCount(0, { timeout: 30000 });
            await ep.expectLogsRows(1);
            expect(ep.loads).toBe(loadsBefore);
        } finally {
            await deleteOrg(page, orgId);
        }
    });

    test('with no pick the existing cards stay and only the status line is added', {
        tag: ['@onboarding', '@all', '@P2'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        const orgId = await createEmptyOrg(page, 'e2e_no_pick');
        const ep = new EmptyPagesPage(page);
        try {
            test.skip(!(await ep.restrictedRoutesOn(orgId)), 'needs ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA=true');
            await ep.open('logs', orgId);
            await expect(ep.panelFor('logs')).toHaveAttribute('data-pick', 'none', { timeout: 20000 });
            await expect(ep.codeBlock).toHaveCount(0);
            await expect(ep.logsNoData).toBeVisible();
            await expect(ep.logsCurlCard).toBeVisible();
        } finally {
            await deleteOrg(page, orgId);
        }
    });
});
