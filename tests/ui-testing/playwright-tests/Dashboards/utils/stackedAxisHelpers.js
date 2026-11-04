/**
 * Helpers for asserting how stacked panels fit a user-set value-axis min/max to the rendered stacks.
 */

/**
 * Tallest positive and deepest negative stack end across every bucket; positives and negatives stack apart.
 *
 * @param {Array<{name: string, stack: string|null, points: Array}>} series
 * @returns {{hi: number, lo: number}} stack extent, anchored at 0 like a bar baseline
 */
export function stackExtent(series) {
  const sums = new Map();
  let hi = 0;
  let lo = 0;
  series.forEach((s, seriesIndex) => {
    // Unnamed series carry mark lines and annotations, not stacked data.
    if (!s.name) return;
    const group = s.stack ?? `series:${seriesIndex}`;
    s.points.forEach((point, index) => {
      // A time-axis point is [time, value]; a category point sits at its category's index.
      const [bucket, raw] = Array.isArray(point) ? [point[0], point[1]] : [index, point];
      const value = Number(raw);
      if (raw === null || raw === undefined || raw === "" || !Number.isFinite(value)) return;
      const key = `${group}|${value < 0 ? "-" : "+"}|${bucket}`;
      const sum = (sums.get(key) ?? 0) + value;
      sums.set(key, sum);
      if (value < 0) lo = Math.min(lo, sum);
      else hi = Math.max(hi, sum);
    });
  });
  return { hi, lo };
}

/**
 * Largest single plotted value across all named series, ignoring how they stack.
 *
 * @param {Array<{name: string, points: Array}>} series
 * @returns {number}
 */
export function tallestPoint(series) {
  return Math.max(
    0,
    ...series
      .filter((s) => s.name)
      .flatMap((s) => s.points.map((p) => Number(Array.isArray(p) ? p[1] : p)))
      .filter(Number.isFinite),
  );
}

/**
 * Polls the rendered chart until its series carry data and `ready` accepts the fit, then returns that fit.
 *
 * @param {object} pm - PageManager instance
 * @param {Function} expect - Playwright expect
 * @param {object} [options]
 * @param {"yAxis"|"xAxis"} [options.valueAxis]
 * @param {(fit: object) => boolean} [options.ready] - e.g. wait until the applied max reached the option
 * @param {string} [options.scopeSelector]
 */
export async function waitForValueAxisFit(pm, expect, {
  valueAxis = "yAxis",
  ready = () => true,
  scopeSelector,
} = {}) {
  let fit = null;
  await expect
    .poll(
      async () => {
        fit = await pm.dashboardPanelActions.getChartValueAxisFit(valueAxis, scopeSelector);
        return Boolean(fit?.series.some((s) => s.name && s.points.length > 0) && ready(fit));
      },
      { timeout: 30000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return fit;
}
