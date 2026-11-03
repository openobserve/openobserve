const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

const PAGE_TIMEOUT_MS = 30000;
const SCRIPT_BASE = 'https://raw.githubusercontent.com/openobserve/agents/main';
const IMAGE = 'o2cr.ai/openobserve/otel-fleet-collector';
const HELM_NAMESPACE = 'openobserve-collector';
const AGENT_RELEASE = 'otel-fleet-collector';
const GATEWAY_RELEASE = 'otel-fleet-collector-gateway';
const MASK = '•'.repeat(12);

class FleetInstallPage {
  constructor(page) {
    this.page = page;
    this.dialog = '[data-test="fleet-install-dialog"]';
    this.noToken = '[data-test="fleet-install-dialog-no-token"]';
    this.tokenTrigger = '[data-test="fleet-install-dialog-token-trigger"]';
    this.tokenOption = '[data-test="fleet-install-dialog-token-option"]';
    this.joinsText = '[data-test="fleet-install-dialog-fleet"]';
    this.copyOnce = '[data-test="fleet-install-dialog-copy-once"]';
    this.placeholderHint = '[data-test="fleet-install-dialog-placeholder-hint"]';
    this.waiting = '[data-test="fleet-install-dialog-waiting"]';
    this.tokenFormName = '[data-test="fleet-token-form-name-field"]';
    this.tokenFormSubmit = '[data-test="fleet-token-form-submit"]';
    this.command = '[data-test="fleet-install-command"]';
    this.commandCode = '[data-test="fleet-install-command-code-pre"] code';
    this.revealBtn = '[data-test="fleet-install-command-code-reveal-btn"]';
    this.copyBtn = '[data-test="fleet-install-command-code-copy-btn"]';
    this.websocket = '[data-test="fleet-install-command-websocket"] button[role="checkbox"]';
    this.clusterNameField = '[data-test="fleet-install-command-cluster-name-field"]';
    this.uninstallTrigger = '[data-test="fleet-install-command-uninstall"] button[aria-expanded]';
    this.uninstallCode = '[data-test="fleet-uninstall-command-code-pre"] code';
  }

  osButton(platform) {
    return this.page.locator(`[data-test="fleet-install-command-os-${platform}"]`);
  }

  roleButton(role) {
    return this.page.locator(`[data-test="fleet-install-command-role-${role}"]`);
  }

  static resolveBaseUrl(endpoint, origin) {
    let url;
    try {
      url = new URL(endpoint || '/', origin);
    } catch {
      url = new URL(origin);
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  }

  static opampEndpoint(t) {
    const url = new URL(t.baseUrl);
    const scheme = t.http ? url.protocol.replace(':', '') : url.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${url.host}${url.pathname.replace(/\/+$/, '')}/api/${t.org}/v1/opamp`;
  }

  static expectedInstallLines(platform, t) {
    const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`;
    const join = (args, cont) => args.map((a, i) => `  ${a}${i < args.length - 1 ? cont : ''}`);
    if (platform === 'linux' || platform === 'macos') {
      const args = [
        `--url ${q(t.baseUrl)}`,
        `--org ${q(t.org)}`,
        `--token ${q(t.token)}`,
        ...(t.version ? [`--version ${q(t.version)}`] : []),
        `--transport ${t.http ? 'http' : 'ws'}`,
      ];
      return [`curl -fsSL ${SCRIPT_BASE}/fleet/install.sh | sudo bash -s -- \\`, ...join(args, ' \\')];
    }
    if (platform === 'windows') {
      const ps = (v) => `'${v.replace(/'/g, "''")}'`;
      const args = [
        `-Url ${ps(t.baseUrl)}`,
        `-Org ${ps(t.org)}`,
        `-Token ${ps(t.token)}`,
        ...(t.version ? [`-Version ${ps(t.version)}`] : []),
        `-Transport ${t.http ? 'http' : 'ws'}`,
      ];
      return [`& ([scriptblock]::Create((irm ${SCRIPT_BASE}/fleet/install.ps1))) \``, ...join(args, ' `')];
    }
    if (platform === 'docker') {
      const baseUrl = t.baseUrl.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//host.docker.internal');
      const insecure = !baseUrl.startsWith('https:');
      return [
        `AUTH=$(printf 'fleet:%s' ${q(t.token)} | base64 | tr -d '\\n')`,
        'mkdir -p otel-fleet && cat > otel-fleet/supervisor.yaml <<EOF',
        'server:',
        `  endpoint: ${FleetInstallPage.opampEndpoint({ ...t, baseUrl })}`,
        '  headers:',
        '    Authorization: "Basic $AUTH"',
        ...(insecure ? ['  tls:', '    insecure: true'] : []),
        'capabilities:',
        '  accepts_remote_config: true',
        '  reports_effective_config: true',
        '  reports_health: true',
        '  reports_own_metrics: true',
        '  accepts_restart_command: true',
        '  reports_available_components: true',
        'agent:',
        '  executable: /usr/local/bin/otelcol-contrib',
        '  config_apply_timeout: 30s',
        '  env:',
        `    O2_ENDPOINT: ${baseUrl.replace(/\/+$/, '')}/api/${t.org}`,
        '    O2_TOKEN: "Basic $AUTH"',
        'storage:',
        '  directory: /var/lib/opampsupervisor',
        'EOF',
        'docker rm -f otel-fleet-collector >/dev/null 2>&1 || true',
        'docker run -d --name otel-fleet-collector --restart unless-stopped \\',
        '  --hostname "$(hostname)" \\',
        '  -v "$PWD/otel-fleet/supervisor.yaml:/etc/opampsupervisor/supervisor.yaml:ro" \\',
        '  -v otel-fleet-state:/var/lib/opampsupervisor \\',
        `  ${IMAGE}:${t.version ?? 'latest'}`,
      ];
    }
    const gateway = t.role === 'gateway';
    const cluster = t.clusterName?.trim().replace(/\\/g, '\\\\').replace(/,/g, '\\,');
    const sets = [
      ...(gateway ? ['--set agent.enabled=false', '--set gateway.enabled=true'] : []),
      ...(cluster ? [`--set-string clusterName=${q(cluster)}`] : []),
      `--set image.repository=${IMAGE}`,
      ...(t.version ? [`--set image.tag=${q(t.version)}`] : []),
      `--set opamp.endpoint=${q(FleetInstallPage.opampEndpoint(t))}`,
      `--set opamp.token=${q(t.token)}`,
    ];
    return [
      'helm repo add openobserve https://charts.openobserve.ai && helm repo update',
      `helm upgrade --install ${gateway ? GATEWAY_RELEASE : AGENT_RELEASE} openobserve/otel-fleet-collector \\`,
      `  --namespace ${HELM_NAMESPACE} --create-namespace \\`,
      ...join(sets, ' \\'),
    ];
  }

  static expectedUninstallLines(platform, role = 'agent') {
    if (platform === 'windows') return [`& ([scriptblock]::Create((irm ${SCRIPT_BASE}/fleet/install.ps1))) -Uninstall`];
    if (platform === 'docker') {
      return ['docker rm -f otel-fleet-collector', 'docker volume rm otel-fleet-state', 'rm -rf otel-fleet'];
    }
    if (platform === 'kubernetes') {
      return [`helm uninstall ${role === 'gateway' ? GATEWAY_RELEASE : AGENT_RELEASE} --namespace ${HELM_NAMESPACE}`];
    }
    return [`curl -fsSL ${SCRIPT_BASE}/fleet/install.sh | sudo bash -s -- --uninstall`];
  }

  static maskToken(token) {
    return token.slice(0, 4) + MASK + token.slice(-4);
  }

  // The command targets the ingestion URL, or the app's own base when none is configured.
  async installTarget(seed, token) {
    const ingestion = await seed.ingestionBaseUrl();
    const url = new URL(this.page.url());
    const pos = url.pathname.indexOf('/web/');
    const appBase = pos > -1 ? url.origin + url.pathname.slice(0, pos) : url.origin;
    const target = {
      baseUrl: FleetInstallPage.resolveBaseUrl(ingestion || appBase, url.origin),
      org: seed.orgId(),
      token,
      version: await seed.targetCollectorVersion(),
    };
    testLogger.info('Install target', { baseUrl: target.baseUrl, org: target.org, version: target.version });
    return target;
  }

  async expectDialogOpen() {
    await expect(this.page.locator(this.dialog)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectCommandShown() {
    await expect(this.page.locator(this.commandCode)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  // A single-choice toggle deselects its active item on a second click, so only an inactive item is clicked.
  async selectPlatform(platform) {
    if ((await this.osButton(platform).getAttribute('data-state')) !== 'on') await this.osButton(platform).click();
    await expect(this.osButton(platform)).toHaveAttribute('data-state', 'on');
  }

  async selectRole(role) {
    if ((await this.roleButton(role).getAttribute('data-state')) !== 'on') await this.roleButton(role).click();
    await expect(this.roleButton(role)).toHaveAttribute('data-state', 'on');
  }

  async expectWebsocket(checked) {
    await expect(this.page.locator(this.websocket)).toHaveAttribute('aria-checked', String(checked));
  }

  async setWebsocket(checked) {
    const box = this.page.locator(this.websocket);
    if ((await box.getAttribute('aria-checked')) !== String(checked)) await box.click();
    await this.expectWebsocket(checked);
  }

  async revealToken() {
    await this.page.locator(this.revealBtn).click();
  }

  async setClusterName(name) {
    await this.page.locator(this.clusterNameField).fill(name);
  }

  async commandText() {
    return (await this.page.locator(this.commandCode).textContent()) ?? '';
  }

  async expectCommandLines(lines) {
    await expect.poll(async () => (await this.commandText()).split('\n'), { timeout: PAGE_TIMEOUT_MS }).toEqual(lines);
  }

  async expectCommandMasked(token) {
    await expect.poll(() => this.commandText(), { timeout: PAGE_TIMEOUT_MS }).toContain(FleetInstallPage.maskToken(token));
    expect(await this.commandText()).not.toContain(token);
  }

  async expandUninstall() {
    const trigger = this.page.locator(this.uninstallTrigger).first();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(this.page.locator(this.uninstallCode)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectUninstallLines(lines, token) {
    await expect
      .poll(async () => ((await this.page.locator(this.uninstallCode).textContent()) ?? '').split('\n'), {
        timeout: PAGE_TIMEOUT_MS,
      })
      .toEqual(lines);
    expect(await this.page.locator(this.uninstallCode).textContent()).not.toContain(token);
  }

  async copyCommand() {
    await this.page.locator(this.copyBtn).click();
    return await this.page.evaluate(() => navigator.clipboard.readText());
  }

  async expectNoTokenState() {
    await expect(this.page.locator(this.noToken)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  // The dialog must read GET /fleet/collectors again once a token exists, or it never notices the collector.
  async createInlineTokenAndAwaitCollectorsPoll(name) {
    let created = false;
    const onResponse = (resp) => {
      if (resp.request().method() === 'POST' && /\/fleet\/tokens$/.test(new URL(resp.url()).pathname) && resp.ok()) {
        created = true;
      }
    };
    this.page.on('response', onResponse);
    try {
      const createdResp = this.page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/fleet\/tokens$/.test(new URL(r.url()).pathname),
      );
      const polled = this.page.waitForResponse(
        (r) => created && r.request().method() === 'GET' && /\/fleet\/collectors$/.test(new URL(r.url()).pathname),
        { timeout: PAGE_TIMEOUT_MS },
      );
      await this.page.locator(this.noToken).locator(this.tokenFormName).fill(name);
      await this.page.locator(this.noToken).locator(this.tokenFormSubmit).click();
      const resp = await createdResp;
      expect(resp.status(), 'token create from the dialog failed').toBe(201);
      const pollResp = await polled;
      expect(pollResp.status()).toBe(200);
      return await resp.json();
    } finally {
      this.page.off('response', onResponse);
    }
  }

  async expectCopyOnceAndWaiting() {
    await expect(this.page.locator(this.copyOnce)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.waiting)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.placeholderHint)).toHaveCount(0);
  }

  async expectSelectedToken(label) {
    await expect(this.page.locator(this.tokenTrigger)).toHaveAttribute('data-test-selected-label', label, {
      timeout: PAGE_TIMEOUT_MS,
    });
  }

  async tokenOptionLabels() {
    const trigger = this.page.locator(this.tokenTrigger);
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.tokenOption).first()).toBeVisible();
    const labels = await this.page.locator(this.tokenOption).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-test-label')),
    );
    await this.page.keyboard.press('Escape');
    return labels;
  }

  async expectJoinsText(text) {
    await expect(this.page.locator(this.joinsText)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }
}

module.exports = FleetInstallPage;
