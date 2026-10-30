// Page object for Continuous Profiling (/web/profiles); selectors from web/src/plugins/profiles and FlameGraphView.vue.

import { expect } from '@playwright/test';
import { PNG } from 'pngjs';

const FLAME_ROW_PX = 26;
const FLAME_PLOT_INSET_PX = 10;
const FLAME_TOOLTIP_Z = 'z-index: 9999999';

// Hand-computed frame geometry (percent of width) for the reference checkout cpu tree (total 12 s).
export const CHECKOUT_FRAMES = {
  root: { depth: 0, left: 0, width: 100, path: 'root' },
  main: { depth: 1, left: 0, width: 98.75, path: 'root/0' },
  runtime_main: { depth: 1, left: 98.75, width: 1.25, path: 'root/1' },
  handle_order: { depth: 2, left: 0, width: 98.75, path: 'root/0/0' },
  gc_sweep: { depth: 2, left: 98.75, width: 1.25, path: 'root/1/0' },
  db_query: { depth: 3, left: 0, width: 50, path: 'root/0/0/0' },
  json_encode: { depth: 3, left: 50, width: 33.333, path: 'root/0/0/1' },
  process_payment: { depth: 3, left: 83.333, width: 2.083, path: 'root/0/0/2' },
};

// Reference catalog cpu tree (total 5.515 s): catalog_main 4.515 s, [truncated] 1 s, 55 values below the 0.1 % draw floor.
export const CATALOG_FRAMES = {
  root: { depth: 0, left: 0, width: 100 },
  catalog_main: { depth: 1, left: 0, width: 81.868 },
  truncated: { depth: 1, left: 81.868, width: 18.132 },
  wide_root: { depth: 2, left: 0, width: 81.868 },
  smallFrames: { depth: 3, left: 79.076, width: 2.792 },
};

/** A frame spanning the whole plot at `depth` (zoomed frames and their dimmed callers). */
export const fullWidthFrame = (depth) => ({ depth, left: 0, width: 100 });

export class ProfilesPage {
  constructor(page) {
    this.page = page;

    this.pageRoot = '[data-test="profiles-page"]';
    this.pageTitle = '[data-test="profiles-page-title"]';
    this.betaBadge = '[data-test="beta-badge"]';
    this.datePicker = '[data-test="profiles-date-picker"]';
    this.datePrevBtn = '[data-test="profiles-date-picker"] [data-test="date-time-prev-btn"]';
    this.dateNextBtn = '[data-test="profiles-date-picker"] [data-test="date-time-next-btn"]';
    this.dateBtn = '[data-test="profiles-date-picker"] [data-test="date-time-btn"]';
    this.shareBtn = '[data-test="profiles-share-btn"]';
    this.runBtn = '[data-test="profiles-run-query"]';
    this.cancelBtn = '[data-test="profiles-cancel-query"]';
    this.runOptionsBtn = '[data-test="profiles-run-options"]';
    this.autoRunToggle = '[data-test="profiles-auto-run-toggle"]';
    this.streamSelect = 'profiles-stream-select';
    this.serviceSelect = 'profiles-service-select';
    this.typeSelect = 'profiles-type-select';

    this.addFilterBtn = '[data-test="profiles-add-filter"]';
    this.tagKeySelect = 'profiles-tag-key-select';
    this.tagValueSelect = 'profiles-tag-value-select';
    this.filterChips = '[data-test^="profiles-filter-chip-"]';

    this.errorState = '[data-test="profiles-error"]';
    this.noStreamState = '[data-test="profiles-no-stream"]';
    this.searchCancelledState = '[data-test="profiles-search-cancelled"]';
    this.noResultsState = '[data-test="profiles-no-results"]';
    this.errorBanner = '[data-test="profiles-error-banner"]';
    this.errorRetryBtn = '[data-test="profiles-error-retry"]';
    this.partialResultBanner = '[data-test="profiles-partial-result"]';

    this.seriesCard = '[data-test="profiles-series-card"]';
    this.seriesChart = '[data-test="profiles-series-card"] [data-test="chart-renderer"]';
    this.breakdownSelect = 'profiles-breakdown-select';
    this.breakdownLegend = '[data-test="profiles-breakdown-legend"]';
    this.breakdownChipOthers = '[data-test="profiles-breakdown-chip-others"]';
    this.seriesSkeleton = '[data-test="profiles-series-skeleton"]';
    this.noSeries = '[data-test="profiles-no-series"]';

    this.viewToggle = '[data-test="profiles-view"]';
    this.searchInput = '[data-test="profiles-search-functions-field"]';
    this.searchSummary = '[data-test="profiles-search-summary"]';
    this.resultsExpandBtn = '[data-test="profiles-results-expand"]';
    this.topTable = '[data-test="profiles-top-table"]';
    this.stackTable = '[data-test="profiles-stack-table"]';
    this.flameSkeleton = '[data-test="profiles-flame-skeleton"]';
    this.sandwich = '[data-test="profiles-sandwich"]';
    this.sandwichFunction = 'profiles-sandwich-function';
    this.sandwichCoverage = '[data-test="profiles-sandwich-coverage"]';
    this.sandwichSkeleton = '[data-test="profiles-sandwich-skeleton"]';
    this.sandwichCallers = '[data-test="profiles-sandwich-callers"]';
    this.sandwichCallees = '[data-test="profiles-sandwich-callees"]';
    this.loadingIndicators = [
      '[data-test="profiles-series-skeleton"]',
      '[data-test="profiles-flame-skeleton"]',
      '[data-test="profiles-sandwich-skeleton"]',
      '[data-test="profiles-top-table"] [data-test="o2-table"][data-test-loading="true"]',
      '[data-test="profiles-stack-table"] [data-test="o2-table"][data-test-loading="true"]',
    ].join(', ');

    this.details = '[data-test="profiles-function-details"]';
    this.detailsCopy = '[data-test="profiles-function-details-copy"]';
    this.detailsClose = '[data-test="profiles-function-details-close"]';
    this.detailsPackage = '[data-test="profiles-function-details-package"]';
    this.detailsSelf = '[data-test="profiles-function-details-self"]';
    this.detailsTotal = '[data-test="profiles-function-details-total"]';
    this.detailsCalledBy = '[data-test="profiles-function-details-called-by"]';
    this.detailsCalls = '[data-test="profiles-function-details-calls"]';
    this.detailsSandwich = '[data-test="profiles-function-details-sandwich"]';
    this.detailsShow = '[data-test="profiles-function-details-show"]';

    this.compare = '[data-test="profiles-compare"]';
    this.compareLabel = 'profiles-compare-label';
    this.compareBaseline = 'profiles-compare-baseline';
    this.compareComparison = 'profiles-compare-comparison';
    this.compareSwap = '[data-test="profiles-compare-swap"]';
    this.compareLegend = '[data-test="profiles-compare-legend"]';
    this.compareSkeleton = '[data-test="profiles-compare-skeleton"]';
    this.compareMessage = '[data-test="profiles-compare-message"]';
    this.compareFlame = '[data-test="profiles-compare-flame"]';
    this.compareSides = '[data-test="profiles-compare-sides"]';
    this.compareTable = '[data-test="profiles-compare-table"]';
    this.compareSideBaseline = '[data-test="profiles-compare-side-baseline"]';
    this.compareSideComparison = '[data-test="profiles-compare-side-comparison"]';

    this.flameViewOptions = '[data-test="flame-graph-view-options"]';
    this.flameAlignLeft = '[data-test="flame-graph-align-left"]';
    this.flameAlignRight = '[data-test="flame-graph-align-right"]';
    this.flameRootAtBottom = '[data-test="flame-graph-root-at-bottom-btn"]';
    this.flamePlot = '[data-test="flame-graph-plot"]';
    this.flameFrameMore = '[data-test="flame-graph-frame-more"]';
    this.flameZoomHint = '[data-test="flame-graph-zoom-hint"]';
    this.flameZoomHintNever = '[data-test="flame-graph-zoom-hint-never"]';
    this.flameZoomHintClose = '[data-test="flame-graph-zoom-hint-close"]';
    this.flameMenu = '[data-test="flame-graph-frame-menu"]';

    this.successToast = '[data-test-variant="success"]';
    this.menuProfiles = '[data-test="menu-link-/profiles-item"]';
    this.menuLinks = '[data-test^="menu-link-"]';
    this.navRail = '[data-test="navbar-main-nav"]';

    this.streamTypeFilter = '[data-test="log-stream-type-filter"]';
    this.streamSearchInput = '[data-test="streams-search-stream-input-field"]';
    this.streamExploreBtn = '[data-test="log-stream-explore-btn"]';
    this.ingestionProfilesTab = '[data-test="ingestion-custom-tab-ingestProfiles"]';
    this.ingestionOtelTab = '[data-test="ingestion-profiles-tab-otelCollector"]';
    this.ingestionOtelBlock = '[data-test="ingestion-profiles-otel-code-block-pre"]';
    this.ingestionOtelStartBlock = '[data-test="ingestion-profiles-otel-start-code-block-pre"]';
    this.ingestionOtelGrpcBlock = '[data-test="ingestion-profiles-otel-grpc-code-block-pre"]';
    this.traceViewProfileBtn = '[data-test="trace-details-sidebar-header-toolbar-view-profile-btn"]';
  }


  orgName() {
    return process.env['ORGNAME'] || 'default';
  }

  baseUrl() {
    return (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  }

  /** Patches /config and /api/{org}/config so Auto Run and the profiling flag do not depend on how the server was started. */
  async mockServerConfig({ autoQuery = false, profiling = true } = {}) {
    await this.page.route(/\/config(\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== '/config' && !/^\/api\/[^/]+\/config$/.test(url.pathname)) return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, auto_query_enabled: autoQuery, profiling_enabled: profiling },
      });
    });
  }

  /** Drops this page's routes so an in-flight mock cannot fail the test after it ends. */
  async teardown() {
    await this.page.unrouteAll({ behavior: 'ignoreErrors' });
  }

  /** Hides the one-time flame zoom hint so it never covers a frame the test clicks. */
  async hideFlameZoomHint() {
    await this.page.addInitScript(() => localStorage.setItem('o2_flame_zoom_hint_hidden', '1'));
  }

  seededUrl({ stream, from, to, period, service, type = 'cpu', unit = 'nanoseconds', view = 'top', filters, extra = {} }) {
    const params = new URLSearchParams({ org_identifier: this.orgName(), stream });
    if (from && to) {
      params.set('from', String(from));
      params.set('to', String(to));
    }
    if (period) params.set('period', period);
    if (service) params.set('service_name', service);
    if (type) {
      params.set('profile_type', type);
      params.set('profile_unit', unit);
    }
    if (filters) params.set('filters', filters);
    if (view) params.set('view', view);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return `${this.baseUrl()}/web/profiles?${params.toString()}`;
  }

  /** Opens the page on a seeded reference stream (`ref` from seedReferenceStream) and waits for the run. */
  async gotoRef(ref, { service = 'checkout', view = 'top', type, unit, filters, extra = {} } = {}) {
    await this.gotoSeeded({ stream: ref.stream, ...ref.window, service, view, filters, extra, ...(type ? { type, unit } : {}) });
  }

  async gotoSeeded(options) {
    await this.page.goto(this.seededUrl(options));
    await this.waitForPageReady();
  }

  /** Opens a seeded URL and returns once the page shell is up, without waiting for the run. */
  async openSeededNoWait(options) {
    await this.page.goto(this.seededUrl(options));
    await expect(this.page.locator(this.pageRoot)).toBeVisible({ timeout: 30000 });
  }

  async gotoProfiles() {
    await this.page.goto(`${this.baseUrl()}/web/profiles?org_identifier=${this.orgName()}`);
    await this.waitForPageReady();
  }

  async gotoUrl(url) {
    await this.page.goto(url);
    await this.waitForPageReady();
  }

  async reload() {
    await this.page.reload();
    await this.waitForPageReady();
  }

  async waitForPageReady() {
    await expect(this.page.locator(this.pageRoot)).toBeVisible({ timeout: 30000 });
    await this.waitForRunIdle();
  }

  /** Waits until the query AND the page init (meta) are done: skeletons render while either runs, and init ignores input. */
  async waitForRunIdle() {
    await expect(this.page.locator(this.cancelBtn)).toHaveCount(0, { timeout: 30000 });
    await expect(this.page.locator(this.runBtn)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.loadingIndicators)).toHaveCount(0, { timeout: 30000 });
  }

  /** In-app navigation through the SPA router, as a menu click would do. */
  async routerPush(location) {
    await this.page.evaluate((to) => {
      const app = document.querySelector('#app')?.__vue_app__;
      return app.config.globalProperties.$router.push(to);
    }, location);
  }

  currentQuery() {
    return Object.fromEntries(new URL(this.page.url()).searchParams.entries());
  }

  async expectUrlParam(key, value) {
    await expect.poll(() => this.currentQuery()[key], { timeout: 10000, message: `URL ${key}` }).toBe(value);
  }

  async expectUrlParamAbsent(key) {
    await expect.poll(() => key in this.currentQuery(), { timeout: 10000, message: `URL ${key} absent` }).toBe(false);
  }

  async historyLength() {
    return this.page.evaluate(() => window.history.length);
  }

  trackRequests() {
    const calls = { series: [], merge: [], meta: [], tag_values: [], diff: [] };
    this.page.on('request', (request) => {
      const match = request.url().match(/\/profiles\/(series|merge|meta|tag_values|diff)(\?|$)/);
      if (!match) return;
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      calls[match[1]].push({ url: request.url(), body });
    });
    return calls;
  }

  /** Holds matching profiles API calls until the returned release() is called, so loading and cancel states stay on screen. */
  async holdApi(kind) {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await this.page.route(new RegExp(`/profiles/${kind}(\\?|$)`), async (route) => {
      await gate;
      await route.fallback().catch((error) => {
        if (!/already handled|closed/i.test(error.message)) throw error;
      });
    });
    return release;
  }

  async mockApi(kind, { status = 200, json }) {
    await this.page.route(new RegExp(`/profiles/${kind}(\\?|$)`), (route) => route.fulfill({ status, json }));
  }

  /** Rewrites the real `kind` response with the fields `patch(body)` returns (e.g. truncated flags). */
  async patchApiResponse(kind, patch) {
    await this.page.route(new RegExp(`/profiles/${kind}(\\?|$)`), async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, ...patch(body) } });
    });
  }

  /** Rewrites the merge request's max_nodes before it reaches the server. */
  async forceMergeMaxNodes(maxNodes) {
    await this.page.route(/\/profiles\/merge(\?|$)/, async (route) => {
      const body = route.request().postDataJSON();
      await route.fallback({ postData: JSON.stringify({ ...body, max_nodes: maxNodes }) });
    });
  }

  /** Answers the profiles stream-name list with exactly `names`, so "first stream" does not depend on other streams in the org. */
  async mockStreamList(names) {
    await this.page.route(/\/api\/[^/]+\/streams\?.*type=profiles/, (route) =>
      route.fulfill({ status: 200, json: { list: names.map((name) => ({ name, stream_type: 'profiles' })) } }),
    );
  }

  async unrouteApi(kind) {
    await this.page.unroute(new RegExp(`/profiles/${kind}(\\?|$)`));
  }


  selectRoot(name, scope) {
    return (scope ?? this.page).locator(`[data-test="${name}"]`).first();
  }

  selectTrigger(name, scope) {
    return (scope ?? this.page).locator(`[data-test="${name}-trigger"]`).first();
  }

  async openSelect(name, scope) {
    const trigger = this.selectTrigger(name, scope);
    await expect(trigger).toBeVisible();
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 });
    }).toPass({ timeout: 15000 });
  }

  async closeSelect(name, scope) {
    const trigger = this.selectTrigger(name, scope);
    if ((await trigger.getAttribute('aria-expanded')) === 'true') await this.page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }

  options(name) {
    return this.page.locator(`[data-test="${name}-popover"] [data-test="${name}-option"]`);
  }

  async selectOptionLabels(name, scope) {
    await this.openSelect(name, scope);
    await expect(this.options(name).first()).toBeVisible();
    const labels = await this.options(name).evaluateAll((els) => els.map((el) => el.getAttribute('data-test-label')));
    await this.closeSelect(name, scope);
    return labels;
  }

  async pickOption(name, label, scope) {
    await this.openSelect(name, scope);
    const option = this.page.locator(`[data-test="${name}-popover"] [data-test="${name}-option"][data-test-label="${label}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await expect(this.selectTrigger(name, scope)).toHaveAttribute('data-test-selected-label', label);
  }

  async expectSelected(name, label, scope) {
    await expect(this.selectTrigger(name, scope)).toHaveAttribute('data-test-selected-label', label, { timeout: 15000 });
  }

  async selectStream(stream) {
    await this.pickOption(this.streamSelect, stream);
  }

  async selectService(service) {
    await this.pickOption(this.serviceSelect, service);
  }

  async selectProfileType(label) {
    await this.pickOption(this.typeSelect, label);
  }


  async clickRun() {
    await expect(this.page.locator(this.runBtn)).toBeEnabled();
    await this.page.locator(this.runBtn).click();
    await this.waitForRunIdle();
  }

  /** Clicks Run without waiting for the query to answer (for cancel tests). */
  async clickRunNoWait() {
    await this.page.locator(this.runBtn).click();
  }

  async clickCancel() {
    await expect(this.page.locator(this.cancelBtn)).toBeVisible({ timeout: 15000 });
    await this.page.locator(this.cancelBtn).click();
    await this.waitForRunIdle();
  }

  async expectRunPending(pending) {
    const run = this.page.locator(this.runBtn);
    if (pending) await expect(run).toHaveAttribute('data-run-pending', 'true');
    else await expect(run).not.toHaveAttribute('data-run-pending', 'true');
  }

  async expectRunDisabled() {
    await expect(this.page.locator(this.runBtn)).toBeDisabled();
  }

  async hoverRunAndExpectTooltip(text) {
    await this.page.locator(this.runBtn).hover({ force: true });
    await expect(this.page.locator('[data-test="o-tooltip-content"]').filter({ hasText: text })).toBeVisible();
  }

  async expectRunOptionsHidden() {
    await expect(this.page.locator(this.runBtn)).toBeVisible();
    await expect(this.page.locator(this.runOptionsBtn)).toHaveCount(0);
  }

  async openRunOptions() {
    const trigger = this.page.locator(this.runOptionsBtn);
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(this.page.locator(this.autoRunToggle)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
  }

  async expectAutoRunToggleText(text) {
    await expect(this.page.locator(this.autoRunToggle)).toContainText(text);
  }

  async clickAutoRunToggle() {
    await this.page.locator(this.autoRunToggle).click();
    await expect(this.page.locator(this.autoRunToggle)).toHaveCount(0);
  }

  async autoRunStorageValue() {
    return this.page.evaluate(() => localStorage.getItem('oo_toggle_auto_run'));
  }

  async clickDatePrev() {
    await this.page.locator(this.datePrevBtn).click();
  }

  async clickDateNext() {
    await this.page.locator(this.dateNextBtn).click();
  }

  async expectDateButtonText(pattern) {
    await expect(this.page.locator(this.dateBtn)).toContainText(pattern);
  }


  async openAddFilter() {
    const add = this.page.locator(this.addFilterBtn);
    await expect(async () => {
      if ((await add.getAttribute('aria-expanded')) !== 'true') await add.click();
      await expect(this.selectTrigger(this.tagKeySelect)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
  }

  async openFilterEditor(key) {
    const edit = this.page.locator(`[data-test="profiles-filter-edit-${key}"]`);
    await expect(async () => {
      if ((await edit.getAttribute('aria-expanded')) !== 'true') await edit.click();
      await expect(this.selectTrigger(this.tagValueSelect)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
  }

  /** Opens the add-filter menu, picks the label, then the value (which applies the filter). */
  async addFilter(key, value) {
    await this.openAddFilter();
    await this.pickOption(this.tagKeySelect, key);
    await this.pickFilterValue(value);
  }

  async pickFilterValue(value) {
    const trigger = this.selectTrigger(this.tagValueSelect);
    await expect(trigger).toBeEnabled();
    await this.openSelect(this.tagValueSelect);
    const option = this.page.locator(
      `[data-test="${this.tagValueSelect}-popover"] [data-test="${this.tagValueSelect}-option"][data-test-label="${value}"]`,
    );
    await expect(option).toBeVisible();
    await option.click();
    await expect(this.selectTrigger(this.tagValueSelect)).toHaveCount(0);
  }

  async filterValueOptionLabels(key) {
    await this.openAddFilter();
    await this.pickOption(this.tagKeySelect, key);
    await expect(this.selectTrigger(this.tagValueSelect)).toBeEnabled();
    const labels = await this.selectOptionLabels(this.tagValueSelect);
    await this.page.keyboard.press('Escape');
    return labels;
  }

  async editFilter(key, value) {
    await this.openFilterEditor(key);
    await this.pickFilterValue(value);
  }

  async removeFilter(key) {
    await this.page.locator(`[data-test="profiles-filter-remove-${key}"]`).click();
    await expect(this.page.locator(`[data-test="profiles-filter-chip-${key}"]`)).toHaveCount(0);
  }

  async expectFilterChip(key, value) {
    const chip = this.page.locator(`[data-test="profiles-filter-chip-${key}"]`);
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(key);
    await expect(chip).toContainText(value);
  }

  async expectFilterChipCount(count) {
    await expect(this.page.locator(this.filterChips)).toHaveCount(count);
  }

  async expectValueSelectDisabled() {
    await this.openAddFilter();
    await expect(this.selectTrigger(this.tagValueSelect)).toBeDisabled();
    await this.page.keyboard.press('Escape');
  }


  async switchView(view) {
    await this.page.locator(`[data-test="profiles-view-${view}"]`).click();
    await this.expectViewActive(view);
  }

  async expectViewActive(view) {
    await expect(this.page.locator(`[data-test="profiles-view-${view}"]`)).toHaveAttribute('data-state', 'on', { timeout: 15000 });
  }

  async search(text) {
    await this.page.locator(this.searchInput).fill(text);
  }

  async expectSearchValue(text) {
    await expect(this.page.locator(this.searchInput)).toHaveValue(text);
  }

  async expectSearchSummary(text) {
    await expect(this.page.locator(this.searchSummary)).toHaveText(text);
  }

  async toggleResultsExpand() {
    await this.page.locator(this.resultsExpandBtn).click();
  }


  /** Rendered row at `position` (data-test row ids keep the unsorted data index, so position is by DOM order). */
  topRow(position) {
    return this.topRowsLocator().nth(position);
  }

  topRowsLocator() {
    return this.page.locator(`${this.topTable} [data-test^="o2-table-row-"]`);
  }

  /** Asserts a Top Table row: values are display strings, any omitted key is not checked. */
  async expectTopRow(index, { name, self, selfPercent, total, totalPercent }) {
    const row = this.topRow(index);
    if (name !== undefined) await expect(row.locator('[data-test="o2-table-cell-name"]')).toHaveText(name, { timeout: 15000 });
    if (self !== undefined) await expect(row.locator('[data-test="o2-table-cell-self"]')).toHaveText(self);
    if (selfPercent !== undefined) await expect(row.locator('[data-test="o2-table-cell-selfPercent"]')).toHaveText(selfPercent);
    if (total !== undefined) await expect(row.locator('[data-test="o2-table-cell-total"]')).toHaveText(total);
    if (totalPercent !== undefined) await expect(row.locator('[data-test="o2-table-cell-totalPercent"]')).toHaveText(totalPercent);
  }

  async expectTopRowNames(names) {
    await expect(this.topRowsLocator().locator('[data-test="o2-table-cell-name"]')).toHaveText(names, { timeout: 15000 });
  }

  async expectTopRowCount(count) {
    await expect(this.topRowsLocator()).toHaveCount(count, { timeout: 15000 });
  }

  async expectTopTableVisible() {
    await expect(this.page.locator(this.topTable)).toBeVisible({ timeout: 15000 });
  }

  async sortTopBy(columnId) {
    await this.page.locator(`th[data-test="o2-table-th-${columnId}"] [data-test="o2-table-th-sort-trigger"]`).click();
  }

  async expectTopSort(columnId, direction) {
    await expect(this.page.locator(`th[data-test="o2-table-th-${columnId}"]`)).toHaveAttribute('aria-sort', direction);
  }

  async expectMarkedText(text) {
    await expect(this.topRowsLocator().locator('mark').first()).toHaveText(text);
  }

  /** Opens the ⋮ menu of the row rendered at `position`; returns the menu's data-test prefix. */
  async openRowMenu(kind, position) {
    const row = kind === 'tree' ? this.treeRow(position) : this.topRow(position);
    const trigger = row.locator(`[data-test^="profiles-${kind}-row-"][data-test$="-menu"]`);
    const prefix = (await trigger.getAttribute('data-test')).replace(/-menu$/, '');
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(this.page.locator(`[data-test="${prefix}-copy"]`)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    return prefix;
  }

  async rowMenuAction(kind, position, action) {
    const prefix = await this.openRowMenu(kind, position);
    await this.page.locator(`[data-test="${prefix}-${action}"]`).click();
  }

  treeRow(position) {
    return this.page.locator(`${this.stackTable} [data-test^="o2-table-row-"]`).nth(position);
  }

  async expectTreeRow(index, { name, counts, self, total }) {
    const row = this.treeRow(index);
    if (name !== undefined) await expect(row.locator('[data-test="o2-table-cell-name"]')).toContainText(name, { timeout: 15000 });
    const countCell = row.locator('[data-test^="profiles-tree-row-"][data-test$="-counts"]');
    if (counts === null) await expect(countCell).toHaveCount(0);
    else if (counts !== undefined) await expect(countCell).toHaveText(counts);
    if (self !== undefined) await expect(row.locator('[data-test="o2-table-cell-self"]')).toHaveText(self);
    if (total !== undefined) await expect(row.locator('[data-test="o2-table-cell-total"]')).toHaveText(total);
  }

  async expectTreeRowCount(count) {
    await expect(this.page.locator(`${this.stackTable} [data-test^="o2-table-row-"]`)).toHaveCount(count);
  }

  async toggleTreeRow(index) {
    await this.treeRow(index).locator('[data-test="o2-table-tree-toggle-name"]').click();
  }

  async expectTreeRowExpanded(index, expanded) {
    await expect(this.treeRow(index).locator('[data-test="o2-table-tree-toggle-name"]')).toHaveAttribute('aria-expanded', String(expanded));
  }


  async expectDetails({ name, self, total, calledBy, calls, hasPackage }) {
    const panel = this.page.locator(this.details);
    await expect(panel).toBeVisible({ timeout: 15000 });
    if (name !== undefined) await expect(panel).toContainText(name);
    if (self !== undefined) await expect(panel.locator(this.detailsSelf)).toHaveText(self);
    if (total !== undefined) await expect(panel.locator(this.detailsTotal)).toHaveText(total);
    if (calledBy !== undefined) {
      for (const caller of calledBy) await expect(panel.locator(this.detailsCalledBy)).toContainText(caller);
    }
    if (calls !== undefined) {
      for (const callee of calls) await expect(panel.locator(this.detailsCalls)).toContainText(callee);
    }
    if (hasPackage !== undefined) await expect(panel.locator(this.detailsPackage)).toHaveCount(hasPackage ? 1 : 0);
  }

  async detailsListRowCount(list) {
    const section = this.page.locator(list === 'calls' ? this.detailsCalls : this.detailsCalledBy);
    return section.locator(':scope > div').count();
  }

  async expectDetailsHidden() {
    await expect(this.page.locator(this.details)).toHaveCount(0);
  }

  async clickDetails(action) {
    const map = { copy: this.detailsCopy, close: this.detailsClose, sandwich: this.detailsSandwich, show: this.detailsShow };
    await this.page.locator(map[action]).click();
  }


  async expectSandwichFunction(name) {
    await this.expectSelected(this.sandwichFunction, name);
  }

  async pickSandwichFunction(name) {
    await this.pickOption(this.sandwichFunction, name);
  }

  async expectSandwichCoverage(visible) {
    await expect(this.page.locator(this.sandwichCoverage)).toHaveCount(visible ? 1 : 0, { timeout: 15000 });
  }

  async expectSandwichCoverageText(text) {
    await expect(this.page.locator(this.sandwichCoverage)).toContainText(text, { timeout: 15000 });
  }


  flameGraph(scope) {
    return (scope ? this.page.locator(scope) : this.page).locator(this.flamePlot).first();
  }

  /** Viewport point at the centre of a frame from its hand-computed geometry (rows 26 px, plot inset 10 px). */
  async framePoint(frame, { scope, rootAtBottom = false, maxDepth = 0, at = 0.5 } = {}) {
    const box = await this.flameGraph(scope).boundingBox();
    if (!box) throw new Error('Flame graph plot is not on screen');
    const depth = rootAtBottom ? maxDepth - frame.depth : frame.depth;
    const share = (frame.left + frame.width * at) / 100;
    return {
      x: box.x + FLAME_PLOT_INSET_PX + share * (box.width - 2 * FLAME_PLOT_INSET_PX),
      y: box.y + 1 + depth * FLAME_ROW_PX + FLAME_ROW_PX / 2 - 1,
    };
  }

  flameTooltip(text) {
    return this.page.locator(`body > div[style*="${FLAME_TOOLTIP_Z}"]`).filter({ hasText: text });
  }

  /** Hovers a frame and proves the tooltip names it, so later clicks land on the intended frame. */
  async hoverFrame(frame, name, options = {}) {
    const point = await this.framePoint(frame, options);
    await expect(async () => {
      await this.page.mouse.move(point.x, point.y - 3);
      await this.page.mouse.move(point.x, point.y);
      await expect(this.flameTooltip(name).first()).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    return point;
  }

  async expectFlameTooltipContains(name, texts) {
    const tooltip = this.flameTooltip(name).first();
    for (const text of texts) await expect(tooltip).toContainText(text);
  }

  async expectFlameTooltipLacks(name, text) {
    await expect(this.flameTooltip(name).first()).not.toContainText(text);
  }

  async expectFlameViewOptions() {
    await expect(this.page.locator(this.flameViewOptions).first()).toBeVisible();
  }

  async clickFrame(frame, name, options = {}) {
    const point = await this.hoverFrame(frame, name, options);
    await this.page.mouse.click(point.x, point.y);
  }

  async rightClickFrame(frame, name, options = {}) {
    const point = await this.hoverFrame(frame, name, options);
    await this.page.mouse.click(point.x, point.y, { button: 'right' });
  }

  async expectFlameMenu(items, absent = []) {
    const menu = this.page.locator(this.flameMenu);
    await expect(menu).toBeVisible();
    for (const item of items) await expect(menu.locator(`[data-test="flame-graph-${item}"]`)).toBeVisible();
    for (const item of absent) await expect(menu.locator(`[data-test="flame-graph-${item}"]`)).toHaveCount(0);
  }

  async expectFlameMenuHidden() {
    await expect(this.page.locator(this.flameMenu)).toHaveCount(0);
  }

  async clickFlameMenuItem(item) {
    await this.page.locator(`${this.flameMenu} [data-test="flame-graph-${item}"]`).click();
  }

  async expectFlameRootSummary(text, scope) {
    await this.hoverFrame(CHECKOUT_FRAMES.root, text, { scope });
  }

  /** Screenshot of the label end of a frame (first 40 px), where search highlighting draws. */
  async frameLabelPng(frame, options = {}) {
    const box = await this.flameGraph(options.scope).boundingBox();
    const x = box.x + FLAME_PLOT_INSET_PX + (frame.left / 100) * (box.width - 2 * FLAME_PLOT_INSET_PX);
    const y = box.y + 1 + frame.depth * FLAME_ROW_PX;
    return this.page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 40, height: FLAME_ROW_PX - 2 } });
  }

  async flameCanvasPng(scope) {
    return this.flameGraph(scope).screenshot();
  }

  async toggleRootAtBottom() {
    await this.page.locator(this.flameRootAtBottom).first().click();
  }

  async expectRootAtBottom(checked) {
    await expect(this.page.locator(this.flameRootAtBottom).first()).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked');
  }

  async clickAlign(side) {
    await this.page.locator(side === 'right' ? this.flameAlignRight : this.flameAlignLeft).first().click();
  }

  async expectAlignActive(side) {
    const active = this.page.locator(side === 'right' ? this.flameAlignRight : this.flameAlignLeft).first();
    await expect(active).toHaveAttribute('data-o2-variant', 'primary');
  }

  async flamePlotWidth(scope) {
    const box = await this.flameGraph(scope).boundingBox();
    return box ? box.width : 0;
  }

  async flameCanvasWidth(scope) {
    return this.flameGraph(scope).locator('canvas').first().evaluate((canvas) => canvas.getBoundingClientRect().width);
  }

  async ctrlWheelOnFrame(frame, name, deltaY) {
    const point = await this.hoverFrame(frame, name);
    await this.page.keyboard.down('Control');
    await this.page.mouse.wheel(0, deltaY);
    await this.page.keyboard.up('Control');
    return point;
  }

  async dragOnFlame(from, dx) {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(from.x + dx / 2, from.y, { steps: 5 });
    await this.page.mouse.move(from.x + dx, from.y, { steps: 5 });
    await this.page.mouse.up();
  }

  async expectFlameGrabCursor(zoomed) {
    const plot = this.flameGraph();
    if (zoomed) await expect(plot).toHaveClass(/cursor-grab/);
    else await expect(plot).not.toHaveClass(/cursor-grab/);
  }

  async expectZoomHint(visible) {
    await expect(this.page.locator(this.flameZoomHint)).toHaveCount(visible ? 1 : 0, { timeout: 15000 });
  }

  async expectZoomHintText(pattern) {
    await expect(this.page.locator(this.flameZoomHint)).toContainText(pattern);
  }

  async clickZoomHint(action) {
    await this.page.locator(action === 'never' ? this.flameZoomHintNever : this.flameZoomHintClose).click();
  }

  async zoomHintStorageValue() {
    return this.page.evaluate(() => localStorage.getItem('o2_flame_zoom_hint_hidden'));
  }

  async expectFrameMoreVisible() {
    await expect(this.page.locator(this.flameFrameMore)).toBeVisible();
  }

  async clickFrameMore() {
    await this.page.locator(this.flameFrameMore).click();
  }

  async pressEscape() {
    await this.page.keyboard.press('Escape');
  }

  async expectFlameSkeleton() {
    await expect(this.page.locator(this.flameSkeleton)).toBeVisible();
  }


  pixelAt(png, fx, fy) {
    const image = PNG.sync.read(png);
    const x = Math.min(image.width - 1, Math.max(0, Math.round(fx * image.width)));
    const y = Math.min(image.height - 1, Math.max(0, Math.round(fy * image.height)));
    const i = (image.width * y + x) * 4;
    return { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] };
  }

  /** RGB at a viewport point, from a 1×1 page screenshot. */
  async viewportPixel(x, y) {
    const png = await this.page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
    return this.pixelAt(png, 0, 0);
  }

  /** Horizontal centre (0–1 of the chart width) of the strongly blue pixels the series draws. */
  async seriesBlueCentre() {
    const png = await this.page.locator(this.seriesChart).screenshot();
    const image = PNG.sync.read(png);
    let sum = 0;
    let count = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (image.width * y + x) * 4;
        const [r, g, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
        if (b > 150 && b - r > 60 && b - g > 30) {
          sum += x;
          count += 1;
        }
      }
    }
    return { count, centre: count ? sum / count / image.width : -1 };
  }


  async expectSeriesCardVisible(visible) {
    if (visible) await expect(this.page.locator(this.seriesCard)).toBeVisible();
    else await expect(this.page.locator(this.seriesCard)).toBeHidden();
  }

  /** Sweeps the pointer across the series chart and returns every distinct tooltip text. */
  async collectSeriesTooltips(step = 5) {
    const chart = this.page.locator(this.seriesChart);
    await expect(chart.locator('canvas').first()).toBeVisible();
    const box = await chart.boundingBox();
    const texts = new Set();
    const tooltip = chart.locator(':scope > div').filter({ hasText: /\d/ });
    for (let x = box.x + 2; x < box.x + box.width - 2; x += step) {
      await this.page.mouse.move(x, box.y + box.height / 2);
      const visible = tooltip.last();
      if (await visible.isVisible()) {
        const text = (await visible.innerText()).replace(/\s+/g, ' ').trim();
        if (text) texts.add(text);
      }
    }
    await this.page.mouse.move(box.x - 20, box.y - 20);
    return [...texts];
  }

  async dragAcrossChart(fromShare, toShare) {
    const box = await this.page.locator(this.seriesChart).boundingBox();
    const y = box.y + box.height / 2;
    await this.page.mouse.move(box.x + box.width * fromShare, y);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width * ((fromShare + toShare) / 2), y, { steps: 5 });
    await this.page.mouse.move(box.x + box.width * toShare, y, { steps: 5 });
    await this.page.mouse.up();
  }

  async pickBreakdown(label) {
    await this.pickOption(this.breakdownSelect, label);
  }

  async breakdownOptionLabels() {
    return this.selectOptionLabels(this.breakdownSelect);
  }

  async expectBreakdownDisabled() {
    await expect(this.selectTrigger(this.breakdownSelect)).toBeDisabled();
  }

  breakdownChip(key) {
    return this.page.locator(`[data-test="profiles-breakdown-chip-${key}"]`);
  }

  async expectBreakdownChips(labels) {
    await expect(this.page.locator(`${this.breakdownLegend} [data-test^="profiles-breakdown-chip-"]`)).toHaveText(labels, { timeout: 15000 });
  }

  async clickBreakdownChip(key) {
    await this.breakdownChip(key).click();
  }

  async expectOthersChipDisabled() {
    await expect(this.page.locator(this.breakdownChipOthers)).toBeDisabled();
    await expect(this.page.locator(this.breakdownChipOthers)).toHaveText('Others');
  }


  async expectState(name, { title, description } = {}) {
    const map = {
      error: this.errorState,
      noStream: this.noStreamState,
      cancelled: this.searchCancelledState,
      noResults: this.noResultsState,
      errorBanner: this.errorBanner,
      partial: this.partialResultBanner,
      noSeries: this.noSeries,
      seriesSkeleton: this.seriesSkeleton,
      sandwichSkeleton: this.sandwichSkeleton,
    };
    const state = this.page.locator(map[name]);
    await expect(state).toBeVisible({ timeout: 15000 });
    if (title) await expect(state).toContainText(title);
    if (description) await expect(state).toContainText(description);
  }

  async expectStateHidden(name) {
    const map = { error: this.errorState, noResults: this.noResultsState, errorBanner: this.errorBanner, partial: this.partialResultBanner, cancelled: this.searchCancelledState };
    await expect(this.page.locator(map[name])).toHaveCount(0, { timeout: 15000 });
  }

  async clickStateAction(name) {
    const map = { error: this.errorState, noStream: this.noStreamState, cancelled: this.searchCancelledState };
    await this.page.locator(map[name]).getByRole('button').first().click();
  }

  async expectTopTableLoading() {
    await expect(this.page.locator(`${this.topTable} [data-test="o2-table"]`)).toHaveAttribute('data-test-loading', 'true');
  }

  async expectSkeleton(kind) {
    const map = { series: this.seriesSkeleton, flame: this.flameSkeleton, sandwich: this.sandwichSkeleton };
    await expect(this.page.locator(map[kind])).toBeVisible({ timeout: 15000 });
  }

  /** Switches the results view while a query is still loading (the toggle stays usable). */
  async switchViewWhileLoading(view) {
    await this.page.locator(`[data-test="profiles-view-${view}"]`).click();
    await expect(this.page.locator(`[data-test="profiles-view-${view}"]`)).toHaveAttribute('data-state', 'on');
  }

  async expectErrorBannerText(text) {
    await expect(this.page.locator(this.errorBanner)).toContainText(text, { timeout: 15000 });
  }

  async clickErrorBannerRetry() {
    await this.page.locator(this.errorRetryBtn).click();
  }

  async expectShareDisabled(disabled) {
    const share = this.page.locator(this.shareBtn);
    if (disabled) await expect(share).toBeDisabled();
    else await expect(share).toBeEnabled();
  }

  async clickShareAndReadClipboard() {
    await this.page.locator(this.shareBtn).click();
    await expect(this.page.locator(this.successToast).filter({ hasText: 'Link Copied Successfully!' })).toBeVisible({ timeout: 15000 });
    return this.readClipboard();
  }

  async readClipboard() {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  async expectCopiedToast() {
    await expect(this.page.locator(this.successToast).filter({ hasText: 'Copied to clipboard' }).first()).toBeVisible({ timeout: 15000 });
  }


  /** RGB of the frame's fill at `at` across its width (away from the label, which sits at the left). */
  async framePixel(frame, { at = 0.8, scope } = {}) {
    const point = await this.framePoint(frame, { at, scope });
    await this.page.mouse.move(0, 0);
    return this.viewportPixel(point.x, point.y);
  }

  /** Chart-canvas pixel near its top-right corner (no axis or line there) and the card pixel just above the canvas. */
  async chartAndCardBackground() {
    const box = await this.page.locator(this.seriesChart).boundingBox();
    const chart = await this.viewportPixel(box.x + box.width - 6, box.y + 3);
    const card = await this.viewportPixel(box.x + box.width - 6, box.y - 6);
    return { chart, card };
  }

  async setViewport(width, height) {
    await this.page.setViewportSize({ width, height });
  }

  async openMobileViewMenu() {
    const trigger = this.page.locator('[data-test="profiles-view-dropdown-btn"]');
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(this.page.locator('[data-test="profiles-view-top-item"]')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
  }

  async mobileViewMenuItems() {
    return this.page.locator('[data-test^="profiles-view-"][data-test$="-item"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-test')));
  }

  async pickMobileView(view) {
    await this.openMobileViewMenu();
    await this.page.locator(`[data-test="profiles-view-${view}-item"]`).click();
  }

  async hasHorizontalPageScroll() {
    return this.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  }

  async detailsSitsBelowTable() {
    const table = await this.page.locator(this.topTable).boundingBox();
    const details = await this.page.locator(this.details).boundingBox();
    return details.y >= table.y + table.height - 1;
  }


  async expectCompareSides(label, baseline, comparison) {
    await this.expectSelected(this.compareLabel, label);
    await this.expectSelected(this.compareBaseline, baseline);
    await this.expectSelected(this.compareComparison, comparison);
  }

  async waitForCompareIdle() {
    await expect(this.page.locator(this.compare)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.compareSkeleton)).toHaveCount(0, { timeout: 30000 });
  }

  async pickCompareDisplay(display) {
    await this.page.locator(`[data-test="profiles-compare-display-${display}"]`).click();
    await expect(this.page.locator(`[data-test="profiles-compare-display-${display}"]`)).toHaveAttribute('data-state', 'on');
    await this.waitForCompareIdle();
  }

  async clickCompareSwap() {
    await this.page.locator(this.compareSwap).click();
    await this.waitForCompareIdle();
  }

  async pickCompareLabel(label) {
    await this.pickOption(this.compareLabel, label);
    await this.waitForCompareIdle();
  }

  async compareBaselineOptions() {
    return this.selectOptionLabels(this.compareBaseline);
  }

  compareTableRow(name) {
    return this.page.locator(`${this.compareTable} [data-test^="o2-table-row-"]`).filter({
      has: this.page.locator('[data-test="o2-table-cell-name"]', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
    });
  }

  async expectCompareTableRow(name, { before, after, beforePercent, afterPercent, change }) {
    const row = this.compareTableRow(name);
    await expect(row).toHaveCount(1, { timeout: 15000 });
    if (before !== undefined) await expect(row.locator('[data-test="o2-table-cell-before"]')).toHaveText(before);
    if (after !== undefined) await expect(row.locator('[data-test="o2-table-cell-after"]')).toHaveText(after);
    if (beforePercent !== undefined) await expect(row.locator('[data-test="o2-table-cell-beforePercent"]')).toHaveText(beforePercent);
    if (afterPercent !== undefined) await expect(row.locator('[data-test="o2-table-cell-afterPercent"]')).toHaveText(afterPercent);
    if (change !== undefined) await expect(row.locator('[data-test="o2-table-cell-change"]')).toHaveText(change);
  }

  async expectCompareTableRowNames(names) {
    await expect(
      this.page.locator(`${this.compareTable} [data-test^="o2-table-row-"] [data-test="o2-table-cell-name"]`),
    ).toHaveText(names, { timeout: 15000 });
  }

  async expectCompareMessage(text) {
    await expect(this.page.locator(this.compareMessage)).toContainText(text, { timeout: 15000 });
  }


  async expectMenuProfilesVisible(visible) {
    await expect(this.page.locator(this.navRail)).toBeVisible();
    await expect(this.page.locator(this.menuProfiles)).toHaveCount(visible ? 1 : 0);
  }

  async clickMenuProfiles() {
    await this.page.locator(this.menuProfiles).click();
    await this.waitForPageReady();
  }

  async menuLinkOrder() {
    return this.page.locator(this.menuLinks).evaluateAll((els) => els.map((el) => el.getAttribute('data-test')));
  }

  async expectPageHeader() {
    await expect(this.page.locator(this.pageRoot)).toBeVisible();
    await expect(this.page.locator(this.betaBadge).first()).toBeVisible();
    await expect(this.page.locator(this.pageTitle)).toContainText('Profiles');
  }

  async gotoDataPageProfiles(stream) {
    await this.page.goto(`${this.baseUrl()}/web/streams?org_identifier=${this.orgName()}`);
    const filter = this.page.locator(this.streamTypeFilter);
    await expect(filter).toBeVisible({ timeout: 30000 });
    await filter.getByRole('button', { name: 'Profiles' }).click();
    await expect(filter.getByRole('button', { name: 'Profiles' })).toHaveAttribute('data-state', 'on');
    await expect(this.page.locator('[data-test^="log-stream-name-cell-"]').first()).toBeVisible({ timeout: 30000 });
    await expect(async () => {
      await this.page.locator(this.streamSearchInput).fill(stream);
      await expect(this.page.locator('[data-test^="log-stream-name-cell-"]')).toHaveCount(1, { timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(this.page.locator(`[data-test="log-stream-name-cell-${stream}"]`)).toBeVisible();
  }

  /** Clicks the row's explore button until the app leaves the Data page (the filtered list re-renders under the pointer). */
  async clickDataPageExplore(stream) {
    const row = this.page.locator(`[data-test="log-stream-name-cell-${stream}"]`).locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]');
    await expect(async () => {
      if (new URL(this.page.url()).pathname === '/web/streams') await row.locator(this.streamExploreBtn).click({ timeout: 2000 });
      await expect.poll(() => new URL(this.page.url()).pathname, { timeout: 3000 }).toBe('/web/logs');
    }).toPass({ timeout: 20000 });
  }

  /** Data-test ids of the visible left-rail items, top to bottom. */
  async visibleMenuOrder() {
    await expect(this.page.locator(this.menuProfiles)).toBeVisible();
    return this.page.locator(this.menuLinks).evaluateAll((els) =>
      els
        .map((el) => ({ id: el.getAttribute('data-test'), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0)
        .sort((a, b) => a.box.top - b.box.top)
        .map(({ id }) => id),
    );
  }

  async gotoProfilesIngestion() {
    await this.page.goto(`${this.baseUrl()}/web/ingestion/custom/profiles/otelcollector?org_identifier=${this.orgName()}`);
    await expect(this.page.locator(this.ingestionOtelBlock)).toBeVisible({ timeout: 30000 });
  }

  async ingestionSnippetText(which) {
    const map = { otel: this.ingestionOtelBlock, start: this.ingestionOtelStartBlock, grpc: this.ingestionOtelGrpcBlock };
    await expect(this.page.locator(map[which])).toBeVisible();
    return this.page.locator(map[which]).innerText();
  }

  async expectIngestionProfilesTabsActive() {
    await expect(this.page.locator(this.ingestionProfilesTab)).toBeVisible();
    await expect(this.page.locator(this.ingestionOtelTab)).toBeVisible();
  }

  async expectLogsExplorerRows() {
    await expect(this.page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]').first()).toBeVisible({ timeout: 30000 });
  }

  /** Resolves once the trace sidebar's profile probe has queried `stream` for `spanId`. */
  waitForSpanProfileProbe(stream, spanId) {
    return this.page.waitForResponse(
      (response) => {
        const body = response.request().postData() || '';
        return response.url().includes('/_search') && body.includes(spanId) && body.includes(stream);
      },
      { timeout: 30000 },
    );
  }

  async gotoTraceDetails({ traceId, stream, fromUs, toUs }) {
    await this.page.goto(
      `${this.baseUrl()}/web/traces/trace-details?trace_id=${traceId}&stream=${stream}&from=${fromUs}&to=${toUs}&org_identifier=${this.orgName()}`,
    );
  }

  async openTraceSpan(spanId) {
    const span = this.page.locator(`[data-test="trace-tree-span-operation-name-${spanId}"]`);
    await expect(span).toBeVisible({ timeout: 30000 });
    await span.click();
  }

  async expectViewProfileButton(visible) {
    if (visible) await expect(this.page.locator(this.traceViewProfileBtn)).toBeVisible({ timeout: 30000 });
    else await expect(this.page.locator(this.traceViewProfileBtn)).toHaveCount(0);
  }

  async clickViewProfile() {
    await this.page.locator(this.traceViewProfileBtn).click();
    await this.waitForPageReady();
  }

  async isXssExecuted() {
    return this.page.evaluate(() => window.__xss !== undefined || !!document.querySelector('img[src="x"]'));
  }
}
