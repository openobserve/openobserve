const fs = require('fs');
const path = require('path');
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier, authedRequest } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { GetStartedPage } = require('../../pages/generalPages/getStartedPage.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');
const { EmptyPagesPage } = require('../../pages/generalPages/emptyPagesPage.js');
import PageManager from '../../pages/page-manager.js';
import { setupTestDashboard } from '../Dashboards/utils/dashCreation.js';

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const apiBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const DAY_US = 24 * 60 * 60 * 1_000_000;
const THEMES = ['light', 'dark'];

async function createOrg(page, prefix) {
    const res = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name: `${prefix}_${Date.now()}` } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return body.identifier || (body.data && body.data.identifier);
}

async function ingest(request, orgId, stream, records, headers = getAuthHeaders()) {
    return request.post(`${apiBase()}/api/${orgId}/${stream}/_json`, { headers, data: records });
}

async function ingestMetric(request, orgId, name) {
    const res = await request.post(`${apiBase()}/api/${orgId}/ingest/metrics/_json`, {
        headers: getAuthHeaders(),
        data: [{ __name__: name, __type__: 'gauge', _timestamp: Date.now() * 1000, value: 1, host: 'web-07' }],
    });
    expect(res.ok()).toBeTruthy();
}

async function rejectOnce(request, orgId, stream) {
    const bad = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:not-the-token`).toString('base64');
    const res = await ingest(request, orgId, stream, [{ log: 'rejected' }], { Authorization: `Basic ${bad}`, 'Content-Type': 'application/json' });
    expect(res.status()).toBe(401);
}

async function openGuide(page, guidePath, orgId) {
    await page.goto(`${base()}/web${guidePath}?org_identifier=${orgId}`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
}

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
}

async function openNewPanel(page, pm) {
    await pm.dashboardCreate.addPanel();
    await page.waitForURL((url) => url.pathname.includes('add_panel'), { timeout: 30000 });
    await pm.dashboardPanelActions.getPanelSaveBtn().waitFor({ state: 'visible', timeout: 30000 });
}

async function editTitle(page, pm, title) {
    await pm.dashboardPanelActions.addPanelName(title);
    await page.waitForTimeout(1500);
}

async function pinBillingState(page, { expiry, provider, usageDelayMs = 0 }) {
    await page.route(/\/api\/[^/]+\/settings(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json().catch(() => ({ data: {} }));
        body.data = { ...(body.data || {}), free_trial_expiry: expiry ?? '' };
        await route.fulfill({ response, json: body });
    });
    await page.route(/\/billings\/list_subscription(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        await route.fulfill({ response, json: { ...body, provider } });
    });
    if (usageDelayMs) {
        await page.route(/\/billings\/data_usage/, async (route) => {
            await new Promise((r) => setTimeout(r, usageDelayMs));
            await route.continue().catch(() => {});
        });
    }
}

const SCREENS = [
    {
        id: 'a1-get-started-prefilled',
        async run({ page }) {
            const gs = new GetStartedPage(page);
            await gs.captureAttribution({ passThrough: false });
            await gs.openAsFirstLogin(`${base()}/web/?org_identifier=${getOrgIdentifier()}`, { orgId: getOrgIdentifier(), prefill: { utm_content: 'kubernetes' } });
            await gs.agree.click();
            await gs.expectPicked('kubernetes');
            await expect(gs.continueBtn).toBeEnabled();
            await expect(gs.skipBtn).toBeEnabled();
        },
        cleanup: async ({ page }) => page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')),
    },
    {
        id: 'a2-get-started-empty',
        async run({ page }) {
            const gs = new GetStartedPage(page);
            await gs.captureAttribution({ passThrough: false });
            await gs.openAsFirstLogin(`${base()}/web/?org_identifier=${getOrgIdentifier()}`, { orgId: getOrgIdentifier() });
            expect(await gs.sourceIds()).toEqual(GetStartedPage.SOURCE_IDS);
            await expect(gs.continueBtn).toBeDisabled();
            await expect(gs.skipBtn).toBeDisabled();
        },
        cleanup: async ({ page }) => page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')),
    },
    {
        id: 'a3-get-started-submitting',
        async run({ page }) {
            const gs = new GetStartedPage(page);
            await page.route(/\/api\/[^/]+\/billings\/new_user_attribution$/, () => new Promise(() => {}));
            await gs.openAsFirstLogin(`${base()}/web/?org_identifier=${getOrgIdentifier()}`, { orgId: getOrgIdentifier() });
            await gs.hearAboutUs.fill('A colleague');
            await gs.whereDoYouWork.fill('Acme');
            await gs.source('kubernetes').click();
            await gs.agree.click();
            await gs.continueBtn.click();
            await expect(gs.skipBtn).toBeDisabled();
        },
        cleanup: async ({ page }) => page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')),
    },
    {
        id: 'a4-get-started-error',
        async run({ page }) {
            const gs = new GetStartedPage(page);
            await page.route(/\/api\/[^/]+\/billings\/new_user_attribution$/, (route) => route.fulfill({ status: 500, json: { code: 500, message: 'boom' } }));
            await gs.openAsFirstLogin(`${base()}/web/?org_identifier=${getOrgIdentifier()}`, { orgId: getOrgIdentifier() });
            await gs.hearAboutUs.fill('A colleague');
            await gs.whereDoYouWork.fill('Acme');
            await gs.source('kubernetes').click();
            await gs.agree.click();
            await gs.continueBtn.click();
            await expect(page.getByText('Something went wrong').first()).toBeVisible();
            await expect(gs.title).toBeVisible();
        },
        cleanup: async ({ page }) => page.evaluate(() => localStorage.removeItem('isFirstTimeLogin')),
    },
    {
        id: 'b1-setup-kubernetes-copied',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            await page.locator('[data-test="ingestion-recommended-pick-group"]').waitFor();
            await page.locator('[data-test="ingestion-setup-code-block-pre"]').first().click();
            await expect(page.getByText(/Copied with org token|Copied/).first()).toBeVisible();
            await expect(fe.troubleshootBtn).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
        noSettle: true,
    },
    {
        id: 'b2-setup-kubernetes-received',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, request, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            const res = await ingest(request, orgId, 'default', [{ k8s_namespace_name: 'acme-prod-eks', k8s_pod_name: 'api-7d9f', level: 'info', log: 'Everything is ready.' }]);
            expect(res.ok()).toBeTruthy();
            await fe.expectState('received', 30000);
            await expect(fe.firstRecord).toBeVisible();
            await expect(fe.openBtn).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'c1-setup-curl-test-received',
        emptyOrg: true,
        pick: 'http',
        async run({ page, request, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/custom/logs/curl', orgId);
            await fe.expectState('waiting', 20000);
            await expect(fe.bar).toHaveAttribute('data-kind', 'test');
            const res = await ingest(request, orgId, 'default', [{ level: 'info', job: 'test', log: 'test message for openobserve' }]);
            expect(res.ok()).toBeTruthy();
            await fe.expectState('received', 30000);
            await expect(page.locator('[data-test="first-event-status-connect-source-btn"]')).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'c2-setup-nginx-fluentbit',
        emptyOrg: true,
        pick: 'webserver',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/servers/nginx', orgId);
            await fe.expectState('waiting', 20000);
            await expect(page.locator('[data-test="ingestion-nginx-config-code-block-pre"]')).toBeVisible();
            await expect(fe.troubleshootBtn).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'c3-setup-nginx-rejected',
        emptyOrg: true,
        pick: 'webserver',
        async run({ page, request, orgId }) {
            const fe = new FirstEventPage(page);
            await rejectOnce(request, orgId, 'nginx');
            await openGuide(page, '/ingestion/servers/nginx', orgId);
            await fe.expectState('waiting', 20000);
            await fe.clickTroubleshoot();
            await fe.expectState('rejected', 20000);
            await fe.expectDiagnosis({ trigger: 'troubleshoot' });
            await expect(fe.diagnosisCopyBtn).toHaveText(/Copy config/);
            await expect(fe.stillStuck).toBeVisible();
            await fe.stillStuck.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'd1-setup-kubernetes-rejected',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, request, orgId }) {
            const fe = new FirstEventPage(page);
            await rejectOnce(request, orgId, 'default');
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            await fe.clickTroubleshoot();
            await fe.expectState('rejected', 20000);
            await expect(fe.summary).toContainText('401 invalid credentials');
            await expect(fe.stillStuck).toBeVisible();
            await fe.stillStuck.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'd2-setup-kubernetes-no-requests',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            await fe.clickTroubleshoot();
            await fe.expectState('no-requests', 20000);
            await expect(fe.diagnosisOrgId).toHaveText(orgId);
            await expect(fe.diagnosisEndpoint).not.toHaveText('');
            await expect(fe.stillStuck).toBeVisible();
            await fe.stillStuck.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'd3-setup-kubernetes-waiting-no-diagnosis',
        emptyOrg: true,
        pick: 'kubernetes',
        timeout: 300000,
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            let reads = 0;
            await page.route(/\/api\/[^/]+\/ingest\/recent_rejections/, (route) => { reads += 1; return route.fulfill({ status: 403, json: { code: 403, message: 'Unauthorized Access' } }); });
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            await expect.poll(() => reads, { timeout: 150000, intervals: [2000] }).toBeGreaterThan(0);
            await page.waitForTimeout(1500);
            await fe.expectState('waiting');
            await expect(fe.diagnosis).toHaveCount(0);
            await expect(fe.troubleshootBtn).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'd4-setup-kubernetes-troubleshoot-unavailable',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await page.route(/\/api\/[^/]+\/ingest\/recent_rejections/, (route) => route.fulfill({ status: 403, json: { code: 403, message: 'Unauthorized Access' } }));
            await openGuide(page, '/ingestion/recommended/kubernetes', orgId);
            await fe.expectState('waiting', 20000);
            await fe.clickTroubleshoot();
            await fe.expectDiagnosis({ trigger: 'troubleshoot', reason: 'unavailable' });
            await fe.expectState('waiting');
            await expect(fe.diagnosisOrgId).toHaveText(orgId);
            await expect(fe.stillStuck).toBeVisible();
            await fe.stillStuck.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'e1-logs-empty-first-data-panel',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('logs', orgId);
            await expect(ep.panelFor('logs')).toHaveAttribute('data-pick', 'kubernetes', { timeout: 20000 });
            await expect(ep.codeBlock).toBeVisible();
            await expect(ep.status).toHaveAttribute('data-state', 'waiting');
        },
    },
    {
        id: 'e2-logs-empty-no-pick',
        emptyOrg: true,
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('logs', orgId);
            await expect(ep.panelFor('logs')).toHaveAttribute('data-pick', 'none', { timeout: 20000 });
            await expect(ep.logsCurlCard).toBeVisible();
        },
    },
    {
        id: 'e3-dashboards-empty-compact-card',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('dashboards', orgId);
            await expect(ep.panelFor('any')).toHaveAttribute('data-variant', 'compact', { timeout: 20000 });
            await expect(ep.copyBtn).toBeVisible();
            await expect(page.locator('[data-test="dashboards-first-data"] [data-test="first-data-panel"]')).toBeVisible();
            await expect(page.locator('[data-test="dashboard-table"] [data-test="first-data-panel"]')).toHaveCount(0);
        },
    },
    {
        id: 'e4-home-empty-compact-card',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            // the first Home tab is the AI assistant where AI is on, and the panel mounts only on Overview and Usage
            await page.evaluate(() => localStorage.setItem('o2_home_active_tab', 'overview'));
            await ep.open('', orgId);
            await expect(ep.panelFor('any')).toHaveAttribute('data-variant', 'compact', { timeout: 20000 });
            await expect(ep.openGuideBtn).toBeVisible();
        },
    },
    {
        id: 'e5-logs-first-data-arrived',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, request, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('logs', orgId);
            await expect(ep.panelFor('logs')).toBeVisible({ timeout: 20000 });
            const res = await ingest(request, orgId, 'default', [{ level: 'info', log: 'first logs while Logs is open' }]);
            expect(res.ok()).toBeTruthy();
            await expect(ep.arrived).toBeVisible({ timeout: 30000 });
            await expect(ep.logsResultRows.first()).toBeVisible({ timeout: 30000 });
        },
    },
    {
        id: 'e6-logs-no-permission',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            await page.route(/\/api\/[^/]+\/streams\?.*type=logs/, (route) => route.fulfill({ status: 403, json: { code: 403, message: 'Unauthorized Access' } }));
            const ep = new EmptyPagesPage(page);
            await ep.open('logs', orgId);
            await expect(page.locator('[data-test="first-data-panel-no-access"]')).toBeVisible({ timeout: 20000 });
            await expect(ep.codeBlock).toHaveCount(0);
        },
    },
    {
        id: 'f1-home-first-data-banner',
        emptyOrg: true,
        async run({ page, request, orgId }) {
            const fe = new FirstEventPage(page);
            await fe.openHome(orgId);
            await expect.poll(() => page.evaluate((o) => localStorage.getItem(`o2.onboarding.firstData.${o}`), orgId)).not.toBeNull();
            const res = await ingest(request, orgId, 'default', [{ host: 'web-07', level: 'info', log: 'arrived while away' }]);
            expect(res.ok()).toBeTruthy();
            await fe.openHome(orgId);
            await expect(fe.notice).toBeVisible({ timeout: 20000 });
            await expect(fe.noticeOpenBtn).toBeVisible();
            await expect(page.locator('[data-test="home-page"] [data-test="first-data-notice"]')).toBeVisible();
        },
    },
    {
        id: 'g1-billing-usage-trial',
        cloud: true,
        async run({ page }) {
            await pinBillingState(page, { expiry: Date.now() * 1000 + 9.5 * DAY_US, provider: 'stripe' });
            await page.goto(`${base()}/web/billings?org_identifier=${getOrgIdentifier()}`);
            await page.waitForURL(/\/billings\/usage/, { timeout: 30000 });
            await expect(page.locator('[data-test="trial-period-container"]')).toHaveAttribute('data-tone', 'info');
            await expect(page.locator('[data-test="trial-period-end-rule"]')).toBeVisible();
        },
    },
    {
        id: 'g2-billing-usage-trial-ending',
        cloud: true,
        async run({ page }) {
            await pinBillingState(page, { expiry: Date.now() * 1000 + 2.5 * DAY_US, provider: 'stripe' });
            await page.goto(`${base()}/web/billings?org_identifier=${getOrgIdentifier()}`);
            await page.waitForURL(/\/billings\/usage/, { timeout: 30000 });
            await expect(page.locator('[data-test="trial-period-container"]')).toHaveAttribute('data-tone', 'warning');
        },
    },
    {
        id: 'g3-billing-plans-trial-expired',
        cloud: true,
        async run({ page }) {
            await pinBillingState(page, { expiry: Date.now() * 1000 - 2 * DAY_US, provider: 'stripe' });
            await page.goto(`${base()}/web/billings/plans?org_identifier=${getOrgIdentifier()}`);
            await expect(page.locator('[data-test="trial-period-container"]')).toContainText('ended', { timeout: 30000 });
        },
    },
    {
        id: 'g4-billing-usage-loading',
        cloud: true,
        async run({ page }) {
            await pinBillingState(page, { expiry: Date.now() * 1000 + 9.5 * DAY_US, provider: 'stripe', usageDelayMs: 60000 });
            await page.goto(`${base()}/web/billings?org_identifier=${getOrgIdentifier()}`);
            await page.waitForURL(/\/billings\/usage/, { timeout: 30000 });
            await expect(page.locator('[data-test="trial-period-container"]')).toBeVisible();
        },
        noSettle: true,
    },
    {
        id: 'h1-billing-plans-trial',
        cloud: true,
        async run({ page }) {
            await pinBillingState(page, { expiry: Date.now() * 1000 + 9.5 * DAY_US, provider: 'stripe' });
            await page.goto(`${base()}/web/billings/plans?org_identifier=${getOrgIdentifier()}`);
            await expect(page.locator('[data-test="trial-period-contact-support-btn"]')).toBeVisible({ timeout: 30000 });
        },
    },
    {
        id: 'i1-add-panel-leave-dialog',
        dashboard: true,
        async run({ page, pm }) {
            await openNewPanel(page, pm);
            await editTitle(page, pm, 'Errors by level');
            await page.locator('[data-test="dashboard-back-btn"]').click();
            await expect(page.locator('[data-test="confirm-dialog"]')).toContainText('Your draft is kept on this browser for 7 days.');
        },
    },
    {
        id: 'i2-add-panel-discard-toast',
        dashboard: true,
        async run({ page, pm }) {
            await openNewPanel(page, pm);
            await editTitle(page, pm, 'Latency p95');
            await pm.dashboardPanelActions.getPanelDiscardBtn().click();
            await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
            await expect(page.locator('[data-test="o-toast-action-btn"]')).toBeVisible();
        },
        noSettle: true,
    },
    {
        id: 'i3-add-panel-leave-dialog-no-storage',
        dashboard: true,
        async init({ page }) {
            await page.addInitScript(() => {
                const set = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) {
                    if (String(k).startsWith('o2.dashboards.panelDraft')) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
                    return set.call(this, k, v);
                };
            });
        },
        async run({ page, pm }) {
            await openNewPanel(page, pm);
            await editTitle(page, pm, 'Errors by level');
            await page.locator('[data-test="dashboard-back-btn"]').click();
            await expect(page.locator('[data-test="confirm-dialog"]')).toContainText('Leave without saving?');
            await expect(page.locator('[data-test="confirm-dialog"]')).not.toContainText('7 days');
        },
    },
    {
        id: 'j1-add-panel-draft-offer',
        dashboard: true,
        async run({ page, pm }) {
            await openNewPanel(page, pm);
            await editTitle(page, pm, 'Errors by level');
            await page.locator('[data-test="dashboard-back-btn"]').click();
            await page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();
            await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
            await openNewPanel(page, pm);
            await expect(page.locator('[data-test="dashboard-panel-draft-offer"]')).toHaveAttribute('data-conflict', 'false');
        },
    },
    {
        id: 'j2-add-panel-draft-conflict',
        dashboard: true,
        async run({ page, pm }) {
            await openNewPanel(page, pm);
            await editTitle(page, pm, 'Errors by level');
            await page.locator('[data-test="dashboard-back-btn"]').click();
            await page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();
            await page.waitForURL((url) => !url.pathname.includes('add_panel'), { timeout: 30000 });
            // The draft's base version is moved, as a save from another tab would move the dashboard hash.
            await page.evaluate(() => {
                for (const k of Object.keys(localStorage).filter((x) => x.startsWith('o2.dashboards.panelDraft.') && !x.endsWith('.probe'))) {
                    const d = JSON.parse(localStorage.getItem(k));
                    if (d && typeof d === 'object') localStorage.setItem(k, JSON.stringify({ ...d, baseVersion: 'moved-elsewhere' }));
                }
            });
            await openNewPanel(page, pm);
            await expect(page.locator('[data-test="dashboard-panel-draft-offer"]')).toHaveAttribute('data-conflict', 'true');
            await expect(page.locator('[data-test="dashboard-panel-draft-conflict-note"]')).toBeVisible();
        },
    },
    {
        id: 'k1-setup-existing-org-token-picker',
        async run({ page, request }) {
            const orgId = getOrgIdentifier();
            const tokenName = `prod_ingest_${Date.now()}`;
            const res = await request.post(`${apiBase()}/api/${orgId}/ingestion-tokens`, { headers: getAuthHeaders(), data: { name: tokenName, description: 'k1 screen' } });
            expect(res.ok()).toBeTruthy();
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/linux', orgId);
            await fe.expectState('waiting', 20000);
            await page.locator('[data-test="ingestion-setup-code-block-pre"]').first().click();
            await page.locator('[data-test="ingestion-setup-code-block-token-link"]').first().click();
            await expect(page.locator('[data-test="ingestion-token-select-popover"]').first()).toBeVisible();
            await expect(fe.troubleshootBtn).toBeVisible();
        },
        noSettle: true,
    },
    {
        id: 'k2-setup-existing-org-received',
        emptyOrg: true,
        // The mockup's Linux card: a host whose system_* metrics already exist, so only records after the watch start count.
        async run({ page, request, orgId }) {
            await ingestMetric(request, orgId, 'system_cpu_time');
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/linux', orgId);
            await fe.expectState('waiting', 20000);
            await expect(fe.bar).toHaveAttribute('data-scope', 'since-watch-start', { timeout: 20000 });
            await page.waitForTimeout(3000);
            await ingestMetric(request, orgId, 'system_cpu_time');
            await fe.expectState('received', 40000);
            await expect(fe.summary).toBeVisible();
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'x1-traces-empty-pick',
        emptyOrg: true,
        pick: 'kubernetes',
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('traces', orgId);
            await expect(ep.panelFor('traces')).toHaveAttribute('data-pick', 'kubernetes', { timeout: 20000 });
        },
    },
    {
        id: 'x2-traces-empty-no-pick',
        emptyOrg: true,
        async run({ page, orgId }) {
            const ep = new EmptyPagesPage(page);
            await ep.open('traces', orgId);
            await expect(ep.panelFor('traces')).toHaveAttribute('data-pick', 'none', { timeout: 20000 });
        },
    },
    {
        id: 'x3-metrics-otel-collector-pick-rail',
        emptyOrg: true,
        pick: 'otel',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/custom/metrics/otelcollector', orgId);
            await fe.expectState('waiting', 20000);
            await expect(page.getByText('Your pick').first()).toBeVisible();
        },
    },
    {
        id: 'x4-aws-bar-bottom',
        emptyOrg: true,
        pick: 'cloud',
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/aws', orgId);
            await fe.expectState('waiting', 20000);
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'x5-azure-bar-bottom',
        emptyOrg: true,
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/recommended/azure', orgId);
            await fe.expectState('waiting', 20000);
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
    {
        id: 'x6-traces-otel-bar-bottom',
        emptyOrg: true,
        async run({ page, orgId }) {
            const fe = new FirstEventPage(page);
            await openGuide(page, '/ingestion/custom/traces/otel', orgId);
            await fe.expectState('waiting', 20000);
            await fe.bar.scrollIntoViewIfNeeded();
        },
    },
];

test.describe('Onboarding screens, light and dark', () => {
    const only = (process.env.SHOTS_ONLY || '').split(',').filter(Boolean);
    const shotsDir = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', 'playwright-results', 'onboarding-shots');

    for (const theme of THEMES) {
        for (const screen of SCREENS) {
            if (only.length && !only.some((p) => screen.id.startsWith(p))) continue;
            test(`${screen.id} ${theme}`, { tag: ['@onboarding', '@screenshots', '@P2'] }, async ({ page, request }, testInfo) => {
                test.skip(Boolean(screen.cloud) && !isCloudEnvironment(), 'Billing screens are Cloud-only');
                test.setTimeout(screen.timeout || 180000);
                // The mockups are 1440 x 900; the shared fixture opens every page at 1500 x 1024.
                await page.setViewportSize({ width: 1440, height: 900 });
                testLogger.testStart(testInfo.title, testInfo.file);
                await page.addInitScript(({ th, email }) => {
                    localStorage.setItem('theme', th);
                    if (email) sessionStorage.setItem(`connectDataSourcePromptShown:${email}`, 'true');
                }, { th: theme, email: process.env.ZO_ROOT_USER_EMAIL });
                if (screen.init) await screen.init({ page });
                await navigateToBase(page);
                const ctx = { page, request, orgId: getOrgIdentifier() };
                if (screen.emptyOrg) ctx.orgId = await createOrg(page, `e2e_shot_${screen.id.slice(0, 2)}`);
                if (screen.pick) {
                    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`o2.onboarding.firstSource.${ctx.orgId}`, screen.pick]);
                }
                if (screen.dashboard) {
                    ctx.pm = new PageManager(page);
                    await setupTestDashboard(page, ctx.pm, `Shot_${screen.id.slice(0, 2)}_${theme}_${Date.now()}`);
                }
                try {
                    await screen.run(ctx);
                    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b).*$/);
                    if (!screen.noSettle) await settle(page);
                    fs.mkdirSync(shotsDir, { recursive: true });
                    const file = path.join(shotsDir, `${screen.id}-${theme}.png`);
                    await page.screenshot({ path: file });
                    await testInfo.attach(`${screen.id}-${theme}`, { path: file, contentType: 'image/png' });
                } finally {
                    if (screen.cleanup) await screen.cleanup(ctx).catch(() => {});
                    if (screen.emptyOrg) await authedRequest(page, 'delete', `${base()}/api/organizations/${ctx.orgId}`).catch(() => {});
                }
            });
        }
    }
});
