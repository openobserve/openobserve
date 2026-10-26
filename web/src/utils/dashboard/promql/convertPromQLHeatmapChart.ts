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
  ConversionContext,
  PromQLChartConverter,
  ProcessedPromQLData,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import {
  deaccumulateHistogramSeries,
  groupHistogramSeries,
  HistogramSeriesOutput,
} from "./shared/histogramBuckets";
import { formatTimestamps } from "./shared/dataProcessor";
import { formatDate } from "../dateTimeUtils";
import {
  HEATMAP_MAX_CELLS,
  HEATMAP_SPLIT_AREA,
  addHeatmapWarning,
  cutHeatmapToBudget,
  cutHistogramsToBudget,
  heatmapAxisLine,
  heatmapBudgetWarning,
  heatmapCellItemStyle,
  heatmapColorRange,
  heatmapColorScale,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
  histogramBudgetWarnings,
  visualMapRangeOf,
} from "../heatmapDefaults";
import { sortHeatmapCategories } from "../heatmapYAxis";
import {
  applyHeatmapTimePointer,
  heatmapZoomToolbox,
  promqlHeatmapTimeAxis,
} from "../heatmapTimeAxis";
import type { HeatmapExemplarGroup, HeatmapExemplarLayout } from "../exemplars/heatmapExemplars";
import { gt } from "@/types/i18n";

/**
 * Opt-in heatmap mode that treats the queried series as the cumulative buckets
 * of a Prometheus classic histogram (`sum by(le) (rate(x_bucket[W]))`).
 */
export const PROMETHEUS_HISTOGRAM_MODE = "prometheus_histogram";

const STACK_TITLE_PX = 20;

const STACK_BOTTOM_PX = 60;

const STACK_GAP_PCT = 2;

const UNMEASURED_PANEL_PX = 400;

interface PromQLTimeGrid {
  startSec: number;
  endSec: number;
  stepSec: number;
}

interface HeatmapGrid {
  data: any[];
  rows: number[];
  timeAxis: Array<[any, any]>;
  min: number;
  max: number;
}

interface HeatmapCells {
  data: any[];
  min: number;
  max: number;
}

interface HistogramGroupBuckets {
  label: string;
  source: Omit<HeatmapExemplarGroup, "bounds"> | null;
  buckets: HistogramSeriesOutput[];
}

interface HistogramGrid {
  label: string;
  bucketLabels: string[];
  data: any[];
}

/**
 * The X axis for a heatmap: every timestamp any query reported, ascending.
 *
 * A union rather than `processedData[0].timestamps`: if the first query returned
 * no data the axis would be empty (blank panel), and if two queries land on
 * different grids, later samples get looked up against query 0's timestamps and
 * read as 0. The union degrades to the truth instead of to blankness.
 */
function buildTimeAxis(
  processedData: ProcessedPromQLData[],
  grid?: PromQLTimeGrid | null,
  timezone?: string,
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

  if (grid && byTs.size > 0) {
    const missing = new Set<number>();
    for (const ts of gridTimestamps(Number(byTs.keys().next().value), grid)) {
      if (!byTs.has(String(ts))) missing.add(ts);
    }
    for (const entry of formatTimestamps(missing, timezone ?? "UTC")) {
      byTs.set(String(entry[0]), entry);
    }
  }

  return [...byTs.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

/** Every evaluation instant of `grid` on the step lattice through `anchor`, capped to the cell budget's column count. */
function gridTimestamps(anchor: number, grid: PromQLTimeGrid): number[] {
  const { startSec, endSec, stepSec } = grid;
  let first = anchor - Math.floor((anchor - startSec) / stepSec) * stepSec;
  const last = anchor + Math.floor((endSec - anchor) / stepSec) * stepSec;
  if ((last - first) / stepSec + 1 > HEATMAP_MAX_CELLS) {
    first = last - (HEATMAP_MAX_CELLS - 1) * stepSec;
  }
  const timestamps: number[] = [];
  for (let ts = first; ts <= last; ts += stepSec) timestamps.push(ts);
  return timestamps;
}

function timeGridOf(context?: ConversionContext): PromQLTimeGrid | null {
  const startSec = Number(context?.metadata?.queries?.[0]?.startTime) / 1_000_000;
  const endSec = Number(context?.metadata?.queries?.[0]?.endTime) / 1_000_000;
  const stepSec = Number(context?.stepSeconds);
  if (!(stepSec > 0) || !Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;
  return endSec >= startSec ? { startSec, endSec, stepSec } : null;
}

/** The summed magnitude of a series' samples, which ranks its row for the cell budget so strongly negative rows count as strong. */
function sampleMagnitude(data: Record<string, unknown>): number {
  let total = 0;
  for (const raw of Object.values(data ?? {})) {
    const value = sampleValue(raw);
    if (value !== "-") total += Math.abs(value);
  }
  return total;
}

/** A sample as a cell value; a missing or non-numeric sample is an empty cell, never 0. */
function sampleValue(raw: unknown): number | "-" {
  if (raw === null || raw === undefined || raw === "") return "-";
  const value = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(value) ? value : "-";
}

/** The cells of a `rowCount` x `timeAxis` grid, cut to the cell budget before any cell is allocated. */
function buildHeatmapGrid(
  rowTotals: number[],
  timeAxis: Array<[any, any]>,
  valueAt: (row: number, ts: any) => number | "-",
  extras: any,
): HeatmapGrid {
  const cut = cutHeatmapToBudget(timeAxis.length, rowTotals);
  if (cut) addHeatmapWarning(extras, heatmapBudgetWarning(cut, timeAxis.length, rowTotals.length));
  const rows = cut ? cut.rows : rowTotals.map((_total, row) => row);
  const keptAxis = cut ? timeAxis.slice(cut.firstColumn) : timeAxis;
  return { ...fillHeatmapCells(rows, keptAxis, valueAt), rows, timeAxis: keptAxis };
}

function fillHeatmapCells(
  rows: number[],
  timeAxis: Array<[any, any]>,
  valueAt: (row: number, ts: any) => number | "-",
): HeatmapCells {
  const data: any[] = [];
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((row, rowIndex) => {
    timeAxis.forEach(([ts], timeIndex) => {
      const value = valueAt(row, ts);
      data.push([timeIndex, rowIndex, value]);
      if (value === "-") return;
      if (value > max) max = value;
      if (value < min) min = value;
    });
  });
  return { data, min, max };
}

/** Each query's histograms, split by their non-`le` labels and de-accumulated on their own, in query order; titles name the query once there are several. */
function histogramGroupsOf(processedData: ProcessedPromQLData[]): HistogramGroupBuckets[] {
  return processedData.flatMap((queryData, queryPosition) =>
    groupHistogramSeries(queryData.series ?? []).map((group) => ({
      label: [
        [
          processedData.length > 1
            ? gt("common.queryNumber", { index: (queryData.queryIndex ?? queryPosition) + 1 })
            : "",
          group.label,
        ]
          .filter(Boolean)
          .join(", "),
        queryData.nameSuffix ? `(${queryData.nameSuffix})` : "",
      ]
        .filter(Boolean)
        .join(" "),
      source:
        queryData.seriesRole === "shifted"
          ? null
          : { queryIndex: queryData.queryIndex ?? queryPosition, labels: group.labels },
      buckets: deaccumulateHistogramSeries(
        group.series.map((seriesData) => ({
          le: extractLeLabel(seriesData),
          data: seriesData.data ?? {},
        })),
      ),
    })),
  );
}

/** The sum of every bucket of a histogram, which ranks it against the others for the cell budget. */
function histogramTotal(group: HistogramGroupBuckets): number {
  let total = 0;
  for (const bucket of group.buckets) {
    for (const value of Object.values(bucket.data)) total += value;
  }
  return total;
}

/** Y-axis labels for a histogram's buckets in ascending `le` order, widened until unique as ECharts category axes require. */
function uniqueBucketLabels(buckets: HistogramSeriesOutput[], config: any): string[] {
  const usedLabels = new Set<string>();
  return buckets.map((bucket) => {
    const base = formatBucketLabel(bucket.le, bucket.leValue, config);
    let label = base;
    if (usedLabels.has(label)) label = `${base} (${bucket.le})`;
    for (let n = 2; usedLabels.has(label); n++) {
      label = `${base} (${bucket.le}) #${n}`;
    }
    usedLabels.add(label);
    return label;
  });
}

function stackedGridLayout(
  count: number,
  heightPx: number,
): Array<{ titleTop: number; gridTop: number; height: number }> {
  const titlePct = (STACK_TITLE_PX / heightPx) * 100;
  const slot = (100 - (STACK_BOTTOM_PX / heightPx) * 100) / count;
  return Array.from({ length: count }, (_unused, index) => ({
    titleTop: index * slot,
    gridTop: index * slot + titlePct,
    height: Math.max(slot - titlePct - STACK_GAP_PCT, 1),
  }));
}

/** The heatmap series for one histogram grid; `cellCount` is the whole chart's, which decides chunked rendering. */
function histogramSeries(data: any[], cellCount: number, store: any): any {
  return {
    type: "heatmap",
    data,
    ...heatmapLargeGridDefaults(cellCount),
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
  };
}

function histogramVisualMap(
  config: any,
  range: { min: number; max: number },
  grids: HistogramGrid[],
): any {
  const { color, ...scaledRange } = heatmapColorScale(
    config,
    range,
    grids.map((grid) => grid.data),
  );
  return {
    ...scaledRange,
    calculable: true,
    orient: "horizontal",
    left: "center",
    inRange: { color },
  };
}

/** The histogram tooltip; `rowTitle` names the hovered cell's row, as HTML-safe text. */
function histogramTooltip(config: any, rowTitle: (params: any) => string): any {
  return {
    position: "top",
    // Rendered into <body> so the panel's overflow does not clip it.
    appendToBody: true,
    // ChartRenderer's mouseleave skips this class, so entering the tooltip does not reset every panel's hover.
    className: "o2-echarts-tooltip",
    textStyle: {
      color: chartColor("--color-tooltip-text"),
      fontSize: 12,
    },
    enterable: true,
    backgroundColor: chartColor("--color-tooltip-bg"),
    extraCssText: TOOLTIP_SCROLL_STYLE,
    formatter: (params: any) => {
      try {
        // config.unit remains the CELL INTENSITY unit (e.g. count/s).
        const value =
          formatUnitValue(
            getUnitValue(params?.value?.[2], config?.unit, config?.unit_custom, config?.decimals),
          ) || params?.value?.[2];
        return `${rowTitle(params)} <br/> ${params?.marker} ${escapeHtml(params?.name)} : ${escapeHtml(value)}`;
      } catch (error) {
        return "";
      }
    },
  };
}

/** A single histogram grid, the layout every one-histogram panel has always had. */
function singleHistogramOptions(
  grid: HistogramGrid,
  xAxisData: string[],
  visualMapRange: { min: number; max: number },
  config: any,
  store: any,
): any {
  return {
    series: [histogramSeries(grid.data, grid.data.length, store)],
    xAxis: [
      {
        type: "category",
        data: xAxisData,
        splitArea: HEATMAP_SPLIT_AREA,
        ...heatmapAxisLine(config),
      },
    ],
    yAxis: {
      type: "category",
      data: grid.bucketLabels,
      splitArea: HEATMAP_SPLIT_AREA,
      ...heatmapAxisLine(config),
      axisLabel: {
        overflow: "truncate",
        width: config.axis_width || 150,
      },
    },
    visualMap: histogramVisualMap(config, visualMapRange, [grid]),
    tooltip: histogramTooltip(
      config,
      (params) => `le ${escapeHtml(grid.bucketLabels[params?.value?.[1]] ?? params?.seriesName)}`,
    ),
    grid: {
      left: "3%",
      right: "4%",
      bottom: 60,
      containLabel: true,
    },
  };
}

function stackedHistogramOptions(
  grids: HistogramGrid[],
  xAxisData: string[],
  visualMapRange: { min: number; max: number },
  config: any,
  store: any,
  heightPx: number,
): any {
  const layout = stackedGridLayout(grids.length, heightPx);
  const cellCount = grids.reduce((count, grid) => count + grid.data.length, 0);
  const last = grids.length - 1;
  return {
    title: grids.map((grid, index) => ({
      text: grid.label,
      top: `${layout[index].titleTop}%`,
      left: "3%",
      textStyle: { fontSize: 12, fontWeight: "bold" },
    })),
    grid: layout.map((cell) => ({
      left: "3%",
      right: "4%",
      top: `${cell.gridTop}%`,
      height: `${cell.height}%`,
      containLabel: true,
    })),
    xAxis: grids.map((_grid, index) => ({
      type: "category",
      gridIndex: index,
      data: xAxisData,
      splitArea: HEATMAP_SPLIT_AREA,
      ...heatmapAxisLine(config),
      // The grids share one time axis, so only the bottom one spends height on its labels.
      axisLabel: { show: index === last },
    })),
    yAxis: grids.map((grid, index) => ({
      type: "category",
      gridIndex: index,
      data: grid.bucketLabels,
      splitArea: HEATMAP_SPLIT_AREA,
      ...heatmapAxisLine(config),
      axisLabel: {
        overflow: "truncate",
        width: config.axis_width || 150,
      },
    })),
    series: grids.map((grid, index) => ({
      // Unnamed, so no legend entry overlaps the colour bar; each grid's title names it.
      ...histogramSeries(grid.data, cellCount, store),
      xAxisIndex: index,
      yAxisIndex: index,
    })),
    visualMap: histogramVisualMap(config, visualMapRange, grids),
    tooltip: histogramTooltip(config, (params) => {
      const grid = grids[params?.seriesIndex];
      const bucket = grid?.bucketLabels[params?.value?.[1]] ?? params?.seriesName;
      return `${escapeHtml(grid?.label ?? "")} <br/> le ${escapeHtml(bucket)}`;
    }),
  };
}

/** The calendar day of a formatted axis timestamp, in the zone it was formatted for. */
function dayOf(formatted: Date | string): string {
  if (formatted instanceof Date) {
    return `${formatted.getFullYear()}-${formatted.getMonth()}-${formatted.getDate()}`;
  }
  return String(formatted).slice(0, 10);
}

/** X labels: the time of day, or the full date and time when the axis spans more than one calendar day. */
function buildXAxisData(timestamps: Array<[any, any]>): string[] {
  const days = new Set((timestamps ?? []).map(([, formatted]) => dayOf(formatted)));
  const withDate = days.size > 1;
  return (
    timestamps?.map(([, formatted]) => {
      if (formatted instanceof Date) {
        return withDate ? formatDate(formatted) : formatDate(formatted).slice(11);
      }
      const dateStr = formatted.toString();
      const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
      if (match) return withDate ? `${match[1]} ${match[2]}` : match[2];
      return dateStr.match(/(\d{2}:\d{2}:\d{2})/)?.[1] ?? dateStr;
    }) || []
  );
}

/** True while another panel is hovered, when a synced tooltip shows only its axis pointer. */
function otherPanelHovered(extras: any, panelId: unknown): boolean {
  const state = extras?.hoveredSeriesState?.value;
  return !!(state && panelId && state.panelId != panelId);
}

function applyTimeInteraction(
  options: any,
  extras: any,
  panelId: unknown,
  timestamps: Array<[any, any]>,
  grid: PromQLTimeGrid | null,
  context: ConversionContext | undefined,
  store: any,
): any {
  const axis = promqlHeatmapTimeAxis(
    timestamps,
    grid?.stepSec ?? Number(context?.stepSeconds),
    grid?.startSec ?? Number(context?.metadata?.queries?.[0]?.startTime) / 1_000_000,
    store?.state?.timezone ?? "UTC",
  );
  extras.panelId = panelId;
  if (!axis) return options;
  extras.heatmapTimeAxis = axis;
  extras.isTimeSeries = true;
  options.toolbox = heatmapZoomToolbox();
  const formatter = options.tooltip?.formatter;
  options.tooltip = {
    ...options.tooltip,
    formatter: (params: any) => (otherPanelHovered(extras, panelId) ? "" : formatter?.(params)),
  };
  applyHeatmapTimePointer(options);
  return options;
}

/** Labels that identify a series' row, without the metric name a function result drops. */
function rowLabels(metric: Record<string, string> | undefined): Record<string, string> {
  const { __name__: _name, ...labels } = metric ?? {};
  return labels;
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
      getUnitValue(leValue, config?.bucket_unit, config?.bucket_unit_custom, config?.decimals),
    );
    return formatted || le;
  } catch (error) {
    return le;
  }
}

/**
 * Card-sized heatmap. The metrics explorer's preview cards are a few cm tall,
 * where the default colour bar and full-size axis labels swamp the plot (the
 * cells collapse to a thin line and only one bucket label survives). Shrinks the
 * visual map, thins the bucket labels — always keeping the top `+Inf` row — and
 * drops the font sizes. Mutates and returns `options`. Only run when the card
 * sets `config.compact_preview`.
 */
function applyCompactPreview(options: any): any {
  if (options.visualMap) {
    options.visualMap = {
      ...options.visualMap,
      show: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 90,
      precision: 2,
      textStyle: { fontSize: 9 },
    };
    if (!Array.isArray(options.grid))
      options.grid = { ...(options.grid ?? {}), top: 8, bottom: 48 };
  }

  for (const yAxis of Array.isArray(options.yAxis) ? options.yAxis : [options.yAxis]) {
    const rowCount = yAxis?.data?.length ?? 0;
    if (!yAxis || !rowCount) continue;
    // Thin the bucket labels to what a card can render, but ALWAYS keep the top
    // row: a histogram's `+Inf` bucket is the "everything slower than this" row,
    // and ECharts' hideOverlap would otherwise drop it. Count DOWN from the top
    // so `+Inf` is always labelled and the spacing stays even.
    const step = Math.max(1, Math.ceil(rowCount / 8));
    yAxis.axisLabel = {
      ...(yAxis.axisLabel ?? {}),
      fontSize: 9,
      width: 46,
      overflow: "truncate",
      hideOverlap: false,
      interval: (index: number) => (rowCount - 1 - index) % step === 0,
    };
  }

  for (const xAxis of Array.isArray(options.xAxis) ? options.xAxis : [options.xAxis]) {
    if (!xAxis) continue;
    xAxis.axisLabel = {
      ...(xAxis.axisLabel ?? {}),
      fontSize: 9,
      hideOverlap: true,
    };
  }

  return options;
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
    context?: ConversionContext,
  ) {
    const config = panelSchema.config || {};
    const grid = timeGridOf(context);

    // Opt-in only: Prometheus classic-histogram mode. Generic heatmaps keep
    // their existing behavior untouched.
    if (config?.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE) {
      return this.convertHistogram(
        processedData,
        panelSchema,
        store,
        extras,
        grid,
        chartPanelRef,
        context,
      );
    }

    // Rows span every query because per-query series indices overlap.
    const sourceOf = new Map<object, ProcessedPromQLData>();
    const allSeries = sortHeatmapCategories(
      processedData.flatMap((queryData) => {
        for (const series of queryData.series) sourceOf.set(series, queryData);
        return queryData.series;
      }),
      (series) => series.name,
      config?.heatmap_y_sort,
    );
    const {
      data,
      rows,
      timeAxis,
      min: minValue,
      max: maxValue,
    } = buildHeatmapGrid(
      allSeries.map((series) => sampleMagnitude(series.data)),
      buildTimeAxis(processedData, grid, store?.state?.timezone),
      (row, ts) => sampleValue(allSeries[row].data[ts]),
      extras,
    );
    const seriesNames = rows.map((row) => allSeries[row].name);
    seriesNames.forEach((name) => extras.legends.push(name));
    extras.heatmapExemplarLayout = {
      mode: "series",
      rows: rows.map((row) => {
        const source = sourceOf.get(allSeries[row]);
        if (!source || source.seriesRole === "shifted") return null;
        return { queryIndex: source.queryIndex, labels: rowLabels(allSeries[row].metric) };
      }),
    } satisfies HeatmapExemplarLayout;

    const { color, ...visualMapRange } = heatmapColorScale(
      config,
      heatmapColorRange(config, visualMapRangeOf(minValue, maxValue)),
      [data],
    );

    // Format timestamps to extract time portion (consistent with bar charts)
    const xAxisData = buildXAxisData(timeAxis);

    const options: any = {
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
          ...heatmapAxisLine(config),
        },
      ],
      yAxis: {
        type: "category",
        data: seriesNames,
        splitArea: HEATMAP_SPLIT_AREA,
        ...heatmapAxisLine(config),
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
          color,
        },
      },
      tooltip: {
        position: "top",
        // render into <body> so the tooltip is not clipped by the panel's
        // overflow — same container treatment as the other PromQL charts
        appendToBody: true,
        // ChartRenderer's mouseleave skips this class, so entering the tooltip does not reset every panel's hover.
        className: "o2-echarts-tooltip",
        textStyle: {
          color: chartColor("--color-tooltip-text"),
          fontSize: 12,
        },
        enterable: true,
        backgroundColor: chartColor("--color-tooltip-bg"),
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: (params: any) => {
          try {
            const seriesName = seriesNames[params?.value[1]] || params?.seriesName;
            const value =
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  config?.unit,
                  config?.unit_custom,
                  config?.decimals,
                ),
              ) || params?.value?.[2];
            return `${escapeHtml(seriesName)} <br/> ${params?.marker} ${escapeHtml(params?.name)} : ${escapeHtml(value)}`;
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

    applyTimeInteraction(options, extras, panelSchema.id, timeAxis, grid, context, store);
    return config?.compact_preview ? applyCompactPreview(options) : options;
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
    panelSchema: any,
    store: any,
    extras: any,
    grid: PromQLTimeGrid | null,
    chartPanelRef?: any,
    context?: ConversionContext,
  ) {
    const config = panelSchema.config || {};
    const groups = histogramGroupsOf(processedData);
    const timeAxis = buildTimeAxis(processedData, grid, store?.state?.timezone);

    const cut = cutHistogramsToBudget(
      timeAxis.length,
      groups.map((group) => group.buckets.length),
      groups.map(histogramTotal),
    );
    if (cut) {
      for (const warning of histogramBudgetWarnings(cut, timeAxis.length, groups.length)) {
        addHeatmapWarning(extras, warning);
      }
    }
    const kept = cut ? cut.groups.map((index) => groups[index]) : groups;
    const timestamps = cut ? timeAxis.slice(cut.firstColumn) : timeAxis;

    let minValue = Infinity;
    let maxValue = -Infinity;
    const grids: HistogramGrid[] = kept.map((group) => {
      const cells = fillHeatmapCells(
        group.buckets.map((_bucket, row) => row),
        timestamps,
        (row, ts) => sampleValue(group.buckets[row].data[String(ts)]),
      );
      minValue = Math.min(minValue, cells.min);
      maxValue = Math.max(maxValue, cells.max);
      return {
        label: group.label,
        bucketLabels: uniqueBucketLabels(group.buckets, config),
        data: cells.data,
      };
    });
    for (const histogram of grids) {
      for (const label of histogram.bucketLabels) extras.legends.push(label);
    }
    extras.heatmapExemplarLayout = {
      mode: "histogram",
      groups: kept.map((group) =>
        group.source
          ? { ...group.source, bounds: group.buckets.map((bucket) => bucket.leValue) }
          : null,
      ),
    } satisfies HeatmapExemplarLayout;

    // [0, max] for clamped counts, unless heatmaps drawn side by side share a range so colours compare.
    const visualMapRange = heatmapColorRange(
      config,
      config?.visual_map_range ?? visualMapRangeOf(minValue, maxValue),
    );
    const xAxisData = buildXAxisData(timestamps);

    const options =
      grids.length > 1
        ? stackedHistogramOptions(
            grids,
            xAxisData,
            visualMapRange,
            config,
            store,
            chartPanelRef?.value?.offsetHeight || UNMEASURED_PANEL_PX,
          )
        : singleHistogramOptions(
            grids[0] ?? { label: "", bucketLabels: [], data: [] },
            xAxisData,
            visualMapRange,
            config,
            store,
          );
    applyTimeInteraction(options, extras, panelSchema.id, timestamps, grid, context, store);
    return config?.compact_preview ? applyCompactPreview(options) : options;
  }
}
