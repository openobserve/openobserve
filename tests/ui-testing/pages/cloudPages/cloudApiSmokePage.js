// cloudApiSmokePage.js - API-only CRUD round-trips against the deployed meta store.
// Cloud runs on Postgres, which rejects column-type drift that SQLite (local CI) accepts.
const { expect } = require('@playwright/test');
const APICleanup = require('../apiCleanup.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const { ingestCustomData, waitForStreamListed } = require('../../playwright-tests/utils/data-ingestion.js');

// Alpha blocks private and loopback hosts for destinations (SSRF guard).
const WEBHOOK_URL = 'https://example.com/o2-cloud-api-smoke';
const PANEL_ID = 'panel_1';

class CloudApiSmokePage {
    constructor(page) {
        this.page = page;
        this.api = new APICleanup(page);
        this.baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
        this.org = getOrgIdentifier();
    }

    uniqueSuffix() {
        return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }

    // ===== GENERIC REQUEST =====

    async call(method, path, body) {
        const response = await this.api._fetch(`${this.baseUrl}/${path}`, {
            method,
            headers: { 'Authorization': this.api.authHeader, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON body is reported via text */ }
        return { status: response.status, json, text };
    }

    async expectOk(method, path, body) {
        const res = await this.call(method, path, body);
        expect(res.status, `${method} /${path} -> ${res.status}: ${res.text.slice(0, 500)}`).toBe(200);
        return res.json;
    }

    // ===== SEED DATA =====

    async seedStream(streamName) {
        const res = await ingestCustomData(this.page, streamName, [{ level: 'error', message: 'cloud api smoke seed' }]);
        expect(res.status, `ingest into ${streamName}: ${JSON.stringify(res.data)}`).toBe(200);
        expect(await waitForStreamListed(this.page, streamName), `${streamName} must be listed`).toBe(true);
    }

    // ===== ALERTS =====

    async createTemplate(name) {
        await this.expectOk('POST', `api/${this.org}/alerts/templates`, {
            name, body: '{"text": "{alert_name}"}', type: 'http', title: '',
        });
    }

    async createDestination(name, template) {
        await this.expectOk('POST', `api/${this.org}/alerts/destinations`, {
            name, url: WEBHOOK_URL, method: 'post', template, headers: {}, skip_tls_verify: false,
        });
    }

    async getDestination(name) {
        return this.expectOk('GET', `api/${this.org}/alerts/destinations/${name}`);
    }

    alertPayload(name, stream, destination, { realtime = false } = {}) {
        const payload = {
            name,
            stream_type: 'logs',
            stream_name: stream,
            is_real_time: realtime,
            query_condition: {
                type: 'custom',
                conditions: { version: 2, conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
                sql: null, promql: null, promql_condition: null, aggregation: null,
                vrl_function: null, search_event_type: null, multi_time_range: [],
            },
            trigger_condition: {
                period: 10, operator: '>=', threshold: 5, frequency: 10, cron: '',
                frequency_type: 'minutes', silence: 10, timezone: 'UTC', align_time: true,
                warning_threshold: 2, notify_on_warning: true,
            },
            destinations: [destination],
            context_attributes: { team: 'qa' },
            row_template: '',
            enabled: false,
            description: 'cloud api smoke',
            priority: 2,
            tags: ['cloud-api-smoke'],
            runbook_url: 'https://example.com/runbooks/cloud-api-smoke',
            deduplication: { enabled: true, fingerprint_fields: ['level'], time_window_minutes: 30 },
            notify_on_recovery: true,
            recovery_destinations: [destination],
            pending_period_sec: 60,
            keep_firing_for: 60,
        };
        if (!realtime) return payload;
        // Realtime alerts reject pending, warning, recovery and keep-firing settings.
        const { warning_threshold: _w, notify_on_warning: _n, ...trigger } = payload.trigger_condition;
        return { ...payload, trigger_condition: trigger, pending_period_sec: 0, notify_on_recovery: false, recovery_destinations: [], keep_firing_for: 0 };
    }

    async createAlert(payload) {
        const created = await this.expectOk('POST', `api/v2/${this.org}/alerts?folder=default`, payload);
        expect(created?.id, 'alert create must return its id').toBeTruthy();
        return created.id;
    }

    async getAlert(id) {
        return this.expectOk('GET', `api/v2/${this.org}/alerts/${id}`);
    }

    async updateAlert(id, payload) {
        await this.expectOk('PUT', `api/v2/${this.org}/alerts/${id}?folder=default`, payload);
    }

    clearedAlert(stored) {
        const { runbook_url: _runbook, ...rest } = stored;
        return { ...rest, recovery_destinations: [], tags: [], context_attributes: {}, deduplication: { enabled: false } };
    }

    // ===== DASHBOARDS =====

    async createDashboard(title) {
        const created = await this.expectOk('POST', `api/${this.org}/dashboards?folder=default`, {
            version: 8, title, description: 'cloud api smoke',
            tabs: [{
                tabId: 'default', name: 'Default',
                panels: [{
                    id: PANEL_ID, type: 'bar', title: 'Smoke panel', description: '',
                    config: { show_legends: true, legends_position: null, axis_border_show: false },
                    queryType: 'sql', queries: [], layout: { x: 0, y: 0, w: 12, h: 6, i: 1 },
                }],
            }],
            variables: { list: [{ type: 'constant', name: 'env', label: 'env', value: 'prod' }], showDynamicFilters: true },
        });
        const inner = created[`v${created.version}`] || created;
        const id = inner.dashboardId || inner.dashboard_id;
        expect(id, 'dashboard create must return its id').toBeTruthy();
        return id;
    }

    async getDashboard(id) {
        return this.expectOk('GET', `api/${this.org}/dashboards/${id}?folder=default`);
    }

    async addAnnotation(dashboardId, title, tags) {
        const end = Date.now() * 1000;
        const annotation = { title, text: 'cloud api smoke', panels: [PANEL_ID], start_time: end - 3_600_000_000, end_time: end, tags };
        await this.expectOk('POST', `api/${this.org}/dashboards/${dashboardId}/annotations`, { timed_annotations: [annotation] });
        return { start: annotation.start_time, end };
    }

    async findAnnotation(dashboardId, title, { start, end }) {
        const query = `panels=${PANEL_ID}&start_time=${start - 3_600_000_000}&end_time=${end + 3_600_000_000}`;
        const body = await this.expectOk('GET', `api/${this.org}/dashboards/${dashboardId}/annotations?${query}`);
        const rows = Array.isArray(body) ? body : (body?.timed_annotations || body?.list || []);
        return rows.find((r) => r.title === title);
    }

    // ===== SLOS =====

    sloPayload(name, stream) {
        return {
            name,
            description: 'cloud api smoke',
            sli_type: 'count',
            config: { source: { mode: 'single_query', query: { stream, stream_type: 'logs', good_expr: "level != 'error'" } } },
            group_by: ['level'],
            groups_estimate: 3,
            window_secs: 604800,
            slice_interval_secs: 300,
            target: 99,
            tags: ['cloud-api-smoke', 'tier:1'],
            enabled: false,
        };
    }

    async createSlo(payload) {
        const created = await this.expectOk('POST', `api/${this.org}/slos`, payload);
        expect(created?.id, 'SLO create must return its id').toBeTruthy();
        return created.id;
    }

    async getSlo(id) {
        return this.expectOk('GET', `api/${this.org}/slos/${id}`);
    }

    async updateSlo(id, payload) {
        await this.expectOk('PUT', `api/${this.org}/slos/${id}`, payload);
    }

    // ===== FUNCTIONS =====

    async createFunction(name) {
        await this.expectOk('POST', `api/${this.org}/functions`, {
            name, function: '.smoke = true\n.', params: 'row', transType: 0,
        });
    }

    async listFunctionNames() {
        const body = await this.expectOk('GET', `api/${this.org}/functions`);
        return (body?.list || []).map((f) => f.name);
    }

    // ===== SAVED VIEWS =====

    async createSavedView(name) {
        const created = await this.expectOk('POST', `api/${this.org}/savedviews`, {
            view_name: name, data: this.savedViewData(),
        });
        expect(created?.view_id, 'saved view create must return its id').toBeTruthy();
        return created.view_id;
    }

    savedViewData() {
        return { query: 'SELECT * FROM "smoke"', smoke: true, filters: [{ field: 'level', values: ['error', '警告'] }], nested: { depth: { ok: true } } };
    }

    async getSavedView(id) {
        return this.expectOk('GET', `api/${this.org}/savedviews/${id}`);
    }

    // ===== LIST SWEEP =====

    listEndpoints() {
        return [
            `api/v2/${this.org}/alerts`,
            `api/v2/${this.org}/folders/alerts`,
            `api/v2/${this.org}/folders/dashboards`,
            `api/${this.org}/alerts/destinations`,
            `api/${this.org}/alerts/templates`,
            `api/${this.org}/dashboards`,
            `api/${this.org}/functions`,
            `api/${this.org}/savedviews`,
            `api/${this.org}/pipelines`,
            `api/${this.org}/streams`,
            `api/${this.org}/slos`,
            `api/v2/${this.org}/downtimes`,
            `api/${this.org}/anomaly_detection`,
        ];
    }

    // ===== CLEANUP =====

    async deleteLogged(path) {
        try {
            const res = await this.call('DELETE', path);
            if (res.status >= 300) testLogger.warn('Cloud API smoke cleanup failed', { path, status: res.status, body: res.text.slice(0, 200) });
        } catch (e) {
            testLogger.warn('Cloud API smoke cleanup errored', { path, error: e.message });
        }
    }

    async cleanup({ alertId, alertIds = [], destination, template, dashboardId, functionName, viewId, sloId }) {
        for (const id of [alertId, ...alertIds].filter(Boolean)) await this.deleteLogged(`api/v2/${this.org}/alerts/${id}`);
        if (destination) await this.deleteLogged(`api/${this.org}/alerts/destinations/${destination}`);
        if (template) await this.deleteLogged(`api/${this.org}/alerts/templates/${template}`);
        if (dashboardId) await this.deleteLogged(`api/${this.org}/dashboards/${dashboardId}?folder=default`);
        if (functionName) await this.deleteLogged(`api/${this.org}/functions/${functionName}`);
        if (viewId) await this.deleteLogged(`api/${this.org}/savedviews/${viewId}`);
        if (sloId) await this.deleteLogged(`api/${this.org}/slos/${sloId}`);
    }
}

module.exports = { CloudApiSmokePage };
