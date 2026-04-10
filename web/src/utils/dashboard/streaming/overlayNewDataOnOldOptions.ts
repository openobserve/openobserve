// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Extract a numeric timestamp (ms) from a data point's x-value.
 * After JSON.parse(JSON.stringify()), Date objects become ISO strings.
 * We normalize to numeric ms for reliable Set comparison.
 */
function toNumericTime(val: any): number {
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") return new Date(val).getTime();
  return NaN;
}

/**
 * Overlay new chunk options on top of old rendered options.
 * New data takes priority, old data fills remaining time gaps.
 *
 * @param oldOptions - Snapshot of old rendered chart (ISO string timestamps after JSON clone)
 * @param newOptions - Complete options built from new accumulated data (Date objects)
 * @param containerSize - Chart container dimensions for graphic overlay positioning
 * @returns Merged options with new data overlaid on old
 */
export function overlayNewDataOnOldOptions(
  oldOptions: any,
  newOptions: any,
  containerSize?: { width: number; height: number },
  metadataStartTime?: number,
  queryStartTime?: number,
): any {
  if (!oldOptions?.series?.length) return newOptions;
  if (!newOptions?.series?.length) return oldOptions;

  // Shallow-spread newOptions so functions (yAxis.axisLabel.formatter, tooltip.formatter, etc.)
  // are preserved by reference. Only deep-clone series & legend since we mutate their data.
  // JSON.parse(JSON.stringify()) strips functions — using it on the full object caused
  // y-axis formatter loss and unformatted numbers during streaming.
  const merged: any = { ...newOptions };
  merged.series = JSON.parse(JSON.stringify(newOptions.series));
  if (newOptions.legend) {
    merged.legend = JSON.parse(JSON.stringify(newOptions.legend));
  }

  // Preserve the maximum yAxis nameGap seen across streaming chunks.
  // nameGap is computed from the longest formatted Y-value in the current partial data.
  // Early chunks have smaller Y values ΓåÆ shorter strings ΓåÆ smaller nameGap, causing the
  // Y-axis name label (e.g. "Metric_Name") to overlap tick labels mid-stream.
  // By taking max(old, new) we ensure nameGap only grows, never shrinks, during streaming.
  if (oldOptions.yAxis && newOptions.yAxis) {
    const oldNameGap =
      typeof oldOptions.yAxis.nameGap === "number"
        ? oldOptions.yAxis.nameGap
        : 0;
    const newNameGap =
      typeof newOptions.yAxis?.nameGap === "number"
        ? newOptions.yAxis.nameGap
        : 0;
    if (oldNameGap > newNameGap) {
      merged.yAxis = { ...newOptions.yAxis, nameGap: oldNameGap };
    }
  }

  // Preserve the maximum grid.bottom seen across streaming chunks.
  // For non-time-series categorical charts with rotated x-axis labels, grid.bottom
  // includes `additionalBottomSpace` which is derived from the longest x-axis category
  // label string in the current partial data. Early chunks may have shorter category
  // names ΓåÆ smaller additionalBottomSpace ΓåÆ smaller grid.bottom. As more data arrives
  // with longer category labels, grid.bottom grows to its correct final value, causing
  // the plot area to jump. Taking max(old, new) prevents it from shrinking mid-stream.
  const oldGrid = oldOptions.grid?.[0] ?? oldOptions.grid;
  const newGrid = newOptions.grid?.[0] ?? newOptions.grid;
  if (oldGrid && newGrid) {
    const oldBottom = typeof oldGrid.bottom === "number" ? oldGrid.bottom : 0;
    const newBottom = typeof newGrid.bottom === "number" ? newGrid.bottom : 0;
    if (oldBottom > newBottom) {
      const mergedGrid = { ...newGrid, bottom: oldBottom };
      merged.grid = Array.isArray(newOptions.grid)
        ? [mergedGrid, ...newOptions.grid.slice(1)]
        : mergedGrid;
    }
  }

  // First pass: compute the full time range across ALL new series.
  // fillMissingValues ensures the new data spans the entire query range,
  // so newMinTime/newMaxTime represent the new query's time boundaries.
  // We use this to filter out old data points that fall outside the new range
  // (e.g. when switching from 1-week to 1-day view).
  let newMinTime = Infinity;
  let newMaxTime = -Infinity;
  for (const newSeries of merged.series) {
    if (!newSeries.name || !Array.isArray(newSeries.data)) continue;
    for (const point of newSeries.data) {
      if (Array.isArray(point) && point.length >= 2) {
        const t = toNumericTime(point[0]);
        if (!isNaN(t)) {
          if (t < newMinTime) newMinTime = t;
          if (t > newMaxTime) newMaxTime = t;
        }
      }
    }
  }

  // For each series in new options, fill time gaps from old options
  for (const newSeries of merged.series) {
    // Skip annotation series (no name)
    if (!newSeries.name) continue;

    const oldSeries = oldOptions.series.find(
      (s: any) => s.name === newSeries.name,
    );
    if (!oldSeries?.data?.length) continue;

    // Build set of timestamps covered by new data (using numeric ms)
    const newTimeSlots = new Set<number>();
    if (Array.isArray(newSeries.data)) {
      newSeries.data.forEach((point: any) => {
        if (Array.isArray(point) && point.length >= 2) {
          const t = toNumericTime(point[0]);
          if (!isNaN(t)) {
            newTimeSlots.add(t);
          }
        }
      });
    }

    // If new data uses [timestamp, value] format (time-series)
    if (newTimeSlots.size > 0 && Array.isArray(oldSeries.data)) {
      // Append old data points for time slots NOT covered by new data,
      // but ONLY if they fall within the new query's time range.
      // This prevents old data from a different time range (e.g. 1-week)
      // leaking into the new chart (e.g. 1-day) when the user changes
      // the time picker.
      for (const oldPoint of oldSeries.data) {
        if (Array.isArray(oldPoint) && oldPoint.length >= 2) {
          const oldT = toNumericTime(oldPoint[0]);
          if (
            !isNaN(oldT) &&
            !newTimeSlots.has(oldT) &&
            oldT >= newMinTime &&
            oldT <= newMaxTime
          ) {
            newSeries.data.push(oldPoint);
          }
        }
      }

      // Sort by timestamp to maintain chronological order
      newSeries.data.sort((a: any, b: any) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          return toNumericTime(a[0]) - toNumericTime(b[0]);
        }
        return 0;
      });
    }
    // For categorical data (non-time-series), don't overlay — just use new data
  }

  // For series in OLD that don't exist in NEW yet:
  // Keep them visible with reduced opacity so user knows they're stale.
  // Filter their data to the new time range so they don't stretch the x-axis
  // (e.g. old 1-week series shouldn't expand a 1-day chart).
  const hasValidNewRange = newMinTime !== Infinity && newMaxTime !== -Infinity;
  for (const oldSeries of oldOptions.series) {
    if (!oldSeries.name) continue;
    const existsInNew = merged.series.some(
      (s: any) => s.name === oldSeries.name,
    );
    if (!existsInNew) {
      const cloned = JSON.parse(JSON.stringify(oldSeries));

      // Filter old data points to the new query's time range
      if (hasValidNewRange && Array.isArray(cloned.data)) {
        cloned.data = cloned.data.filter((point: any) => {
          if (Array.isArray(point) && point.length >= 2) {
            const t = toNumericTime(point[0]);
            return !isNaN(t) && t >= newMinTime && t <= newMaxTime;
          }
          return false;
        });
      }

      merged.series.push({
        ...cloned,
        lineStyle: {
          ...(oldSeries.lineStyle || {}),
          opacity: 0.3,
        },
        itemStyle: {
          ...(oldSeries.itemStyle || {}),
          opacity: 0.3,
        },
      });
    }
  }

  // Recalculate legend to include all visible series
  if (merged.legend) {
    const allNames = merged.series
      .filter((s: any) => s.name)
      .map((s: any) => s.name);
    if (Array.isArray(merged.legend)) {
      merged.legend.forEach((l: any) => {
        if (l.data) l.data = allNames;
      });
    } else if (merged.legend.data) {
      merged.legend.data = allNames;
    }
  }

  // Add a gray overlay on the STALE portion of the chart during streaming.
  // Only covers the time range where new data hasn't arrived yet, so the user
  // can see which part of the chart is fresh vs stale.
  //
  // Uses ECharts graphic component which renders directly on the canvas.
  // This function is only called during streaming; the final render bypasses it,
  // so the overlay disappears automatically when streaming completes.
  //
  // IMPORTANT: Must use `left/top + shape: { width, height }` instead of
  // `left/right/top/bottom` positioning because ChartRenderer uses `notMerge: true`
  // in setOption, and ECharts doesn't resolve right/bottom layout with notMerge.
  if (containerSize && containerSize.width > 0 && containerSize.height > 0) {
    // Prefer the actual grid pixel rect captured from the ECharts instance.
    // With containLabel: true, the raw grid config values don't match the
    // actual plot area — ECharts internally adjusts for axis label widths.
    const gridRect = oldOptions._gridRect;

    let plotLeft: number;
    let plotTop: number;
    let plotWidth: number;
    let plotHeight: number;

    if (gridRect) {
      plotLeft = gridRect.x;
      plotTop = gridRect.y;
      plotWidth = gridRect.width;
      plotHeight = gridRect.height;
    } else {
      // Fallback: estimate from raw grid config (less accurate with containLabel)
      const grid = merged.grid?.[0] || merged.grid || {};
      const gridLeft = typeof grid.left === "number" ? grid.left : 30;
      const gridRight = typeof grid.right === "number" ? grid.right : 20;
      const gridTopVal =
        typeof grid.top === "number" ? grid.top : parseInt(grid.top) || 10;
      const gridBottom = typeof grid.bottom === "number" ? grid.bottom : 50;

      plotLeft = gridLeft;
      plotTop = gridTopVal;
      plotWidth = containerSize.width - gridLeft - gridRight;
      plotHeight = containerSize.height - gridTopVal - gridBottom;
    }

    if (plotWidth > 0 && plotHeight > 0) {
      // Use the metadata start_time (microseconds) of the earliest received chunk
      // to compute the overlay. Chunks stream newest-first, so metadataStartTime is
      // the left boundary of data we've already received. Everything from
      // metadataStartTime → newMaxTime is new; convert µs → ms for comparison.
      const startTimeMs = metadataStartTime ? metadataStartTime / 1000 : 0;
      // Use queryStartTime (full query start, µs→ms) as the denominator anchor so
      // the fraction is relative to the complete query range, not just the received
      // data range. Falls back to newMinTime if queryStartTime is not available.
      const queryStartMs = queryStartTime ? queryStartTime / 1000 : newMinTime;
      const totalRange = newMaxTime - queryStartMs;
      const hasValidRange =
        newMinTime !== Infinity && newMaxTime !== -Infinity && totalRange > 0;
      const newFraction =
        startTimeMs > 0 && hasValidRange
          ? Math.max(0, Math.min(1, (newMaxTime - startTimeMs) / totalRange))
          : 0;

      if (newFraction > 0 && newFraction < 1) {
        const overlayWidth = newFraction * plotWidth;
        const overlayLeft = plotLeft + plotWidth - overlayWidth;

        if (overlayWidth > 1) {
          merged.graphic = [
            {
              type: "rect",
              left: overlayLeft,
              top: plotTop,
              shape: {
                width: overlayWidth,
                height: plotHeight,
              },
              style: {
                fill: "rgba(128, 128, 128, 0.15)",
              },
              silent: true,
              z: 0,
            },
          ];
        }
      }
    }
  }

  return merged;
}
