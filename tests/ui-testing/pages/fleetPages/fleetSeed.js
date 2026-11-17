const crypto = require('crypto');
const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const FLEET_PREFIX = 'fl_auto_';
const CONFIG_PREFIX = 'fl-auto-';
const LIST_PAGE = 'offset=0&limit=1000';
const OPAMP_PROTOBUF = 'application/x-protobuf';
// ReportsStatus | AcceptsRemoteConfig | ReportsRemoteConfig: the least a rollout member advertises.
const MEMBER_CAPABILITIES = 0x1 | 0x2 | 0x1000;
const REMOTE_CONFIG_FAILED = 3;
// A node flushes OpAMP reports to the table in batches, then the rollout engine ticks every 10 s.
const REPORT_FLUSH_TIMEOUT_MS = 60000;
// One poll keeps the member online for 10 min and the phase never times out first, whatever the org defaults.
const SILENT_MEMBER_SETTINGS = { heartbeat_interval_secs: 60, offline_heartbeats: 10, phase_timeout_secs: 3600 };

const FLEET_YAML = {
  seed: 'service:\n  pipelines:\n    logs: {}\n',
  publishable: [
    'receivers:',
    '  otlp:',
    '    protocols:',
    '      http:',
    '        endpoint: "0.0.0.0:4318"',
    'exporters:',
    '  otlphttp:',
    '    endpoint: "https://example.com"',
    'service:',
    '  pipelines:',
    '    logs:',
    '      receivers: [otlp]',
    '      exporters: [otlphttp]',
    '',
  ].join('\n'),
  broken: 'receivers:\n  otlp: [unclosed\n',
  dottedKey: [
    'processors:',
    '  resourcedetection:',
    '    detectors:',
    '      - system',
    '    system:',
    '      resource_attributes:',
    '        host.id:',
    '          enabled: true',
    'exporters:',
    '  debug:',
    '    verbosity: basic',
    'service:',
    '  pipelines:',
    '    logs:',
    '      processors: [resourcedetection]',
    '      exporters: [debug]',
    '',
  ].join('\n'),
  quotedNumber: [
    'exporters:',
    '  debug:',
    '    verbosity: "123"',
    'service:',
    '  pipelines:',
    '    logs:',
    '      exporters: [debug]',
    '',
  ].join('\n'),
  paletteResult: [
    'receivers:',
    '  otlp:',
    '    protocols:',
    '      grpc:',
    '        endpoint: "0.0.0.0:4317"',
    '      http:',
    '        endpoint: "0.0.0.0:4318"',
    'processors:',
    '  batch:',
    '    timeout: 5s',
    '    send_batch_size: 8192',
    '  memory_limiter:',
    '    check_interval: 1s',
    '    limit_mib: 400',
    '    spike_limit_mib: 100',
    'exporters:',
    '  otlphttp/openobserve:',
    '    endpoint: "${env:O2_ENDPOINT}"',
    '    headers:',
    '      Authorization: "${env:O2_TOKEN}"',
    '      stream-name: default',
    'service:',
    '  pipelines:',
    '    logs:',
    '      receivers: [otlp]',
    '      processors: [memory_limiter, batch]',
    '      exporters: [otlphttp/openobserve]',
    '',
  ].join('\n'),
};

function varint(n) {
  const out = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
}

function varintField(num, value) {
  return Buffer.concat([varint(num << 3), varint(value)]);
}

function bytesField(num, bytes) {
  return Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);
}

// AgentToServer: 1 instance_uid, 2 sequence_num, 4 capabilities, 7 RemoteConfigStatus (1 hash, 2 status, 3 error).
function agentToServer(collectorId, seq, rejectedHashHex) {
  const parts = [
    bytesField(1, Buffer.from(collectorId.replace(/-/g, ''), 'hex')),
    varintField(2, seq),
    varintField(4, MEMBER_CAPABILITIES),
  ];
  if (rejectedHashHex) {
    const status = Buffer.concat([
      bytesField(1, Buffer.from(rejectedHashHex, 'hex')),
      varintField(2, REMOTE_CONFIG_FAILED),
      bytesField(3, Buffer.from('fleet automation rejects this version')),
    ]);
    parts.push(bytesField(7, status));
  }
  return Buffer.concat(parts);
}

class FleetSeed {
  constructor(page) {
    this.page = page;
    this.run = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    this.fleetPrefix = `${FLEET_PREFIX}${this.run}_`;
    this.configPrefix = `${CONFIG_PREFIX}${this.run}-`;
    this.loginUserField = '[data-test="login-user-id-field"]';
    this.loginPasswordField = '[data-test="login-password-field"]';
    this.loginSubmit = '[data-test="login-sign-in"]';
    this.loginInternalUser = '[data-test="login-as-internal-user"]';
    this.appShell = '[data-test="navbar-main-nav"]';
  }

  // beforeAll and afterAll run on different raw pages, so the run prefix must outlive the first one.
  setPage(page) {
    this.page = page;
  }

  fleetName(suffix) {
    return `${this.fleetPrefix}${suffix}`;
  }

  configId(suffix) {
    return `${this.configPrefix}${suffix}`;
  }

  orgId() {
    return getOrgIdentifier();
  }

  apiUrl(path) {
    return `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/api/${getOrgIdentifier()}${path}`;
  }

  async call(method, path, data) {
    const resp = await this.page.request.fetch(this.apiUrl(path), {
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

  async ok(method, path, data, what) {
    const res = await this.call(method, path, data);
    if (res.status >= 400) {
      throw new Error(`${what} failed: ${method} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    }
    return res.body;
  }

  async createFleet(suffix) {
    const name = this.fleetName(suffix);
    const body = await this.ok('POST', '/fleet/fleets', { name }, `create fleet ${name}`);
    if (!body?.id) throw new Error(`create fleet ${name}: no id in ${JSON.stringify(body)}`);
    testLogger.info('Seeded fleet', { id: body.id, name });
    return { id: body.id, name };
  }

  async createToken(fleetId, suffix) {
    const name = this.fleetName(suffix);
    const body = await this.ok(
      'POST',
      '/fleet/tokens',
      { name, expires_in_days: null, max_uses: null, fleet: fleetId },
      `create token ${name}`,
    );
    if (!/^o2ft_/.test(body?.token ?? '')) throw new Error(`create token ${name}: no o2ft_ value returned`);
    return { id: body.id, name, token: body.token };
  }

  async createConfig(suffix, yaml) {
    const id = this.configId(suffix);
    await this.ok('POST', '/fleet/configs', { id, description: 'fleet automation', yaml }, `create config ${id}`);
    return id;
  }

  async publishConfig(id, yaml, message = 'fleet automation') {
    const body = await this.ok('POST', `/fleet/configs/${id}/versions`, { yaml, message }, `publish ${id}`);
    return body.version;
  }

  async getConfig(id) {
    return await this.ok('GET', `/fleet/configs/${id}`, undefined, `get config ${id}`);
  }

  async setDesired(fleetId, config, version) {
    const body = await this.ok(
      'PUT',
      `/fleet/fleets/${fleetId}/desired`,
      {
        config,
        version,
        start: { kind: 'now' },
        batching: { kind: 'one' },
        verify: false,
        auto_rollback: false,
      },
      `deploy ${config} v${version} to ${fleetId}`,
    );
    return { id: body.id };
  }

  async setFleetSettings(fleetId, settings) {
    return await this.ok('PUT', `/fleet/fleets/${fleetId}/settings`, settings, `set settings of fleet ${fleetId}`);
  }

  async waitForRolloutStatus(rolloutId, status, timeout = 30000) {
    await expect
      .poll(async () => (await this.call('GET', `/fleet/rollouts/${rolloutId}`)).body?.status, {
        timeout,
        message: `rollout ${rolloutId} never reached ${status}`,
      })
      .toBe(status);
  }

  // Speaks OpAMP over HTTP as a collector with no process behind it, authenticated by the fleet token.
  async opampPoll(token, collectorId, seq, rejectedHashHex = null) {
    const resp = await this.page.request.fetch(this.apiUrl('/v1/opamp'), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`fleet:${token}`).toString('base64')}`,
        'Content-Type': OPAMP_PROTOBUF,
      },
      data: agentToServer(collectorId, seq, rejectedHashHex),
    });
    if (resp.status() !== 200) {
      throw new Error(`OpAMP poll as ${collectorId} -> ${resp.status()} ${(await resp.text()).slice(0, 300)}`);
    }
  }

  // A first rollout whose only member rejects the version, so it halts as proven bad and offers Fix forward.
  async seedRejectedRollout(suffix, yaml) {
    const fleet = await this.createFleet(suffix);
    await this.setFleetSettings(fleet.id, SILENT_MEMBER_SETTINGS);
    const token = await this.createToken(fleet.id, suffix);
    const config = await this.createConfig(suffix, yaml);
    const version = await this.publishConfig(config, yaml);
    const collectorId = crypto.randomUUID();
    await this.opampPoll(token.token, collectorId, 1);
    await expect
      .poll(async () => (await this.call('GET', `/fleet/collectors/${collectorId}`)).body?.capabilities ?? [], {
        timeout: REPORT_FLUSH_TIMEOUT_MS,
        message: `collector ${collectorId} never reported AcceptsRemoteConfig`,
      })
      .toContain('AcceptsRemoteConfig');

    const { id: rolloutId } = await this.setDesired(fleet.id, config, version);
    const started = await this.ok('GET', `/fleet/rollouts/${rolloutId}`, undefined, `get rollout ${rolloutId}`);
    if (started.status !== 'in_progress' || started.total !== 1) {
      throw new Error(`rollout ${rolloutId} did not start on the polled collector: ${JSON.stringify(started).slice(0, 300)}`);
    }
    const { hash } = await this.ok('GET', `/fleet/configs/${config}/versions/${version}`, undefined, `get ${config} v${version}`);
    await this.opampPoll(token.token, collectorId, 2, hash);
    await this.waitForRolloutStatus(rolloutId, 'halted', REPORT_FLUSH_TIMEOUT_MS);
    const halted = await this.ok('GET', `/fleet/rollouts/${rolloutId}`, undefined, `get rollout ${rolloutId}`);
    if (halted.halt?.class !== 'proven_bad' || !halted.halt.exits.includes('fix_forward')) {
      throw new Error(`rollout ${rolloutId} halted without a Fix forward exit: ${JSON.stringify(halted.halt)}`);
    }
    testLogger.info('Seeded halted rollout', { fleet: fleet.id, rolloutId, config, version });
    return { fleetId: fleet.id, rolloutId, config, version };
  }

  async rolloutsForConfig(configId) {
    const body = await this.ok('GET', `/fleet/rollouts?${LIST_PAGE}`, undefined, 'list rollouts');
    return (body?.items ?? []).filter((r) => r.config === configId);
  }

  async listFleets() {
    const body = await this.ok('GET', `/fleet/fleets?${LIST_PAGE}`, undefined, 'list fleets');
    return body?.items ?? [];
  }

  async expectNoFleetNamed(name) {
    const names = (await this.listFleets()).map((f) => f.name);
    expect(names, `fleet ${name} exists although its create was refused`).not.toContain(name);
  }

  async targetCollectorVersion() {
    const body = await this.ok('GET', '/fleet/settings', undefined, 'get fleet settings');
    return body?.target_collector_version || null;
  }

  async ingestionBaseUrl() {
    const config = await this.ok('GET', '/config', undefined, 'get org config');
    return config?.ingestion_url || null;
  }

  async assertRbacEnabled() {
    const { status } = await this.call('GET', '/roles');
    if (status >= 400) {
      throw new Error(`RBAC is off on ${process.env.ZO_BASE_URL} (GET /roles -> ${status}); the Fleet-RBAC shard must start OpenFGA.`);
    }
  }

  async createRole(suffix, grants) {
    const role = this.fleetName(suffix);
    await this.ok('POST', '/roles', { role }, `create role ${role}`);
    if (grants.length) {
      await this.ok(
        'PUT',
        `/roles/${role}`,
        { add: grants, remove: [], add_users: [], remove_users: [] },
        `grant ${role}`,
      );
    }
    return role;
  }

  async createMember(suffix, role = null) {
    const email = `${this.fleetName(suffix)}_${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = `Fl#9${crypto.randomBytes(12).toString('base64url')}aZ`;
    await this.ok(
      'POST',
      '/users',
      { email, password, first_name: 'Automation', last_name: 'TestUser', role: 'user' },
      `create member ${email}`,
    );
    if (role) {
      await this.ok(
        'PUT',
        `/roles/${role}`,
        { add: [], remove: [], add_users: [email], remove_users: [] },
        `assign ${role} to ${email}`,
      );
    }
    return { email, password };
  }

  fleetGrant(object, permission) {
    return { object: `fleets:${object}`, permission };
  }

  orgGrant(type, permission) {
    return { object: `${type}:_all_${getOrgIdentifier()}`, permission };
  }

  async loginAsMember(browser, member) {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1024 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${getOrgIdentifier()}`, {
      waitUntil: 'domcontentloaded',
    });
    const userField = page.locator(this.loginUserField);
    const internal = page.locator(this.loginInternalUser).first();
    await expect(userField.or(internal)).toBeVisible({ timeout: 30000 });
    if (await internal.isVisible()) await internal.click();
    await userField.fill(member.email);
    await page.locator(this.loginPasswordField).fill(member.password);
    await page.locator(this.loginSubmit).click();
    await expect(page.locator(this.appShell)).toBeVisible({ timeout: 30000 });
    testLogger.info('Signed in as fleet member', { email: member.email });
    return { context, page };
  }

  // Grants reach OpenFGA asynchronously, so a member's first read must see them before the UI is judged.
  async waitForMemberStatus(memberPage, path, status) {
    await expect
      .poll(
        async () =>
          (
            await memberPage.request.fetch(this.apiUrl(path), {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
            })
          ).status(),
        { timeout: 30000, message: `member GET ${path} never answered ${status}` },
      )
      .toBe(status);
  }

  async cleanup() {
    const removed = { tokens: 0, collectors: 0, fleets: 0, configs: 0, roles: 0, users: 0 };
    const mine = async (path, key) => {
      const res = await this.call('GET', path);
      if (res.status >= 400) return [];
      const items = Array.isArray(res.body) ? res.body : (res.body?.items ?? res.body?.data ?? []);
      return items.filter((x) => typeof key(x) === 'string');
    };
    const fleets = (await mine(`/fleet/fleets?${LIST_PAGE}`, (f) => f?.name)).filter((f) =>
      f.name.startsWith(this.fleetPrefix),
    );
    const fleetIds = new Set(fleets.map((f) => f.id));
    for (const tok of await mine(`/fleet/tokens?${LIST_PAGE}`, (t) => t?.id)) {
      if (fleetIds.has(tok.fleet?.id) && !tok.revoked) {
        await this.call('POST', `/fleet/tokens/${tok.id}/revoke`);
        removed.tokens += 1;
      }
    }
    for (const f of fleets) {
      // A fleet still holding collectors refuses its delete.
      for (const c of await mine(`/fleet/collectors?fleet=${f.id}&${LIST_PAGE}`, (c) => c?.id)) {
        await this.call('DELETE', `/fleet/collectors/${c.id}`);
        removed.collectors += 1;
      }
      await this.call('DELETE', `/fleet/fleets/${f.id}`);
      removed.fleets += 1;
    }
    for (const c of await mine(`/fleet/configs?${LIST_PAGE}`, (c) => c?.id)) {
      if (c.id.startsWith(this.configPrefix)) {
        await this.call('DELETE', `/fleet/configs/${c.id}`);
        removed.configs += 1;
      }
    }
    for (const u of await mine('/users', (u) => u?.email)) {
      if (u.email.startsWith(this.fleetPrefix)) {
        await this.call('DELETE', `/users/${u.email}`);
        removed.users += 1;
      }
    }
    const roles = await this.call('GET', '/roles');
    for (const r of roles.status < 400 && Array.isArray(roles.body) ? roles.body : []) {
      if (typeof r === 'string' && r.startsWith(this.fleetPrefix)) {
        await this.call('DELETE', `/roles/${r}`);
        removed.roles += 1;
      }
    }
    testLogger.info('Fleet teardown', { run: this.run, ...removed });
    return removed;
  }

  // Anything still carrying this run's prefix after cleanup() is a leak; a failed list read fails loudly.
  async survivors() {
    const left = [];
    for (const f of await this.listFleets()) {
      if (f.name?.startsWith(this.fleetPrefix)) left.push(`fleet ${f.name}`);
    }
    const configs = await this.ok('GET', `/fleet/configs?${LIST_PAGE}`, undefined, 'list configs');
    for (const c of configs?.items ?? []) {
      if (c.id?.startsWith(this.configPrefix)) left.push(`config ${c.id}`);
    }
    const roles = await this.call('GET', '/roles');
    if (roles.status < 400) {
      for (const r of Array.isArray(roles.body) ? roles.body : []) {
        if (typeof r === 'string' && r.startsWith(this.fleetPrefix)) left.push(`role ${r}`);
      }
    }
    const users = await this.ok('GET', '/users', undefined, 'list users');
    for (const u of users?.data ?? []) {
      if (u?.email?.startsWith(this.fleetPrefix)) left.push(`user ${u.email}`);
    }
    return left;
  }
}

module.exports = FleetSeed;
module.exports.FLEET_YAML = FLEET_YAML;
module.exports.FLEET_PREFIX = FLEET_PREFIX;
module.exports.CONFIG_PREFIX = CONFIG_PREFIX;
