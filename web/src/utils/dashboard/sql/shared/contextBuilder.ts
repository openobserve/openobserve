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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { calculateWidthText } from "../../chartDimensionUtils";
import { getDataValue } from "../../aliasUtils";
import {
  createBaseLegendConfig,
  getChartDimensions,
  calculateChartDimensions,
  calculatePieChartRadius,
} from "../../legendConfiguration";
import { buildDataLookupMap, createSeriesBuilders } from "./seriesBuilder";
import { createTrellisHelpers } from "./trellisConfig";
import { type SQLContext } from "./types";
import { type SerializableDataContext } from "./workerContract";
// Worker-safe data phase — re-exported here for callers that import from contextBuilder
export { largestLabel, buildSQLDataContext } from "./contextBuilderData";
import { largestLabel, buildSQLDataContext } from "./contextBuilderData";

/**
 * Builds the complete SQLContext for a given set of raw inputs.
 *
 * This function replicates all the work that `convertSQLData` used to do
 * *before* the chart-type switch statement — axis-key extraction, data
 * processing, base-options construction, and helper-function creation.
 *
 * Internally calls `buildSQLDataContext` for the CPU-heavy data phase so that
 * phase can be offloaded to a Web Worker without duplicating logic.
 *
 * @returns The fully populated SQLContext, or `null` if the input is invalid.
 */
export function buildSQLContext(
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
): SQLContext | null {
  // --- Data phase (CPU heavy, worker-safe) ---
  const dataCtx = buildSQLDataContext(
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    resultMetaData,
    metadata,
    chartPanelStyle,
    annotations,
  );
  if (!dataCtx) return null;

  const isDataEmpty =
    (searchQueryData?.every((it: any) => it.length == 0) as boolean) ?? false;

  return _buildOptionsFromDataCtx(
    dataCtx,
    panelSchema,
    store,
    chartPanelRef,
    hoveredSeriesState,
    chartPanelStyle,
    annotations,
    isDataEmpty,
    searchQueryData,
    metadata,
    resultMetaData,
  );
}

/**
 * Builds the full SQLContext from a pre-computed `SerializableDataContext`
 * (e.g. returned by the Web Worker) without re-running the CPU-heavy data
 * phase.
 *
 * Called by `assembleMultiSQLOptions` on the main thread after the worker
 * has finished. Attaches all formatter closures and helper functions.
 */
export function buildSQLContextFromSerializable(
  dataCtx: SerializableDataContext,
  panelSchema: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  chartPanelStyle: any,
  annotations: any,
  metadata: any,
  searchQueryData: any,
): SQLContext {
  const isDataEmpty =
    (searchQueryData?.every((it: any) => it.length == 0) as boolean) ?? false;
  return _buildOptionsFromDataCtx(
    dataCtx,
    panelSchema,
    store,
    chartPanelRef,
    hoveredSeriesState,
    chartPanelStyle,
    annotations,
    isDataEmpty,
    searchQueryData,
    metadata,
    /* resultMetaData */ null,
  );
}

// ---------------------------------------------------------------------------
// Private: "options phase" ΓÇö builds ECharts options + closure-based helpers
// from a pre-computed SerializableDataContext.  Called by both buildSQLContext
// (normal path) and buildSQLContextFromSerializable (worker path).
// ---------------------------------------------------------------------------
function _buildOptionsFromDataCtx(
  dataCtx: SerializableDataContext,
  panelSchema: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  chartPanelStyle: any,
  annotations: any,
  isDataEmpty: boolean,
  searchQueryData: any,
  metadata: any,
  resultMetaData: any,
): SQLContext {
  const {
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    missingValueData,
    extras,
    showGridlines,
    hasTimestampField,
    isHorizontalChart,
    dynamicXAxisNameGap,
    additionalBottomSpace,
    convertedTimeStampToDataFormat,
    defaultSeriesProps,
    chartMin,
    chartMax,
    min,
    max,
    defaultGrid,
    markLineData: markLineDataRaw,
  } = dataCtx;

  // Restore the mark line helper (needs formatter string, already plain ΓÇö no closure)
  const getMarkLineData = () => markLineDataRaw;

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          yAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          breakDownKeys.every((k: any) => getDataValue(item, k) != null)
        );
      }) || [];
    const keys = Object.keys((data.length && data[0]) || {});
    const keyArrays: any = {};
    for (const k of keys) {
      keyArrays[k] = data.map((obj: any) => getDataValue(obj, k));
    }
    return getDataValue(keyArrays, key) || [];
  };

  const largestStackLabel = (axisKey: string, breakDownkey: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          yAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          breakDownKeys.every((k: any) => getDataValue(item, k) != null)
        );
      }) || [];
    const maxValues: any = {};
    data.forEach((obj: any) => {
      const breakDownValue = getDataValue(obj, breakDownkey);
      const axisValue = getDataValue(obj, axisKey);
      if (maxValues[breakDownValue]) {
        if (axisValue > maxValues[breakDownValue]) {
          maxValues[breakDownValue] = axisValue;
        }
      } else {
        maxValues[breakDownValue] =
          typeof axisValue === "number" ? axisValue : 0;
      }
    });
    return Object.values(maxValues).reduce((a: any, b: any) => a + b, 0);
  };

  function getLargestLabel() {
    if (
      (panelSchema.type === "stacked" || panelSchema.type === "area-stacked") &&
      breakDownKeys.length > 0
    ) {
      return largestStackLabel(yAxisKeys[0], breakDownKeys[0]);
    } else {
      return largestLabel(getAxisDataFromKey(yAxisKeys[0]));
    }
  }

  const getFinalAxisValue = (
    configValue: number | null | undefined,
    dataValue: number,
    isMin: boolean,
  ) => {
    if (configValue === null || configValue === undefined) {
      return undefined;
    }
    return isMin
      ? Math.min(configValue, dataValue)
      : Math.max(configValue, dataValue);
  };

  const hasXAxisName = panelSchema.queries[0]?.fields?.x[0]?.label;
  const hasYAxisName =
    panelSchema.queries[0]?.fields?.y?.length == 1 &&
    panelSchema.queries[0]?.fields?.y[0]?.label;

  /**
   * Returns the pie chart radius that accounts for legend space
   */
  const getPieChartRadius = (seriesData: any[] = []) => {
    const dimensions = getChartDimensions(chartPanelRef);
    const chartDimensions = calculateChartDimensions(
      panelSchema,
      dimensions.chartWidth,
      dimensions.chartHeight,
      seriesData,
    );
    const radius = calculatePieChartRadius(
      panelSchema,
      chartDimensions.availableWidth,
      chartDimensions.availableHeight,
      dimensions.chartWidth,
      dimensions.chartHeight,
    );
    return radius;
  };

  const legendConfig = createBaseLegendConfig(panelSchema, hoveredSeriesState);

  const options: any = {
    backgroundColor: "transparent",
    legend: legendConfig,
    grid: {
      containLabel: panelSchema.config?.axis_width == null ? true : false,
      left: hasYAxisName ? (panelSchema.config?.axis_width ?? 30) : 5,
      right: 20,
      top: "15",
      bottom: hasXAxisName
        ? (() => {
            const baseBottom =
              legendConfig.orient === "horizontal" &&
              panelSchema.config?.show_legends
                ? panelSchema.config?.axis_width == null
                  ? 50
                  : 60
                : panelSchema.config?.axis_width == null
                  ? 35
                  : 40;
            return baseBottom;
          })()
        : (() => {
            const baseBottom =
              legendConfig.orient === "vertical" &&
              panelSchema.config?.show_legends
                ? 0
                : breakDownKeys.length > 0
                  ? 25
                  : 0;
            return baseBottom + additionalBottomSpace;
          })(),
    },
    tooltip: {
      trigger: "axis",
      textStyle: {
        color: store.state.theme === "dark" ? "#fff" : "#000",
        fontSize: 12,
      },
      enterable: true,
      backgroundColor:
        store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
      extraCssText:
        "max-height: 200px; overflow: auto; max-width: 400px; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.5) transparent;",
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          formatter: function (params: any) {
            try {
              let lineBreaks = "";
              if (
                panelSchema.type === "h-bar" ||
                panelSchema.type === "h-stacked"
              ) {
                if (params?.axisDimension == "x")
                  return formatUnitValue(
                    getUnitValue(
                      params?.value,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  );
                if (panelSchema.type === "h-stacked")
                  return params?.value?.toString();
                for (
                  let i = 0;
                  i <
                  xAxisKeys.length +
                    breakDownKeys.length -
                    params?.axisIndex -
                    1;
                  i++
                ) {
                  lineBreaks += " \n \n";
                }
                params.value = params?.value?.toString();
                return `${lineBreaks}  ${params?.value}`;
              }
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              for (
                let i = 0;
                i <
                xAxisKeys.length + breakDownKeys.length - params?.axisIndex - 1;
                i++
              ) {
                lineBreaks += " \n \n";
              }
              params.value = params?.value?.toString();
              return `${lineBreaks}  ${params?.value}`;
            } catch {
              return params?.value?.toString() ?? "";
            }
          },
        },
      },
      formatter: function (name: any) {
        try {
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          if (name?.length == 0) return "";

          name?.sort((a: any, b: any) => {
            return (b.value ?? 0) - (a.value ?? 0);
          });

          if (hoveredSeriesState?.value?.hoveredSeriesName) {
            const currentSeriesIndex = name?.findIndex(
              (it: any) =>
                it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
            );
            if (currentSeriesIndex != -1) {
              const temp = name?.[currentSeriesIndex];
              for (let i = currentSeriesIndex; i > 0; i--) {
                name[i] = name?.[i - 1];
              }
              name[0] = temp;
            }
          }

          const hoverText: string[] = [];
          name?.forEach((it: any) => {
            if (it.value != null) {
              if (
                it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
              )
                hoverText.push(
                  `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it.value,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )} </strong>`,
                );
              else
                hoverText.push(
                  `${it.marker} ${it.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it.value,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )}`,
                );
            }
          });

          return `${name?.[0]?.name} <br/> ${hoverText.join("<br/>")}`;
        } catch {
          return "";
        }
      },
    },
    xAxis: [...xAxisKeys, ...breakDownKeys]?.map((key: any, index: number) => {
      const data = getAxisDataFromKey(key);
      const arr: any = [];
      for (let i = 0; i < data.length; i++) {
        if (i == 0 || data[i] != data[i - 1]) arr.push(i);
      }
      const axisLabelRotation =
        hasTimestampField || isHorizontalChart
          ? 0
          : panelSchema.config?.axis_label_rotate || 0;
      const axisLabelWidth =
        hasTimestampField || isHorizontalChart
          ? 120
          : panelSchema.config?.axis_label_truncate_width || 120;
      const axisLabelMargin = 10;

      return {
        type: "category",
        position: panelSchema.type == "h-bar" ? "left" : "bottom",
        inverse: ["h-stacked", "h-bar"].includes(panelSchema.type),
        name: index == 0 ? panelSchema.queries[0]?.fields?.x[index]?.label : "",
        label: {
          show: panelSchema.config?.label_option?.position != null,
          position: panelSchema.config?.label_option?.position || "None",
          rotate: panelSchema.config?.label_option?.rotate || 0,
        },
        nameLocation: "middle",
        nameGap: dynamicXAxisNameGap,
        nameTextStyle: {
          fontWeight: "bold",
          fontSize: 14,
        },
        axisLabel: {
          interval:
            panelSchema.type == "h-stacked"
              ? "auto"
              : index == xAxisKeys.length + breakDownKeys.length - 1
                ? "auto"
                : function (i: any) {
                    return arr.includes(i);
                  },
          overflow:
            index == xAxisKeys.length + breakDownKeys.length - 1
              ? "none"
              : "truncate",
          hideOverlap: true,
          width: axisLabelWidth,
          margin: axisLabelMargin,
          rotate: axisLabelRotation,
        },
        splitLine: {
          show: showGridlines,
        },
        axisLine: {
          show: isDataEmpty
            ? true
            : (panelSchema.config?.axis_border_show ?? false),
        },
        axisTick: {
          show: xAxisKeys.length + breakDownKeys.length == 1 ? false : true,
          align: "left",
          alignWithLabel: false,
          length: 5,
          interval:
            panelSchema.type == "h-stacked"
              ? "auto"
              : function (i: any) {
                  return arr.includes(i);
                },
        },
        data: data,
      };
    }),
    yAxis: {
      type: "value",
      name:
        panelSchema.queries[0]?.fields?.y?.length == 1
          ? panelSchema.queries[0]?.fields?.y[0]?.label
          : "",
      nameLocation: "middle",
      min: getFinalAxisValue(panelSchema.config.y_axis_min, min, true),
      max: getFinalAxisValue(panelSchema.config.y_axis_max, max, false),
      nameGap:
        calculateWidthText(
          panelSchema.type == "h-bar" || panelSchema.type == "h-stacked"
            ? largestLabel(getAxisDataFromKey(yAxisKeys[0]))
            : formatUnitValue(
                getUnitValue(
                  getLargestLabel(),
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              ),
        ) + 8,
      nameTextStyle: {
        fontWeight: "bold",
        fontSize: 14,
      },
      axisLabel: {
        formatter: function (value: any) {
          try {
            return formatUnitValue(
              getUnitValue(
                value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
            );
          } catch {
            return "";
          }
        },
      },
      splitLine: {
        show: showGridlines,
      },
      axisLine: {
        show: isDataEmpty
          ? true
          : (panelSchema.config?.axis_border_show ?? false),
      },
    },
    toolbox: {
      orient: "vertical",
      show: !["pie", "donut", "metric", "gauge"].includes(panelSchema.type),
      showTitle: false,
      tooltip: {
        show: false,
      },
      itemSize: 0,
      itemGap: 0,
      bottom: "100%",
      feature: {
        dataZoom: {
          yAxisIndex:
            "yAxisIndex" in (panelSchema.config?.dataZoom ?? {})
              ? panelSchema.config?.dataZoom.yAxisIndex
              : "none",
        },
      },
    },
    series: [],
  };

  // Ensure gridlines visibility is set for all xAxis and yAxis
  if (options.xAxis) {
    (Array.isArray(options.xAxis) ? options.xAxis : [options.xAxis]).forEach(
      (axis) => {
        axis.splitLine.show = showGridlines;
      },
    );
  }
  if (options.yAxis) {
    (Array.isArray(options.yAxis) ? options.yAxis : [options.yAxis]).forEach(
      (axis) => {
        axis.splitLine.show = showGridlines;
      },
    );
  }

  const dataLookupMap = buildDataLookupMap(
    missingValueData,
    breakDownKeys,
    xAxisKeys,
  );

  const seriesHelpers = createSeriesBuilders({
    options,
    panelSchema,
    store,
    missingValueData,
    xAxisKeys,
    yAxisKeys,
    breakDownKeys,
    defaultSeriesProps,
    chartMin,
    chartMax,
    dataLookupMap,
    annotations,
    getMarkLineData,
    getAxisDataFromKey,
  });

  const trellisHelpers = createTrellisHelpers({
    options,
    panelSchema,
    chartPanelRef,
    chartPanelStyle,
    yAxisKeys,
    xAxisKeys,
    isHorizontalChart,
    convertedTimeStampToDataFormat,
    defaultGrid,
    getAxisDataFromKey,
    getAnnotationMarkLine: seriesHelpers.getAnnotationMarkLine,
    getSeriesMarkArea: seriesHelpers.getSeriesMarkArea,
    largestLabel,
  });

  const ctx: SQLContext = {
    // Raw inputs
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    chartPanelStyle,
    annotations,
    metadata,
    resultMetaData,
    // Axis keys
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    // Processed data
    missingValueData,
    extras,
    // Derived scalars
    showGridlines,
    hasTimestampField,
    isHorizontalChart,
    dynamicXAxisNameGap,
    convertedTimeStampToDataFormat,
    defaultSeriesProps,
    chartMin,
    chartMax,
    defaultGrid,
    // Mutable ECharts options
    options,
    // Closure-based helpers
    getAxisDataFromKey,
    getSeries: seriesHelpers.getSeries,
    getAnnotationMarkLine: seriesHelpers.getAnnotationMarkLine,
    getSeriesMarkArea: seriesHelpers.getSeriesMarkArea,
    getPieChartRadius,
    updateTrellisConfig: trellisHelpers.updateTrellisConfig,
  };

  return ctx;
}
