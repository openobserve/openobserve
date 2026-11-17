// Copyright 2026 OpenObserve Inc.

// Service versions (enterprise): catalog version columns, the panel Versions tab, the compare drawer
// and Settings → Correlation → Environments & versions. Static methods seed and read the REST API.

const crypto = require('crypto');
const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');
const { orgId, ingestOtlpTraces } = require('../../playwright-tests/utils/traces-api.js');

const STREAM = 'e2e_svcver';
const CLUSTER = 'e2e-svcver-cluster';
const OSS_DENIAL = 'Service versions require the enterprise build';
// The registry flushes once a minute; four flushes leave room for a loaded CI runner.
const REGISTRY_TIMEOUT_MS = 240_000;
const REGISTRY_POLL_MS = [2_000, 5_000];
const MULTI_VERSIONS = ['1.0.0', '1.1.0', '2.0.0'];
const SINGLE_VERSION = '1.0.0';
const SPANS_PER_RESOURCE = 3;

const apiBase = () => (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const attrs = (values) => Object.entries(values).map(([key, value]) => ({ key, value: { stringValue: value } }));

export class ServiceVersionsPage {
  constructor(page) {
    this.page = page;

    this.catalogTable = page.locator('[data-test="services-catalog-table"]');
    this.envFilterTrigger = page.locator('[data-test="svcver-env-filter-trigger"]');
    this.envFilterPopover = page.locator('[data-test="svcver-env-filter-popover"]');
    this.envFilterValue = page.locator('[data-test="svcver-env-filter-value"]');
    this.envOptionNone = page.locator('[data-test="svcver-env-option-none"]');
    this.envPopover = page.locator('[data-test="svcver-env-popover"]');
    this.envNewButton = page.locator('[data-test="svcver-env-new"]');
    this.envNewInput = page.locator('[data-test="svcver-env-new-input-field"]');
    this.envUndoBar = page.locator('[data-test="svcver-env-undo-bar"]');

    this.sidePanel = page.locator('[data-test="service-graph-side-panel"]');
    // The tab content reuses the tab's data-test, so the tab is addressed by its role.
    this.versionsTab = this.sidePanel.locator('[role="tab"][data-test="svcver-versions-tab"]');
    this.versionsTable = this.sidePanel.locator('[data-test="svcver-versions-table"]');
    this.versionRows = this.versionsTable.locator('tr[data-test^="o2-table-row-"]');
    this.compareButton = this.sidePanel.locator('[data-test="svcver-compare"]');
    this.compareWrap = this.sidePanel.locator('[data-test="svcver-compare-wrap"]');
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
    this.drawer = page.locator('[data-test="svcver-drawer"]');

    this.envSettings = page.locator('[data-test="svcver-env-versions"]');
    this.envSettingsTab = page.locator('[role="tab"][data-test="svcver-correlation-settings-env-versions-tab"]');
    this.overridesUndoBar = page.locator('[data-test="svcver-overrides-undo-bar"]');
    this.overridesUndo = page.locator('[data-test="svcver-overrides-undo"]');

    this.catalogRow = (service) =>
      page.locator('tr[data-test^="o2-table-row-"]').filter({
        has: page.locator(`[data-test="services-catalog-service-link-${service}"]`),
      });
    this.catalogCell = (service, column) => this.catalogRow(service).locator(`[data-test="o2-table-cell-${column}"]`);
    this.columnHeader = (column) => this.catalogTable.locator(`[data-test="o2-table-th-${column}"]`);
    this.versionCheckbox = (key) => this.sidePanel.locator(`[data-test="svcver-select-${key}"] [role="checkbox"]`);
    this.versionLabel = (key) => this.sidePanel.locator(`[data-test="svcver-version-${key}"]`);
    this.overrideRemove = (ruleKey) => page.locator(`[data-test="svcver-override-remove-${ruleKey}"]`);
  }

  // ---------------------------------------------------------------- REST: gate, seed, read

  /** `available: false` only on an OSS build that denies the routes; anything else unexpected throws. */
  static async probe(request) {
    const res = await request.get(`${apiBase()}/api/${orgId()}/service_identity/envs`, { headers: getAuthHeaders() });
    if (res.ok()) return { available: true, reason: '' };
    const body = await res.text();
    const config = await request.get(`${apiBase()}/config`);
    expect(config.ok(), `GET /config: ${config.status()}`).toBe(true);
    const buildType = (await config.json()).build_type;
    if (buildType === 'opensource' && res.status() === 403 && body.includes(OSS_DENIAL)) {
      return { available: false, reason: 'service versions are enterprise-only and this is an OSS build' };
    }
    throw new Error(`service versions probe: HTTP ${res.status()} on a ${buildType} build — ${body.slice(0, 200)}`);
  }

  /** Unique service names for one spec: three versions, one version, and one with env "default" outside k8s. */
  static fixture(label) {
    const id = `${label}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
    return {
      namespace: `e2e-svcver-${id}`,
      multi: `svcver-multi-${id}`,
      single: `svcver-single-${id}`,
      noEnv: `svcver-noenv-${id}`,
      multiVersions: MULTI_VERSIONS,
      singleVersion: SINGLE_VERSION,
    };
  }

  static resource(service, { version, env, namespace }) {
    const resource = { 'service.name': service, 'service.version': version, 'deployment.environment': env };
    if (namespace) {
      Object.assign(resource, {
        'k8s.cluster.name': CLUSTER,
        'k8s.namespace.name': namespace,
        'k8s.deployment.name': service,
        'k8s.pod.name': `${service}-${crypto.randomBytes(3).toString('hex')}`,
      });
    }
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const spans = Array.from({ length: SPANS_PER_RESOURCE }, (_, i) => {
      const begin = startNs + BigInt(i) * 1_000_000n;
      return {
        traceId: crypto.randomBytes(16).toString('hex'),
        spanId: crypto.randomBytes(8).toString('hex'),
        name: 'GET /svcver',
        kind: 2,
        startTimeUnixNano: String(begin),
        endTimeUnixNano: String(begin + 5_000_000n),
        attributes: attrs({ 'http.method': 'GET', 'http.route': '/svcver' }),
        status: { code: 1 },
      };
    });
    return { resource: { attributes: attrs(resource) }, scopeSpans: [{ scope: { name: 'svcver-e2e' }, spans }] };
  }

  /** Ingest the fixture's spans and wait until the registry lists every version; returns rows by service and version. */
  static async seed(request, fixture, { services = ['multi', 'single', 'noEnv'] } = {}) {
    const resources = [];
    if (services.includes('multi')) {
      for (const version of fixture.multiVersions) {
        resources.push(this.resource(fixture.multi, { version, env: 'production', namespace: fixture.namespace }));
      }
    }
    if (services.includes('single')) {
      resources.push(this.resource(fixture.single, { version: fixture.singleVersion, env: 'production', namespace: fixture.namespace }));
    }
    if (services.includes('noEnv')) {
      resources.push(this.resource(fixture.noEnv, { version: fixture.singleVersion, env: 'default' }));
    }
    await ingestOtlpTraces(request, STREAM, { resourceSpans: resources });
    testLogger.info('Service versions spans ingested', { stream: STREAM, services });
    const rows = {};
    if (services.includes('multi')) rows.multi = await this.waitForVersions(request, fixture.multi, fixture.multiVersions);
    if (services.includes('single')) rows.single = await this.waitForVersions(request, fixture.single, [fixture.singleVersion]);
    if (services.includes('noEnv')) rows.noEnv = await this.waitForVersions(request, fixture.noEnv, [fixture.singleVersion]);
    return rows;
  }

  static async listVersions(request, service) {
    const res = await request.get(`${apiBase()}/api/${orgId()}/service_versions`, {
      headers: getAuthHeaders(),
      params: { service },
    });
    expect(res.status(), `GET service_versions?service=${service}`).toBe(200);
    return (await res.json()).versions;
  }

  static async waitForVersions(request, service, versions) {
    let rows = [];
    await expect
      .poll(async () => {
        rows = await this.listVersions(request, service);
        return versions.every((version) => rows.some((row) => row.version === version));
      }, { message: `registry lists ${versions.join(', ')} of ${service}`, timeout: REGISTRY_TIMEOUT_MS, intervals: REGISTRY_POLL_MS })
      .toBe(true);
    return Object.fromEntries(rows.map((row) => [row.version, row]));
  }

  static async overridesFor(request, whereKey) {
    const res = await request.get(`${apiBase()}/api/${orgId()}/service_identity/overrides`, {
      headers: getAuthHeaders(),
      params: { q: whereKey, limit: '1000' },
    });
    expect(res.status(), 'GET service_identity/overrides').toBe(200);
    return (await res.json()).overrides.filter((row) => row.where_key === whereKey);
  }

  static async deleteOverride(request, ruleKey) {
    const res = await request.delete(`${apiBase()}/api/${orgId()}/service_identity/overrides/${ruleKey}`, {
      headers: getAuthHeaders(),
    });
    expect([200, 404], `DELETE override ${ruleKey}: ${res.status()}`).toContain(res.status());
  }

  // ---------------------------------------------------------------- Services catalog

  async gotoCatalog() {
    await this.page.goto(
      `${apiBase()}/web/traces?org_identifier=${orgId()}&tab=services-catalog&stream=${STREAM}&period=1h`,
    );
    await expect(this.catalogTable).toBeVisible({ timeout: 30_000 });
  }

  async expectServiceRow(service) {
    await expect(this.catalogRow(service)).toHaveCount(1, { timeout: 60_000 });
  }

  async expectNoServiceRow(service) {
    await expect(this.catalogRow(service)).toHaveCount(0, { timeout: 30_000 });
  }

  async expectVersionColumns() {
    const headers = { version_env: 'Env', version_where: 'Where', service_versions: 'Version', version_verdict: 'Deploy verdict' };
    for (const [column, label] of Object.entries(headers)) {
      await expect(this.columnHeader(column)).toBeVisible();
      await expect(this.columnHeader(column)).toContainText(label);
    }
  }

  /** The cell names one of `versions`: which one (current or newest) depends on deploy tracking. */
  async expectVersionCell(service, versions) {
    const anyOf = new RegExp(versions.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
    await expect(this.catalogCell(service, 'service_versions')).toContainText(anyOf, { timeout: 30_000 });
  }

  async expectWhereNamespace(service, namespace) {
    await expect(this.catalogCell(service, 'version_where').locator(`[data-test="svcver-where-${service}"]`))
      .toContainText(namespace, { timeout: 30_000 });
  }

  async expectOutsideKubernetes(service) {
    await expect(this.catalogCell(service, 'version_where').locator('[data-test="svcver-where-none"]'))
      .toBeVisible({ timeout: 30_000 });
  }

  async expectEnvCell(service, env) {
    await expect(this.catalogCell(service, 'version_env')).toContainText(env, { timeout: 30_000 });
  }

  async openEnvFilter() {
    await this.envFilterTrigger.click();
    await expect(this.envFilterPopover).toBeVisible();
  }

  async pickNoEnv() {
    await expect(this.envOptionNone).toBeVisible();
    await expect(this.envOptionNone).toContainText('No env');
    await this.envOptionNone.click();
    await expect(this.envFilterPopover).toBeHidden();
    await expect(this.envFilterValue).toHaveText('No env');
  }

  /** Change a catalog row's env through its env chip, with a new label typed into the popover. */
  async setEnvFromChip(service, env) {
    await this.catalogCell(service, 'version_env').locator('button[data-test="svcver-env-chip"]').click();
    await expect(this.envPopover).toBeVisible();
    await this.envNewButton.click();
    await this.envNewInput.fill(env);
    await this.envNewInput.press('Enter');
    await expect(this.envUndoBar).toBeVisible({ timeout: 15_000 });
  }

  // ---------------------------------------------------------------- Service panel → Versions tab

  async openVersionsTab(service) {
    await this.catalogRow(service).locator(`[data-test="services-catalog-service-link-${service}"]`).click();
    await expect(this.sidePanel).toBeVisible({ timeout: 30_000 });
    await this.versionsTab.click();
    await expect(this.versionsTab).toHaveAttribute('data-state', 'active', { timeout: 10_000 });
    await expect(this.versionsTable).toBeVisible({ timeout: 30_000 });
  }

  async expectVersionRows(keys) {
    await expect(this.versionRows).toHaveCount(keys.length, { timeout: 30_000 });
    for (const key of keys) await expect(this.versionLabel(key)).toBeVisible();
  }

  async expectCompareDisabled() {
    await expect(this.compareButton).toBeDisabled();
  }

  async expectOnlyOneVersionHint() {
    await this.compareWrap.hover();
    await expect(this.tooltip.filter({ hasText: 'Only one version so far' })).toBeVisible({ timeout: 10_000 });
  }

  async selectVersion(key) {
    await this.versionCheckbox(key).click();
    await expect(this.versionCheckbox(key)).toHaveAttribute('aria-checked', 'true');
  }

  async expectVersionSelectBlocked(key) {
    await expect(this.versionCheckbox(key)).toBeDisabled();
    await expect(this.versionCheckbox(key)).toHaveAttribute('aria-checked', 'false');
  }

  async compareSelected() {
    await expect(this.compareButton).toBeEnabled();
    await this.compareButton.click();
  }

  // ---------------------------------------------------------------- Compare drawer

  async expectDrawerOpen() {
    await expect(this.drawer).toBeVisible({ timeout: 30_000 });
  }

  /** The URL names the service and both picked versions, in either arm. */
  async expectCompareUrl(service, versions) {
    await expect(this.page).toHaveURL(/[?&]cmp=/);
    const query = new URL(this.page.url()).searchParams;
    expect(query.get('cmpSvc')).toBe(service);
    expect(query.get('cmp').split('..').sort()).toEqual([...versions].sort());
  }

  async reload() {
    await this.page.reload();
  }

  // ---------------------------------------------------------------- Settings → Environments & versions

  async gotoEnvSettings() {
    await this.page.goto(`${apiBase()}/web/settings/correlation/env-versions?org_identifier=${orgId()}`);
    await expect(this.envSettingsTab).toHaveAttribute('data-state', 'active', { timeout: 30_000 });
    await expect(this.envSettings).toBeVisible();
  }

  async expectOverrideListed(ruleKey) {
    await expect(this.overrideRemove(ruleKey)).toBeVisible({ timeout: 30_000 });
  }

  async expectOverrideGone(ruleKey) {
    await expect(this.overrideRemove(ruleKey)).toHaveCount(0, { timeout: 30_000 });
  }

  async removeOverride(ruleKey) {
    await this.overrideRemove(ruleKey).click();
    await expect(this.overridesUndoBar).toBeVisible();
    await this.expectOverrideGone(ruleKey);
  }

  async undoRemove() {
    await this.overridesUndo.click();
    await expect(this.overridesUndoBar).toBeHidden({ timeout: 15_000 });
  }
}
