// Dashboard zoom-brush & panel-drag interactions.
//
// The ECharts dataZoom brush is canvas-drawn (not a DOM node), so a brush-to-zoom
// is a page.mouse drag on the chart canvas, and a panel reposition is a page.mouse
// drag on the panel header bar (GridStack only cancels the `.drag-cancel` body).

// The dashboard chart lives inside a GridStack tile, where a press competes with
// a tile drag; the expanded panel renders outside the grid, so a press there can
// only ever reach ECharts. Selection appearance is asserted in the expanded view
// for that reason, and the drag rule in the grid view where it actually applies.
const GRID_CHART_HOST = '.grid-stack-item [data-test="chart-renderer"]';
const EXPANDED_CHART_HOST =
  '[data-test="dashboard-viewpanel-panel-schema-renderer"] [data-test="chart-renderer"]';

const BRUSH_START_FRACTION = 0.2;
const BRUSH_END_FRACTION = 0.8;

// Sampled well inside the brushed band so a read never straddles its edges.
const TINT_SAMPLE_X = [0.35, 0.65];
const TINT_SAMPLE_Y = [0.35, 0.65];

export default class DashboardZoomDrag {
  constructor(page) {
    this.page = page;
    this.chartHostSelector = GRID_CHART_HOST;
    this.globalPickerBtn = page.locator(
      '[data-test="dashboard-global-date-time-picker"] [data-test="date-time-btn"]'
    );
    this.expandedCloseBtn = page.locator(
      '[data-test="dashboard-viewpanel-close-btn"]'
    );
    this.expandedRefreshBtn = page.locator(
      '[data-test="dashboard-viewpanel-refresh-data-btn"]'
    );
  }

  get chartRenderer() {
    return this.page.locator(this.chartHostSelector);
  }

  get chartCanvas() {
    return this.page.locator(`${this.chartHostSelector} canvas`);
  }

  // The GridStack tile for a panel by id — the host carrying the persisted layout.
  getPanelTile(panelId) {
    return this.page.locator(`.grid-stack-item[gs-id="${panelId}"]`);
  }

  // The panel header bar — the GridStack drag handle (the body is `.drag-cancel`).
  getPanelHeader(panelId) {
    return this.page.locator(
      `[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-bar"]`
    );
  }

  // The panel body — `.drag-cancel`, so a press here must reach ECharts, not GridStack.
  getPanelBody(panelId) {
    return this.page.locator(
      `[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-body"]`
    );
  }

  // The global date-time picker button — the zoom brush's observable surface.
  getGlobalPickerBtn() {
    return this.globalPickerBtn;
  }

  // Expand the panel to the full-window view. The fullscreen button is revealed
  // on hover, so the panel must be hovered before it can be waited for.
  async openExpandedPanel(timeout = 30000) {
    await this.page
      .locator('[data-test="dashboard-panel-container"]')
      .first()
      .hover();
    const button = this.page
      .locator('[data-test="dashboard-panel-fullscreen-btn"]')
      .first();
    await button.waitFor({ state: "visible", timeout });
    await button.click();
    await this.expandedCloseBtn.waitFor({ state: "visible", timeout });
    this.chartHostSelector = EXPANDED_CHART_HOST;
  }

  async closeExpandedPanel(timeout = 30000) {
    await this.expandedCloseBtn.click();
    await this.expandedCloseBtn.waitFor({ state: "hidden", timeout });
    this.chartHostSelector = GRID_CHART_HOST;
  }

  // Re-run the expanded panel's query, which re-applies the chart options and so
  // dispatches takeGlobalCursor again — the path that used to leak a brush handler.
  async refreshExpandedPanel(timeout = 30000) {
    await this.expandedRefreshBtn.waitFor({ state: "visible", timeout });
    const searched = this.page
      .waitForResponse((r) => r.url().includes("/_search"), { timeout })
      .catch(() => null);
    await this.expandedRefreshBtn.click();
    await searched;
    // The re-render keeps the same geometry, so a stale dwell count would pass instantly.
    await this.page.evaluate(() => {
      window.__o2ChartBox = null;
    });
  }

  // Poll until ECharts has mounted a canvas that has stopped moving. A non-zero
  // canvas is not enough: the dashboard reflows after load, so a brush path
  // measured too early is offset by hundreds of pixels and the drag lands off
  // the chart. Position matters as much as size, and the reflow outlasts a
  // couple of frames — hence the dwell.
  async waitForChartMounted(timeout = 30000) {
    if (this.chartHostSelector === GRID_CHART_HOST) {
      await this.waitForPanelsIdle(timeout);
    }
    await this.page.waitForFunction(
      (selector) => {
        const host = document.querySelector(selector);
        if (!host || !host.hasAttribute("_echarts_instance_")) return false;
        const canvas = host.querySelector("canvas");
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 80) return false;
        const key = [rect.left, rect.top, rect.width, rect.height]
          .map((n) => Math.round(n))
          .join(":");
        const prev = window.__o2ChartBox;
        window.__o2ChartBox =
          prev && prev.key === key ? { key, count: prev.count + 1 } : { key, count: 1 };
        return window.__o2ChartBox.count >= 4;
      },
      this.chartHostSelector,
      { timeout, polling: 100 }
    );
  }

  // A streamed chunk landing mid-gesture re-renders the chart and drops the in-progress brush.
  async waitForPanelsIdle(timeout = 30000) {
    await this.page.waitForFunction(
      () => {
        if (document.querySelector('[data-test="dashboard-cancel-btn"]')) return false;
        const refresh = document.querySelector('[data-test="dashboard-refresh-btn"]');
        if (!refresh) return false;
        return !refresh.disabled && refresh.getAttribute("aria-disabled") !== "true";
      },
      null,
      { timeout, polling: 200 }
    );
  }

  // Wait for a panel's tile and header bar to be mounted, so the drag handle
  // actually exists (an off-screen panel renders a placeholder, not the bar).
  async waitForPanelTile(panelId, timeout = 30000) {
    await this.getPanelTile(panelId).waitFor({ state: "visible", timeout });
    await this.getPanelHeader(panelId).waitFor({ state: "visible", timeout });
  }

  // Read the persisted GridStack layout of a panel off its tile attributes.
  async readPanelLayout(panelId) {
    const tile = this.getPanelTile(panelId);
    const [x, y, w, h] = await Promise.all([
      tile.getAttribute("gs-x"),
      tile.getAttribute("gs-y"),
      tile.getAttribute("gs-w"),
      tile.getAttribute("gs-h"),
    ]);
    return { x, y, w, h };
  }

  // zrender paints the selection cover on the next frame, so a sample taken in
  // the same tick as the mouse move would read the chart without its overlay.
  async settleFrames() {
    await this.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  }

  // Resolve the brush path in viewport coordinates and cache it, so the
  // hold/release pair drags along exactly the band the tint sampler reads.
  async resolveBrushPath() {
    await this.waitForChartMounted();
    const canvas = this.chartCanvas.first();
    await canvas.waitFor({ state: "visible", timeout: 30000 });
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("chart canvas has no bounding box");
    }
    this.brushPath = {
      startX: box.x + box.width * BRUSH_START_FRACTION,
      endX: box.x + box.width * BRUSH_END_FRACTION,
      y: box.y + box.height * 0.5,
    };
    return this.brushPath;
  }

  // Park the cursor at the brush origin without pressing, so the axis pointer is
  // already painted when the caller samples the pre-drag baseline.
  async moveToBrushStart() {
    const { startX, y } = await this.resolveBrushPath();
    await this.page.mouse.move(startX, y);
    await this.settleFrames();
  }

  // Press and drag across the band WITHOUT releasing, leaving the cover painted.
  async holdBrushAcrossCanvas() {
    const path = await this.resolveBrushPath();
    await this.page.mouse.move(path.startX, path.y);
    await this.page.mouse.down();
    await this.page.mouse.move(path.endX, path.y, { steps: 12 });
    await this.settleFrames();
  }

  async releaseBrush() {
    await this.page.mouse.up();
    this.brushPath = null;
  }

  // Mean (blue - red) over the sampled band. The selection fill is deep sky blue
  // at low alpha, so the overlay lifts this well clear of the chart's own
  // baseline, while echarts' default near-neutral grey barely moves it.
  async measureBandBlueShift() {
    return this.page.evaluate(
      ({ xs, ys, selector }) => {
        const host = document.querySelector(selector);
        if (!host) return null;
        const layers = Array.from(host.querySelectorAll("canvas"));
        if (!layers.length) return null;

        // zrender may paint the series and the selection cover on separate
        // layers, and leaves the plot area itself transparent — so flatten onto
        // opaque white, or the sampled band is all alpha 0 and carries no colour.
        const flat = document.createElement("canvas");
        flat.width = layers[0].width;
        flat.height = layers[0].height;
        const flatCtx = flat.getContext("2d");
        flatCtx.fillStyle = "#ffffff";
        flatCtx.fillRect(0, 0, flat.width, flat.height);
        for (const layer of layers) {
          flatCtx.drawImage(layer, 0, 0, flat.width, flat.height);
        }

        const x = Math.floor(flat.width * xs[0]);
        const w = Math.max(1, Math.floor(flat.width * (xs[1] - xs[0])));
        const y = Math.floor(flat.height * ys[0]);
        const h = Math.max(1, Math.floor(flat.height * (ys[1] - ys[0])));
        const { data } = flatCtx.getImageData(x, y, w, h);

        let sum = 0;
        let counted = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i + 2] - data[i];
          counted++;
        }
        return counted ? sum / counted : null;
      },
      { xs: TINT_SAMPLE_X, ys: TINT_SAMPLE_Y, selector: this.chartHostSelector }
    );
  }

  // True while GridStack has a tile drag in flight — stamped on mouse-down only
  // when the grab point is outside `.drag-cancel`.
  async isGridDragActive() {
    return this.page.evaluate(() =>
      Boolean(
        document.querySelector(".grid-stack-dragging") ||
          document.querySelector(".ui-draggable-dragging")
      )
    );
  }

  // Press on an element and drag by a viewport-pixel offset WITHOUT releasing,
  // so the caller can observe whether a grid drag actually started.
  async holdDragFrom(locator, { deltaX, deltaY }) {
    await locator.waitFor({ state: "visible", timeout: 30000 });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error("drag source has no bounding box");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(startX + deltaX, startY + deltaY, { steps: 15 });
    await this.settleFrames();
  }

  async releaseDrag() {
    await this.page.mouse.up();
  }

  // Drag a panel's header bar by a viewport-pixel offset (GridStack snaps to cells).
  async dragPanelHeader(panelId, { deltaX, deltaY }) {
    await this.holdDragFrom(this.getPanelHeader(panelId), { deltaX, deltaY });
    await this.releaseDrag();
  }

  // Brush a horizontal dataZoom selection across the chart canvas: mouse down at
  // ~20% width, drag to ~80% width at mid-height, release. The toolbox dataZoom
  // tool is auto-selected on init, so no toolbox button click is required.
  async brushChartCanvas() {
    await this.holdBrushAcrossCanvas();
    await this.releaseBrush();
  }
}
