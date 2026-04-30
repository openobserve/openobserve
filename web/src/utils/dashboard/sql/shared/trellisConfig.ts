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
  calculateWidthText,
  calculateDynamicNameGap,
} from "../../chartDimensionUtils";
import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { getTrellisGrid } from "../../calculateGridForSubPlot";
import { deepCopy } from "@/utils/zincutils";

export interface TrellisDeps {
  options: any;
  panelSchema: any;
  chartPanelRef: any;
  chartPanelStyle: any;
  yAxisKeys: string[];
  xAxisKeys: string[];
  isHorizontalChart: boolean;
  convertedTimeStampToDataFormat: string;
  defaultGrid: any;
  getAxisDataFromKey: (key: string) => any[];
  getAnnotationMarkLine: () => any;
  getSeriesMarkArea: () => any;
  largestLabel: (data: any) => any;
}

/**
 * Creates the four trellis-layout helper functions.
 * All functions close over `deps` so they behave identically to the original
 * closures defined inside `convertSQLData`.
 */
export function createTrellisHelpers(deps: TrellisDeps) {
  const {
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
    getAnnotationMarkLine,
    getSeriesMarkArea,
    largestLabel,
  } = deps;

  const getYAxisNameGap = () => {
    const yAxisLabel = isHorizontalChart ? xAxisKeys[0] : yAxisKeys[0];

    return (
      calculateWidthText(
        formatUnitValue(
          getUnitValue(
            largestLabel(getAxisDataFromKey(yAxisLabel)),
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          ),
        ),
      ) + 8
    );
  };

  /**
   * This method is used to configure trellis layout for the chart, it will update the yAxis label properties
   * @param yAxisNameGap
   * @param gridData
   */
  const updateYAxisOption = (
    yAxisNameGap: number,
    gridData: null | any = null,
  ) => {
    const maxYValue = getUnitValue(
      Math.max(
        ...yAxisKeys
          .map((key: any) => getAxisDataFromKey(key))
          .flat()
          .filter((value: any) => typeof value === "number"),
      ),
      "null", // We don't need to add unit, as we are only calculating the max value. Unit will format the value
      panelSchema.config?.unit_custom,
      panelSchema.config?.decimals,
    );

    // Some units, currencies are formatted with , separator, we need to remove it and convert it to valid number
    maxYValue.value = maxYValue.value.replace(",", "");

    const [num, decimals] = maxYValue.value.split(".");

    //  The purpose of addMaxValue is to ensure that the maxYValue.value is in a valid numeric format before updating the yAxis properties. By doing this check, the code ensures that only valid numeric values are used to set the max property of the yAxis, preventing potential errors or invalid configurations.
    // Summary
    // addMaxValue is a boolean that verifies if maxYValue.value is a valid numeric string.
    // It ensures that the max property of the yAxis is only updated with valid numeric values.
    const addMaxValue =
      maxYValue.value ===
      parseInt(num) + (decimals === undefined ? "" : `.${decimals}`);

    const independentYAxisScale =
      panelSchema.config.trellis?.independent_y_axis_scale;

    options.yAxis.forEach((it: any, index: number) => {
      if (independentYAxisScale) {
        // When independent Y-axis scale is enabled, let ECharts auto-calculate
        // min/max per sub-chart based on its own data range
        delete it.min;
        delete it.max;
      } else if (addMaxValue) {
        const rounedMaxValue = Math.ceil(parseFloat(maxYValue.value));
        it.max = rounedMaxValue + rounedMaxValue * 0.1; // Add 10% to the max value, to ensure that the max value is not at the top of the chart
      }

      it.axisLabel = {
        formatter: function (value: any) {
          return formatUnitValue(
            getUnitValue(
              value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          );
        },
      };

      // Determine if this sub-chart is on the edge (leftmost col or bottom row)
      let isEdgeChart = true;
      if (isHorizontalChart) {
        isEdgeChart = options.yAxis.length - gridData.gridNoOfCol <= index;
      } else {
        isEdgeChart = index % gridData.gridNoOfCol === 0;
      }

      // Show tick values on all sub-charts when independent scale is enabled,
      // otherwise only on edge charts
      const showTickLabels = independentYAxisScale || isEdgeChart;

      // Axis name (e.g. "Timestamp") always follows the edge-only rule
      it.nameGap = isEdgeChart ? (isHorizontalChart ? 25 : yAxisNameGap) : 0;
      it.axisLabel.margin = showTickLabels ? 5 : 0;
      it.axisLabel.fontSize = showTickLabels ? 12 : 10;
      it.nameTextStyle.fontSize = 12;
      it.axisLabel.show = showTickLabels;
      if (!isEdgeChart) it.name = "";
    });
  };

  /**
   * This method is used to configure trellis layout for the chart, it will update the xAxis label properties
   * @param yAxisNameGap
   * @param gridData
   */
  const updateXAxisOption = (
    yAxisNameGap: number,
    gridData: null | any = null,
  ) => {
    // Update xAxis label properties for each chart xAxis based on the grid position
    options.xAxis.forEach((it: any, index: number) => {
      let showAxisLabel = false;

      if (isHorizontalChart) {
        showAxisLabel = index % gridData.gridNoOfCol === 0;
      } else {
        showAxisLabel = options.xAxis.length - gridData.gridNoOfCol <= index;
      }

      // Calculate dynamic nameGap for non-horizontal charts when label rotation is applied
      const axisLabelRotation = it.axisLabel?.rotate || 0;
      const axisLabelWidth = it.axisLabel?.width || 120;
      const axisLabelFontSize = showAxisLabel ? 12 : 10;
      const axisLabelMargin = showAxisLabel ? 8 : 0;

      const dynamicNameGap = isHorizontalChart
        ? yAxisNameGap
        : calculateDynamicNameGap(
            axisLabelRotation,
            axisLabelWidth,
            axisLabelFontSize,
            25,
            axisLabelMargin,
          );

      it.axisTick.length = showAxisLabel ? 5 : 0;
      it.nameGap = showAxisLabel ? dynamicNameGap : 0;
      it.axisLabel.margin = axisLabelMargin;
      it.axisLabel.fontSize = axisLabelFontSize;
      it.nameTextStyle.fontSize = 12;
      it.axisLabel.show = showAxisLabel;

      if (!showAxisLabel) it.name = "";
    });
  };

  const updateTrellisConfig = () => {
    try {
      if (!chartPanelRef?.value) {
        throw new Error("Chart panel reference is not available");
      }

      // Validate panel dimensions
      if (
        chartPanelRef.value.offsetWidth <= 0 ||
        chartPanelRef.value.offsetHeight <= 0
      ) {
        throw new Error("Invalid panel dimensions");
      }

      if (!options.series?.length) {
        return;
      }

      const yAxisNameGap = getYAxisNameGap();

      // If the trellis layout is custom, we need to calculate the number of columns in panel
      let customCols = -1;
      if (
        panelSchema.config.trellis?.layout === "custom" &&
        panelSchema.config.trellis?.num_of_columns
      ) {
        if (panelSchema.config.trellis.num_of_columns <= 0) {
          throw new Error("Number of columns must be positive");
        }

        customCols = panelSchema.config.trellis?.num_of_columns;
      }

      if (panelSchema.config.trellis?.layout === "vertical") {
        customCols = 1;
      }

      // When group_by_y_axis is enabled, create separate charts for each breakdown category,
      // with each chart containing multiple series (one per y-axis metric)
      const group_by_y_axis = panelSchema.config.trellis?.group_by_y_axis;

      const independentYAxisScale =
        !!panelSchema.config.trellis?.independent_y_axis_scale;

      // Calculate grid layout for trellis charts
      const gridData = getTrellisGrid(
        chartPanelRef.value.offsetWidth,
        chartPanelRef.value.offsetHeight,
        group_by_y_axis
          ? options.series.length / yAxisKeys.length
          : options.series.length,
        yAxisNameGap,
        customCols,
        panelSchema.config?.axis_width,
        independentYAxisScale,
      );

      options.grid = gridData.gridArray;

      chartPanelStyle.height = gridData.panelHeight + "px";

      // Update axes configuration for trellis layout
      options.xAxis = options.xAxis.slice(0, 1);
      options.yAxis = [options.yAxis];

      options.title = [];

      // Store original series
      const originalSeries = [...options.series];
      options.series = [];

      let seriesUniqueIndex = 0;

      // Configure each series with its corresponding grid index
      originalSeries.forEach((series: any, index: number) => {
        let gridIndex = index;
        let existingSeriesIndex = -1;
        if (group_by_y_axis) {
          // Find if there's already a series with the same originalSeriesName
          existingSeriesIndex = options.series.findIndex(
            (existingSeries: any) =>
              existingSeries.originalSeriesName === series.originalSeriesName,
          );

          // Use existing gridIndex if found, otherwise use current index
          gridIndex =
            existingSeriesIndex !== -1
              ? options.series[existingSeriesIndex].gridIndex
              : seriesUniqueIndex++;
        }
        // Add the original series
        const updatedSeries = {
          ...series,
          xAxisIndex: gridIndex,
          yAxisIndex: gridIndex,
          gridIndex: gridIndex,
          zlevel: 2,
        };
        options.series.push(updatedSeries);

        if (existingSeriesIndex === -1) {
          options.series.push({
            type: "line",
            xAxisIndex: gridIndex,
            yAxisIndex: gridIndex,
            gridIndex: gridIndex,
            data: [[convertedTimeStampToDataFormat, null]],
            markArea: getSeriesMarkArea(),
            markLine: getAnnotationMarkLine(),
            zlevel: 1,
          });
        }

        if (gridIndex > 0 && existingSeriesIndex === -1) {
          options.xAxis.push({
            ...deepCopy(options.xAxis[0]),
            gridIndex: gridIndex,
          });
          options.yAxis.push({
            ...deepCopy(options.yAxis[0]),
            gridIndex: gridIndex,
          });
        }

        // Add title for each chart
        if (existingSeriesIndex === -1) {
          options.title.push({
            text: group_by_y_axis
              ? series.originalSeriesName || series.name
              : series.name,
            textStyle: {
              fontSize: 12,
              width:
                parseInt(gridData.gridArray[gridIndex].width) *
                  (chartPanelRef.value.offsetWidth / 100) -
                8,
              overflow: "truncate",
              ellipsis: "...",
            },
            top:
              parseFloat(gridData.gridArray[gridIndex].top) -
              (20 / (gridData.panelHeight as number)) * 100 +
              "%",
            left: gridData.gridArray[gridIndex].left,
          });
        }
      });

      updateYAxisOption(yAxisNameGap, gridData);
      updateXAxisOption(yAxisNameGap, gridData);

      options.legend.show = false;
    } catch (err: any) {
      console.error("Trellis configuration failed:", {
        error: err?.message,
        code: err?.code,
        details: err?.details,
      }); // Fallback to default single grid configuration
      options.grid = defaultGrid;
      options.xAxis = options.xAxis.slice(0, 1);
      options.yAxis = [options.yAxis];

      // Set default chartPanelStyle height
      chartPanelStyle.height = chartPanelRef.value.offsetHeight + "px";
    }
  };

  return {
    updateTrellisConfig,
    getYAxisNameGap,
    updateYAxisOption,
    updateXAxisOption,
  };
}
