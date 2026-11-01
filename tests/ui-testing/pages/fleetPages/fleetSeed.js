const crypto = require('crypto');
const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const FLEET_PREFIX = 'fl_auto_';
const CONFIG_PREFIX = 'fl-auto-';
const LIST_PAGE = 'offset=0&limit=1000';

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

  async waitForRolloutStatus(rolloutId, status) {
    await expect
      .poll(async () => (await this.call('GET', `/fleet/rollouts/${rolloutId}`)).body?.status, {
        timeout: 30000,
        message: `rollout ${rolloutId} never reached ${status}`,
      })
      .toBe(status);
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
    const removed = { tokens: 0, fleets: 0, configs: 0, roles: 0, users: 0 };
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
