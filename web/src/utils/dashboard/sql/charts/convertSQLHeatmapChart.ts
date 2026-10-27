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

import { toZonedTime } from "date-fns-tz";
import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { formatDate, isTimeSeries } from "../../dateTimeUtils";
import { getDataValue } from "../../aliasUtils";
import { getFieldLabel } from "../../fieldLabel";
import { chartColor } from "@/utils/chartTheme";
import { type SQLContext } from "../shared/types";
import {
  HEATMAP_MAX_CELLS,
  HEATMAP_SPLIT_AREA,
  addHeatmapWarning,
  cutHeatmapToBudget,
  heatmapBudgetWarning,
  heatmapCellItemStyle,
  heatmapColorRange,
  heatmapColorScale,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
  visualMapRangeOf,
} from "@/utils/dashboard/heatmapDefaults";
import {
  fillHeatmapYBuckets,
  heatmapYBucketInRange,
  heatmapYBucketLabel,
  heatmapYBucketing,
  isHeatmapYBucketLowerBound,
  isPlainYField,
  sortHeatmapCategories,
  type HeatmapYBucketing,
} from "@/utils/dashboard/heatmapYAxis";
import { applyHeatmapTimePointer, sqlHeatmapTimeAxis } from "@/utils/dashboard/heatmapTimeAxis";
import { escapeHtml } from "@/utils/html";
import { spansStreamLifetime } from "@/utils/dashboard/streamLifetime";
import { gt } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

/**
 * Applies chart-specific options for: heatmap
 *
 * Mutates `ctx.options` in place.
 */
export function applyHeatmapChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    searchQueryData,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    hoveredSeriesState,
    defaultSeriesProps,
  } = ctx;

  const key0 = xAxisKeys[0];
  const key1 = yAxisKeys[0];
  const yAxisKey0 = zAxisKeys[0];
  const rows: any[] = searchQueryData[0] ?? [];

  // Tiles of a multi-query panel share one budget, which convertMultiSQLData splits between them.
  const budget = panelSchema?.heatmapCellBudget ?? HEATMAP_MAX_CELLS;
  const histogramField = histogramTimeField(panelSchema, store);
  const { columns: allColumns, timesMs: columnTimesMs } = fillHistogramColumns(
    distinctValues(rows, key0),
    histogramField ? ctx : null,
    budget,
  );
  const yBucketing = builderYBucketing(panelSchema, rows, key1);
  const allRows = orderYValues(distinctValues(rows, key1), yBucketing, panelSchema?.config);

  const { lookup, duplicates } = buildCellLookup(rows, key1, key0);
  if (duplicates > 0) {
    addHeatmapWarning(
      ctx.extras,
      gt("dashboard.utils.heatmapDuplicateCells", { count: addCommasToNumber(duplicates) }),
    );
  }

  // Checked before the grid exists, so an oversized result never allocates its full matrix.
  const cut = cutHeatmapToBudget(
    allColumns.length,
    allRows.map((yValue) => rowTotal(lookup.get(yValue), yAxisKey0)),
    budget,
    !!yBucketing,
  );
  if (cut) {
    addHeatmapWarning(ctx.extras, heatmapBudgetWarning(cut, allColumns.length, allRows.length));
  }
  let xAxisZerothPositionUniqueValue: any[] = cut ? allColumns.slice(cut.firstColumn) : allColumns;
  const xAxisFirstPositionUniqueValue: any[] = cut
    ? cut.rows.map((index) => allRows[index])
    : allRows;
  // Drilldowns read the raw row value, not its "(empty)" or range label.
  if (ctx.extras) ctx.extras.heatmapRowValues = [xAxisFirstPositionUniqueValue];
  if (columnTimesMs) {
    ctx.extras.heatmapTimeAxis = sqlHeatmapTimeAxis(
      cut ? columnTimesMs.slice(cut.firstColumn) : columnTimesMs,
      Number(ctx.resultMetaData?.[0]?.histogram_interval) * 1000,
      queryRangeMs(ctx),
      store.state.timezone,
    );
  }

  const heatmapCells: any[] = [];
  let minValue = Infinity;
  let maxValue = -Infinity;
  xAxisFirstPositionUniqueValue.forEach((yAxisValue: any, rowIndex: number) => {
    const rowCells = lookup.get(yAxisValue);
    xAxisZerothPositionUniqueValue.forEach((xAxisValue: any, columnIndex: number) => {
      const value = cellValue(rowCells?.get(xAxisValue), yAxisKey0);
      heatmapCells.push([columnIndex, rowIndex, value]);
      const numeric = value === "-" ? NaN : Number(value);
      if (Number.isFinite(numeric)) {
        if (numeric < minValue) minValue = numeric;
        if (numeric > maxValue) maxValue = numeric;
      }
    });
  });

  const { color, ...colorRange } = heatmapColorScale(
    panelSchema?.config,
    heatmapColorRange(panelSchema?.config, visualMapRangeOf(minValue, maxValue)),
    [heatmapCells],
  );
  ((options.visualMap = {
    ...colorRange,
    calculable: true,
    orient: "horizontal",
    left: "center",
    inRange: { color },
  }),
    (options.series = [
      {
        ...defaultSeriesProps,
        name: getFieldLabel(
          panelSchema?.queries[0]?.fields?.z[0],
          panelSchema?.config,
          panelSchema?.queries[0]?.customQuery,
        ),
        // Without a cell border a dense heatmap collapses into solid bands.
        itemStyle: heatmapCellItemStyle(store),

        data: heatmapCells,
        // Per-cell labels only while the grid is small enough to read them, and
        // chunked rendering when it is not — a text element plus a unit
        // formatter per cell is what hangs the tab on a big grid. See
        // heatmapDefaults.
        ...heatmapLargeGridDefaults(heatmapCells.length),
        label: heatmapValueLabel(heatmapCells.length, (params: any) => {
          try {
            return (
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              ) || params?.value?.[2]
            );
          } catch (error) {
            return params?.value?.[2]?.toString() ?? "";
          }
        }),
      },
    ]));
  ((options.tooltip = {
    position: "top",
    textStyle: {
      color: chartColor("--color-tooltip-text"),
      fontSize: 12,
    },
    backgroundColor: chartColor("--color-tooltip-bg"),
    formatter: (params: any) => {
      try {
        // show tooltip for hovered panel only for other we only need axis so just return empty string
        if (
          hoveredSeriesState?.value &&
          panelSchema.id &&
          hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        // we have value[1] which return yaxis index
        // it is used to get y axis data
        const yLabel = options?.yAxis?.data[params?.value[1]] ?? params?.seriesName;
        const value =
          formatUnitValue(
            getUnitValue(
              params?.value?.[2],
              panelSchema?.config?.unit,
              panelSchema?.config?.unit_custom,
              panelSchema?.config?.decimals,
            ),
          ) || params?.value?.[2];
        return `${escapeHtml(yLabel)} <br/> ${params?.marker} ${escapeHtml(params?.name)} : ${escapeHtml(value)}`;
      } catch (error) {
        return "";
      }
    },
  }),
    (options.tooltip.axisPointer = {
      type: "cross",
      label: {
        fontsize: 12,
        precision: panelSchema.config?.decimals,
        backgroundColor: chartColor("--color-chart-crosshair-bg"),
      },
    }));
  if (panelSchema?.queries[0]?.customQuery == false) {
    if (histogramField) {
      xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map((it: any) =>
        formatDate(toZonedTime(it + "Z", store.state.timezone)),
      );
    }
  } else {
    const sample = xAxisZerothPositionUniqueValue.slice(
      0,
      Math.min(20, xAxisZerothPositionUniqueValue.length),
    );
    if (isTimeSeries(sample)) {
      xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map((it: any) =>
        formatDate(toZonedTime(it + "Z", store.state.timezone)),
      );
    }
  }

  options.grid.bottom = 60;
  ((options.xAxis = [
    {
      type: "category",
      data: xAxisZerothPositionUniqueValue.map(categoryLabel),
      splitArea: HEATMAP_SPLIT_AREA,
    },
  ]),
    [
      (options.yAxis = {
        type: "category",
        data: xAxisFirstPositionUniqueValue.map((value) =>
          yBucketing ? heatmapYBucketLabel(value, yBucketing.bucket) : categoryLabel(value),
        ),
        splitArea: HEATMAP_SPLIT_AREA,
      }),
    ]);
  options.legend.show = false;
  // A y pointer label snaps independently of the hovered cell, so only the tooltip names the row.
  if (ctx.extras?.heatmapTimeAxis) applyHeatmapTimePointer(options);
  else options.yAxis.axisPointer = { label: { show: false } };
}

function categoryLabel(value: any): any {
  return value === "" ? gt("dashboard.utils.heatmapEmptyCategory") : value;
}

/** The builder's y bucketing when it applies to these rows: a bare y column whose every value came back as one of its bucket lower bounds. */
function builderYBucketing(panelSchema: any, rows: any[], yKey: string): HeatmapYBucketing | null {
  const query = panelSchema?.queries?.[0];
  if (query?.customQuery !== false || !isPlainYField(query?.fields?.y?.[0])) return null;
  const bucketing = heatmapYBucketing(panelSchema?.config);
  if (!bucketing) return null;
  for (const row of rows) {
    const value = getDataValue(row, yKey);
    if (value === null || value === undefined) continue;
    if (typeof value !== "number" || !isHeatmapYBucketLowerBound(value, bucketing.bucket)) {
      return null;
    }
  }
  return bucketing;
}

/** Y values in `heatmap_y_sort` order; bucket lower bounds are kept to the y range, gaps filled with empty buckets, and read ascending unless sorted descending. */
function orderYValues(values: any[], bucketing: HeatmapYBucketing | null, config: any): any[] {
  if (!bucketing) return sortHeatmapCategories(values, (value) => value, config?.heatmap_y_sort);
  const kept = values.filter((value) =>
    heatmapYBucketInRange(value, bucketing.bucket, bucketing.range),
  );
  return sortHeatmapCategories(
    fillHeatmapYBuckets(kept, bucketing.bucket, HEATMAP_MAX_CELLS),
    (value) => value,
    config?.heatmap_y_sort === "desc" ? "desc" : "asc",
  );
}

/** Distinct values of `key` in first-seen order; 0 and "" are real categories, only null/undefined are dropped. */
function distinctValues(rows: any[], key: string): any[] {
  const values = new Set<any>();
  for (const row of rows) {
    const value = getDataValue(row, key);
    if (value !== null && value !== undefined) values.add(value);
  }
  return [...values];
}

/** Rows keyed y then x (first row wins), so values containing any separator cannot collide. */
function buildCellLookup(
  rows: any[],
  yKey: string,
  xKey: string,
): { lookup: Map<any, Map<any, any>>; duplicates: number } {
  const lookup = new Map<any, Map<any, any>>();
  let duplicates = 0;
  for (const row of rows) {
    const yValue = getDataValue(row, yKey);
    const xValue = getDataValue(row, xKey);
    if (yValue === null || yValue === undefined || xValue === null || xValue === undefined) {
      continue;
    }
    let cells = lookup.get(yValue);
    if (!cells) {
      cells = new Map();
      lookup.set(yValue, cells);
    }
    if (cells.has(xValue)) duplicates++;
    else cells.set(xValue, row);
  }
  return { lookup, duplicates };
}

function cellValue(row: any, zKey: string): any {
  if (!row) return "-";
  const value = getDataValue(row, zKey);
  return value === null || value === undefined || value === "" ? "-" : value;
}

/** A row's weight for the cell budget: its summed magnitude, so strongly negative rows rank as strong. */
function rowTotal(cells: Map<any, any> | undefined, zKey: string): number {
  let total = 0;
  cells?.forEach((row) => {
    const value = Number(getDataValue(row, zKey));
    if (Number.isFinite(value)) total += Math.abs(value);
  });
  return total;
}

/** The builder x field when it is `histogram(<timestamp column>)`, else undefined. */
function histogramTimeField(panelSchema: any, store: any): any {
  if (panelSchema?.queries?.[0]?.customQuery != false) return undefined;
  return panelSchema.queries[0].fields?.x?.find(
    (it: any) =>
      it.functionName == "histogram" &&
      it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
  );
}

function queryRangeMs(ctx: SQLContext): [number, number] {
  if (spansStreamLifetime(ctx?.panelSchema)) return [NaN, NaN];
  return [
    Number(ctx?.metadata?.queries?.[0]?.startTime) / 1000,
    Number(ctx?.metadata?.queries?.[0]?.endTime) / 1000,
  ];
}

/** Histogram x values sorted by time, plus an empty column per missing bucket in the query range, with each column's epoch ms; unchanged and without times when any input is unknown. */
function fillHistogramColumns(
  columns: any[],
  ctx: SQLContext | null,
  maxColumns: number,
): { columns: any[]; timesMs: number[] | null } {
  const unchanged = { columns, timesMs: null };
  if (!ctx) return unchanged;
  const intervalMs = Number(ctx.resultMetaData?.[0]?.histogram_interval) * 1000;
  const [startMs, endMs] = queryRangeMs(ctx);
  if (!(intervalMs > 0) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return unchanged;
  if (!columns.length || endMs < startMs) return unchanged;

  const byTime = new Map<number, any>();
  let newest = -Infinity;
  for (const value of columns) {
    const ms = Date.parse(String(value).endsWith("Z") ? String(value) : `${value}Z`);
    if (!Number.isFinite(ms)) return unchanged;
    if (!byTime.has(ms)) byTime.set(ms, value);
    if (ms > newest) newest = ms;
  }

  // Buckets are labelled by their start, so the first one may begin before the range does.
  const anchor = byTime.keys().next().value as number;
  let first = anchor - Math.ceil((anchor - startMs) / intervalMs) * intervalMs;
  let last = anchor + Math.floor((endMs - anchor) / intervalMs) * intervalMs;
  if ((last - first) / intervalMs + 1 > maxColumns) {
    // Ending the window at the newest returned bucket keeps data that lies early in a long range on screen.
    last = Math.min(last, Math.max(newest, first + (maxColumns - 1) * intervalMs));
    first = last - (maxColumns - 1) * intervalMs;
  }
  for (let ms = first; ms <= last; ms += intervalMs) {
    if (!byTime.has(ms)) byTime.set(ms, new Date(ms).toISOString().slice(0, 19));
  }
  const sorted = [...byTime.entries()].sort(([a], [b]) => a - b);
  return { columns: sorted.map(([, value]) => value), timesMs: sorted.map(([ms]) => ms) };
}
