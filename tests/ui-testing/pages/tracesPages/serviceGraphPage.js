// serviceGraphPage.js
// Page object for Service Graph feature in Traces module
// Selectors verified against: ServiceGraph.vue, ServiceGraphNodeSidePanel.vue

import { expect } from '@playwright/test';

export class ServiceGraphPage {
  constructor(page) {
    this.page = page;

    // ===== NAVIGATION =====
    this.serviceGraphToggle = '[data-test="traces-service-graph-toggle"]';

    // ===== MAIN COMPONENT (ServiceGraph.vue) =====
    this.dateTimePicker = '[data-test="service-graph-date-time-picker"]';
    this.refreshButton = '[data-test="service-graph-refresh-btn"]';
    this.viewTabs = '[data-test="service-graph-view-tabs"]';
    this.chartContainer = '[data-test="service-graph-chart"]';

    // ===== VIEW TAB SELECTORS (AppTabs renders div.o2-tab, NOT role="tab") =====
    this.graphViewTab = '[data-test="tab-graph"]';
    this.treeViewTab = '[data-test="tab-tree"]';
    this.activeViewTab = '.o2-tab.active';

    // ===== SEARCH =====
    this.searchInput = 'input[placeholder="Search services..."]';

    // ===== NODE DETAIL PANEL (ServiceGraphNodeSidePanel.vue) =====
    this.sidePanel = '[data-test="service-graph-side-panel"]';
    this.sidePanelHeader = '[data-test="service-graph-side-panel-header"]';
    this.sidePanelServiceName = '[data-test="service-graph-side-panel-service-name"]';
    this.sidePanelShowTelemetryBtn = '[data-test="service-graph-side-panel-show-telemetry-btn"]';
    this.sidePanelCloseBtn = '[data-test="service-graph-side-panel-close-btn"]';

    // RED charts section (Rate/Errors/Duration dashboards)
    this.sidePanelRedCharts = '[data-test="service-graph-side-panel-red-charts"]';
    this.sidePanelFilterChips = '[data-test="service-graph-side-panel-filter-chips"]';
    this.sidePanelViewInTracesBtn = '[data-test="service-graph-side-panel-view-in-traces-btn"]';

    // Tabs section (Operations / Nodes / Pods)
    this.nodePanelTabs = '[data-test="service-graph-node-panel-tabs"]';
    this.operationsTab = '[data-test="service-graph-node-panel-tab-operations"]';
    this.nodesTab = '[data-test="service-graph-node-panel-tab-nodes"]';
    this.podsTab = '[data-test="service-graph-node-panel-tab-pods"]';
    this.recentOperations = '[data-test="service-graph-side-panel-recent-operations"]';
    this.operationsTable = '[data-test="service-graph-side-panel-operations-table"]';
    this.nodesPanel = '[data-test="service-graph-side-panel-nodes"]';
    this.nodesTable = '[data-test="service-graph-side-panel-nodes-table"]';
    this.podsPanel = '[data-test="service-graph-side-panel-pods"]';
    this.podsTable = '[data-test="service-graph-side-panel-pods-table"]';

    // ===== TELEMETRY CORRELATION DIALOG =====
    this.correlationDashboardClose = '[data-test="correlation-dashboard-close"]';
    this.correlationDashboardCard = '.correlation-dashboard-card';
    this.correlationDialogTabs = '.q-dialog .q-tab';
  }

  // ===== NAVIGATION =====

  async navigateToServiceGraph() {
    await this.page.locator(this.serviceGraphToggle).click();
    await this.page.waitForURL(/tab=service-graph/, { timeout: 10000 });
  }

  /**
   * Navigate directly to service graph via URL (more reliable than click-based navigation).
   * Sets the stream filter in localStorage before navigating to ensure the correct stream is shown.
   * @param {string} streamName - Stream to filter by (default: 'default')
   */
  async navigateToServiceGraphUrl(streamName = 'default') {
    // Set stream filter in localStorage before navigation — the Vue component reads from here
    await this.page.evaluate((stream) => {
      localStorage.setItem('serviceGraph_streamFilter', stream);
    }, streamName);

    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const url = `${baseUrl}/web/traces?tab=service-graph&org_identifier=${org}`;
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
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

  async switchToGraphView() {
    await this.page.locator(this.graphViewTab).click();
    // Wait for the graph tab to become active
    await this.page.locator(this.graphViewTab + '.active')
      .waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  }

  async switchToTreeView() {
    await this.page.locator(this.treeViewTab).click();
    // Wait for the tree tab to become active
    await this.page.locator(this.treeViewTab + '.active')
      .waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  }

  async getActiveViewTab() {
    // Scope to the view tabs container to avoid matching other AppTabs on the page
    const activeTab = this.page.locator(this.viewTabs).locator(this.activeViewTab);
    return await activeTab.textContent();
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
    return await this.page.locator(this.sidePanelServiceName).textContent();
  }

  async getHealthStatus() {
    const nameEl = this.page.locator(this.sidePanelServiceName);
    const badge = nameEl.locator('.health-badge');
    const badgeExists = await badge.count() > 0;
    if (!badgeExists) return 'unknown';
    const classes = await badge.getAttribute('class') || '';
    if (classes.includes('critical')) return 'critical';
    if (classes.includes('degraded')) return 'degraded';
    if (classes.includes('healthy')) return 'healthy';
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
    await table.locator('.q-spinner, .loading').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return await table.locator('tbody tr').count();
  }

  async closeSidePanel() {
    await this.page.locator(this.sidePanelCloseBtn).click();
    await this.page.locator(this.sidePanel)
      .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // ===== TELEMETRY CORRELATION =====

  /**
   * Click "Show Telemetry" and wait for the async API call to finish.
   * The button has a :loading state while fetchCorrelatedStreams() runs.
   * Returns true if the correlation dialog opened, false if an error notification appeared.
   */
  async clickShowTelemetryAndWait() {
    const btn = this.page.locator(this.sidePanelShowTelemetryBtn);
    await btn.click();

    // Wait for the loading spinner to appear and then disappear (API call in progress)
    // The button has :loading="correlationLoading" — Quasar adds .q-btn--loading class
    await btn.locator('.q-spinner').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await btn.locator('.q-spinner').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // After loading completes, either the dialog opens or a notification toast appears
    const dialogVisible = await this.page.locator(this.correlationDashboardCard)
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    return dialogVisible;
  }

  async clickShowTelemetry() {
    await this.page.locator(this.sidePanelShowTelemetryBtn).click();
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
