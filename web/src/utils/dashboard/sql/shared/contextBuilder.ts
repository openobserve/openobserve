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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import {
  calculateWidthText,
  calculateDynamicNameGap,
  calculateRotatedLabelBottomSpace,
} from "../../chartDimensionUtils";
import { ColorModeWithoutMinMax, getSQLMinMaxValue } from "../../colorPalette";
import { getDataValue } from "../../aliasUtils";
import {
  createBaseLegendConfig,
  getChartDimensions,
  calculateChartDimensions,
  calculatePieChartRadius,
} from "../../legendConfiguration";
import { getPropsByChartTypeForSeries } from "../../sqlChartSeriesProps";
import { processData } from "../../sqlProcessData";
import { fillMissingValues } from "../../sqlMissingValueFiller";
import { buildDataLookupMap, createSeriesBuilders } from "./seriesBuilder";
import { createTrellisHelpers } from "./trellisConfig";
import { type SQLContext } from "./types";

/**
 * Finds the largest label in the given data array.
 */
export const largestLabel = (data: any) => {
  const largestlabel = data.reduce((largest: any, label: any) => {
    return label?.toString().length > largest?.toString().length
      ? label
      : largest;
  }, "");

  return largestlabel;
};

/**
 * Builds the complete SQLContext for a given set of raw inputs.
 *
 * This function replicates all the work that `convertSQLData` used to do
 * *before* the chart-type switch statement ΓÇö axis-key extraction, data
 * processing, base-options construction, and helper-function creation.
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
  loading?: any,
): SQLContext | null {
  // Set gridlines visibility based on config.show_gridlines (default: true)
  const showGridlines =
    panelSchema?.config?.show_gridlines !== undefined
      ? panelSchema.config.show_gridlines
      : true;
  const extras: any = {};

  // if no data than return it
  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema.queries[0].fields.x ||
    !panelSchema.queries[0].fields.y
  ) {
    return null;
  }

  // get the x axis key
  const getXAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.x?.length
      ? panelSchema?.queries[0]?.fields?.x.map((it: any) => it.alias)
      : [];
  };

  // get the y axis key
  const getYAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.y?.length
      ? panelSchema?.queries[0]?.fields?.y.map((it: any) => it.alias)
      : [];
  };

  // get the z axis key
  const getZAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.z?.length
      ? panelSchema?.queries[0]?.fields?.z.map((it: any) => it.alias)
      : [];
  };

  // get the breakdown key
  const getBreakDownKeys = () => {
    return panelSchema?.queries[0]?.fields?.breakdown?.length
      ? panelSchema?.queries[0]?.fields?.breakdown.map((it: any) => it.alias)
      : [];
  };

  // Step 1: Get the X-Axis key
  const xAxisKeys = getXAxisKeys();

  // Step 2: Get the Y-Axis key
  const yAxisKeys = getYAxisKeys();

  const zAxisKeys = getZAxisKeys();

  const breakDownKeys = getBreakDownKeys();

  const getMarkLineData = (panelSchema: any) => {
    return (
      panelSchema?.config?.mark_line?.map((markLine: any) => {
        return {
          name: markLine.name,
          type: markLine.type,
          xAxis: markLine.type == "xAxis" ? markLine.value : null,
          yAxis: markLine.type == "yAxis" ? markLine.value : null,
          label: {
            formatter: markLine.name ? "{b}:{c}" : "{c}",
            position: "insideEndTop",
          },
        };
      }) ?? []
    );
  };

  const noValueConfigOption = panelSchema?.config?.no_value_replacement ?? "";

  const processedData = processData(
    searchQueryData,
    panelSchema,
    store,
    yAxisKeys,
    breakDownKeys,
    xAxisKeys,
    extras,
  );

  const missingValueData = fillMissingValues(
    processedData,
    panelSchema,
    resultMetaData,
    metadata,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    noValueConfigOption,
    loading,
  );

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((key: any) => getDataValue(item, key) != null) &&
          yAxisKeys.every((key: any) => getDataValue(item, key) != null) &&
          breakDownKeys.every((key: any) => getDataValue(item, key) != null)
        );
      }) || [];

    // if data is not there use {} as a default value
    const keys = Object.keys((data.length && data[0]) || {}); // Assuming there's at least one object

    const keyArrays: any = {};

    for (const key of keys) {
      keyArrays[key] = data.map((obj: any) => getDataValue(obj, key));
    }

    const result = getDataValue(keyArrays, key) || [];

    return result;
  };

  /**
   * Returns the largest label from the stacked chart data.
   * Calculates the largest value for each unique breakdown and sums those values.
   * @param axisKey - key of the yaxis
   * @param breakDownkey - key of the breakdown
   * @returns {number} - the largest value
   */
  const largestStackLabel = (axisKey: string, breakDownkey: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((key: any) => getDataValue(item, key) != null) &&
          yAxisKeys.every((key: any) => getDataValue(item, key) != null) &&
          breakDownKeys.every((key: any) => getDataValue(item, key) != null)
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

  const convertedTimeStampToDataFormat = new Date(
    annotations?.value?.[0]?.start_time / 1000,
  ).toString();

  /**
   * Returns the pie chart radius that accounts for legend space
   * @param {any[]} seriesData - The series data for legend calculation
   * @returns {number} - the radius percentage
   */
  const getPieChartRadius = (seriesData: any[] = []) => {
    // Get chart dimensions from chartPanelRef
    const dimensions = getChartDimensions(chartPanelRef);

    // Calculate available dimensions using our centralized helper function
    const chartDimensions = calculateChartDimensions(
      panelSchema,
      dimensions.chartWidth,
      dimensions.chartHeight,
      seriesData,
    );

    // Use the optimized pie chart radius calculation
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

  const isHorizontalChart =
    panelSchema.type === "h-bar" || panelSchema.type === "h-stacked";

  const defaultGrid = {
    containLabel: true,
    left: "10%",
    right: "10%",
    top: "15%",
    bottom: "15%",
  };

  const [min, max] = getSQLMinMaxValue(yAxisKeys, missingValueData);

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

  // Check if x-axis will be time-based by looking for timestamp fields
  const hasTimestampField = panelSchema.queries[0].fields?.x?.some(
    (it: any) =>
      it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column ||
      ["histogram", "date_bin"].includes(it.aggregationFunction),
  );

  // Calculate additional spacing needed for rotated labels
  // Skip rotation for time-based x-axis and horizontal chart types (h-bar, h-stacked)
  // For horizontal charts, labels should always be at 0 degrees (not rotated)
  let labelRotation =
    hasTimestampField || isHorizontalChart
      ? 0
      : panelSchema.config?.axis_label_rotate || 0;
  let labelWidth =
    hasTimestampField || isHorizontalChart
      ? 0
      : panelSchema.config?.axis_label_truncate_width || 0;

  // If truncate width is not set and not time-based/horizontal, calculate the actual max width from data
  if (
    !hasTimestampField &&
    !isHorizontalChart &&
    labelWidth === 0 &&
    xAxisKeys.length > 0
  ) {
    const longestLabelStr = largestLabel(getAxisDataFromKey(xAxisKeys[0]));
    labelWidth = calculateWidthText(longestLabelStr, "12px");
  } else if (!hasTimestampField && !isHorizontalChart && labelWidth === 0) {
    labelWidth = 120; // Fallback
  }

  const labelFontSize = 12;
  const labelMargin = 10;

  // Calculate the section height (nameGap) upfront so we can use it for bottom spacing
  // Skip rotation-based calculations for horizontal charts and time-based axes
  const dynamicXAxisNameGap =
    hasTimestampField || isHorizontalChart
      ? 25
      : calculateDynamicNameGap(
          labelRotation,
          labelWidth,
          labelFontSize,
          25,
          labelMargin,
        );

  // Additional bottom space is only needed for non-horizontal, non-time-based charts
  const additionalBottomSpace =
    hasTimestampField || isHorizontalChart
      ? 0
      : calculateRotatedLabelBottomSpace(
          labelRotation,
          labelWidth,
          labelFontSize,
          !!hasXAxisName,
          dynamicXAxisNameGap,
        );

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
            // When an x-axis name is present, `nameGap` already reserves space
            // between rotated labels and the axis name. Adding `additionalBottomSpace`
            // here causes double-counting and extra blank space beneath the axis
            // name. Only return the base bottom in this case.
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

                //we does not required any linebreaks for h-stacked because we only use one x axis
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
            } catch (error) {
              return params?.value?.toString() ?? "";
            }
          },
        },
      },
      formatter: function (name: any) {
        try {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          if (name?.length == 0) return "";

          // sort tooltip array based on value
          name?.sort((a: any, b: any) => {
            return (b.value ?? 0) - (a.value ?? 0);
          });

          // if hovered series name is not null then move it to first position
          if (hoveredSeriesState?.value?.hoveredSeriesName) {
            // get the current series index from name
            const currentSeriesIndex = name?.findIndex(
              (it: any) =>
                it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
            );

            // if hovered series index is not -1 then take it to very first position
            if (currentSeriesIndex != -1) {
              // shift all series to next position and place current series at first position
              const temp = name?.[currentSeriesIndex];
              for (let i = currentSeriesIndex; i > 0; i--) {
                name[i] = name?.[i - 1];
              }
              name[0] = temp;
            }
          }

          const hoverText: string[] = [];
          name?.forEach((it: any) => {
            // if value is not null, show in tooltip
            if (it.value != null) {
              // check if the series is the current series being hovered
              // if have than bold it
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
              // else normal text
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
        } catch (error) {
          return "";
        }
      },
    },
    xAxis: [...xAxisKeys, ...breakDownKeys]?.map((key: any, index: number) => {
      const data = getAxisDataFromKey(key);

      //unique value index array
      const arr: any = [];
      for (let i = 0; i < data.length; i++) {
        if (i == 0 || data[i] != data[i - 1]) arr.push(i);
      }

      // Use 0 for rotation and width if time-based field or horizontal chart
      const labelRotation =
        hasTimestampField || isHorizontalChart
          ? 0
          : panelSchema.config?.axis_label_rotate || 0;
      const labelWidth =
        hasTimestampField || isHorizontalChart
          ? 120
          : panelSchema.config?.axis_label_truncate_width || 120;
      const labelFontSize = 12;
      const labelMargin = 10;

      return {
        type: "category",
        position: panelSchema.type == "h-bar" ? "left" : "bottom",
        // inverse data for h-stacked and h-bar
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
          // hide axis label if overlaps
          hideOverlap: true,
          width: labelWidth,
          margin: labelMargin,
          rotate: labelRotation,
        },
        splitLine: {
          show: showGridlines,
        },
        axisLine: {
          show: searchQueryData?.every((it: any) => it.length == 0)
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
          } catch (error) {
            return "";
          }
        },
      },
      splitLine: {
        show: showGridlines,
      },
      axisLine: {
        show: searchQueryData?.every((it: any) => it.length == 0)
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
      // it is used to hide toolbox buttons
      bottom: "100%",
      feature: {
        dataZoom: {
          yAxisIndex: panelSchema.config?.dataZoom?.hasOwnProperty("yAxisIndex")
            ? panelSchema.config?.dataZoom.yAxisIndex
            : "none",
        },
      },
    },
    series: [],
  };

  // Ensure gridlines visibility is set for all xAxis and yAxis (handles both array and object cases)
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
        // if (!axis.splitLine) axis.splitLine = {};
        axis.splitLine.show = showGridlines;
      },
    );
  }

  const defaultSeriesProps = getPropsByChartTypeForSeries(panelSchema);

  // if color type is shades, continuous then required to calculate min and max for chart.
  let chartMin: any = Infinity;
  let chartMax: any = -Infinity;
  if (
    !Object.values(ColorModeWithoutMinMax).includes(
      panelSchema.config?.color?.mode,
    )
  ) {
    // if heatmap then get min and max from z axis sql data
    if (panelSchema.type == "heatmap") {
      // NOTE: Currently we do not support color options for heatmap
      // [chartMin, chartMax] = getSQLMinMaxValue(zAxisKeys, searchQueryData);
      chartMin = null;
      chartMax = null;
    } else {
      [chartMin, chartMax] = getSQLMinMaxValue(yAxisKeys, missingValueData);
    }
  }

  // Build the lookup map once for O(1) series data access
  const dataLookupMap = buildDataLookupMap(
    missingValueData,
    breakDownKeys,
    xAxisKeys,
  );

  // Build series helpers (they close over options, missingValueData, etc.)
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

  // Build trellis helpers (they close over options, chartPanelRef, etc.)
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