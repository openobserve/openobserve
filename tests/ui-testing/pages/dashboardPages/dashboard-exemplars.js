// Prometheus exemplar overlay page object — backs dashboard-exemplars.spec.js.
//
// Encapsulates the panel/marker/card data-test contract so the spec never
// reaches for a raw selector. Marker positions are recomputed after every
// chart paint, so markerPoint() polls until two canvas-relative reads agree.
// The line-mode offset check and the light/dark contrast check both reach into
// ECharts internals; they live here so the spec asserts plain values.

import { expect } from "@playwright/test";

export default class DashboardExemplars {
  constructor(page) {
    this.page = page;

    // Panel + chart surface.
    this.panelContainer = page.locator('[data-test="dashboard-panel-container"]');
    this.noData = page.locator('[data-test="no-data"]');
    this.toast = page.locator('.o2-toast, [data-test="o-toast"]');

    // Exemplar overlay — the card is a single portal, so these are global.
    this.card = page.locator('[data-test="dashboard-panel-exemplar-tooltip"]');
    this.exemplarValue = page.locator('[data-test="dashboard-panel-exemplar-value"]');
    this.exemplarTraceId = page.locator('[data-test="dashboard-panel-exemplar-trace-id"]');
    this.exemplarLabelSpan = page.locator('[data-test="dashboard-panel-exemplar-label-span_id"]');
    this.exemplarSeriesLabels = page.locator('[data-test="dashboard-panel-exemplar-series-labels"]');
    this.exemplarQuery = page.locator('[data-test="dashboard-panel-exemplar-query"]');
    this.exemplarNoTrace = page.locator('[data-test="dashboard-panel-exemplar-no-trace"]');
    this.exemplarClampedNote = page.locator('[data-test="dashboard-panel-exemplar-clamped-note"]');
    this.exemplarTraceUnavailable = page.locator('[data-test="dashboard-panel-exemplar-trace-unavailable"]');
    this.exemplarErrorMessage = page.locator('[data-test="dashboard-panel-exemplars-error-message"]');
    this.exemplarOpenTrace = page.locator('[data-test="dashboard-panel-exemplar-open-trace"]');
    this.exemplarOpenTraceUnverified = page.locator('[data-test="dashboard-panel-exemplar-open-trace-unverified"]');
    this.retry = page.locator('[data-test="dashboard-panel-exemplars-retry"]');

    // Dashboard chrome.
    this.refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.editDropdown = page.locator('[data-test="dashboard-edit-panel-Edit-dropdown"]');
    this.editPanelItem = page.locator('[data-test="dashboard-edit-panel"]');
    this.applyBtn = page.locator('[data-test="dashboard-apply"]');
    this.sidebarCollapsed = page.locator('[data-test="panel-sidebar-header-collapsed"]');
    this.configSearchInput = page.locator('[data-test="dashboard-config-panel-search"] input');
    this.showExemplarsSwitch = page.locator('[data-test="dashboard-config-show-exemplars"]');
    this.saveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.viewpanelToggle = page.locator('[data-test="dashboard-viewpanel-exemplars-toggle"]');
    this.viewpanelCloseBtn = page.locator('[data-test="dashboard-viewpanel-close-btn"]');

    // Trace details surface.
    this.traceSpansCount = page.locator('[data-test="trace-details-spans-count"]');
    this.traceSidebar = page.locator('[data-test="trace-details-sidebar"]');
  }

  // ---- dynamic locators (panel-scoped) ----

  container(panelId) {
    return this.page.locator(`[data-test="dashboard-panel-container"][data-test-panel-id="${panelId}"]`);
  }

  chart(panelId) {
    return this.container(panelId).locator('[_echarts_instance_]');
  }

  points(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplar-points"]');
  }

  point(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplar-point"]');
  }

  clampedPoints(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplar-point"][data-clamped]');
  }

  toggle(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplars-toggle"]');
  }

  emptyTag(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplars-empty"]');
  }

  errorTag(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-exemplars-error"]');
  }

  fullscreenBtn(panelId) {
    return this.container(panelId).locator('[data-test="dashboard-panel-fullscreen-btn"]');
  }

  outdatedText() {
    return this.page.getByText('Your chart is not up to date');
  }

  // ---- navigation / render helpers ----

  async openDashboard(url) {
    await this.page.goto(url);
    await this.panelContainer.first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  async waitForChart(panelId) {
    await expect.poll(async () => this.chart(panelId).count(), { timeout: 30_000 }).toBeGreaterThan(0);
  }

  async markerCount(panelId) {
    const list = this.points(panelId);
    if (!(await list.count())) return 0;
    return Number(await list.getAttribute('data-count'));
  }

  /** Absolute page coordinates of a marker, from the hidden list's canvas-relative pixels. */
  async markerPoint(panelId, index = 0) {
    const point = this.point(panelId).nth(index);
    // Positions are recomputed after each chart paint, so wait until two reads agree.
    let last = '';
    await expect.poll(async () => {
      const now = `${await point.getAttribute('data-x-px')},${await point.getAttribute('data-y-px')}`;
      const stable = now === last;
      last = now;
      return stable;
    }, { timeout: 15_000, intervals: [750] }).toBe(true);
    const x = Number(await point.getAttribute('data-x-px'));
    const y = Number(await point.getAttribute('data-y-px'));
    const box = await this.chart(panelId).first().boundingBox();
    return {
      x: box.x + x,
      y: box.y + y,
      traceId: await point.getAttribute('data-trace-id'),
      spanId: await point.getAttribute('data-span-id'),
    };
  }

  async firstFoundMarker(panelId, found) {
    const ids = new Set(found.map((f) => f.traceId));
    const points = this.point(panelId);
    const n = await points.count();
    for (let i = 0; i < n; i++) {
      if (ids.has(await points.nth(i).getAttribute('data-trace-id'))) return this.markerPoint(panelId, i);
    }
    throw new Error('no marker points at an ingested trace');
  }

  // ---- chart-level measurements (brittle ECharts internals live here) ----

  /** Distance (px) of each line-mode marker from the line its series drew. */
  async lineMarkerOffsets(panelId) {
    const markers = await this.point(panelId).evaluateAll((els) =>
      els.map((e) => [Number(e.getAttribute('data-y-px')), Number(e.getAttribute('data-x-px'))]));
    return this.container(panelId).locator('[data-test="chart-renderer"]').evaluate((host, list) => {
      const chart = host.__vueParentComponent?.setupState?.chart;
      const all = chart?.getOption()?.series ?? [];
      const seriesIndex = all.findIndex((s) => s.type === 'line' && Array.isArray(s.data) && s.data.length > 1);
      if (seriesIndex < 0) return [Infinity];
      const pts = all[seriesIndex].data
        .filter((d) => d[1] !== null && d[1] !== undefined)
        .map((d) => chart.convertToPixel({ seriesIndex }, d))
        .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map((p) => [p[0], p[1]])
        .sort((a, b) => a[0] - b[0]);
      if (pts.length < 2) return [Infinity];
      return list.map(([y, x]) => {
        const i = pts.findIndex((p) => p[0] >= x);
        if (i <= 0) return Math.abs(pts[i < 0 ? pts.length - 1 : 0][1] - y);
        const [a, b] = [pts[i - 1], pts[i]];
        return Math.abs(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]) - y);
      });
    }, markers);
  }

  /** Marker and background colours sampled from the chart canvas at the marker's pixel. */
  async markerPixelColors(panelId, { x, y }) {
    return this.chart(panelId).locator('canvas').first().evaluate((canvas, [ax, ay]) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      const ctx = canvas.getContext('2d');
      // The canvas is transparent, so the visible background is the first painted ancestor.
      let el = canvas;
      let bg = [255, 255, 255];
      while (el) {
        const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        if (c.length >= 3 && (c.length < 4 || c[3] > 0)) { bg = c.slice(0, 3); break; }
        el = el.parentElement;
      }
      const lum = (rgb) => {
        const c = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      // Symbol 10 px, halo 1.5 px and edge blur 2 px (applyExemplarSeries): only the marker's own disc is sampled.
      const radius = (10 / 2 + 1.5 + 2) * dpr;
      const reach = Math.ceil(radius);
      const cx = Math.round((ax - rect.left) * dpr);
      const cy = Math.round((ay - rect.top) * dpr);
      const data = ctx.getImageData(cx - reach, cy - reach, 2 * reach + 1, 2 * reach + 1).data;
      let best = bg;
      const side = 2 * reach + 1;
      for (let i = 0; i < data.length; i += 4) {
        const px0 = (i / 4) % side - reach;
        const py0 = Math.floor(i / 4 / side) - reach;
        if (px0 * px0 + py0 * py0 > radius * radius) continue;
        const a = data[i + 3] / 255;
        const px = [0, 1, 2].map((k) => Math.round(data[i + k] * a + bg[k] * (1 - a)));
        if (ratio(px, bg) > ratio(best, bg)) best = px;
      }
      return [best, bg];
    }, [x, y]);
  }

  /** Viewport/clipping geometry of the open card (not-available is self-scrolling). */
  async cardLayout() {
    return this.card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const overflowing = [...el.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > box.right + 0.5).length;
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        overflowing,
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
  }
}
