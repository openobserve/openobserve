// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const { ingestCustomData, waitForFieldValueSearchable } = require('../../playwright-tests/utils/data-ingestion.js');

const MONITORS_TABLE = 'synthetic-monitoring-monitors-table';
const RUNS_TABLE = 'monitor-runs-runs-table';
const LOCATIONS_TABLE = 'synthetics-locations-list-table';
const RESULTS_STREAM = 'synthetics_results';

export class SyntheticsRegressionPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
    this.createdCheckIds = [];
    this.createdLocationIds = [];
  }

  _initializeLocators() {
    return {
      newCheckButton: '[data-test="synthetic-monitoring-new-check-btn"]',
      monitorSearchField: '[data-test="synthetic-monitoring-search-input-field"]',
      typeTabs: '[data-test="synthetic-monitoring-type-tabs"]',
      resultsPage: '[data-test="synthetic-monitor-results-page"]',
      resultsBackButton: '[data-test="app-page-header-back"]',
      resultsEditButton: '[data-test="synthetic-monitor-results-edit-btn"]',
      runsSection: '[data-test="synthetics-monitor-runs"]',
      runDrawer: '[data-test="synthetics-run-detail-drawer"]',
      runDetailBackButton: '[data-test="synthetics-run-detail-back-btn"]',
      runDetailTitle: '[data-test="synthetics-run-detail-title"]',
      runDetailInfoSkeleton: '[data-test="synthetics-run-detail-info-skeleton"]',
      protocolRunTitle: '[data-test="synthetics-protocol-run-title"]',
      protocolRunBackButton: '[data-test="synthetics-protocol-run-back-btn"]',
      locationsAddButton: '[data-test="synthetics-locations-add-btn"]',
      locationsRailTab: '[data-test="synthetics-locations-tab"]',
      generalRailTab: '[data-test="general-settings-tab"]',
      tableToolbarInput: '[data-test="o2-table-toolbar"] input',
      tableRow: '[data-test^="o2-table-row-"]',
      locationCell: '[data-test="o2-table-cell-location"]',
      tooltipBubble: '[data-test="o-tooltip-content"]',
      nameCell: '[data-test="o2-table-cell-name"]',
      paginationInfo: '[data-test="o2-table-pagination-info"]',
      pageSizeSelect: '[data-test="o2-table-page-size-select"]',
      pageSizeTrigger: '[data-test="o2-table-page-size-select-trigger"]',
      pageSizeOption: '[data-test="o2-table-page-size-select-option"]',
      nextPageButton: '[data-test="o2-table-next-page-btn"]',
      sortTrigger: '[data-test="o2-table-th-sort-trigger"]',
      sortIcon: '[data-test^="o2-table-sort-icon-"]',
      durationCell: '[data-test="o2-table-cell-duration"]',
    };
  }

  table(name) { return this.page.locator(`[data-test="${name}"]`); }
  columnHeader(tableName, columnId) { return this.table(tableName).locator(`[data-test="o2-table-th-${columnId}"]`); }
  activeSortIcon(direction) { return `[data-test="o2-table-sort-icon-active"][data-test-sort-direction="${direction}"]`; }
  typeTab(type) { return this.page.locator(this.locators.typeTabs).locator(`[data-otoggle-value="${type}"]`); }
  statusTile(status) { return this.page.locator(`[data-test="synthetics-summary-${status}"]`); }
  runStatusFilter(key) { return this.page.locator(this.locators.runsSection).locator(`[data-otoggle-value="${key}"]`); }
  locationsSearchField() { return this.table(LOCATIONS_TABLE).locator(this.locators.tableToolbarInput); }

  baseUrl() {
    const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL || '';
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }

  org() {
    return getOrgIdentifier() || process.env.ORGNAME || 'default';
  }

  /** A short id unique to one test, so parallel tests never share checks or locations. */
  newRunTag() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // Zero-padded so that sorting by name matches creation order.
  numberedNames(base, count) {
    return Array.from({ length: count }, (_, i) => `${base}${String(i).padStart(2, '0')}`);
  }

  // The single-node meta store is SQLite; parallel check writers can hit "database is locked".
  async apiRequest(method, path, data) {
    let last = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await this.page.request[method](`${this.baseUrl()}${path}`, { headers: getAuthHeaders(), data });
      const body = await res.json().catch(() => null);
      testLogger.apiCall(method.toUpperCase(), path, res.status(), 0);
      last = { status: res.status(), body };
      if (res.ok() || !/database is locked|SqlxError|SeaORMError/i.test(JSON.stringify(body ?? ''))) return last;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    return last;
  }

  async getMetaOrg() {
    const { status, body } = await this.apiRequest('get', `/api/${this.org()}/config`);
    expect(status, 'GET /config must succeed').toBe(200);
    expect(body?.synthetics_enabled, 'the server must run with ZO_SYNTHETICS_ENABLED=true').toBe(true);
    return body.meta_org;
  }

  async createPublicLocations(locations) {
    this.createdLocationIds.push(...locations.map((l) => l.id));
    const { status, body } = await this.apiRequest('post', `/api/${this.org()}/synthetics/locations`, {
      locations: locations.map((l) => ({ kind: 'public', provider: 'e2e', region: 'us-east-1', enabled: true, ...l })),
    });
    expect(status, `public locations must be created: ${JSON.stringify(body)}`).toBe(200);
    expect(body.results.every((r) => r.ok), `every location must be created: ${JSON.stringify(body)}`).toBe(true);
    testLogger.info('Synthetics public locations created', { count: locations.length });
  }

  /** Creates one public location for this test's checks and returns its id. */
  async createProbeLocation(tag, label = `SynReg ${tag}`) {
    const id = `synreg-${tag}`;
    await this.createPublicLocations([{ id, label }]);
    return id;
  }

  numberedProbeLocations(tag, count) {
    const labels = this.numberedNames(`SynReg ${tag} `, count);
    return this.numberedNames(`synreg-${tag}-`, count).map((id, i) => ({ id, label: labels[i] }));
  }

  async deleteLocation(id) {
    await this.apiRequest('delete', `/api/${this.org()}/synthetics/locations/${encodeURIComponent(id)}`);
  }

  // Disabled so the scheduler never claims it; the seeded runs stand in for real probes.
  async createCheck(name, type, locationId) {
    const configs = {
      http: { method: 'GET', timeout_ms: 10000, follow_redirects: true, headers: [], assertions: [{ field: 'status_code', operator: 'eq', value: 200 }] },
      tcp: { port: 443, timeout_ms: 10000 },
      browser: {
        steps: [{ id: 'step-navigate', action: 'navigate', url: 'https://example.com' }],
        browser_devices: [{ browser: 'chromium', device: 'desktop' }],
        timeout_ms: 30000,
        capture: { screenshot: 'on-fail', trace: 'on-fail', video: 'off' },
      },
    };
    const { status, body } = await this.apiRequest('post', `/api/${this.org()}/synthetics?folder=default`, {
      name,
      type,
      target: type === 'tcp' ? 'example.com' : 'https://example.com',
      enabled: false,
      retries: 0,
      locations: [locationId],
      frequency: { type: 'minutes', interval: 5, cron: '' },
      config: configs[type],
    });
    if (body?.id) this.createdCheckIds.push(body.id);
    expect([200, 201], `check ${name} must be created: ${JSON.stringify(body)}`).toContain(status);
    return { id: body.id, name, type };
  }

  async deleteCheck(id) {
    await this.apiRequest('delete', `/api/${this.org()}/synthetics/${id}?folder=default`);
  }

  // Checks go first: a location still referenced by a check may refuse deletion.
  async deleteCreated() {
    for (const id of this.createdCheckIds.splice(0)) await this.deleteCheck(id);
    for (const id of this.createdLocationIds.splice(0)) await this.deleteLocation(id);
  }

  async seedRuns(check, locationId, runs) {
    const browser = check.type === 'browser';
    const nowMs = Date.now();
    const rows = runs.map((run, i) => {
      const suffix = `${i}${Math.random().toString(36).slice(2, 8)}`;
      const tsMicros = (nowMs - run.ageSec * 1000) * 1000;
      const passed = run.status === 'passed';
      return {
        _timestamp: tsMicros,
        schema_version: 2,
        type: check.type,
        target: 'https://example.com',
        location: locationId,
        location_label: locationId,
        region: 'us-east-1',
        runtime: 'lambda',
        probe_id: 'e2e-probe',
        probe_name: 'e2e',
        trigger_type: 'schedule',
        scheduled_ts: tsMicros - 2_000_000,
        started_ts: tsMicros - 1_000_000,
        completed_ts: tsMicros,
        attempts: 1,
        total_attempt_ms: run.durationMs,
        org_id: this.org(),
        synthetics_id: check.id,
        synthetics_name: check.name,
        run_id: `run-${suffix}`,
        execution_id: `exec-${suffix}`,
        job_id: `job-${suffix}`,
        status: run.status,
        response_time_ms: run.durationMs,
        error: passed ? '' : 'assertion failed',
        ...(browser
          ? {
            device: 'desktop',
            engine: 'chromium',
            recorded_steps: [{ id: 'step-navigate', action: 'navigate', name: 'Open example.com', url: 'https://example.com' }],
            last_attempt_steps: [{ step_id: 'step-navigate', status: run.status, duration_ms: run.durationMs, error: '', screenshot_key: '' }],
          }
          : { status_code: passed ? 200 : 503, assertions_passed: passed }),
      };
    });
    const res = await ingestCustomData(this.page, RESULTS_STREAM, rows);
    const failed = res.data?.status?.find((s) => Number(s.failed) > 0);
    expect(res.status === 200 && !failed, `seeding ${RESULTS_STREAM} must succeed: ${JSON.stringify(res.data)}`).toBe(true);
    const searchable = await waitForFieldValueSearchable(this.page, RESULTS_STREAM, 'synthetics_id', check.id, 60000);
    expect(searchable, `seeded runs for ${check.id} must become searchable`).toBe(true);
    testLogger.info('Synthetics runs seeded', { checkId: check.id, count: rows.length });
    return rows.map((r) => ({ runId: r.run_id, executionId: r.execution_id }));
  }

  // One click per settled direction, so a slow re-render cannot step past the target in the asc -> desc -> none cycle.
  async sortColumn(tableName, columnId, direction) {
    const header = this.columnHeader(tableName, columnId);
    const icon = header.locator(this.locators.sortIcon);
    await expect(icon, `${columnId} must show its sort direction`).toHaveAttribute('data-test-sort-direction', /^(asc|desc|none)$/, { timeout: 30000 });
    for (let click = 0; click < 3; click++) {
      const before = await icon.getAttribute('data-test-sort-direction');
      if (before === direction) break;
      await header.locator(this.locators.sortTrigger).click();
      await expect(icon, `${columnId} sort must move on from ${before}`).not.toHaveAttribute('data-test-sort-direction', before, { timeout: 30000 });
    }
    await expect(icon, `${columnId} must be sorted ${direction}`).toHaveAttribute('data-test-sort-direction', direction);
  }

  async setPageSize(tableName, size) {
    const trigger = this.table(tableName).locator(this.locators.pageSizeTrigger);
    const option = this.page.locator(`${this.locators.pageSizeOption}[data-test-value="${size}"]`);
    const sizeText = new RegExp(`^\\s*${size}\\s*$`);
    // A table re-render (after a sort, or while runs load) can swallow the opening click or rebuild the open list under the option.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await option.isVisible())) await this.table(tableName).locator(this.locators.pageSizeSelect).click();
      const opened = await option.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
      const picked = opened && (await option.click({ timeout: 5000 }).then(() => true).catch(() => false));
      if (picked && (await expect(trigger).toHaveText(sizeText, { timeout: 3000 }).then(() => true).catch(() => false))) break;
      await this.page.keyboard.press('Escape');
    }
    await expect(trigger).toHaveText(sizeText);
  }

  async goToNextPage(tableName) {
    await this.table(tableName).locator(this.locators.nextPageButton).click();
  }

  async expectTableState(tableName, { sortColumn, sortDirection, pageSize, from, to, total, names }) {
    const table = this.table(tableName);
    await expect(table.locator(this.locators.paginationInfo), 'the restored page and page size').toHaveText(
      new RegExp(`\\b${from}\\s*-\\s*${to}\\s+\\S+\\s+${total}\\s*$`),
      { timeout: 30000 },
    );
    await expect(table.locator(this.locators.pageSizeTrigger), 'the restored page size').toHaveText(new RegExp(`^\\s*${pageSize}\\s*$`));
    await expect(
      this.columnHeader(tableName, sortColumn).locator(this.activeSortIcon(sortDirection)),
      `the restored ${sortDirection} sort on ${sortColumn}`,
    ).toBeVisible();
    if (names) {
      await expect(table.locator(this.locators.tableRow).locator(this.locators.nameCell), 'the rows of the restored page').toHaveText(names);
    }
  }

  async browserBack() {
    await this.page.goBack();
  }

  async gotoMonitorsList() {
    await this.page.goto(`/web/synthetics?org_identifier=${this.org()}&folder=default`);
    await expect(this.page.locator(this.locators.newCheckButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics monitors list');
  }

  async selectTypeTab(type) {
    await this.typeTab(type).click();
    await expect(this.typeTab(type)).toHaveAttribute('data-state', 'on');
  }

  async selectStatusTile(status) {
    await this.statusTile(status).click();
    await expect(this.statusTile(status)).toHaveAttribute('aria-pressed', 'true');
  }

  async searchMonitors(text) {
    const field = this.page.locator(this.locators.monitorSearchField);
    await field.fill(text);
    await expect(field).toHaveValue(text);
  }

  async sortMonitors(columnId, direction) { await this.sortColumn(MONITORS_TABLE, columnId, direction); }
  async setMonitorsPageSize(size) { await this.setPageSize(MONITORS_TABLE, size); }
  async nextMonitorsPage() { await this.goToNextPage(MONITORS_TABLE); }

  async openMonitor(name) {
    await this.table(MONITORS_TABLE).locator(this.locators.nameCell).filter({ hasText: name }).click();
    await expect(this.page.locator(this.locators.resultsPage)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics results', { name });
  }

  async expectMonitorRowVisible(name) {
    await expect(this.table(MONITORS_TABLE).locator(this.locators.nameCell).filter({ hasText: name })).toBeVisible({ timeout: 30000 });
  }

  async expectMonitorRowAbsent(name) {
    await expect(this.table(MONITORS_TABLE).locator(this.locators.nameCell).filter({ hasText: name })).toHaveCount(0);
  }

  async expectMonitorsListState({ search, type, status, ...tableState }) {
    await expect(this.page.locator(this.locators.newCheckButton)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.monitorSearchField), 'the restored search text').toHaveValue(search);
    await expect(this.typeTab(type), 'the restored type tab').toHaveAttribute('data-state', 'on');
    await expect(this.statusTile(status), 'the restored status tile').toHaveAttribute('aria-pressed', 'true');
    await this.expectTableState(MONITORS_TABLE, tableState);
  }

  async gotoResults(check) {
    const params = new URLSearchParams({ org_identifier: this.org(), folder: 'default', name: check.name });
    await this.page.goto(`/web/synthetics/${check.id}/results?${params.toString()}`);
    await expect(this.page.locator(this.locators.resultsPage)).toBeVisible({ timeout: 30000 });
    await this.waitForRunsTable();
    testLogger.navigation('Synthetics results', { checkId: check.id });
  }

  runLocationCell(rowIndex) {
    return this.table(RUNS_TABLE).locator(`[data-test="o2-table-row-${rowIndex}"]`).locator(this.locators.locationCell);
  }

  // Cut means some box in the cell is narrower than the text it holds, whichever element does the clipping.
  async expectRunLocationCut(rowIndex) {
    const cell = this.runLocationCell(rowIndex);
    await expect(cell).toBeVisible({ timeout: 30000 });
    const cut = await cell.evaluate((td) => [td, ...td.querySelectorAll('*')].some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(cut, 'the location text must be cut off in its column').toBe(true);
  }

  // Late-loading panels shift the runs table and re-render its rows, which can leave one hover's pointer where no mouseenter fired.
  async hoverRunLocation(rowIndex) {
    const bubble = this.page.locator(this.locators.tooltipBubble).first();
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.table(RUNS_TABLE).locator(this.locators.paginationInfo).hover();
      await this.runLocationCell(rowIndex).hover();
      if (await bubble.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) break;
    }
  }

  async expectTooltipText(text) {
    await expect(this.page.locator(this.locators.tooltipBubble).filter({ hasText: text }), 'the full text in a tooltip').toBeVisible({ timeout: 10000 });
  }

  async waitForRunsTable() {
    await expect(this.table(RUNS_TABLE).locator(this.locators.paginationInfo)).toBeVisible({ timeout: 60000 });
  }

  async selectRunStatus(key) {
    await this.runStatusFilter(key).click();
    await expect(this.runStatusFilter(key)).toHaveAttribute('data-state', 'on');
  }

  async sortRuns(columnId, direction) { await this.sortColumn(RUNS_TABLE, columnId, direction); }
  async setRunsPageSize(size) { await this.setPageSize(RUNS_TABLE, size); }
  async nextRunsPage() { await this.goToNextPage(RUNS_TABLE); }

  async clickResultsBack() {
    await this.page.locator(this.locators.resultsBackButton).click();
    await expect(this.page.locator(this.locators.newCheckButton)).toBeVisible({ timeout: 30000 });
  }

  async openEditCheck(checkId) {
    await this.page.locator(this.locators.resultsEditButton).click();
    await expect(this.page).toHaveURL(new RegExp(`/synthetics/edit/${checkId}`), { timeout: 30000 });
  }

  async runDurationsMs() {
    const texts = await this.table(RUNS_TABLE).locator(this.locators.tableRow).locator(this.locators.durationCell).allTextContents();
    const toMs = { us: 0.001, ms: 1, s: 1000, m: 60000 };
    return texts.map((text) => {
      const match = /(\d+(?:\.\d+)?)\s*(us|ms|s|m)\b/.exec(text);
      return match ? Number(match[1]) * toMs[match[2]] : NaN;
    });
  }

  async expectRunsListState({ status, durationsMs, ...tableState }) {
    await expect(this.page.locator(this.locators.resultsPage)).toBeVisible({ timeout: 30000 });
    await expect(this.runStatusFilter(status), 'the restored run status filter').toHaveAttribute('data-state', 'on', { timeout: 30000 });
    await this.expectTableState(RUNS_TABLE, tableState);
    await expect.poll(() => this.runDurationsMs(), {
      timeout: 30000,
      message: `the restored rows must be in ${tableState.sortDirection} duration order`,
    }).toEqual(durationsMs);
  }

  // Browser runs render RunDetail; http/tcp/tls/ssh runs render ProtocolRunSummary, which has its own header.
  runDetailHeader(type) {
    return type === 'browser'
      ? { title: this.locators.runDetailTitle, back: this.locators.runDetailBackButton }
      : { title: this.locators.protocolRunTitle, back: this.locators.protocolRunBackButton };
  }

  async gotoRunDetail(check, run, query) {
    const params = new URLSearchParams({ org_identifier: this.org(), folder: 'default', name: check.name, ...query });
    await this.page.goto(`/web/synthetics/${check.id}/results/run/${run.runId}/${run.executionId}?${params.toString()}`);
    await expect(this.page.locator(this.runDetailHeader(check.type).title)).toHaveText(check.name, { timeout: 30000 });
    await expect(this.page.locator(this.locators.runDetailInfoSkeleton)).toHaveCount(0, { timeout: 60000 });
    testLogger.navigation('Synthetics run detail', { checkId: check.id, runId: run.runId });
  }

  async clickRunDetailBack(type) {
    await this.page.locator(this.runDetailHeader(type).back).click();
    await expect(this.page.locator(this.locators.resultsPage)).toBeVisible({ timeout: 30000 });
  }

  async expectResultsReopenedOnRun(checkId, run, period) {
    await expect(this.page.locator(this.locators.runDrawer), 'the run the user came back from is reopened').toBeVisible({ timeout: 30000 });
    const url = new URL(this.page.url());
    expect(url.pathname, 'back lands on this check\'s results page').toMatch(new RegExp(`/synthetics/${checkId}/results$`));
    expect(url.searchParams.get('run'), 'the run id travels back').toBe(run.runId);
    expect(url.searchParams.get('exec'), 'the execution id travels back').toBe(run.executionId);
    expect(url.searchParams.get('period'), 'the time range travels back').toBe(period);
  }

  /** Opens one seeded run's full page with a 6h range, clicks its back button and expects the results page to reopen that run. */
  async expectBackFromRunPageReopensRun(tag, type) {
    const locationId = await this.createProbeLocation(tag);
    const check = await this.createCheck(`synreg${tag}_${type}_detail`, type, locationId);
    const [run] = await this.seedRuns(check, locationId, [{ status: 'passed', durationMs: 240, ageSec: 60 }]);

    await this.gotoRunDetail(check, run, { period: '6h' });
    await this.clickRunDetailBack(type);
    await this.expectResultsReopenedOnRun(check.id, run, '6h');
  }

  async gotoLocations(metaOrg) {
    await this.page.goto(`/web/settings/synthetics_locations?org_identifier=${metaOrg}`);
    await expect(this.page.locator(this.locators.locationsAddButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics locations settings');
  }

  async searchLocations(text) {
    await this.locationsSearchField().fill(text);
    await expect(this.locationsSearchField()).toHaveValue(text);
  }

  async sortLocations(columnId, direction) { await this.sortColumn(LOCATIONS_TABLE, columnId, direction); }
  async setLocationsPageSize(size) { await this.setPageSize(LOCATIONS_TABLE, size); }
  async nextLocationsPage() { await this.goToNextPage(LOCATIONS_TABLE); }

  async openGeneralSettings() {
    await this.page.locator(this.locators.generalRailTab).click();
    await expect(this.page).toHaveURL(/\/settings\/general/, { timeout: 30000 });
    await expect(this.table(LOCATIONS_TABLE)).toHaveCount(0);
  }

  async openLocationsFromRail() {
    await this.page.locator(this.locators.locationsRailTab).click();
    await expect(this.page.locator(this.locators.locationsAddButton)).toBeVisible({ timeout: 30000 });
  }

  async expectLocationsListState({ search, ...tableState }) {
    await expect(this.page.locator(this.locators.locationsAddButton)).toBeVisible({ timeout: 30000 });
    await expect(this.locationsSearchField(), 'the restored search text').toHaveValue(search);
    await this.expectTableState(LOCATIONS_TABLE, tableState);
  }
}

export default SyntheticsRegressionPage;
