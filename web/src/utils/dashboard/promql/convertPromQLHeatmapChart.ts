// Copyright 2026 OpenObserve Inc.
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

import {
  PromQLChartConverter,
  ProcessedPromQLData,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import {
  deaccumulateHistogramSeries,
  HistogramSeriesInput,
} from "./shared/histogramBuckets";
import {
  HEATMAP_SPLIT_AREA,
  HEATMAP_VISUAL_MAP_COLORS,
  heatmapCellItemStyle,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
} from "../heatmapDefaults";

/**
 * Opt-in heatmap mode that treats the queried series as the cumulative buckets
 * of a Prometheus classic histogram (`sum by(le) (rate(x_bucket[W]))`).
 */
export const PROMETHEUS_HISTOGRAM_MODE = "prometheus_histogram";

/**
 * The X axis for a heatmap: every timestamp any query reported, ascending.
 *
 * Not `processedData[0].timestamps`. The cells come from ALL queries, so taking
 * the axis from the first one alone had two failure modes, and neither announced
 * itself:
 *
 *   - If the FIRST query returned no data, its `timestamps` is empty, so the axis
 *     was empty and the panel rendered blank — even when the other queries had
 *     plenty to show. Any panel whose first query is typo'd, or whose first metric
 *     is simply idle over the chosen range, looked like a total outage.
 *   - If two queries landed on different grids, query 1's samples were looked up
 *     against query 0's timestamps (`bucket.data[ts]`), missed, and read as 0.
 *
 * A union is the honest axis: it is exactly the first query's timestamps in the
 * ordinary single-query / shared-grid case, and it degrades to the truth rather
 * than to blankness otherwise.
 */
function buildTimeAxis(
  processedData: ProcessedPromQLData[],
): Array<[any, any]> {
  const byTs = new Map<string, [any, any]>();

  for (const queryData of processedData ?? []) {
    for (const entry of queryData?.timestamps ?? []) {
      // Keep the first formatting seen for a timestamp; two queries that report
      // the same instant format it identically anyway.
      const key = String(entry[0]);
      if (!byTs.has(key)) byTs.set(key, entry);
    }
  }

  return [...byTs.values()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
}

/**
 * The `visualMap` range for a set of cell values.
 *
 * Zero is the floor whenever the data is non-negative — which is the ordinary
 * case, and the only case for a de-accumulated histogram, whose cells are counts
 * clamped at zero. But a heatmap of a metric that is negative throughout (a
 * delta, a `deriv()`, a temperature) has a max below zero, and a hardcoded floor
 * of 0 handed ECharts the inverted range [0, negative]: every cell came out the
 * same colour. Both paths ask this one question so neither can answer it wrongly
 * on its own.
 */
function visualMapRangeOf(
  minValue: number,
  maxValue: number,
): { min: number; max: number } {
  return {
    min: Number.isFinite(minValue) ? Math.min(0, minValue) : 0,
    max: Number.isFinite(maxValue) ? maxValue : 0,
  };
}

/**
 * Format timestamps to extract the time portion (consistent with bar charts)
 */
function buildXAxisData(timestamps: Array<[any, any]>): string[] {
  return (
    timestamps?.map(([, formatted]) => {
      // formatted can be Date object or ISO string
      let timeString: string;
      if (formatted instanceof Date) {
        // Format as HH:MM:SS
        const hours = String(formatted.getHours()).padStart(2, "0");
        const minutes = String(formatted.getMinutes()).padStart(2, "0");
        const seconds = String(formatted.getSeconds()).padStart(2, "0");
        timeString = `${hours}:${minutes}:${seconds}`;
      } else {
        // ISO string - extract time portion
        const dateStr = formatted.toString();
        // Try to extract time (HH:MM:SS) from datetime string
        const timeMatch = dateStr.match(/(\d{2}:\d{2}:\d{2})/);
        timeString = timeMatch ? timeMatch[1] : dateStr;
      }
      return timeString;
    }) || []
  );
}

/**
 * Extract the `le` label for a series.
 * Prefers the parsed `metric.le` label; when the metric labels are absent
 * (some callers only carry a rendered legend name), fall back to pulling
 * `le="..."` out of the series name, and finally to the whole name if it
 * looks like a bare bound.
 */
export function extractLeLabel(seriesData: any): string {
  const fromMetric = seriesData?.metric?.le;
  if (fromMetric !== undefined && fromMetric !== null) {
    return String(fromMetric);
  }

  const name = seriesData?.name;
  if (typeof name !== "string") return "";

  const labelMatch = name.match(/\ble\s*=\s*"([^"]*)"/);
  if (labelMatch) return labelMatch[1];

  return name.trim();
}

/**
 * Render a bucket bound as a y-axis category label.
 * `+Inf` renders as the literal "+Inf"; finite bounds are formatted with the
 * bucket unit (the unit of the OBSERVATION, e.g. seconds) — distinct from
 * `config.unit`, which describes the cell intensity (count/s).
 */
function formatBucketLabel(le: string, leValue: number, config: any): string {
  if (!Number.isFinite(leValue)) {
    return leValue < 0 ? "-Inf" : "+Inf";
  }

  try {
    const formatted = formatUnitValue(
      getUnitValue(
        leValue,
        config?.bucket_unit,
        config?.bucket_unit_custom,
        config?.decimals,
      ),
    );
    return formatted || le;
  } catch (error) {
    return le;
  }
}

/**
 * Converter for heatmap charts
 * Displays time-series data as a 2D heatmap with color intensity
 */
export class HeatmapConverter implements PromQLChartConverter {
  supportedTypes = ["heatmap"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const config = panelSchema.config || {};

    // Opt-in only: Prometheus classic-histogram mode. Generic heatmaps keep
    // their existing behavior untouched.
    if (config?.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE) {
      return this.convertHistogram(processedData, config, store, extras);
    }

    // Heatmap requires 3D data: [x, y, value]
    // X-axis: timestamps
    // Y-axis: series names
    // Value: metric values

    const seriesNames: string[] = [];
    const data: any[] = [];
    let maxValue = -Infinity;
    let minValue = Infinity;

    // Shared across every query, so a cell's column is its INSTANT — not its
    // offset within whichever query happened to report it.
    const timeAxis = buildTimeAxis(processedData);
    const columnOfTs = new Map(
      timeAxis.map(([ts], index) => [String(ts), index]),
    );

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        seriesNames.push(seriesData.name);
        extras.legends.push(seriesData.name);

        // The row is the series' position on the Y AXIS — which spans every
        // query — not its position within its own query. Using the per-query
        // index put query 2's series back on rows 0..n, on top of query 1's,
        // and left the categories they should have occupied permanently blank.
        // A two-query heatmap silently charted the wrong series against the
        // wrong labels.
        const rowIndex = seriesNames.length - 1;

        queryData.timestamps.forEach(([ts]) => {
          // The column is this timestamp's slot on the SHARED axis. The
          // per-query loop index only agreed with it while every query reported
          // the identical grid; when one query started late or stepped
          // differently, its samples were drawn in another query's columns.
          const timeIndex = columnOfTs.get(String(ts));
          if (timeIndex === undefined) return;

          const value = parseFloat(seriesData.data[ts] ?? "0");
          data.push([timeIndex, rowIndex, value]);

          if (value > maxValue) maxValue = value;
          if (value < minValue) minValue = value;
        });
      });
    });

    const visualMapRange = visualMapRangeOf(minValue, maxValue);

    // Format timestamps to extract time portion (consistent with bar charts)
    const xAxisData = buildXAxisData(timeAxis);

    return {
      series: [
        {
          type: "heatmap",
          data,
          // Per-cell labels only while the grid is small enough to read them,
          // and chunked rendering when it is not — a `sum by (le) (rate(...))`
          // over a full-size panel is thousands of cells, and a text element +
          // a unit formatter per cell is what hangs the tab. See heatmapDefaults.
          ...heatmapLargeGridDefaults(data.length),
          label: heatmapValueLabel(data.length, (params: any) => {
            try {
              return (
                formatUnitValue(
                  getUnitValue(
                    params?.value?.[2],
                    config?.unit,
                    config?.unit_custom,
                    config?.decimals,
                  ),
                ) || params?.value?.[2]
              );
            } catch (error) {
              return params?.value?.[2]?.toString() ?? "";
            }
          }),
          // Shared heatmap defaults, so a heatmap looks the same wherever it
          // is drawn (see heatmapDefaults.ts).
          itemStyle: heatmapCellItemStyle(store),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
      xAxis: [
        {
          type: "category",
          data: xAxisData,
          splitArea: HEATMAP_SPLIT_AREA,
        },
      ],
      yAxis: {
        type: "category",
        data: seriesNames,
        splitArea: HEATMAP_SPLIT_AREA,
        axisLabel: {
          overflow: "truncate",
          width: config.axis_width || 150,
        },
      },
      visualMap: {
        ...visualMapRange,
        calculable: true,
        orient: "horizontal",
        left: "center",
        inRange: {
          color: HEATMAP_VISUAL_MAP_COLORS,
        },
      },
      tooltip: {
        position: "top",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        enterable: true,
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: (params: any) => {
          try {
            const seriesName =
              seriesNames[params?.value[1]] || params?.seriesName;
            const value =
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  config?.unit,
                  config?.unit_custom,
                  config?.decimals,
                ),
              ) || params?.value?.[2];
            return `${seriesName} <br/> ${params?.marker} ${params?.name} : ${value}`;
          } catch (error) {
            return "";
          }
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: 60,
        containLabel: true,
      },
    };
  }

  /**
   * Prometheus classic-histogram heatmap.
   *
   * Assumes each series is one cumulative bucket of a classic histogram
   * (typically `sum by(le) (rate(x_bucket[W]))`). The cumulative buckets are
   * de-accumulated into per-bucket values, and the y-axis becomes the sorted
   * `le` bounds rather than raw series names.
   */
  private convertHistogram(
    processedData: ProcessedPromQLData[],
    config: any,
    store: any,
    extras: any,
  ) {
    // De-accumulate PER QUERY, then concatenate.
    //
    // Flattening every query's series into one list first was wrong: the bucket
    // set is keyed on `le`, and `deaccumulateHistogramSeries` sorts by `le` and
    // de-duplicates. Two histograms in one panel therefore had their buckets
    // interleaved — a second histogram's `le="0.5"` was either discarded as a
    // duplicate of the first's, or subtracted from it as though it were the next
    // bucket up. Each query is its own cumulative histogram and must be
    // de-accumulated on its own.
    const buckets = processedData.flatMap((queryData) => {
      const inputs: HistogramSeriesInput[] = (queryData.series ?? []).map(
        (seriesData) => ({
          le: extractLeLabel(seriesData),
          data: seriesData.data ?? {},
        }),
      );
      return deaccumulateHistogramSeries(inputs);
    });

    // Y-axis categories: formatted bucket bounds, in ascending le order.
    // Formatting can collapse two distinct bounds onto the same label (e.g.
    // rounding), and ECharts category axes need unique names, so disambiguate
    // collisions with the raw le value.
    const usedLabels = new Set<string>();
    const bucketLabels: string[] = buckets.map((bucket) => {
      const base = formatBucketLabel(bucket.le, bucket.leValue, config);

      // ECharts category axes need UNIQUE names, and there are two ways to collide:
      // formatting can round two different bounds onto the same label, and — since
      // each query is now de-accumulated separately — two histograms in one panel
      // can carry the identical `le`. The old single-step fallback appended the raw
      // `le`, which does not disambiguate the second case at all (both are "0.5")
      // and still collides for a third series. Keep widening until it is unique.
      let label = base;
      if (usedLabels.has(label)) label = `${base} (${bucket.le})`;
      for (let n = 2; usedLabels.has(label); n++) {
        label = `${base} (${bucket.le}) #${n}`;
      }

      usedLabels.add(label);
      return label;
    });

    bucketLabels.forEach((label) => extras.legends.push(label));

    // Every query's timestamps, not just the first query's — the buckets above
    // were flat-mapped across ALL of them, and looking their samples up against
    // one query's grid is what dropped them.
    const timestamps = buildTimeAxis(processedData);

    const data: any[] = [];
    let maxValue = -Infinity;
    let minValue = Infinity;

    buckets.forEach((bucket, bucketIndex) => {
      timestamps.forEach(([ts], timeIndex) => {
        const value = bucket.data[String(ts)] ?? 0;
        data.push([timeIndex, bucketIndex, value]);
        if (value > maxValue) maxValue = value;
        if (value < minValue) minValue = value;
      });
    });

    // De-accumulated bucket counts are clamped at zero, so this resolves to the
    // same [0, max] it always did. It goes through the shared helper anyway, so
    // that the empty-data case (no cells at all) is handled in one place rather
    // than by a `maxValue` that silently starts life as a legitimate value.
    const visualMapRange = visualMapRangeOf(minValue, maxValue);

    const xAxisData = buildXAxisData(timestamps);

    return {
      series: [
        {
          type: "heatmap",
          data,
          // Dense by construction: chunk the render and skip the animation once
          // the grid gets big.
          ...heatmapLargeGridDefaults(data.length),
          // Histogram heatmaps are far too dense for per-cell labels.
          label: {
            show: false,
          },
          itemStyle: heatmapCellItemStyle(store),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
      xAxis: [
        {
          type: "category",
          data: xAxisData,
          splitArea: HEATMAP_SPLIT_AREA,
        },
      ],
      yAxis: {
        type: "category",
        data: bucketLabels,
        splitArea: HEATMAP_SPLIT_AREA,
        axisLabel: {
          overflow: "truncate",
          width: config.axis_width || 150,
        },
      },
      visualMap: {
        ...visualMapRange,
        calculable: true,
        orient: "horizontal",
        left: "center",
        inRange: {
          color: HEATMAP_VISUAL_MAP_COLORS,
        },
      },
      tooltip: {
        position: "top",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        enterable: true,
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: (params: any) => {
          try {
            const bucketLabel =
              bucketLabels[params?.value?.[1]] ?? params?.seriesName;
            // config.unit remains the CELL INTENSITY unit (e.g. count/s).
            const value =
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  config?.unit,
                  config?.unit_custom,
                  config?.decimals,
                ),
              ) || params?.value?.[2];
            return `le ${bucketLabel} <br/> ${params?.marker} ${params?.name} : ${value}`;
          } catch (error) {
            return "";
          }
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: 60,
        containLabel: true,
      },
    };
  }
}
