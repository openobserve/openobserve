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
 * @param boundaryTime - Boundary (µs) separating fresh from stale data. RTL: last
 *   chunk's start_time (fresh data is to the RIGHT of boundary). LTR: last chunk's end_time
 *   (fresh data is to the LEFT of boundary).
 * @param queryStartTime - User-selected query start (µs), used as the left edge anchor.
 * @param queryEndTime - User-selected query end (µs), used as the right edge anchor.
 * @param isLTR - true for LTR streaming (overlay on LEFT/fresh), false for RTL (overlay on RIGHT/fresh).
 * @param primaryColor - hex color string for the overlay (e.g. '#5156BE'). Falls back to grey if omitted.
 * @param histogramIntervalMs - histogram bucket interval in milliseconds (from resultMetaData).
 *   Used for phantom point placement instead of deriving from data points.
 * @returns Merged options with new data overlaid on old
 */
export function overlayNewDataOnOldOptions(
  oldOptions: any,
  newOptions: any,
  containerSize?: { width: number; height: number },
  boundaryTime?: number,
  queryStartTime?: number,
  queryEndTime?: number,
  isLTR?: boolean,
  primaryColor?: string,
  histogramIntervalMs?: number,
): any {
  if (!newOptions?.series?.length) return oldOptions ?? newOptions;

  // When there is no old data (first load / no cache), add phantom
  // anchor points so the chart shows the full time range and correct
  // bar width even when only partial streaming data has arrived.
  if (!oldOptions?.series?.length) {
    const qStartMs = queryStartTime ? queryStartTime / 1000 : 0;
    const qEndMs = queryEndTime ? queryEndTime / 1000 : 0;
    const intervalMs = histogramIntervalMs ?? 0;

    if (qStartMs > 0 && qEndMs > 0) {
      for (const series of newOptions.series) {
        if (
          series?.name == null ||
          !Array.isArray(series?.data) ||
          !series?.data?.length
        )
          continue;
        const firstPoint = series.data[0];
        if (!Array.isArray(firstPoint) || firstPoint.length < 2) continue;

        const firstTs = toNumericTime(series.data[0]?.[0]);
        const lastTs = toNumericTime(
          series.data[series.data.length - 1]?.[0],
        );

        // Only add interval phantoms (one bucket before/after data edges)
        // to establish the correct min-interval for bar width.
        // We do NOT add range anchors — xAxis.min/max already pins the
        // chart range, and null anchors still skew min-interval calculation.
        if (!isNaN(firstTs) && intervalMs > 0) {
          const phantomTs = firstTs - intervalMs;
          if (phantomTs >= qStartMs) {
            series.data.unshift([new Date(phantomTs), null]);
          }
        }

        if (!isNaN(lastTs) && intervalMs > 0) {
          const phantomTs = lastTs + intervalMs;
          if (phantomTs <= qEndMs) {
            series.data.push([new Date(phantomTs), null]);
          }
        }
      }
    }
    return newOptions;
  }

  // Shallow-spread newOptions so functions (yAxis.axisLabel.formatter, tooltip.formatter, etc.)
  // are preserved by reference. Only deep-clone series & legend since we mutate their data.
  // JSON.parse(JSON.stringify()) strips functions — using it on the full object caused
  // y-axis formatter loss and unformatted numbers during streaming.
  const merged: any = { ...newOptions };
  merged.series = newOptions.series.map((series: any) => {
    if (Array.isArray(series?.data)) {
      return { ...series, data: series.data.slice() };
    }
    return { ...series };
  });
  if (newOptions.legend) {
    merged.legend = Array.isArray(newOptions.legend)
      ? newOptions.legend.map((legendItem: any) => ({ ...legendItem }))
      : { ...newOptions.legend };
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

  // Convert boundary values from µs to ms once for all series.
  const queryStartMs = queryStartTime ? queryStartTime / 1000 : 0;
  const queryEndMs = queryEndTime ? queryEndTime / 1000 : 0;

  // Boundary-based range splitting: use the four values (queryStart, queryEnd,
  // boundaryTime, isLTR) to cleanly separate fresh data (from new chunks) and
  // stale data (from old chart). No per-point null replacement — genuine nulls
  // in new data are preserved, and old data only fills the stale range.
  for (const newSeries of merged.series) {
    // Skip annotation series (no name — undefined/null, not empty string)
    if (newSeries?.name == null) continue;

    const oldSeries = oldOptions.series.find(
      (s: any) => s?.name === newSeries.name,
    );
    if (!oldSeries?.data?.length || !Array.isArray(oldSeries.data)) continue;

    // Skip non-time-series data (plain values, not [timestamp, value] pairs)
    const firstPoint = newSeries.data?.[0];
    if (!Array.isArray(firstPoint) || firstPoint.length < 2) continue;

    // Build old data lookup by timestamp for phantom and stale data filtering.
    const oldDataByTime = new Map<number, any>();
    for (const oldPoint of oldSeries.data) {
      if (Array.isArray(oldPoint) && oldPoint.length >= 2) {
        const t = toNumericTime(oldPoint[0]);
        if (!isNaN(t)) {
          oldDataByTime.set(t, oldPoint);
        }
      }
    }

    const intervalMs = histogramIntervalMs ?? 0;

    if (isLTR) {
      // LTR: new data covers [queryStart → chunkEnd].
      const lastNewTime = toNumericTime(
        newSeries.data[newSeries.data.length - 1]?.[0],
      );

      if (!isNaN(lastNewTime)) {
        // Compute phantom timestamp (one interval after last new point).
        const phantomTime =
          intervalMs > 0 ? lastNewTime + intervalMs : 0;
        const phantomInRange = phantomTime > 0 && phantomTime <= queryEndMs;

        // Collect stale old data AFTER last new timestamp,
        // excluding the phantom timestamp to avoid duplicates.
        const staleOldData: any[] = [];
        let phantomOldValue: any = null;

        oldDataByTime.forEach((oldPoint, t) => {
          if (phantomInRange && t === phantomTime) {
            // Reserve this point's value for the phantom
            phantomOldValue = oldPoint[1];
          } else if (t > lastNewTime && t <= queryEndMs) {
            staleOldData.push(oldPoint);
          }
        });

        // Add phantom with old data value for visual continuity & bar width.
        // Falls back to null when old data has no value at that timestamp
        // (null still contributes the timestamp for bar width derivation).
        if (phantomInRange) {
          newSeries.data.push([
            new Date(phantomTime),
            phantomOldValue ?? null,
          ]);
        }

        // Append remaining stale old data
        if (staleOldData.length) {
          newSeries.data = [...newSeries.data, ...staleOldData];
        }
      }
    } else {
      // RTL: new data covers [chunkStart → queryEnd].
      const firstNewTime = toNumericTime(newSeries.data[0]?.[0]);

      if (!isNaN(firstNewTime)) {
        // Compute phantom timestamp (one interval before first new point).
        const phantomTime =
          intervalMs > 0 ? firstNewTime - intervalMs : 0;
        const phantomInRange = phantomTime > 0 && phantomTime >= queryStartMs;

        // Collect stale old data BEFORE first new timestamp,
        // excluding the phantom timestamp to avoid duplicates.
        const staleOldData: any[] = [];
        let phantomOldValue: any = null;

        oldDataByTime.forEach((oldPoint, t) => {
          if (phantomInRange && t === phantomTime) {
            phantomOldValue = oldPoint[1];
          } else if (t < firstNewTime && t >= queryStartMs) {
            staleOldData.push(oldPoint);
          }
        });

        // Add phantom with old data value for visual continuity & bar width.
        if (phantomInRange) {
          newSeries.data = [
            [new Date(phantomTime), phantomOldValue ?? null],
            ...newSeries.data,
          ];
        }

        // Prepend remaining stale old data
        if (staleOldData.length) {
          newSeries.data = [...staleOldData, ...newSeries.data];
        }
      }
    }
  }

  // For series in OLD that don't exist in NEW yet:
  // Keep them visible with reduced opacity so user knows they're stale.
  // Filter their data to the new time range so they don't stretch the x-axis
  // (e.g. old 1-week series shouldn't expand a 1-day chart).
  const hasValidQueryRange = queryStartMs > 0 && queryEndMs > 0;
  for (const oldSeries of oldOptions.series) {
    if (oldSeries?.name == null) continue;
    const existsInNew = merged.series.some(
      (s: any) => s?.name === oldSeries.name,
    );
    if (!existsInNew) {
      const cloned = {
        ...oldSeries,
        data: Array.isArray(oldSeries.data)
          ? oldSeries.data.slice()
          : oldSeries.data,
      };

      // Filter old data points to the user's query time range
      if (hasValidQueryRange && Array.isArray(cloned.data)) {
        cloned.data = cloned.data.filter((point: any) => {
          if (Array.isArray(point) && point.length >= 2) {
            const t = toNumericTime(point[0]);
            return !isNaN(t) && t >= queryStartMs && t <= queryEndMs;
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
        ...(oldSeries.areaStyle
          ? {
              areaStyle: {
                ...oldSeries.areaStyle,
                opacity: 0.3,
              },
            }
          : {}),
      });
    }
  }

  // Recalculate legend to include all visible series
  if (merged.legend) {
    const allNames = merged.series
      .filter((s: any) => s?.name)
      .map((s: any) => s?.name);
    if (Array.isArray(merged.legend)) {
      merged.legend.forEach((l: any) => {
        if (l.data) l.data = allNames;
      });
    } else if (merged.legend.data) {
      merged.legend.data = allNames;
    }
  }

  // Add a subtle overlay on the FRESH portion of the chart during streaming.
  // Only covers the time range where new data has already arrived, so the user
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
      const boundaryMs = boundaryTime ? boundaryTime / 1000 : 0;
      const totalRange = queryEndMs - queryStartMs;
      const hasValidRange = boundaryMs > 0 && totalRange > 0;

      if (hasValidRange) {
        // Compute the fresh fraction (portion where new data has arrived) and
        // overlay it on that edge. LTR chunks arrive earliest-first, so fresh
        // data is on the LEFT up to boundaryTime. RTL chunks arrive newest-first,
        // so fresh data is on the RIGHT from boundaryTime to queryEnd.
        const freshFraction = Math.max(
          0,
          Math.min(
            1,
            (isLTR ? boundaryMs - queryStartMs : queryEndMs - boundaryMs) /
              totalRange,
          ),
        );
        const rawOverlayWidth = freshFraction * plotWidth;
        const rawOverlayLeft = isLTR
          ? plotLeft
          : plotLeft + plotWidth - rawOverlayWidth;

        // Clamp to plot rect so the overlay never bleeds onto y-axis labels
        // (this can happen when _gridRect is stale or when fallback grid
        // coordinates underestimate the axis-label width).
        const plotRight = plotLeft + plotWidth;
        const overlayLeft = Math.max(
          plotLeft,
          Math.min(plotRight, rawOverlayLeft),
        );
        const overlayRight = Math.max(
          plotLeft,
          Math.min(plotRight, rawOverlayLeft + rawOverlayWidth),
        );
        const overlayWidth = overlayRight - overlayLeft;

        if (overlayWidth > 1 && freshFraction > 0) {
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
                fill: primaryColor ?? "#808080",
                opacity: 0.05, // 5% opacity
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
