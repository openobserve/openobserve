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

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
import { convertSQLChartData } from "./sql";
import { applySeriesColorMappings } from "./chartColorUtils";
import { calculateOptimalFontSize } from "./chartDimensionUtils";
import {
  calculateGridPositions,
  getTrellisGrid,
} from "./calculateGridForSubPlot";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

/**
 * Re-applies trellis layout on merged multi-query data.
 * Groups series by breakdown value (originalSeriesName) so that series from
 * different queries sharing the same breakdown category share a subplot.
 *
 * Mirrors the logic in trellisConfig.ts → updateTrellisConfig(), including
 * column-mode handling (vertical / custom / auto) and selective axis-label
 * visibility (only first-column y-labels, only last-row x-labels).
 */
function reapplyTrellisLayout(
  opts: any,
  panelSchema: any,
  chartPanelRef: any,
  chartPanelStyle: any,
) {
  try {
    const trellisConfig = panelSchema.config.trellis;
    const isHorizontalChart =
      panelSchema.type === "h-bar" || panelSchema.type === "h-stacked";

    // Column logic — matches trellisConfig.ts
    let customCols = -1;
    if (
      trellisConfig.layout === "custom" &&
      trellisConfig.num_of_columns > 0
    ) {
      customCols = trellisConfig.num_of_columns;
    }
    if (trellisConfig.layout === "vertical") {
      customCols = 1;
    }

    // Filter out annotation/markArea helper series
    const realSeries = (opts.series || []).filter(
      (s: any) => !(s.zlevel === 1 && s.markArea),
    );
    if (realSeries.length === 0) return;

    // Group series by breakdown value so multiple queries sharing the same
    // breakdown category land in the same subplot.
    const groups = new Map<string, any[]>();
    realSeries.forEach((series: any) => {
      const key = series.originalSeriesName || series.name || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(series);
    });

    const numGrids = groups.size;
    const gridData = getTrellisGrid(
      chartPanelRef.value.offsetWidth,
      chartPanelRef.value.offsetHeight,
      numGrids,
      0,
      customCols,
      panelSchema.config?.axis_width,
    );

    const gridNoOfCol = gridData.gridNoOfCol ?? 1;

    // Deep-clone helper (axis objects have nested axisLabel / nameTextStyle)
    const cloneObj = (o: any) => JSON.parse(JSON.stringify(o));

    // Capture base axis templates
    const baseXAxis = cloneObj(
      Array.isArray(opts.xAxis) ? opts.xAxis[0] : opts.xAxis,
    );
    const baseYAxis = cloneObj(
      Array.isArray(opts.yAxis) ? (opts.yAxis[0] ?? opts.yAxis) : opts.yAxis,
    );

    // Rebuild grid, axes, titles, series
    opts.grid = gridData.gridArray;
    opts.xAxis = [];
    opts.yAxis = [];
    opts.title = [];
    opts.series = [];

    let gridIdx = 0;
    groups.forEach((seriesList: any[], groupName: string) => {
      // Data series — all queries for this breakdown value share the subplot
      seriesList.forEach((series: any) => {
        opts.series.push({
          ...series,
          gridIndex: gridIdx,
          xAxisIndex: gridIdx,
          yAxisIndex: gridIdx,
          zlevel: 2,
        });
      });

      // Annotation placeholder
      opts.series.push({
        type: "line",
        xAxisIndex: gridIdx,
        yAxisIndex: gridIdx,
        gridIndex: gridIdx,
        data: [],
        zlevel: 1,
      });

      // --- xAxis for this subplot ---
      const xAxis = cloneObj(baseXAxis);
      xAxis.gridIndex = gridIdx;
      // Show x-axis labels only on the bottom row (or first column for h-charts)
      const showXLabel = isHorizontalChart
        ? gridIdx % gridNoOfCol === 0
        : gridIdx >= numGrids - gridNoOfCol;
      if (xAxis.axisLabel) xAxis.axisLabel.show = showXLabel;
      if (xAxis.axisTick) xAxis.axisTick.length = showXLabel ? 5 : 0;
      if (!showXLabel) {
        xAxis.name = "";
        xAxis.nameGap = 0;
      }
      opts.xAxis.push(xAxis);

      // --- yAxis for this subplot ---
      const yAxis = cloneObj(baseYAxis);
      yAxis.gridIndex = gridIdx;
      // Show y-axis labels only on the first column (or bottom row for h-charts)
      const showYLabel = isHorizontalChart
        ? gridIdx >= numGrids - gridNoOfCol
        : gridIdx % gridNoOfCol === 0;
      if (yAxis.axisLabel) {
        yAxis.axisLabel.show = showYLabel;
        yAxis.axisLabel.margin = showYLabel ? 5 : 0;
      }
      if (!showYLabel) {
        yAxis.name = "";
        yAxis.nameGap = 0;
      }
      opts.yAxis.push(yAxis);

      // --- Title label above this subplot ---
      if (gridData.gridArray[gridIdx]) {
        opts.title.push({
          text: groupName,
          textStyle: {
            fontSize: 12,
            width:
              parseFloat(gridData.gridArray[gridIdx].width) *
                (chartPanelRef.value.offsetWidth / 100) -
              8,
            overflow: "truncate",
            ellipsis: "...",
          },
          top:
            parseFloat(gridData.gridArray[gridIdx].top) -
            (20 / ((gridData.panelHeight as number) || 1)) * 100 +
            "%",
          left: gridData.gridArray[gridIdx].left,
        });
      }

      gridIdx++;
    });

    // Update panel height to fit all subplots
    if (gridData.panelHeight && chartPanelStyle) {
      chartPanelStyle.height = gridData.panelHeight + "px";
    }

    // Hide legend — trellis uses per-subplot titles
    if (opts.legend) {
      opts.legend.show = false;
    }
  } catch (err: any) {
    console.error("Trellis re-application on merged data failed:", err?.message);
  }
}

export const convertMultiSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
  loading?: any,
) => {
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    // this sets a blank object until it loads
    // because of this, it will go to UI and draw something, even 0 or a blank chart
    // this will give a sence of progress to the user
    searchQueryData = [[]];
  }

  // C1: loop on all search query data with per-query schema
  const options: any = [];
  const isMultiQuery = searchQueryData.length > 1;
  const isTrellis = !!panelSchema.config?.trellis?.layout;

  for (let i = 0; i < searchQueryData.length; i++) {
    // Get the original query index from metadata (handling time-shifts gracefully)
    const panelQueryIndex = metadata?.queries?.[i]?.panelQueryIndex ?? i;

    // Create a per-query schema view: set queries[0] to the current query
    // so contextBuilder.ts reads the correct query's fields.
    // When multi-query + trellis, disable trellis for individual conversions;
    // it will be re-applied on the merged result to avoid grid/axis conflicts.
    if (!panelSchema.queries[panelQueryIndex]) continue;
    const querySchema = {
      ...panelSchema,
      queries: [panelSchema.queries[panelQueryIndex]],
      ...(isMultiQuery && isTrellis
        ? { config: { ...panelSchema.config, trellis: undefined } }
        : {}),
    };

    options.push(
      await convertSQLData(
        querySchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        resultMetaData.value?.[i] ?? [],
        { queries: [metadata?.queries?.[i]] },
        chartPanelStyle,
        annotations,
        loading,
      ),
    );
  }

  const isAnnotationSeries = (series: any) => {
    // check if series name is available
    // if series name is not available then that is anotation series
    if (!series.name) return true;
  };

  const chartType = panelSchema.type;

  // Helper: build labeled name with promql_legend template + time shift suffix
  const buildLabeledName = (
    name: string,
    queryConfig: any,
    queryIndex: number,
    periodAsStr?: string,
  ) => {
    let labeled = name;

    // Apply template replacement if query_label is provided
    if (queryConfig?.query_label) {
      // Replace any {placeholder} with the generated series name
      labeled = queryConfig.query_label.replace(/\{[^}]+\}/g, name);
    }

    return periodAsStr ? `${labeled} (${periodAsStr})` : labeled;
  };

  // C5: Pie/Donut — merge data arrays into single series (not series concat)
  if (
    (chartType === "pie" || chartType === "donut") &&
    options.length > 1
  ) {
    const mergedData: any[] = [];

    options.forEach((opt: any, execIndex: number) => {
      const panelQueryIndex = metadata?.queries?.[execIndex]?.panelQueryIndex ?? execIndex;
      const queryConfig = panelSchema.queries[panelQueryIndex]?.config;

      opt?.options?.series?.[0]?.data?.forEach((d: any) => {
        const labeledName = buildLabeledName(
          d.name,
          queryConfig,
          execIndex,
        );
        mergedData.push({ ...d, name: labeledName });
      });
    });

    if (options[0]?.options?.series?.[0]) {
      options[0].options.series[0].data = mergedData;
    }

    applySeriesColorMappings(
      options[0]?.options?.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
    return options[0];
  }

  // C6: Metric — build grid so each query value occupies its own cell
  if (chartType === "metric" && options.length > 1) {
    if (!chartPanelRef?.value) return options[0];
    const allMetricSeries: any[] = [];
    options.forEach((opt: any) => {
      if (opt?.options?.series?.[0]) {
        allMetricSeries.push(opt.options.series[0]);
      }
    });

    const gridData = calculateGridPositions(
      chartPanelRef.value.offsetWidth,
      chartPanelRef.value.offsetHeight,
      allMetricSeries.length,
    );
    const isDark = store.state.theme === "dark";
    const longestText = allMetricSeries.reduce(
      (acc: string, s: any) =>
        (s._metricText ?? "").length > acc.length ? (s._metricText ?? "") : acc,
      "",
    );
    const sharedFontSize = calculateOptimalFontSize(
      longestText,
      gridData.gridWidth,
    );
    const labelFontSize = Math.max(
      11,
      Math.min(14, Math.round(gridData.gridWidth / 30)),
    );

    allMetricSeries.forEach((s: any, idx: number) => {
      const cell = gridData.gridArray[idx];
      const cx =
        ((parseFloat(cell.left) + parseFloat(cell.width) / 2) / 100) *
        chartPanelRef.value.offsetWidth;
      const cy =
        ((parseFloat(cell.top) + parseFloat(cell.height) / 2) / 100) *
        chartPanelRef.value.offsetHeight;
      const fill = s._metricFillColor ?? (isDark ? "#fff" : "#000");
      s.renderItem = () => {
        try {
          return {
            type: "group",
            children: [
              {
                type: "text",
                style: {
                  text: s._metricText ?? "",
                  fontSize: sharedFontSize,
                  fontWeight: 500,
                  align: "center",
                  verticalAlign: "middle",
                  x: cx,
                  y: cy - labelFontSize / 2 - 2,
                  fill,
                },
              },
              {
                type: "text",
                style: {
                  text: s._metricLabel ?? "",
                  fontSize: labelFontSize,
                  fontWeight: 400,
                  align: "center",
                  verticalAlign: "middle",
                  x: cx,
                  y: cy + sharedFontSize / 2 + 4,
                  fill,
                  opacity: 0.65,
                },
              },
            ],
          };
        } catch {
          return "";
        }
      };
    });

    options[0].options.series = allMetricSeries;
    return options[0];
  }

  // C6: Gauge — collect all dials and recalculate grid positions
  if (chartType === "gauge" && options.length > 1) {
    if (!chartPanelRef?.value) return options[0];
    const allSeries: any[] = [];
    options.forEach((opt: any) => {
      if (opt?.options?.series) {
        allSeries.push(...opt.options.series);
      }
    });
    const gridDataForGauge = calculateGridPositions(
      chartPanelRef.value.offsetWidth,
      chartPanelRef.value.offsetHeight,
      allSeries.length,
    );
    const minDim = Math.min(
      gridDataForGauge.gridWidth,
      gridDataForGauge.gridHeight,
    );

    allSeries.forEach((s: any, idx: number) => {
      const cell = gridDataForGauge.gridArray[idx];
      s.gridIndex = idx;
      s.center = [
        `${parseFloat(cell.left) + parseFloat(cell.width) / 2}%`,
        `${parseFloat(cell.top) + parseFloat(cell.height) / 2}%`,
      ];
      s.radius = `${minDim / 2 - 5}px`;
      if (s.progress) {
        s.progress.width = `${minDim / 6}`;
      }
      if (s.axisLine?.lineStyle) {
        s.axisLine.lineStyle.width = `${minDim / 6}`;
      }
      if (s.title) {
        s.title.width = `${gridDataForGauge.gridWidth}`;
      }
    });
    options[0].options.series = allSeries;
    applySeriesColorMappings(
      options[0].options.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
    return options[0];
  }

  // C7: Heatmap — render each query as an independent heatmap in its own grid cell
  if (chartType === "heatmap" && options.length > 1) {
    if (!chartPanelRef?.value) return options[0];
    // Reserve space at the bottom for the visualMap colour scale and legend.
    const VISUAL_MAP_HEIGHT = 80;
    const LEGEND_BOTTOM = 5;
    const VISUAL_MAP_BOTTOM = 38;
    const TITLE_HEIGHT_PX = 20;
    const containerHeight = chartPanelRef.value.offsetHeight;
    const usableHeight = Math.max(containerHeight - VISUAL_MAP_HEIGHT, 1);
    // Scale vertically so grid cells stay above the reserved bottom area.
    const heightScale = usableHeight / containerHeight;
    const titleHeightPct = (TITLE_HEIGHT_PX / containerHeight) * 100;

    const gridDataForHeatmap = calculateGridPositions(
      chartPanelRef.value.offsetWidth,
      usableHeight,
      options.length,
    );

    const allGrids: any[] = [];
    const allXAxes: any[] = [];
    const allYAxes: any[] = [];
    const allSeries: any[] = [];
    const allTitles: any[] = [];
    let globalMin = Infinity;
    let globalMax = -Infinity;

    // Gap between adjacent cells and horizontal padding from the container edge.
    const GAP = 1.5;
    const H_PAD = 2;

    options.forEach((opt: any, i: number) => {
      const cell = gridDataForHeatmap.gridArray[i];
      const left = H_PAD + (parseFloat(cell.left) / 100) * (100 - 2 * H_PAD);
      const rawTop = parseFloat(cell.top) * heightScale;
      const width = (parseFloat(cell.width) / 100) * (100 - 2 * H_PAD) - GAP;
      const height = parseFloat(cell.height) * heightScale - GAP;

      // containLabel keeps axis labels inside the cell boundary.
      allGrids.push({
        containLabel: true,
        left: `${left}%`,
        top: `${rawTop + titleHeightPct}%`,
        width: `${width}%`,
        height: `${Math.max(height - titleHeightPct, 1)}%`,
      });

      // xAxis is always an array in the single-query heatmap output.
      const srcXAxis = opt?.options?.xAxis?.[0];
      if (srcXAxis) allXAxes.push({ ...srcXAxis, gridIndex: i });

      // yAxis is always a plain object in the single-query heatmap output.
      const srcYAxis = opt?.options?.yAxis;
      if (srcYAxis) allYAxes.push({ ...srcYAxis, gridIndex: i });

      const srcSeries = opt?.options?.series?.[0];
      if (srcSeries) {
        const panelQueryIndex = metadata?.queries?.[i]?.panelQueryIndex ?? i;
        const queryConfig = panelSchema.queries[panelQueryIndex]?.config;
        const periodAsStr = metadata?.queries[i]?.timeRangeGap?.periodAsStr || "";
        const labeledName = buildLabeledName(srcSeries.name, queryConfig, panelQueryIndex, periodAsStr);

        allSeries.push({ ...srcSeries, xAxisIndex: i, yAxisIndex: i, name: labeledName });

        allTitles.push({
          text: labeledName,
          textStyle: {
            fontSize: 12,
            fontWeight: "bold",
            overflow: "truncate",
            ellipsis: "...",
            width: (width / 100) * chartPanelRef.value.offsetWidth - 8,
          },
          top: `${rawTop}%`,
          left: `${left}%`,
        });
      }

      const vm = opt?.options?.visualMap;
      if (vm) {
        if (typeof vm.min === "number") globalMin = Math.min(globalMin, vm.min);
        if (typeof vm.max === "number") globalMax = Math.max(globalMax, vm.max);
      }
    });

    options[0].options.grid = allGrids;
    options[0].options.xAxis = allXAxes;
    options[0].options.yAxis = allYAxes;
    options[0].options.series = allSeries;
    options[0].options.title = allTitles;

    // The single-query tooltip formatter closes over yAxis as a plain object;
    // in multi-query mode yAxis is an array, so we replace the formatter.
    options[0].options.tooltip = {
      ...(options[0].options.tooltip ?? {}),
      trigger: "item",
      formatter: (params: any) => {
        try {
          const yLabel =
            allYAxes[params.seriesIndex]?.data?.[params?.value?.[1]] ??
            params?.seriesName ??
            "";
          const rawVal = params?.value?.[2];
          const formatted =
            formatUnitValue(
              getUnitValue(
                rawVal,
                panelSchema?.config?.unit,
                panelSchema?.config?.unit_custom,
                panelSchema?.config?.decimals,
              ),
            ) || rawVal;
          return `${yLabel} <br/> ${params?.marker ?? ""} ${params?.name ?? ""} : ${formatted}`;
        } catch {
          return "";
        }
      },
    };

    if (options[0].options.visualMap) {
      options[0].options.visualMap.min = isFinite(globalMin) ? globalMin : 0;
      options[0].options.visualMap.max = isFinite(globalMax) ? globalMax : 0;
      options[0].options.visualMap.bottom = VISUAL_MAP_BOTTOM;
    }

    if (options[0].options.legend) {
      options[0].options.legend.show = true;
      options[0].options.legend.bottom = LEGEND_BOTTOM;
    }

    return options[0];
  }

  // C3: X-axis merge + reindex for time-series charts
  const needsXAxisMerge =
    options.length > 1 &&
    options[0]?.options?.xAxis?.[0]?.data &&
    !["pie", "donut", "metric", "gauge", "heatmap"].includes(chartType);

  if (needsXAxisMerge) {
    // Save each query's original xAxis BEFORE merging
    const originalXAxes = options.map(
      (opt: any) => [...(opt?.options?.xAxis?.[0]?.data || [])],
    );

    // Build merged xAxis (union of all queries' values)
    const mergedXAxisSet = new Set<any>();
    originalXAxes.forEach((xData: any[]) => {
      xData.forEach((v: any) => mergedXAxisSet.add(v));
    });

    // Sort: timestamps numerically, categorical strings alphabetically
    const mergedXAxis = Array.from(mergedXAxisSet).sort((a: any, b: any) =>
      typeof a === "number" ? a - b : String(a).localeCompare(String(b)),
    );

    // Optimization: skip reindexing if merged === original Q1 xAxis
    const q1Unchanged =
      mergedXAxis.length === originalXAxes[0].length &&
      mergedXAxis.every((v: any, idx: number) => v === originalXAxes[0][idx]);

    // Apply merged xAxis to result
    options[0].options.xAxis[0].data = mergedXAxis;

    // Reindex every query's series data to align with merged xAxis
    options.forEach((opt: any, queryIdx: number) => {
      if (queryIdx === 0 && q1Unchanged) return;

      const originalXAxis = originalXAxes[queryIdx];
      if (!originalXAxis?.length) return;

      // Build value→mergedIndex lookup
      const valueToMergedIdx = new Map<any, number>();
      mergedXAxis.forEach((val: any, idx: number) =>
        valueToMergedIdx.set(val, idx),
      );

      // Reindex each series' data array
      opt?.options?.series?.forEach((series: any) => {
        if (!Array.isArray(series.data)) return;
        const newData = new Array(mergedXAxis.length).fill(null);
        series.data.forEach((val: any, origIdx: number) => {
          const mergedIdx = valueToMergedIdx.get(originalXAxis[origIdx]);
          if (mergedIdx !== undefined) newData[mergedIdx] = val;
        });
        series.data = newData;
      });
    });
  }

  // C2: Series labeling + C4: Stack collision fix — apply to ALL queries when multi-query
  if (options && options.length > 1 && options[0]?.options) {
    // Label Q1 series
    if (options[0].options.series) {
      const pIdx0 = metadata?.queries?.[0]?.panelQueryIndex ?? 0;
      const q1Config = panelSchema.queries[pIdx0]?.config;
      const q1Period =
        metadata?.queries[0]?.timeRangeGap?.periodAsStr || "";

      options[0].options.series = options[0].options.series.map(
        (it: any) => {
          if (isAnnotationSeries(it)) return it;
          return {
            ...it,
            name: buildLabeledName(it.name, q1Config, pIdx0, q1Period),
            _queryIndex: 0,
          };
        },
      );
    }

    // Label + merge Q2+ series
    for (let i = 1; i < options.length; i++) {
      if (options[i]?.options?.series) {
        const panelQueryIndex = metadata?.queries?.[i]?.panelQueryIndex ?? i;
        const qConfig = panelSchema.queries[panelQueryIndex]?.config;
        const periodAsStr =
          metadata?.queries[i]?.timeRangeGap?.periodAsStr || "";

        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: buildLabeledName(it.name, qConfig, panelQueryIndex, periodAsStr),
              _queryIndex: i,
              // C4: prefix stack names to prevent cross-query stacking
              stack: it.stack ? `q${i}-${it.stack}` : it.stack,
            };
          }),
        ];
      }
    }
  } else if (options && options[0] && options[0].options) {
    // Single query with time shift: preserve existing time shift naming
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap?.periodAsStr
                ? `${it.name} (${metadata?.queries[i]?.timeRangeGap.periodAsStr})`
                : it.name,
            };
          }),
        ];
      }
    }
  }

  // Re-apply color mappings on the fully merged+renamed series
  if (options[0]?.options?.series) {
    applySeriesColorMappings(
      options[0].options.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
  }

  // When multi-query + trellis: per-query conversions had trellis stripped
  // to avoid grid/axis index conflicts. Re-apply trellis on the merged
  // result, grouping series by breakdown value (originalSeriesName) so
  // series from different queries share the same subplot.
  if (isMultiQuery && isTrellis && options[0]?.options && chartPanelRef?.value) {
    reapplyTrellisLayout(
      options[0].options,
      panelSchema,
      chartPanelRef,
      chartPanelStyle,
    );
  }

  return options[0];
};

export const convertSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
  loading?: any,
) => {
  return convertSQLChartData(
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    resultMetaData,
    metadata,
    chartPanelStyle,
    annotations,
    loading,
  );

};
