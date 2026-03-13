/**
 * Shared canvas helper utilities for dashboard chart tests.
 * ECharts renders to canvas — these helpers let tests verify chart output
 * by inspecting canvas pixel data directly.
 */

/**
 * Verify that a specific RGB color appears on any canvas element via pixel analysis.
 * Scans every canvas in the page and counts pixels matching the target color (within tolerance).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ r: number, g: number, b: number }} rgb - Target color as RGB values (0-255 each)
 * @param {number} [minPixels=5] - Minimum matching pixels required to consider the color found
 * @returns {Promise<{ matchingPixels: number, colorFound: boolean, canvasCount: number }>}
 *
 * @example
 * // Verify #e63946 (rgb 230,57,70) appears on the chart
 * const result = await verifyColorOnCanvas(page, { r: 230, g: 57, b: 70 });
 * expect(result.colorFound).toBe(true);
 */
export async function verifyColorOnCanvas(page, { r, g, b }, minPixels = 5) {
  return page.evaluate(
    ({ r, g, b, minPixels }) => {
      const canvasElements = document.querySelectorAll("canvas");
      let matchingPixels = 0;
      let canvasCount = canvasElements.length;

      for (const canvas of canvasElements) {
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          // Sample every 4th pixel for performance (still thorough)
          for (let i = 0; i < data.length; i += 16) {
            if (
              Math.abs(data[i]     - r) < 15 &&
              Math.abs(data[i + 1] - g) < 15 &&
              Math.abs(data[i + 2] - b) < 15 &&
              data[i + 3] > 200   // alpha > 200 (nearly opaque)
            ) {
              matchingPixels++;
            }
          }
        } catch (e) {
          // Tainted canvas (cross-origin) — skip
        }
      }

      return { matchingPixels, colorFound: matchingPixels >= minPixels, canvasCount };
    },
    { r, g, b, minPixels }
  );
}

/**
 * Wait for the chart canvas to be fully repainted after applying data changes.
 * Uses double requestAnimationFrame + a fixed settle delay to ensure ECharts
 * has finished its paint cycle before pixel inspection.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 * @param {number} [settleMs=2000] - Extra ms to wait after rAF for ECharts to finish
 */
export async function waitForChartRepaint(page, pm, settleMs = 2000) {
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
  await page.waitForFunction(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    { timeout: 5000 }
  ).catch(() => {});
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
}

/**
 * Apply the dashboard and wait for the first _search API response + chart repaint.
 * Suitable for tests that need accurate canvas pixel data after applying a query.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} pm - PageManager instance
 */
export async function applyAndWaitForRender(page, pm) {
  const apiPromise = page.waitForResponse(
    (response) =>
      /\/api\/.*\/_search/.test(response.url()) && response.status() === 200,
    { timeout: 30000 }
  );
  await pm.dashboardPanelActions.applyDashboardBtn();
  await apiPromise;
  await waitForChartRepaint(page, pm);
}
