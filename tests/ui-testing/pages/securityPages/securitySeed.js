const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const { ingestBase } = require('../../playwright-tests/utils/ingest-url.js');
const FleetSeed = require('../fleetPages/fleetSeed.js');

const SECURITY_PREFIX = 'sec_auto_';
// OCSF Authentication (3002) logon failure: the Events page derives class, outcome, actor and source address from these.
const OCSF_LOGON_FAILURE = {
  class_uid: 3002,
  category_uid: 3,
  severity_id: 4,
  activity_name: 'Logon',
  status_id: 2,
  src_endpoint: { ip: '10.20.30.40' },
  metadata: { product: { name: 'sec_auto_idp' } },
};
// The Security Viewer preset's grants, as jobPresets.ts sends them.
const SECURITY_VIEWER_GRANTS = ['security', 'incidents', 'afolder'].flatMap((type) =>
  ['AllowList', 'AllowGet'].map((permission) => ({ type, permission })),
);

// Members, roles, sign-in and the API client are FleetSeed's; only the prefix and the Security seeds differ.
class SecuritySeed extends FleetSeed {
  constructor(page) {
    super(page);
    this.fleetPrefix = `${SECURITY_PREFIX}${this.run}_`;
    this.streams = [];
    this.caseIds = [];
  }

  streamName(suffix) {
    return this.fleetName(suffix);
  }

  viewerGrants() {
    return SECURITY_VIEWER_GRANTS.map(({ type, permission }) => this.orgGrant(type, permission));
  }

  async ingestLogonFailure(suffix, { actor, message }) {
    const stream = this.streamName(suffix);
    const row = { ...OCSF_LOGON_FAILURE, actor: { user: { name: actor } }, message };
    const resp = await this.page.request.post(
      `${ingestBase(process.env.ZO_BASE_URL)}/api/${getOrgIdentifier()}/${stream}/_json`,
      { headers: getAuthHeaders(), data: [row] },
    );
    if (resp.status() !== 200) throw new Error(`ingest ${stream}: ${resp.status()} ${await resp.text()}`);
    this.streams.push(stream);
    await this.waitForRows(stream, 1);
    testLogger.info('Seeded OCSF stream', { stream });
    return { stream, row, srcIp: row.src_endpoint.ip };
  }

  // The Events page searches the last 15 minutes, so the row must be searchable before the page is judged.
  async waitForRows(stream, count) {
    const end = Date.now() * 1000;
    const query = { sql: `SELECT * FROM "${stream}"`, start_time: end - 3600 * 1e6, end_time: end + 60 * 1e6, size: 10 };
    await expect
      .poll(async () => (await this.call('POST', '/_search?type=logs', { query })).body?.hits?.length ?? 0, {
        timeout: 30000,
        message: `${stream} never returned ${count} searchable rows`,
      })
      .toBe(count);
  }

  async openEventCase(suffix, stream) {
    const title = this.fleetName(`case_${suffix}`);
    const body = await this.ok(
      'POST',
      '/security/cases',
      { title, event: { stream, timestamp: Date.now() * 1000, fields: { host: `${title}-host` } } },
      `open case ${title}`,
    );
    this.caseIds.push(body.id);
    return { id: body.id, title, host: `${title}-host` };
  }

  v2Url(path) {
    return `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/api/v2/${getOrgIdentifier()}${path}`;
  }

  async callV2(method, path, data) {
    const resp = await this.page.request.fetch(this.v2Url(path), {
      method,
      headers: getAuthHeaders(),
      ...(data === undefined ? {} : { data }),
    });
    const text = await resp.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: resp.status(), body };
  }

  async caseStatus(id) {
    const res = await this.callV2('GET', `/alerts/incidents/${id}`);
    if (res.status >= 400) throw new Error(`get case ${id}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.status;
  }

  // Cases have no delete, so cleanup closes this run's open ones; detections, streams, members and roles are deleted.
  async cleanup() {
    const removed = { detections: 0, cases: 0, streams: 0 };
    const alerts = await this.callV2('GET', '/alerts?page_size=1000');
    for (const a of alerts.status < 400 ? (alerts.body?.list ?? []) : []) {
      if (this.streams.some((s) => a?.name?.endsWith(`__${s}`))) {
        await this.callV2('DELETE', `/alerts/${a.alert_id}`);
        removed.detections += 1;
      }
    }
    for (const id of this.caseIds) {
      const res = await this.callV2('GET', `/alerts/incidents/${id}`);
      if (res.status < 400 && res.body?.status !== 'resolved') {
        await this.callV2('PATCH', `/alerts/incidents/${id}/update`, {
          status: 'resolved',
          verdict: 'stale',
          reason: 'security automation cleanup',
        });
        removed.cases += 1;
      }
    }
    for (const s of this.streams) {
      await this.call('DELETE', `/streams/${s}?type=logs`);
      removed.streams += 1;
    }
    for (const u of (await this.call('GET', '/users')).body?.data ?? []) {
      if (u?.email?.startsWith(this.fleetPrefix)) await this.call('DELETE', `/users/${u.email}`);
    }
    const roles = await this.call('GET', '/roles');
    for (const r of roles.status < 400 && Array.isArray(roles.body) ? roles.body : []) {
      if (typeof r === 'string' && r.startsWith(this.fleetPrefix)) await this.call('DELETE', `/roles/${r}`);
    }
    testLogger.info('Security teardown', { run: this.run, ...removed });
    return removed;
  }

  // Anything still carrying this run's prefix after cleanup() is a leak; open cases are closed, never deleted.
  async survivors() {
    const left = [];
    const alerts = await this.callV2('GET', '/alerts?page_size=1000');
    for (const a of alerts.body?.list ?? []) if (a?.name?.includes(this.fleetPrefix)) left.push(`detection ${a.name}`);
    const streams = await this.ok('GET', '/streams?type=logs', undefined, 'list streams');
    for (const st of streams?.list ?? []) if (st?.name?.startsWith(this.fleetPrefix)) left.push(`stream ${st.name}`);
    for (const id of this.caseIds) if ((await this.caseStatus(id)) !== 'resolved') left.push(`open case ${id}`);
    const users = await this.ok('GET', '/users', undefined, 'list users');
    for (const u of users?.data ?? []) if (u?.email?.startsWith(this.fleetPrefix)) left.push(`user ${u.email}`);
    const roles = await this.call('GET', '/roles');
    for (const r of roles.status < 400 && Array.isArray(roles.body) ? roles.body : []) {
      if (typeof r === 'string' && r.startsWith(this.fleetPrefix)) left.push(`role ${r}`);
    }
    return left;
  }
}

module.exports = SecuritySeed;
module.exports.SECURITY_PREFIX = SECURITY_PREFIX;
