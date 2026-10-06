// metricsExplorerPage.js
//
// Page object for the Metrics EXPLORER (`/web/metrics`) — the zero-query browse
// grid and its in-page Visualize workspace.
//
// NOT the same surface as metricsPage.js, which drives the legacy panel editor at
// `/web/metrics/editor`. The two share a route prefix and nothing else: the
// explorer has a mode toggle, a card grid and its own share button
// (`metrics-explorer-share-btn`), while the editor has the PromQL bar and
// `metrics-share-btn`.
//
// Selectors verified against:
//   web/src/plugins/metrics/explorer/MetricsExplorer.vue
//   web/src/plugins/metrics/explorer/MetricsVisualize.vue
//   web/src/plugins/metrics/explorer/MetricCard.vue
//   web/src/components/common/ShareButton.vue
import { expect } from '@playwright/test';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/** Blob envelope version the app accepts — metricsUrlState.ts METRICS_BLOB_VERSION. */
const METRICS_BLOB_VERSION = 1;

export class MetricsExplorerPage {
    constructor(page) {
        this.page = page;

        // ===== ROOT / SHELL =====
        this.explorerRoot = '[data-test="metrics-explorer"]';
        this.filterBar = '[data-test="metrics-explorer-filter-bar"]';
        this.scrollContainer = '[data-test="metrics-explorer-scroll"]';

        // ===== MODE TOGGLE =====
        this.modeToggle = '[data-test="metrics-explorer-mode"]';
        this.modeExplore = '[data-test="metrics-explorer-mode-explore"]';
        this.modeVisualize = '[data-test="metrics-explorer-mode-visualize"]';
        this.modeWorkspace = '[data-test="metrics-explorer-mode-workspace"]';

        // ===== TOOLBAR ACTIONS =====
        // In Visualize the Refresh button re-runs the built chart's query; in the
        // grid modes it refreshes the card grid.
        this.refreshButton = '[data-test="metrics-explorer-refresh"]';
        this.shareButton = '[data-test="metrics-explorer-share-btn"]';
        // Result-count label in the filter bar ("N" or "N of M").
        this.countLabel = '[data-test="metrics-explorer-count"]';

        // ===== VISUALIZE PANE =====
        this.visualizeRoot = '[data-test="metrics-explorer-visualize"]';
        this.panelEditorContainer = '[data-test="panel-editor-container"]';
        this.queryEditorContainer = '[data-test="dashboard-panel-query-editor"]';
        this.chartRenderer = '[data-test="chart-renderer"]';

        // ===== CARDS =====
        // Card data-tests are name-suffixed (`…-card-details-cpu_usage`), so the
        // "any card" locator matches on the stable prefix of the Drill down button.
        this.anyCardSelect = '[data-test^="metrics-explorer-card-details-"]';
        // The same suffixing is why these are prefixes rather than whole selectors:
        // the metric name is only known at call time. Kept here so every selector
        // string still lives in one place.
        this.cardPrefix = 'metrics-explorer-card-';
        this.cardNoDataPrefix = 'metrics-explorer-card-nodata-';
        // ECharts mounts more than one canvas per instance (zrender adds layers).
        this.cardChartCanvas = 'canvas';

        // ===== SIDEBAR NAV (in-app route changes, no full page reload) =====
        this.metricsMenuItem = '[data-test="menu-link-\\/metrics-item"]';
        this.logsMenuItem = '[data-test="menu-link-\\/logs-item"]';

        // ===== ENDPOINTS (network assertions) =====
        // stream.nameList() builds `/api/<org>/streams?type=<type>`; the metrics
        // name list is the request the 5-minute TanStack cache is meant to skip.
        this.streamListUrlPart = '/streams?type=metrics';
        this.promqlQueryUrlPart = '/prometheus/api/v1/query_range';

        // ===== DETAIL VIEW (MetricDetailView / MetricBreakdown) =====
        this.cardDetailsPrefix = 'metrics-explorer-card-details-';
        this.detailRoot = '[data-test="metrics-detail"]';
        this.detailTitle = '[data-test="metrics-detail-title"]';
        this.detailClose = '[data-test="metrics-detail-close"]';
        this.detailOpenVisualize = '[data-test="metrics-detail-open-visualize"]';
        this.breakdownChart = '[data-test="metrics-breakdown-chart"]';
        this.breakdownTopk = '[data-test="metrics-breakdown-topk"]';
        this.breakdownBack = '[data-test="metrics-breakdown-back"]';
        this.labelChipPrefix = 'metrics-explorer-label-chip-';

        // ===== EMPTY STATES =====
        this.noMetricsState = '[data-test="metrics-explorer-no-metrics"]';
        this.loadErrorState = '[data-test="metrics-explorer-load-error"]';
        this.noMatchState = '[data-test="metrics-explorer-no-match"]';
        this.workspaceEmptyState = '[data-test="metrics-workspace-empty-grid"]';

        // ===== SHARE TOASTS (OToast exposes variant + message as data-test attrs) =====
        this.shareSuccessToast = page.locator(
            '[data-test-variant="success"][data-test-message*="Link Copied"]'
        );
        this.shareErrorToast = page.locator(
            '[data-test-variant="error"][data-test-message*="shortening link"]'
        );
    }

    /* ------------------------------------------------------------ navigation */

    /**
     * The org the page is CURRENTLY on, falling back to the configured one.
     * Mirrors gotoMetricsEditor: change-org tests must not be pinned to default.
     */
    resolveOrgIdentifier() {
        let orgIdentifier = getOrgIdentifier();
        try {
            orgIdentifier =
                new URL(this.page.url()).searchParams.get('org_identifier') || orgIdentifier;
        } catch {
            // about:blank has no query string — keep the fallback.
        }
        return orgIdentifier;
    }

    /**
     * Build an absolute explorer URL. `/web/` is mandatory — without it a cloud
     * deployment resolves the org to _meta instead of the configured one.
     */
    buildExplorerUrl(params = {}) {
        const url = new URL(`${process.env.ZO_BASE_URL}/web/metrics`);
        url.searchParams.set('org_identifier', this.resolveOrgIdentifier());
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        return url.href;
    }

    /** Navigate to the explorer with optional query params, then wait for its shell. */
    async gotoExplorer(params = {}) {
        await this.page.goto(this.buildExplorerUrl(params));
        await this.page
            .locator(this.explorerRoot)
            .waitFor({ state: 'visible', timeout: 30000 })
            .catch(() => {});
    }

    /** Navigate to a fully-formed URL (deep-link cases that must not be rebuilt). */
    async navigateToUrl(url) {
        await this.page.goto(url);
        // networkidle never settles on OpenObserve (persistent WebSocket/RUM).
        await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    }

    async expectExplorerVisible() {
        await expect(this.page.locator(this.explorerRoot)).toBeVisible({ timeout: 30000 });
    }

    /**
     * Asserts the browser stayed on the EXPLORER route.
     *
     * The back-compat guard redirects `/metrics` + editor params to
     * `/metrics/editor`, so "did not redirect" is exactly "the path is /metrics
     * and not /metrics/editor".
     */
    async expectOnExplorerRoute() {
        await expect
            .poll(() => new URL(this.page.url()).pathname, { timeout: 15000 })
            .toMatch(/\/web\/metrics\/?$/);
        await expect(this.page.locator(this.explorerRoot)).toBeVisible({ timeout: 30000 });
    }

    /** Asserts the back-compat guard sent a legacy deep link to the editor route. */
    async expectRedirectedToEditor() {
        await expect
            .poll(() => new URL(this.page.url()).pathname, { timeout: 15000 })
            .toMatch(/\/web\/metrics\/editor\/?$/);
    }

    /* ----------------------------------------------------------------- modes */

    async switchToExplore() {
        await this.page.locator(this.modeExplore).click();
    }

    async switchToVisualize() {
        await this.page.locator(this.modeVisualize).click();
        await this.expectModeActive('visualize');
    }

    async switchToWorkspace() {
        await this.page.locator(this.modeWorkspace).click();
    }

    /** OToggleGroupItem marks the active tab with data-state="on". */
    async expectModeActive(mode) {
        const locators = {
            explore: this.modeExplore,
            visualize: this.modeVisualize,
            workspace: this.modeWorkspace,
        };
        await expect(this.page.locator(locators[mode])).toHaveAttribute('data-state', 'on', {
            timeout: 15000,
        });
    }

    async expectVisualizeVisible() {
        await expect(this.page.locator(this.visualizeRoot)).toBeVisible({ timeout: 30000 });
    }

    /** The chart renderer stays mounted — a query re-run, not a stream reload. */
    async expectChartRendererVisible() {
        await expect(this.page.locator(this.chartRenderer).first()).toBeVisible({ timeout: 30000 });
    }

    async expectGridVisible() {
        await expect(this.page.locator(this.scrollContainer)).toBeVisible({ timeout: 30000 });
    }

    /* ------------------------------------------------------------ URL / blob */

    getQueryParam(name) {
        try {
            return new URL(this.page.url()).searchParams.get(name);
        } catch {
            return null;
        }
    }

    getMetricsDataParam() {
        return this.getQueryParam('metrics_data');
    }

    hasMetricsDataParam() {
        return !!this.getMetricsDataParam();
    }

    /**
     * Decode `metrics_data` back into `{ v, data }`.
     * Returns null when the param is absent or not decodable — the same silent
     * fallback the app's decodeMetricsConfig applies.
     */
    decodeMetricsBlob() {
        const raw = this.getMetricsDataParam();
        if (!raw) return null;
        try {
            return JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString('utf8'));
        } catch {
            return null;
        }
    }

    /** Encode a panel-data object as the app would, for deep-link construction. */
    buildMetricsBlob(data, version = METRICS_BLOB_VERSION) {
        return Buffer.from(JSON.stringify({ v: version, data }), 'utf8').toString('base64');
    }

    /** A minimal, valid Visualize payload carrying one PromQL query. */
    buildPromqlBlob(query, version = METRICS_BLOB_VERSION) {
        return this.buildMetricsBlob(
            {
                type: 'line',
                queryType: 'promql',
                queries: [{ query, queryType: 'promql', fields: { stream_type: 'metrics' } }],
            },
            version
        );
    }

    /**
     * The URL write-back is debounced 300ms, so poll rather than read once.
     * Returns the blob param so callers can round-trip it.
     */
    async waitForMetricsDataParam(timeout = 20000) {
        await expect
            .poll(() => this.hasMetricsDataParam(), {
                timeout,
                intervals: [200, 400, 800],
            })
            .toBe(true);
        return this.getMetricsDataParam();
    }

    /** The decoded blob once the URL stops changing, or null if none was written. NOT expect.poll: that waits for an expectation to BECOME true and cannot assert one HOLDS, so poll(hasMetricsDataParam).toBe(false) just raced the debounced write. */
    async settleMetricsBlob(stableMs = 2000, timeout = 15000) {
        const deadline = Date.now() + timeout;
        let last = this.getMetricsDataParam();
        let stableSince = Date.now();
        while (Date.now() < deadline) {
            await this.page.waitForTimeout(250);
            const now = this.getMetricsDataParam();
            if (now !== last) {
                last = now;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= stableMs) {
                break;
            }
        }
        return this.decodeMetricsBlob();
    }

    /** The mirror case — leaving Visualize must strip a stale blob. */
    async waitForMetricsDataCleared(timeout = 20000) {
        await expect
            .poll(() => this.hasMetricsDataParam(), {
                timeout,
                intervals: [200, 400, 800],
            })
            .toBe(false);
    }

    /* --------------------------------------------------------- visualize pane */

    async waitForVisualizeReady() {
        await this.page
            .locator(this.panelEditorContainer)
            .waitFor({ state: 'visible', timeout: 30000 })
            .catch(() => {});
        await this.page
            .locator(this.queryEditorContainer)
            .first()
            .waitFor({ state: 'visible', timeout: 30000 })
            .catch(() => {});
    }

    /**
     * Set the PromQL query via Monaco's setValue API.
     *
     * setValue fires onDidChangeContent — the same event keyboard typing raises,
     * so the Vue panel model stays in sync — without opening the autocomplete
     * dropdown that would swallow the next click.
     */
    async enterVisualizeQuery(query) {
        const editor = this.page.locator(this.queryEditorContainer).first();
        await editor.waitFor({ state: 'visible', timeout: 30000 });
        await this.page
            .waitForFunction(
                () =>
                    !!(
                        window.monaco &&
                        window.monaco.editor &&
                        window.monaco.editor.getEditors().length > 0
                    ),
                null,
                { timeout: 15000 }
            )
            .catch(() => {});

        const setViaApi = await this.page.evaluate((q) => {
            try {
                const editors = window.monaco?.editor?.getEditors?.();
                if (!editors || editors.length === 0) return false;
                const target = editors[editors.length - 1];
                target.focus();
                target.setValue(q);
                return true;
            } catch {
                return false;
            }
        }, query);

        if (setViaApi) return;

        // Fallback: keyboard entry, which also raises Monaco change events.
        await editor.click();
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Backspace');
        await this.page.keyboard.type(query, { delay: 50 });
        await this.page.keyboard.press('Escape');
    }

    /** Current editor text — used to assert a shared link rehydrated the chart. */
    async getVisualizeQueryText() {
        return await this.page.evaluate(() => {
            try {
                const editors = window.monaco?.editor?.getEditors?.();
                if (!editors || editors.length === 0) return '';
                return editors[editors.length - 1].getValue();
            } catch {
                return '';
            }
        });
    }

    /**
     * Best-effort wait for the query editor to stop being empty.
     *
     * Used before a NEGATIVE assertion, where reading too early would pass
     * trivially against an editor that had not been populated yet. It is
     * deliberately bounded and non-fatal: a genuinely blank canvas is a valid
     * outcome, so a timeout here must not fail the caller.
     */
    async waitForVisualizeQuerySettled(timeout = 8000) {
        await expect
            .poll(async () => (await this.getVisualizeQueryText()).length, {
                timeout,
                intervals: [300, 600, 1000],
            })
            .toBeGreaterThan(0)
            .catch(() => {});
    }

    /** Poll the editor text — a rehydrated seed lands after the pane mounts. */
    async expectVisualizeQueryToContain(expected, timeout = 30000) {
        await expect
            .poll(async () => await this.getVisualizeQueryText(), {
                timeout,
                intervals: [300, 600, 1000],
            })
            .toContain(expected);
    }

    /** In Visualize the toolbar Refresh button runs the chart's query. */
    async runVisualizeQuery() {
        await this.page.locator(this.refreshButton).click();
    }

    /* ----------------------------------------------------------------- cards */

    async getCardCount() {
        return await this.page.locator(this.anyCardSelect).count();
    }

    /**
     * Open the first rendered card in Visualize — the real path: the card's
     * always-visible Drill down, then the detail view's Open in Visualize.
     */
    async openFirstCardInVisualize() {
        const drill = this.page.locator(this.anyCardSelect).first();
        await drill.waitFor({ state: 'attached', timeout: 30000 });
        await expect(drill).toBeVisible({ timeout: 10000 });
        await drill.click();

        const openVisualize = this.page.locator(this.detailOpenVisualize);
        await expect(openVisualize).toBeVisible({ timeout: 30000 });
        await openVisualize.click();
    }

    /** True once at least one card has rendered (grid is populated). */
    async waitForCards(timeout = 60000) {
        await expect
            .poll(async () => await this.getCardCount(), {
                timeout,
                intervals: [500, 1000, 2000],
            })
            .toBeGreaterThan(0);
    }

    /** Sampled, not polled: `expect.poll` proves a state is REACHED, not that it HOLDS. */
    async expectCardsRemainVisible(timeout = 10000) {
        const deadline = Date.now() + timeout;
        // do-while: a cache-fast reload may already be idle, and the invariant must still be asserted once.
        do {
            const count = await this.getCardCount();
            expect(count, 'the grid must not blank during a manual refresh').toBeGreaterThan(0);
            await this.page.waitForTimeout(100);
        } while (Date.now() < deadline && (await this.isRefreshButtonLoading()));
    }

    /* ------------------------------------------------- a card, by metric name */

    cardRoot(metric) {
        return this.page.locator(`[data-test="${this.cardPrefix}${metric}"]`);
    }

    /** The inline "No data" tile — MetricCard's `isEmpty` branch. */
    cardNoData(metric) {
        return this.page.locator(`[data-test="${this.cardNoDataPrefix}${metric}"]`);
    }

    /**
     * A DRAWN chart, not merely a mounted card: the preview renders through
     * PanelSchemaRenderer, which paints into a canvas only once it has series.
     */
    cardChart(metric) {
        return this.cardRoot(metric).locator(this.cardChartCanvas).first();
    }

    async expectCardNoData(metric, timeout = 60000) {
        await expect(
            this.cardNoData(metric),
            `${metric} should render the No-data tile`,
        ).toBeVisible({ timeout });
    }

    /** Charted means BOTH: a canvas arrived and the No-data tile went away. */
    async expectCardCharted(metric, timeout = 60000) {
        await expect(this.cardChart(metric), `${metric} should render a chart`).toBeVisible({
            timeout,
        });
        await expect(this.cardNoData(metric)).toBeHidden();
    }

    /* ---------------------------------------------------------------- refresh */

    async clickRefresh() {
        await this.page.locator(this.refreshButton).click();
    }

    /** OButton binds `:aria-busy="loading || undefined"` — so "true", or absent. */
    async isRefreshButtonLoading() {
        const state = await this.page
            .locator(this.refreshButton)
            .getAttribute('aria-busy', { timeout: 5000 })
            .catch(() => null);
        return state === 'true';
    }

    /** The refresh button is mid-reload: aria-busy AND disabled (double-click guard). */
    async expectRefreshBusy(timeout = 10000) {
        await expect
            .poll(async () => await this.isRefreshButtonLoading(), {
                timeout,
                intervals: [50, 100, 200],
            })
            .toBe(true);
        await expect(this.page.locator(this.refreshButton)).toBeDisabled({ timeout: 10000 });
    }

    /** The refresh button returned to idle: not busy and enabled again. */
    async expectRefreshIdle(timeout = 30000) {
        await expect
            .poll(async () => await this.isRefreshButtonLoading(), {
                timeout,
                intervals: [200, 400, 800],
            })
            .toBe(false);
        await expect(this.page.locator(this.refreshButton)).toBeEnabled({ timeout: 30000 });
    }

    /** The toolbar result-count label text — "N" when unfiltered, "N of M" when filtered. */
    async getResultCountText() {
        return (
            (await this.page
                .locator(this.countLabel)
                .textContent({ timeout: 5000 })
                .catch(() => '')) || ''
        ).trim();
    }

    /**
     * The FIRST number in the label — the count of cards the grid is showing.
     *
     * Not comparable to getCardCount(): the grid is virtualized, so the DOM only
     * ever holds the rows in view. This is the upper bound that count sits under.
     */
    async getResultCount() {
        const text = await this.getResultCountText();
        const shown = Number(text.split(' of ')[0].replace(/,/g, ''));
        return Number.isFinite(shown) ? shown : -1;
    }

    /** Both clicks land in ONE tick, so the second is guaranteed to hit the re-entry guard. */
    async clickRefreshTwiceInSameTick() {
        await this.page.locator(this.refreshButton).evaluate((el) => {
            el.click();
            el.click();
        });
    }

    /** Drill down is always visible on the card. */
    async openMetricDetails(metric) {
        await this.page.locator(`[data-test="${this.cardDetailsPrefix}${metric}"]`).click();
    }

    async expectDetailOpen(metric) {
        await expect(this.page.locator(this.detailTitle)).toHaveText(metric, { timeout: 30000 });
        await expect.poll(() => this.getQueryParam('metric'), { timeout: 15000 }).toBe(metric);
    }

    /** Detail tabs carry no data-test of their own; OTab stamps its name on the trigger. */
    detailTab(name) {
        return this.page.locator(`${this.detailRoot} [role="tab"][data-otab-name="${name}"]`);
    }

    async selectDetailTab(name) {
        await this.detailTab(name).click();
        await expect.poll(() => this.getQueryParam('tab'), { timeout: 15000 }).toBe(name);
    }

    /** A label's chart card in the Breakdown grid. */
    breakdownCard(label) {
        return this.page.locator(`[data-test="metrics-breakdown-card-${label}"]`);
    }

    /** The card's Drill down focuses that label: its chart plus its value table. */
    async selectBreakdownLabel(label) {
        await this.page.locator(`[data-test="metrics-breakdown-select-${label}"]`).click();
        await expect.poll(() => this.getQueryParam('breakdown_label'), { timeout: 15000 }).toBe(label);
    }

    /** "All labels" — back from a focused label to the Breakdown grid. */
    async backToBreakdownGrid() {
        await this.page.locator(this.breakdownBack).click();
        await expect.poll(() => this.getQueryParam('breakdown_label'), { timeout: 15000 }).toBeNull();
    }

    breakdownValue(label, value) {
        return this.page.locator(`[data-test="metrics-breakdown-value-${label}-${value}"]`);
    }

    breakdownDistinct(label) {
        return this.page.locator(`[data-test="metrics-breakdown-distinct-${label}"]`);
    }

    /** "Add to filter" (=) on one value of the Breakdown table. */
    async addBreakdownFilter(label, value) {
        await this.page.locator(`[data-test="metrics-breakdown-add-${label}-${value}"]`).click();
    }

    /** The filter bar's chip for a label matcher. */
    labelChip(label) {
        return this.page.locator(`[data-test="${this.labelChipPrefix}${label}"]`);
    }

    /** A related metric's chart card in the Related grid. */
    relatedCard(metric) {
        return this.page.locator(`[data-test="metrics-detail-related-card-${metric}"]`);
    }

    async openRelated(metric) {
        await this.page.locator(`[data-test="metrics-detail-related-open-${metric}"]`).click();
    }

    async closeDetail() {
        await this.page.locator(this.detailClose).click();
    }

    /* ------------------------------------------------------------- network */

    /**
     * Tally matching requests from now until `stop()`.
     *
     * The cache contract is only observable on the wire — a served-from-cache
     * mount looks identical in the DOM to a refetched one.
     */
    startRequestCounter(urlPart) {
        const counter = { count: 0, urls: [] };
        const handler = (request) => {
            if (!request.url().includes(urlPart)) return;
            counter.count += 1;
            counter.urls.push(request.url());
        };
        this.page.on('request', handler);
        counter.stop = () => {
            this.page.off('request', handler);
            return counter.count;
        };
        return counter;
    }

    startStreamListCounter() {
        return this.startRequestCounter(this.streamListUrlPart);
    }

    /** Resolves on the next stream-list response — a reload landed, no UI-state race. */
    waitForStreamListResponse(timeout = 30000) {
        return this.page.waitForResponse(
            (response) => response.url().includes(this.streamListUrlPart),
            { timeout }
        );
    }

    /** Resolves on the next PromQL range query — proof the chart actually re-ran. */
    waitForPromqlQuery(timeout = 30000) {
        return this.page.waitForResponse(
            (response) => response.url().includes(this.promqlQueryUrlPart),
            { timeout }
        );
    }

    /* ------------------------------------------- in-app (SPA) navigation */

    /**
     * Leave the explorer WITHOUT a page reload.
     *
     * `page.goto()` tears down the whole SPA and with it the in-memory TanStack
     * cache, so a reload can never exercise a cache hit. Routing through the
     * sidebar unmounts the explorer (keepAlive:false) while the QueryClient lives.
     */
    async navigateAwayInApp() {
        await this.page.locator(this.logsMenuItem).click();
        await this.page.waitForURL(/\/web\/logs/, { timeout: 30000 });
    }

    async navigateToExplorerInApp() {
        await this.page.locator(this.metricsMenuItem).click();
        await this.page.waitForURL(/\/web\/metrics/, { timeout: 30000 });
    }

    /* ----------------------------------------------------------------- share */

    getShareButton() {
        return this.page.locator(this.shareButton);
    }

    async isShareButtonInDom() {
        return (await this.page.locator(this.shareButton).count()) > 0;
    }

    async isShareButtonVisible() {
        return await this.page
            .locator(this.shareButton)
            .isVisible({ timeout: 5000 })
            .catch(() => false);
    }

    async isShareButtonEnabled() {
        return await this.page
            .locator(this.shareButton)
            .isEnabled({ timeout: 5000 })
            .catch(() => false);
    }

    async isShareButtonDisabled() {
        return !(await this.isShareButtonEnabled());
    }

    async expectShareButtonVisible() {
        await expect(this.page.locator(this.shareButton)).toBeVisible({ timeout: 15000 });
    }

    /** OButton surfaces its loading prop as aria-busy (OButton.vue:318). */
    async isShareButtonLoading() {
        const state = await this.page
            .locator(this.shareButton)
            .getAttribute('aria-busy')
            .catch(() => null);
        return state === 'true' || state === '';
    }

    async clickShareButton() {
        await this.page.locator(this.shareButton).click();
    }

    async waitForShareSuccessToast(timeout = 15000) {
        await expect(this.shareSuccessToast.first()).toBeVisible({ timeout });
    }

    /**
     * The short URL the share button copied.
     * Reading the clipboard needs clipboard-read permission — callers grant it in
     * setup and treat a rejection as "share unavailable here".
     */
    async getCopiedShortUrl(timeout = 15000) {
        let clipboard = '';
        await expect
            .poll(
                async () => {
                    clipboard = await this.page
                        .evaluate(() => navigator.clipboard.readText())
                        .catch(() => '');
                    return clipboard;
                },
                { timeout, intervals: [300, 600, 1000] }
            )
            .not.toBe('');
        return clipboard;
    }

    /**
     * Whether share can actually be exercised here. `web_url` is a deployment
     * setting; where it is unset ShareButton self-disables with a warning
     * tooltip, and the share assertions have nothing to assert against.
     */
    async checkShareReadiness() {
        if (!(await this.isShareButtonInDom())) {
            return { canShare: false, reason: 'Share button not rendered on the explorer toolbar' };
        }
        if (!(await this.isShareButtonEnabled())) {
            return { canShare: false, reason: 'Share button disabled — ZO_WEB_URL is not configured' };
        }
        return { canShare: true, reason: '' };
    }
}
