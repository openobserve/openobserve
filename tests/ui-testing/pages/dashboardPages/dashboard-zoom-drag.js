// Dashboard zoom-brush & panel-drag interactions.
//
// The ECharts dataZoom brush is canvas-drawn (not a DOM node), so a brush-to-zoom
// is a page.mouse drag on the chart canvas, and a panel reposition is a page.mouse
// drag on the panel header bar (GridStack only cancels the `.drag-cancel` body).
export default class DashboardZoomDrag {
  constructor(page) {
    this.page = page;
    this.chartRenderer = page.locator('[data-test="chart-renderer"]');
    this.chartCanvas = page.locator('[data-test="chart-renderer"] canvas');
    this.globalPickerBtn = page.locator(
      '[data-test="dashboard-global-date-time-picker"] [data-test="date-time-btn"]'
    );
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

  // The global date-time picker button — the zoom brush's observable surface.
  getGlobalPickerBtn() {
    return this.globalPickerBtn;
  }

  // Poll until ECharts has mounted a non-zero-sized canvas, which is proof the
  // chart is laid out and ready to receive a dataZoom brush drag.
  async waitForChartMounted(timeout = 30000) {
    await this.page.waitForFunction(
      () => {
        const host = document.querySelector('[data-test="chart-renderer"]');
        if (!host || !host.hasAttribute("_echarts_instance_")) return false;
        const canvas = host.querySelector("canvas");
        return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
      },
      { timeout }
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

  // Drag a panel's header bar by a viewport-pixel offset (GridStack snaps to cells).
  async dragPanelHeader(panelId, { deltaX, deltaY }) {
    const header = this.getPanelHeader(panelId);
    await header.waitFor({ state: "visible", timeout: 30000 });
    await header.scrollIntoViewIfNeeded();
    const box = await header.boundingBox();
    if (!box) {
      throw new Error(`panel header for "${panelId}" has no bounding box`);
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(startX + deltaX, startY + deltaY, { steps: 15 });
    await this.page.mouse.up();
  }

  // Brush a horizontal dataZoom selection across the chart canvas: mouse down at
  // ~20% width, drag to ~80% width at mid-height, release. The toolbox dataZoom
  // tool is auto-selected on init, so no toolbox button click is required.
  async brushChartCanvas() {
    await this.waitForChartMounted();
    const canvas = this.chartCanvas.first();
    await canvas.waitFor({ state: "visible", timeout: 30000 });
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("chart canvas has no bounding box");
    }
    const startX = box.x + box.width * 0.2;
    const endX = box.x + box.width * 0.8;
    const y = box.y + box.height * 0.5;
    await this.page.mouse.move(startX, y);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, y, { steps: 12 });
    await this.page.mouse.up();
  }
}
