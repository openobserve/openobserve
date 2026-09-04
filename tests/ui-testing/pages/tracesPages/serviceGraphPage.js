// serviceGraphPage.js
// Page object for Service Graph feature in Traces module
// Selectors verified against: ServiceGraph.vue, ServiceGraphNodeSidePanel.vue

import { expect } from '@playwright/test';

export class ServiceGraphPage {
  constructor(page) {
    this.page = page;

    // ===== NAVIGATION =====
    // Service Graph is reached from the Traces rail tile's hover flyout; since #13852 the
    // flyout item lands on the Traces page's in-page `?tab=service-graph` view (the old
    // /traces/service-graph route now only exists as a legacy redirect).
    this.tracesRailTile = '[data-test="nav-group-traces"]';
    // #13852 rerouted the flyout children through the Traces page's ?tab= views, so the
    // Service Graph flyout item is now `nav-group-item-traces-service-graph`
    // (childDataTest = `nav-group-item-${child.name}-${child.tab}`), not the old
    // standalone `nav-group-item-serviceGraph`.
    this.serviceGraphFlyoutItem = '[data-test="nav-group-item-traces-service-graph"]';

    // ===== MAIN COMPONENT (ServiceGraph.vue) =====
    this.dateTimePicker = '[data-test="service-graph-date-time-picker"]';
    this.refreshButton = '[data-test="service-graph-refresh-btn"]';
    this.chartContainer = '[data-test="service-graph-chart"]';

    // ===== VIEW TOGGLE BUTTONS (page header #subnav — button with .selected class) =====
    this.graphViewTab = '[data-test="service-graph-graph-view-btn"]';
    this.treeViewTab = '[data-test="service-graph-tree-view-btn"]';

    // ===== SEARCH =====
    this.searchInput = 'input[placeholder="Search Services"]';

    // ===== NODE DETAIL PANEL (ServiceGraphNodeSidePanel.vue) =====
    // ODrawer forwards data-test to <DialogContent> — panel root is [data-test="service-graph-side-panel"].
    // Close button: ODrawer renders it as [data-test="o-drawer-close-btn"] inside the panel.
    // Title: Reka UI DialogTitle renders as an <h2> (sr-only) — accessible via locator('h2').
    this.sidePanel = '[data-test="service-graph-side-panel"]';
    this.sidePanelHeader = '[data-test="service-graph-side-panel"]';
    this.sidePanelViewRelatedBtn = '[data-test="service-graph-node-panel-view-related-btn"]';
    this.sidePanelViewRelatedLogsBtn = '[data-test="service-graph-node-panel-view-related-logs-btn"]';
    this.sidePanelViewRelatedTracesBtn = '[data-test="service-graph-node-panel-view-related-traces-btn"]';
    this.sidePanelCloseBtn = '[data-test="service-graph-side-panel"] [data-test="o-drawer-close-btn"]';

    // RED charts section (Rate/Errors/Duration dashboards)
    this.sidePanelRedCharts = '[data-test="service-graph-side-panel-red-charts"]';
    this.sidePanelFilterChips = '[data-test="service-graph-side-panel-filter-chips"]';
    this.sidePanelViewInTracesBtn = '[data-test="service-graph-side-panel-view-in-traces-btn"]';

    // Tabs section (Operations / Nodes / Pods)
    this.nodePanelTabs = '[data-test="service-graph-node-panel-tabs"]';
    this.operationsTab = '[data-test="service-graph-node-panel-tab-operations"]';
    this.nodesTab = '[data-test="service-graph-node-panel-tab-nodes"]';
    this.podsTab = '[data-test="service-graph-node-panel-tab-pods"]';
    // data-test on OTabPanel is swallowed by <Transition> — target slot content instead
    this.recentOperations = '[data-test="service-graph-side-panel-operations-table"]';
    this.operationsTable = '[data-test="service-graph-side-panel-operations-table"]';
    this.nodesPanel = '[data-test="service-graph-side-panel-nodes"]';
    this.nodesTable = '[data-test="service-graph-side-panel-nodes-table"]';
    this.podsPanel = '[data-test="service-graph-side-panel-pods"]';
    this.podsTable = '[data-test="service-graph-side-panel-pods-table"]';

    // ===== TELEMETRY CORRELATION (Metrics tab) =====
    this.metricsTab = '[data-test="service-graph-node-panel-tab-metrics"]';
    this.metricsPanel = '[data-test="service-graph-side-panel-metrics"]';
    this.metricsLoadingIndicator = '[data-test="service-graph-side-panel-metrics-loading"]';
    // The metrics-tab CONTENT is what we wait on — NOT the panel wrapper. Two hooks that look
    // usable are not:
    //   • service-graph-side-panel-metrics is on an OTabPanel whose data-test is swallowed by
    //     <Transition>, so it never reaches the DOM;
    //   • service-graph-side-panel-metrics-dashboard is passed to <TelemetryCorrelationDashboard>,
    //     which has multiple top-level roots (a Vue FRAGMENT) so Vue 3 drops the fallthrough attr.
    // The reliable, currently-shipping "correlation view rendered" signal is the correlation event
    // header (renders whenever the metrics tab resolves to a correlation object, with or without
    // metric streams — this env seeds only traces, so zero-stream is the common case).
    this.metricsCorrelationHeader = '[data-test^="correlation-event-header-"]';
    // "Rendered WITH metric data" = real per-metric-stream rows (data-dependent; used only for the
    // happy-path assertion, never required for the tab to count as resolved).
    this.metricsStreamItem = '[data-test="telemetry-correlation-metric-stream-item"]';
    this.metricsError = '[data-test="service-graph-side-panel-metrics-error"]';
    this.metricsEmpty = '[data-test="service-graph-side-panel-metrics-empty"]';

    // ===== TELEMETRY CORRELATION DIALOG =====
    this.correlationDashboardClose = '[data-test="correlation-dashboard-close"]';
    this.correlationDashboardCard = '[data-test*="correlation-dashboard"]';
    this.correlationDialogTabs = '[data-test*="dialog"] [role="tab"]';
  }

  // ===== NAVIGATION =====

  async navigateToServiceGraph() {
    await this.page.locator(this.tracesRailTile).hover();
    // The flyout is teleported to <body> and opens after ONavGroup's 120ms OPEN_DELAY, so the
    // item is not in the DOM the instant hover() resolves — wait for it before clicking, else
    // the click races the debounce and times out.
    const flyoutItem = this.page.locator(this.serviceGraphFlyoutItem);
    await flyoutItem.waitFor({ state: 'visible', timeout: 10000 });
    await flyoutItem.click();
    // #13852 lands Service Graph on the Traces page as `?tab=service-graph`; the old
    // /traces/service-graph path now only exists as a legacy redirect.
    await this.page.waitForURL(/\/traces\?.*tab=service-graph/, { timeout: 10000 });
  }

  /**
   * Navigate directly to service graph via URL (more reliable than click-based navigation).
   * Sets the stream filter in localStorage before navigating to ensure the correct stream is shown.
   * @param {string} streamName - Stream to filter by (default: 'default')
   * @param {string} [period='6h'] - Relative time window passed via the `period` URL param.
   *   Defaults to a WIDE 6h window (not the page default "Past 15 Minutes") so the
   *   daemon-processed topology reliably falls inside the query window and the chart renders.
   */
  async navigateToServiceGraphUrl(streamName = 'default', period = '6h') {
    // Set stream filter in localStorage before navigation — the Vue component reads from here
    await this.page.evaluate((stream) => {
      localStorage.setItem('serviceGraph_streamFilter', stream);
    }, streamName);

    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    // Query a WIDE window (default 6h), not the page default of "Past 15 Minutes". The service
    // graph is derived by a backend daemon that runs on a delay after trace ingestion, so with
    // the 15m default the just-ingested topology often falls outside the window and the chart
    // renders "No service graph data" (no chart element) — the alpha1 failure mode. The route
    // honours the `period` URL param (verified: label shows "Past 6 Hours").
    const url = `${baseUrl}/web/traces/service-graph?org_identifier=${org}&period=${period}`;
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Navigate to the service graph and wait until the chart actually renders, tolerating
   * service-graph-daemon lag: if the page shows the empty "No service graph data" state,
   * refresh and retry within the budget. Returns once the chart is visible; if it never
   * renders the caller's own assertion still fails (non-masking).
   * @param {string} streamName
   * @param {object} [opts] { period, timeout }
   */
  async navigateToServiceGraphAndWaitForChart(streamName = 'default', opts = {}) {
    const period = opts.period || '6h';
    const timeout = opts.timeout || 90000;
    await this.navigateToServiceGraphUrl(streamName, period);

    const chart = this.page.locator(this.chartContainer);
    const deadline = Date.now() + timeout;
    // Date.now() is allowed here (test/page-object runtime, not a workflow script).
    while (Date.now() < deadline) {
      if (await chart.isVisible().catch(() => false)) return true;
      // Empty-state → nudge the daemon result by refreshing, then wait a cycle.
      await this.page.locator(this.refreshButton).click({ timeout: 5000 }).catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await chart.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }
    return await chart.isVisible().catch(() => false);
  }

  async expectServiceGraphPageVisible() {
    await expect(this.page.locator(this.chartContainer)).toBeVisible({ timeout: 15000 });
  }

  async isServiceGraphVisible() {
    return await this.page.locator(this.chartContainer)
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
  }

  // ===== CONTROLS =====

  async clickRefresh() {
    await this.page.locator(this.refreshButton).click();
  }

  async waitForGraphReload() {
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async switchToGraphView() {
    await this.page.locator(this.graphViewTab).click();
    // OToggleGroupItem uses inheritAttrs:false + v-bind="$attrs" on the inner Reka UI <button>,
    // so data-test and data-state land on the SAME element. Use compound selector (no space).
    await expect(this.page.locator(`${this.graphViewTab}[data-state="on"]`)).toBeVisible({ timeout: 5000 });
  }

  async switchToTreeView() {
    await this.page.locator(this.treeViewTab).click();
    // Same OToggleGroupItem pattern — compound selector, no space between data-test and data-state.
    await expect(this.page.locator(`${this.treeViewTab}[data-state="on"]`)).toBeVisible({ timeout: 5000 });
  }

  async getActiveViewTab() {
    // OToggleGroupItem: data-test and data-state are on the same element — use compound selector.
    const treeSelected = await this.page.locator(`${this.treeViewTab}[data-state="on"]`)
      .isVisible({ timeout: 1000 }).catch(() => false);
    if (treeSelected) return 'Tree View';

    const graphSelected = await this.page.locator(`${this.graphViewTab}[data-state="on"]`)
      .isVisible({ timeout: 1000 }).catch(() => false);
    if (graphSelected) return 'Graph View';

    return 'Unknown';
  }

  async typeInSearchBox(text) {
    await this.page.locator(this.searchInput).fill(text);
    await this.page.waitForTimeout(500); // debounce 300ms + buffer
  }

  async clearSearchBox() {
    await this.page.locator(this.searchInput).fill('');
    await this.page.waitForTimeout(500);
  }

  // ===== TOPOLOGY API =====

  async getTopologyViaAPI() {
    const orgId = process.env['ORGNAME'] || 'default';
    const baseUrl = process.env['INGESTION_URL'] || process.env['ZO_BASE_URL'];
    const response = await this.page.request.get(
      `${baseUrl}/api/${orgId}/traces/service_graph/topology/current`,
      {
        headers: {
          Authorization: 'Basic ' + Buffer.from(
            `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`
          ).toString('base64'),
          'Content-Type': 'application/json',
        },
      }
    );
    if (!response.ok()) {
      const text = await response.text();
      return { status: response.status(), data: null, error: text };
    }
    const data = await response.json();
    return { status: response.status(), data };
  }

  async getNodeCount() {
    const result = await this.getTopologyViaAPI();
    return result.data?.nodes?.length || result.data?.data?.nodes?.length || 0;
  }

  async getEdgeCount() {
    const result = await this.getTopologyViaAPI();
    return result.data?.edges?.length || result.data?.data?.edges?.length || 0;
  }

  async findNodeByLabel(label) {
    const result = await this.getTopologyViaAPI();
    const nodes = result.data?.nodes || result.data?.data?.nodes || [];
    return nodes.find(n => n.label === label || n.id === label);
  }

  async findEdge(fromService, toService) {
    const result = await this.getTopologyViaAPI();
    const edges = result.data?.edges || result.data?.data?.edges || [];
    return edges.find(e => e.from === fromService && e.to === toService);
  }

  // ===== NODE/EDGE INTERACTION =====

  /**
   * Trigger ServiceGraph's handleNodeClick programmatically.
   *
   * WHY: ECharts renders the graph on an HTML <canvas>. Canvas content is NOT
   * part of the DOM or accessibility tree, so standard Playwright selectors
   * (click, locator, etc.) cannot target individual nodes or edges. The only
   * reliable way to open a node/edge detail panel in tests is to invoke the
   * Vue component's click handler directly.
   *
   * HOW: On the first call the helper walks the Vue 3 vnode tree
   * (app._vnode → component.subTree) to locate the ServiceGraph instance by
   * checking for `setupState.handleNodeClick`. The found reference is cached
   * on `window.__sgTestHelper` so subsequent calls skip the walk entirely.
   *
   * STABILITY: The vnode/component/subTree shape has been stable across all
   * Vue 3.x releases (3.0 – 3.5+). The cache is validated before reuse and
   * rebuilt automatically if the component re-mounts.
   *
   * @param {object} clickParams - Params forwarded to handleNodeClick
   * @returns {Promise<{ success: true } | { error: string }>}
   */
  async _callHandleNodeClick(clickParams) {
    return await this.page.evaluate((params) => {
      // Fast path: reuse cached component instance if still valid
      const cached = window.__sgTestHelper;
      if (cached?.setupState?.handleNodeClick && cached.setupState.graphData) {
        cached.setupState.handleNodeClick(params);
        return { success: true };
      }

      // Slow path: walk the vnode tree to find the ServiceGraph component
      function findServiceGraph(vnode, depth) {
        if (!vnode || depth > 60) return null;
        if (vnode.component) {
          const inst = vnode.component;
          const ss = inst.setupState;
          if (ss && typeof ss.handleNodeClick === 'function' && ss.graphData) return inst;
          if (inst.subTree) { const r = findServiceGraph(inst.subTree, depth + 1); if (r) return r; }
        }
        if (Array.isArray(vnode.children)) {
          for (const child of vnode.children) {
            if (child && typeof child === 'object') { const r = findServiceGraph(child, depth + 1); if (r) return r; }
          }
        }
        if (vnode.dynamicChildren) {
          for (const child of vnode.dynamicChildren) { const r = findServiceGraph(child, depth + 1); if (r) return r; }
        }
        return null;
      }

      const appEl = document.querySelector('#app');
      if (!appEl?._vnode) return { error: 'no-vue-app-vnode' };
      const inst = findServiceGraph(appEl._vnode, 0);
      if (!inst) return { error: 'service-graph-component-not-found' };

      window.__sgTestHelper = inst; // cache for subsequent calls
      inst.setupState.handleNodeClick(params);
      return { success: true };
    }, clickParams);
  }

  /**
   * Click a node in the service graph by name to open the side panel.
   */
  async clickNodeByName(nodeName) {
    const result = await this._callHandleNodeClick({
      componentType: 'series',
      data: { name: nodeName },
    });

    if (result?.error) {
      throw new Error(`clickNodeByName("${nodeName}") failed: ${result.error}`);
    }

    await this.page.locator(this.sidePanel)
      .waitFor({ state: 'visible', timeout: 5000 });
  }

  // ===== SIDE PANEL (Node Detail) =====

  async expectSidePanelVisible() {
    await expect(this.page.locator(this.sidePanel)).toBeVisible({ timeout: 10000 });
  }

  async isSidePanelVisible() {
    return await this.page.locator(this.sidePanel)
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async expectSidePanelNotVisible() {
    await expect(this.page.locator(this.sidePanel)).not.toBeVisible({ timeout: 5000 });
  }

  async expectRedChartsSectionVisible() {
    await expect(this.page.locator(this.sidePanelRedCharts)).toBeVisible({ timeout: 10000 });
  }

  async isRedChartsSectionVisible() {
    return await this.page.locator(this.sidePanelRedCharts)
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async getSidePanelServiceName() {
    // ODrawer renders the :title prop via Reka UI's <DialogTitle> (an <h2>) —
    // also visible as a styled <span> in the header. The <h2> is sr-only but
    // still has textContent. Scope to panel to avoid picking up other headings.
    return await this.page.locator(this.sidePanel).locator('h2').first().textContent();
  }

  async getHealthStatus() {
    // The health badge is an OTag with data-test="service-health-badge" whose visible
    // text is the status label (Healthy / Degraded / Critical). The old `.health-badge`
    // class + status modifier classes were dropped when it moved to the OTag component.
    const badge = this.page.locator(`${this.sidePanel} [data-test="service-health-badge"]`);
    if (await badge.count() === 0) return 'unknown';
    const label = ((await badge.first().textContent()) || '').trim().toLowerCase();
    if (label.includes('critical')) return 'critical';
    if (label.includes('degraded')) return 'degraded';
    if (label.includes('healthy')) return 'healthy';
    return 'unknown';
  }

  // ===== TABS (Operations / Nodes / Pods) =====

  async switchToOperationsTab() {
    await this.page.locator(this.operationsTab).click();
  }

  async switchToNodesTab() {
    await this.page.locator(this.nodesTab).click();
  }

  async switchToPodsTab() {
    await this.page.locator(this.podsTab).click();
  }

  async expectOperationsSectionVisible() {
    await expect(this.page.locator(this.recentOperations)).toBeVisible({ timeout: 10000 });
  }

  async isOperationsSectionVisible() {
    return await this.page.locator(this.recentOperations)
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async getOperationsTableRowCount() {
    const table = this.page.locator(this.operationsTable);
    await table.locator('[data-test="service-graph-operations-loading-indicator"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return await table.locator('tbody tr').count();
  }

  async closeSidePanel() {
    await this.page.locator(this.sidePanelCloseBtn).click();
    await this.page.locator(this.sidePanel)
      .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // ===== TELEMETRY CORRELATION =====

  /**
   * Click the Metrics tab in the side panel and wait for the correlation view to RESOLVE.
   * Deploy-independent: gates only on real, currently-shipping elements (the metrics panel and its
   * loading spinner) — NOT on the dashboard's data-test, which the fragment-root component drops
   * (see this.metricsStreamItem). Throws if the panel never renders (a genuinely broken tab).
   * @returns {Promise<boolean>} true if real metric-stream rows rendered (data present); false for
   *   a resolved-but-streamless view (zero-stream dashboard / empty / error) — all acceptable.
   */
  async clickMetricsTabAndWait() {
    await this.page.locator(this.metricsTab).click();

    // Wait until the metrics tab RESOLVES into a rendered content state — the correlation view
    // (header) OR a terminal empty/error state. We race real content elements (never the swallowed
    // panel wrapper); if none appears within the window the race rejects and the caller fails,
    // which is the correct outcome for a genuinely broken/hung tab.
    await Promise.race([
      this.page.locator(this.metricsCorrelationHeader).first().waitFor({ state: 'visible', timeout: 30000 }),
      this.page.locator(this.metricsError).first().waitFor({ state: 'visible', timeout: 30000 }),
      this.page.locator(this.metricsEmpty).first().waitFor({ state: 'visible', timeout: 30000 }),
    ]);

    // Report whether real metric-stream rows rendered (.first() — the selector matches every row,
    // so an unscoped locator would trip Playwright strict mode).
    return await this.page.locator(this.metricsStreamItem).first()
      .isVisible({ timeout: 2000 }).catch(() => false);
  }

  async expectMetricsStreamsVisible() {
    await expect(this.page.locator(this.metricsStreamItem).first()).toBeVisible({ timeout: 8000 });
  }

  async isMetricsErrorVisible() {
    return await this.page.locator(this.metricsError)
      .isVisible({ timeout: 3000 }).catch(() => false);
  }

  async isMetricsEmptyVisible() {
    return await this.page.locator(this.metricsEmpty)
      .isVisible({ timeout: 3000 }).catch(() => false);
  }

  async getSearchInputValue() {
    return await this.page.locator(this.searchInput).inputValue();
  }

  /**
   * Click "View Related" dropdown and select an option (Logs or Traces).
   * @param {'logs'|'traces'} type - Which related telemetry to view
   */
  async clickViewRelated(type = 'traces') {
    await this.page.locator(this.sidePanelViewRelatedBtn).click();
    await this.page.waitForTimeout(300);
    const selector = type === 'logs' ? this.sidePanelViewRelatedLogsBtn : this.sidePanelViewRelatedTracesBtn;
    await this.page.locator(selector).click();
  }

  async expectCorrelationDialogVisible() {
    await expect(this.page.locator(this.correlationDashboardCard)).toBeVisible({ timeout: 15000 });
  }

  async isCorrelationDialogVisible() {
    return await this.page.locator(this.correlationDashboardCard)
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async closeCorrelationDialog() {
    await this.page.locator(this.correlationDashboardClose).click();
    await this.page.locator(this.correlationDashboardCard)
      .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async getCorrelationTabs() {
    const tabs = this.page.locator(this.correlationDialogTabs);
    const count = await tabs.count();
    const tabNames = [];
    for (let i = 0; i < count; i++) {
      tabNames.push((await tabs.nth(i).textContent()).trim());
    }
    return tabNames;
  }

  // ===== SCREENSHOTS (Visual Verification) =====

  async takeGraphScreenshot(name = 'service-graph') {
    await this.page.locator(this.chartContainer).screenshot({
      path: `test-results/screenshots/${name}-${Date.now()}.png`,
    });
  }
}
