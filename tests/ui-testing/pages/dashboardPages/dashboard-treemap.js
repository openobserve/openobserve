// Treemap panel reads: tiles are canvas-painted, so the live ECharts instance is the only source of what is drawn.
const {
  getOrgIdentifier,
} = require("../../playwright-tests/utils/cloud-auth.js");

export default class DashboardTreemap {
  constructor(page) {
    this.page = page;
  }

  org() {
    return getOrgIdentifier() || process.env.ORGNAME || "default";
  }

  async openDashboard(dashboardId, period = "1h") {
    await this.page.goto(
      `/web/dashboards/view?org_identifier=${this.org()}&dashboard=${dashboardId}&folder=default&period=${period}`,
    );
  }

  /** Opens the panel editor on `panelId`, or on a new panel when `panelId` is omitted. */
  async openPanelEditor(dashboardId, panelId) {
    const panel = panelId ? `&panelId=${panelId}` : "";
    await this.page.goto(
      `/web/dashboards/add_panel?org_identifier=${this.org()}&dashboard=${dashboardId}${panel}&folder=default&tab=default`,
    );
  }

  panel(panelId) {
    return this.page.locator(
      `[data-test="dashboard-panel-container"][data-test-panel-id="${panelId}"]`,
    );
  }

  /** A dashboard panel's chart, or the panel editor's own chart when `panelId` is null. */
  chartHost(panelId) {
    const scope = panelId ? this.panel(panelId) : this.page;
    return scope
      .locator('[data-test="chart-renderer"][_echarts_instance_]')
      .first();
  }

  skippedRowsChip(panelId) {
    return this.panel(panelId).locator(
      '[data-test="panel-notice-chip-skipped-rows"]',
    );
  }

  editorError(text) {
    return this.page
      .locator('[data-test="dashboard-errors-list-item"]')
      .filter({ hasText: text });
  }

  groupFieldLabels() {
    return this.page.locator(
      '[data-test="dashboard-x-layout"] [data-test^="dashboard-x-item-"]:not([data-test$="-drag"]):not([data-test$="-menu"]):not([data-test$="-remove"])',
    );
  }

  firstSizeField() {
    return this.page
      .locator(
        '[data-test="dashboard-y-layout"] [data-test^="dashboard-y-item-"]',
      )
      .first();
  }

  // `__vueParentComponent` is dev-only, so the chart is found by walking the app's vnode tree.
  async snapshot(panelId) {
    return this.chartHost(panelId).evaluate((host) => {
      let chart = null;
      const seen = new Set();
      const walk = (node, depth) => {
        if (
          chart ||
          !node ||
          typeof node !== "object" ||
          depth > 400 ||
          seen.has(node)
        )
          return;
        seen.add(node);
        const comp = node.component;
        if (comp) {
          try {
            if (comp.setupState?.chartRef === host && comp.setupState.chart) {
              chart = comp.setupState.chart;
              return;
            }
          } catch {
            // A setup getter can throw on an unmounted component; it is not the chart we want.
          }
          walk(comp.subTree, depth + 1);
        }
        if (node.suspense) walk(node.suspense.activeBranch, depth + 1);
        if (Array.isArray(node.children))
          for (const child of node.children) walk(child, depth + 1);
      };
      walk(document.querySelector("#app")?._vnode, 0);
      if (!chart) return null;
      const option = chart.getOption();
      const series = chart.getModel().getSeriesByIndex(0);
      if (!series || series.subType !== "treemap")
        return { option: null, tiles: [], boxes: [] };
      const area = series.layoutInfo;
      const boxes = [];
      const visit = (node, path, ox, oy) => {
        const layout = node.getLayout();
        if (!layout) return;
        const x = ox + layout.x;
        const y = oy + layout.y;
        if (node.depth > 0)
          boxes.push({
            path: [...path, node.name].join("/"),
            x,
            y,
            width: layout.width,
            height: layout.height,
          });
        node.children.forEach((child) =>
          visit(child, node.depth > 0 ? [...path, node.name] : path, x, y),
        );
      };
      visit(series.getData().tree.root, [], area.x, area.y);
      const isWhite = (fill) =>
        /^(#fff(fff)?|rgba?\(255,\s*255,\s*255(,\s*1)?\))$/i.test(String(fill));
      const tiles = chart
        .getZr()
        .storage.getDisplayList(true)
        .filter(
          (el) =>
            el.type === "rect" &&
            !el.invisible &&
            el.style?.fill &&
            el.style.fill !== "none" &&
            !isWhite(el.style.fill),
        )
        .map((el) => {
          const t = el.transform || [1, 0, 0, 1, 0, 0];
          return {
            x: Math.round(t[4]),
            y: Math.round(t[5]),
            width: Math.round(el.shape.width * t[0]),
            height: Math.round(el.shape.height * t[3]),
          };
        })
        .filter((tile) => tile.width > 4 && tile.height > 4);
      const strip = (nodes) =>
        (nodes || []).map((n) => ({
          name: n.name,
          value: n.value,
          children: strip(n.children),
        }));
      return {
        nodes: strip(option.series[0].data),
        area: { width: area.width, height: area.height },
        boxes,
        tiles,
      };
    });
  }

  async waitForTiles(expect, panelId) {
    await this.chartHost(panelId).waitFor({ state: "visible", timeout: 30000 });
    await expect
      .poll(async () => (await this.snapshot(panelId))?.tiles?.length ?? 0, {
        timeout: 30000,
        message: `treemap ${panelId} never painted tiles`,
      })
      .toBeGreaterThan(0);
  }
}
