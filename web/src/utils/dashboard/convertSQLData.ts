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
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
import { toZonedTime } from "date-fns-tz";
import { dateBin } from "@/utils/dashboard/datetimeStartPoint";
import { format } from "date-fns";
import {
  calculateOptimalFontSize,
  calculateWidthText,
  formatDate,
  formatUnitValue,
  getContrastColor,
  applySeriesColorMappings,
  getUnitValue,
  isTimeSeries,
  isTimeStamp,
  calculateDynamicNameGap,
  calculateRotatedLabelBottomSpace,
} from "./convertDataIntoUnitValue";
import {
  calculateGridPositions,
  getTrellisGrid,
} from "./calculateGridForSubPlot";
import { isGivenFieldInOrderBy } from "../query/sqlUtils";
import {
  ColorModeWithoutMinMax,
  getSeriesColor,
  getSQLMinMaxValue,
} from "./colorPalette";
import { deepCopy } from "@/utils/zincutils";
import { type SeriesObject } from "@/ts/interfaces/dashboard";
import { getDataValue } from "./aliasUtils";
import { getAnnotationsData } from "@/utils/dashboard/getAnnotationsData";
import {
  createBaseLegendConfig,
  applyLegendConfiguration,
  applyPieDonutChartAlignment,
  getChartDimensions,
  applyPieDonutCenterAdjustment,
  calculateChartDimensions,
  calculatePieChartRadius,
  shouldApplyChartAlignment,
  generateChartAlignmentProperties,
} from "./legendConfiguration";

/**
 * Calculates chart container properties for pie/donut charts based on legend position and chart alignment
 * @param {any} panelSchema - The panel schema containing configuration
 * @param {number} chartWidth - Width of the chart container
 * @param {number} chartHeight - Height of the chart container
 * @param {any[]} seriesData - Series data for legend calculations
 * @returns {object} Object containing grid properties and available dimensions
 */
const calculatePieChartContainer = (
  panelSchema: any,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[] = [],
) => {
  const chartAlign = panelSchema.config?.chart_align;
  const legendPosition = panelSchema.config?.legends_position;

  // Calculate available space using our centralized helper function
  const dimensions = calculateChartDimensions(
    panelSchema,
    chartWidth,
    chartHeight,
    seriesData,
  );

  // Determine if chart alignment should be applied
  const shouldApplyAlignment = shouldApplyChartAlignment(
    panelSchema,
    seriesData,
  );

  // Generate CSS grid properties for chart alignment
  const gridProperties = generateChartAlignmentProperties(
    chartAlign,
    legendPosition,
    shouldApplyAlignment,
  );

  return {
    gridProperties,
    availableWidth: dimensions.availableWidth,
    availableHeight: dimensions.availableHeight,
    shouldUseGridAlignment: shouldApplyAlignment,
  };
};

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
) => {
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    // this sets a blank object until it loads
    // because of this, it will go to UI and draw something, even 0 or a blank chart
    // this will give a sence of progress to the user
    searchQueryData = [[]];
  }

  // loop on all search query data
  const options: any = [];
  for (let i = 0; i < searchQueryData.length; i++) {
    options.push(
      await convertSQLData(
        panelSchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        [resultMetaData.value?.[i]?.[0]],
        { queries: [metadata.queries[i]] },
        chartPanelStyle,
        annotations,
      ),
    );
  }

  const isAnnotationSeries = (series: any) => {
    // check if series name is available
    // if series name is not available then that is anotation series
    if (!series.name) return true;
  };

  // loop on all options
  if (options && options[0] && options[0].options) {
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap.periodAsStr
                ? `${it.name} (${metadata?.queries[i]?.timeRangeGap.periodAsStr})`
                : it.name,
            };
          }),
        ];
      }
    }
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
) => {
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
    // console.timeEnd("convertSQLData");
    return { options: null };
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

  /**
   * Process the SQL data and convert it into a format suitable for the echarts
   * library.
   *
   * This function takes in the raw data returned from the SQL query and the
   * panel schema, and returns a processed data array that can be fed into the
   * echarts library.
   *
   * Here's a step-by-step breakdown of what this function does:
   *
   * 1. It checks if the data is empty or if the first item in the array is not
   * an object. If either condition is true, it returns an empty array.
   *
   * 2. It extracts the top_results and top_results_others values from the
   * panel schema config.
   *
   * 3. If top_results is not enabled, it simply returns the inner data array
   * without any modifications.
   *
   * 4. It extracts the breakdown key, y-axis key, and x-axis key from the
   * panel schema.
   *
   * 5. It aggregates the y-axis values by breakdown, ignoring items without a
   * breakdown key. This is done using the reduce() method.
   *
   * 6. It sorts the breakdown object by value in descending order and extracts
   * the top keys based on the configured number of top results. This is done
   * using the Object.entries() and sort() methods.
   *
   * 7. It initializes an empty result array and an empty others object.
   *
   * 8. It loops through the inner data array and checks if the breakdown value
   * is in the top keys. If it is, it adds the item to the result array. If it's
   * not, and top_results_others is enabled, it adds the item to the others
   * object.
   *
   * 9. If top_results_others is enabled, it loops through the others object and
   * adds the aggregated values to the result array.
   *
   * 10. Finally, it returns the result array.
   *
   * @param {any[]} data - The data returned from the SQL query.
   * @param {any} panelSchema - The schema of the panel.
   * @returns {any[]} - The processed data array.
   */
  const processData = (data: any[], panelSchema: any): any[] => {
    if (!data.length || !Array.isArray(data[0])) {
      return [];
    }

    const { top_results, top_results_others } = panelSchema.config;

    // get the limit series from the config
    // if top_results is enabled then use the top_results value
    // otherwise use the max_dashboard_series value
    let limitSeries = top_results
      ? (Math.min(
          top_results,
          store.state?.zoConfig?.max_dashboard_series ?? 100,
        ) ?? 100)
      : (store.state?.zoConfig?.max_dashboard_series ?? 100);

    // For multi y-axis charts, divide the limit by number of y-axes
    // to keep total series count at or below max_dashboard_series
    // This applies when there are multiple y-axes AND breakdown fields
    if (yAxisKeys.length > 1 && breakDownKeys.length > 0) {
      limitSeries = Math.floor(limitSeries / yAxisKeys.length);
    }

    const innerDataArray = data[0];

    if (!breakDownKeys.length) {
      return innerDataArray;
    }

    const breakdownKey = breakDownKeys[0];
    const yAxisKey = yAxisKeys[0];
    const xAxisKey = xAxisKeys[0];

    // Step 1: Aggregate y_axis values by breakdown, ensuring missing values are set to empty string
    const breakdown = innerDataArray.reduce((acc, item) => {
      let breakdownValue = getDataValue(item, breakdownKey);

      // Convert null, undefined, and empty string to a default empty string
      if (
        breakdownValue == null ||
        breakdownValue === "" ||
        breakdownValue === undefined
      ) {
        breakdownValue = "";
      }

      const yAxisValue = getDataValue(item, yAxisKey);

      acc[breakdownValue] = (acc[breakdownValue] || 0) + (+yAxisValue || 0);
      return acc;
    }, {});

    // Step 2: Sort and extract the top keys based on the configured number of top results
    const allKeys = Object.entries(breakdown).sort(
      ([, a]: any, [, b]: any) => b - a,
    );

    // if top_results is enabled and the number of unique breakdown values is greater than the limit, add a warning message
    // if top_results is not enabled and the number of unique breakdown values is greater than the max_dashboard_series, add a warning message
    if (
      (top_results &&
        top_results > (store.state?.zoConfig?.max_dashboard_series ?? 100) &&
        allKeys.length > top_results) ||
      (!top_results &&
        allKeys.length > (store.state?.zoConfig?.max_dashboard_series ?? 100))
    ) {
      extras.limitNumberOfSeriesWarningMessage =
        "Limiting the displayed series to ensure optimal performance";
    }

    const topKeys = allKeys.slice(0, limitSeries).map(([key]) => key);

    // Step 3: Initialize result array and others object for aggregation
    const resultArray: any[] = [];
    const othersObj: any = {};

    innerDataArray.forEach((item) => {
      let breakdownValue = getDataValue(item, breakdownKey);

      // Ensure missing breakdown values are treated as empty strings
      if (
        breakdownValue == null ||
        breakdownValue === "" ||
        breakdownValue === undefined
      ) {
        breakdownValue = "";
      }

      if (topKeys.includes(breakdownValue.toString())) {
        resultArray.push({ ...item, [breakdownKey]: breakdownValue });
      } else if (top_results_others) {
        const xAxisValue = String(getDataValue(item, xAxisKey));
        othersObj[xAxisValue] =
          (othersObj[xAxisValue] || 0) + (+getDataValue(item, yAxisKey) || 0);
      }
    });

    // Step 4: Add 'others' aggregation to the result array if enabled
    if (top_results_others) {
      Object.entries(othersObj).forEach(([xAxisValue, yAxisValue]) => {
        resultArray.push({
          [breakdownKey]: "others",
          [xAxisKey]: xAxisValue,
          [yAxisKey]: yAxisValue,
        });
      });
    }

    return resultArray;
  };

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

  const processedData = processData(searchQueryData, panelSchema);

  const missingValue = () => {
    // Get the interval in minutes
    const interval = resultMetaData?.map(
      (it: any) => it?.histogram_interval,
    )?.[0];

    if (
      !interval ||
      !metadata.queries ||
      !["area-stacked", "line", "area", "bar", "stacked", "scatter"].includes(
        panelSchema.type,
      )
    ) {
      return JSON.parse(JSON.stringify(processedData));
    }

    // Extract and process metaDataStartTime
    const metaDataStartTime = metadata?.queries[0]?.startTime?.toString() ?? 0;
    const startTime = new Date(parseInt(metaDataStartTime) / 1000);

    // Calculate the binnedDate
    const origin = new Date(Date.UTC(2001, 0, 1, 0, 0, 0, 0));
    const binnedDate = dateBin(interval, startTime, origin);

    // Convert interval to milliseconds
    const intervalMillis = interval * 1000;

    // Identify the time-based key
    const searchQueryDataFirstEntry = processedData[0];

    const keys = [
      ...getXAxisKeys(),
      ...getYAxisKeys(),
      ...getZAxisKeys(),
      ...getBreakDownKeys(),
    ];
    const timeBasedKey = keys?.find((key) =>
      isTimeSeries([getDataValue(searchQueryDataFirstEntry, key)]),
    );

    if (!timeBasedKey) {
      return JSON.parse(JSON.stringify(processedData));
    }

    // Extract and process metaDataEndTime
    const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
    const endTime = new Date(parseInt(metaDataEndTime) / 1000);

    const xAxisKeysWithoutTimeStamp = getXAxisKeys().filter(
      (key: any) => key !== timeBasedKey,
    );
    const breakdownAxisKeysWithoutTimeStamp = getBreakDownKeys().filter(
      (key: any) => key !== timeBasedKey,
    );

    const timeKey = timeBasedKey;
    const uniqueKey =
      xAxisKeysWithoutTimeStamp[0] !== undefined
        ? xAxisKeysWithoutTimeStamp[0]
        : breakdownAxisKeysWithoutTimeStamp[0];

    // Create a set of unique xAxis values
    const uniqueXAxisValues = new Set(
      processedData.map((d: any) => getDataValue(d, uniqueKey)),
    );

    const filledData: any = [];
    let currentTime = binnedDate;
    // Create a map of existing data
    const searchDataMap = new Map();
    processedData?.forEach((d: any) => {
      const key =
        xAxisKeysWithoutTimeStamp.length > 0 ||
        breakdownAxisKeysWithoutTimeStamp.length > 0
          ? `${getDataValue(d, timeKey)}-${getDataValue(d, uniqueKey)}`
          : `${getDataValue(d, timeKey)}`;

      searchDataMap.set(key, d);
    });

    while (currentTime <= endTime) {
      const currentFormattedTime = format(
        toZonedTime(currentTime, "UTC"),
        "yyyy-MM-dd'T'HH:mm:ss",
      );

      if (
        xAxisKeysWithoutTimeStamp.length === 0 &&
        breakdownAxisKeysWithoutTimeStamp.length === 0
      ) {
        const key = `${currentFormattedTime}`;
        const currentData = searchDataMap.get(key);
        const nullEntry = {
          [timeKey]: currentFormattedTime,
          ...currentData,
        };
        if (!currentData) {
          keys.forEach((key) => {
            if (key !== timeKey) nullEntry[key] = noValueConfigOption;
          });
        }

        filledData.push(nullEntry);
      } else {
        uniqueXAxisValues.forEach((uniqueValue: any) => {
          const key = `${currentFormattedTime}-${uniqueValue}`;
          const currentData = searchDataMap.get(key);
          if (currentData) {
            filledData.push(currentData);
          } else {
            const nullEntry = {
              [timeKey]: currentFormattedTime,
              [uniqueKey]: uniqueValue,
            };

            keys.forEach((key) => {
              if (key !== timeKey && key !== uniqueKey) {
                nullEntry[key] = noValueConfigOption;
              }
            });

            filledData.push(nullEntry);
          }
        });
      }

      currentTime = new Date(currentTime.getTime() + intervalMillis);
    }

    return filledData;
  };

  const missingValueData = missingValue();
  // flag to check if the data is time series
  let isTimeSeriesFlag = false;

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
   * This method is used to configure trellis layout for the chart,  it will update the yAxis label properties
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

    options.yAxis.forEach((it: any, index: number) => {
      if (addMaxValue) {
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

      let showAxisLabel = true;

      if (isHorizontalChart) {
        showAxisLabel = options.yAxis.length - gridData.gridNoOfCol <= index;
      } else {
        showAxisLabel = index % gridData.gridNoOfCol === 0;
      }

      // Here we are setting the axis label properties, if showAxisLabel is false then we are hiding the axis label
      it.nameGap = showAxisLabel ? (isHorizontalChart ? 25 : yAxisNameGap) : 0;
      it.axisLabel.margin = showAxisLabel ? 5 : 0;
      it.axisLabel.fontSize = showAxisLabel ? 12 : 10;
      it.nameTextStyle.fontSize = 12;
      it.axisLabel.show = showAxisLabel;
      if (!showAxisLabel) it.name = "";
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
  let labelRotation = (hasTimestampField || isHorizontalChart) ? 0 : (panelSchema.config?.axis_label_rotate || 0);
  let labelWidth = (hasTimestampField || isHorizontalChart) ? 0 : (panelSchema.config?.axis_label_truncate_width || 0);

  // If truncate width is not set and not time-based/horizontal, calculate the actual max width from data
  if (!hasTimestampField && !isHorizontalChart && labelWidth === 0 && xAxisKeys.length > 0) {
    const longestLabelStr = largestLabel(getAxisDataFromKey(xAxisKeys[0]));
    labelWidth = calculateWidthText(longestLabelStr, "12px");
  } else if (!hasTimestampField && !isHorizontalChart && labelWidth === 0) {
    labelWidth = 120; // Fallback
  }

  const labelFontSize = 12;
  const labelMargin = 10;

  // Calculate the section height (nameGap) upfront so we can use it for bottom spacing
  // Skip rotation-based calculations for horizontal charts and time-based axes
  const dynamicXAxisNameGap = (hasTimestampField || isHorizontalChart) ? 25 : calculateDynamicNameGap(
    labelRotation,
    labelWidth,
    labelFontSize,
    25,
    labelMargin,
  );

  // Additional bottom space is only needed for non-horizontal, non-time-based charts
  const additionalBottomSpace = (hasTimestampField || isHorizontalChart) ? 0 : calculateRotatedLabelBottomSpace(
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
                ? (panelSchema.config?.axis_width == null ? 50 : 60)
                : (panelSchema.config?.axis_width == null ? 35 : 40);
          // When an x-axis name is present, `nameGap` already reserves space
          // between rotated labels and the axis name. Adding `additionalBottomSpace`
          // here causes double-counting and extra blank space beneath the axis
          // name. Only return the base bottom in this case.
          return baseBottom;
          })()
        : (() => {
            const baseBottom =
              legendConfig.orient === "vertical" && panelSchema.config?.show_legends
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
      const labelRotation = (hasTimestampField || isHorizontalChart) ? 0 : (panelSchema.config?.axis_label_rotate || 0);
      const labelWidth = (hasTimestampField || isHorizontalChart) ? 120 : (panelSchema.config?.axis_label_truncate_width || 120);
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

  // ------- Series Building Methods -----------

  /**
   * Retrieves unique values for the second x-axis key in a stacked chart.
   * Assumes the first value in breakDownKeys corresponds to the second x-axis key.
   *
   * @param breakDownKeys - Array of strings representing x-axis keys
   * @returns Array of unique values for the second x-axis key
   */
  function getUniqueStackedXAxisValues(breakDownKey: string): any[] {
    // Check if there's a second x-axis key in breakDownKeys
    if (!breakDownKey) return [];

    // Extract unique values for the second x-axis key
    // NOTE: while filter, we can't compare type as well because set will have string values
    const uniqueValues = [
      ...new Set(
        missingValueData.map((obj: any) => getDataValue(obj, breakDownKey)),
      ),
    ].filter((value: any) => value != null || value != undefined);

    return uniqueValues;
  }

  const getSeriesLabel = () => {
    return {
      show: panelSchema.config?.label_option?.position != null,
      position: panelSchema.config?.label_option?.position || "None",
      rotate: panelSchema.config?.label_option?.rotate || 0,
    };
  };

  const { markLines, markAreas } = getAnnotationsData(
    annotations,
    store.state.timezone,
  );

  const getSeriesMarkLine = () => {
    return {
      silent: true,
      animation: false,
      data: getMarkLineData(panelSchema),
    };
  };

  const getAnnotationMarkLine = () => {
    return {
      itemStyle: {
        color: "rgba(108, 122, 125, 1)",
      },
      silent: false,
      animation: false,
      data: markLines,
    };
  };
  const getSeriesMarkArea = () => {
    return {
      itemStyle: {
        color: "rgba(0, 191, 255, 0.15)",
      },
      data: markAreas,
    };
  };

  const getSeriesData = (
    breakdownKey: string,
    yAxisKey: string,
    xAxisKey: string,
  ) => {
    if (!(breakdownKey !== null && yAxisKey !== null && xAxisKey !== null))
      return [];

    const data = missingValueData.filter(
      (it: any) => getDataValue(it, breakdownKey) == xAxisKey,
    );

    const seriesData = options.xAxis[0].data.map(
      (it: any) =>
        getDataValue(
          data.find((it2: any) => getDataValue(it2, xAxisKeys[0]) == it),
          yAxisKey,
        ) ?? null,
    );

    return seriesData;
  };
  const getSeriesObj = (
    yAxisName: string,
    seriesData: Array<number> = [],
    seriesConfig: Record<string, any>,
    seriesName: string,
  ): SeriesObject => {
    return {
      //only append if yaxiskeys length is more than 1
      name: yAxisName?.toString(),
      ...defaultSeriesProps,
      label: getSeriesLabel(),
      originalSeriesName: seriesName,
      // markLine if exist
      markLine: getSeriesMarkLine(),
      // markArea: getSeriesMarkArea(),
      // config to connect null values
      connectNulls: panelSchema.config?.connect_nulls ?? false,
      large: true,
      color:
        getSeriesColor(
          panelSchema.config.color,
          yAxisName,
          seriesData,
          chartMin,
          chartMax,
          store.state.theme,
          panelSchema?.config?.color?.colorBySeries,
        ) ?? null,
      data: seriesData,
      ...seriesConfig,
      zlevel: 2,
    };
  };

  const getYAxisLabel = (yAxisKey: string, xAXisKey: string = "") => {
    const label = panelSchema?.queries[0]?.fields?.y.find(
      (it: any) => it.alias == yAxisKey,
    )?.label;

    if (
      panelSchema.type == "area-stacked" ||
      ((panelSchema.type == "line" ||
        panelSchema.type == "area" ||
        panelSchema.type == "scatter" ||
        panelSchema.type == "bar" ||
        panelSchema.type == "h-bar" ||
        panelSchema.type == "stacked" ||
        panelSchema.type == "h-stacked") &&
        panelSchema.queries[0].fields.breakdown?.length)
    ) {
      return yAxisKeys.length === 1
        ? xAXisKey !== ""
          ? xAXisKey
          : label
        : `${xAXisKey} (${label})`;
    }

    return label;
  };

  const getSeries = (seriesConfig: Record<string, any> = {}) => {
    let stackedXAxisUniqueValue = [];
    let breakdownKey = "";

    // Area-stacked, stacked, h-stacked and trellis needs breakdown field
    if (breakDownKeys?.length) {
      breakdownKey = breakDownKeys[0];
      // get the unique value of the second xAxis's key
      stackedXAxisUniqueValue = getUniqueStackedXAxisValues(breakdownKey);
    }

    return (
      yAxisKeys
        .map((yAxis: any, index: number) => {
          let yAxisName = getYAxisLabel(yAxis);

          if (breakDownKeys.length) {
            return stackedXAxisUniqueValue?.map((key: any) => {
              // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
              yAxisName = getYAxisLabel(yAxis, key);

              const seriesData = getSeriesData(breakdownKey, yAxis, key);
              // Add stack property for stacked charts
              const updatedSeriesConfig = {
                ...seriesConfig,
                // Only add stack property for stacked or h-stacked chart types
                ...(["stacked", "h-stacked"].includes(panelSchema.type) && {
                  stack: `stack-${index}`,
                }),
                yAxisGroup: index,
              };
              // Can create different method to get series
              return getSeriesObj(
                yAxisName,
                seriesData,
                updatedSeriesConfig,
                key,
              );
            });
          } else {
            const seriesData = getAxisDataFromKey(yAxis);
            const updatedSeriesConfig = {
              ...seriesConfig,
              yAxisGroup: index,
            };
            return getSeriesObj(yAxisName, seriesData, updatedSeriesConfig, "");
          }
        })
        .flat() || []
    );
  };

  // ------- End of Series Building Methods -----------

  // Now set the series values as per the chart data
  // Override any configs if required as per the chart type
  switch (panelSchema.type) {
    case "area-stacked":
    case "line":
    case "area":
    case "scatter":
    case "bar": {
      //if area stacked then continue
      //or if area or line or scatter, then check x axis length
      if (
        panelSchema.type == "area-stacked" ||
        ((panelSchema.type == "line" ||
          panelSchema.type == "area" ||
          panelSchema.type == "scatter" ||
          panelSchema.type == "bar") &&
          panelSchema.queries[0].fields.breakdown?.length)
      ) {
        options.xAxis = options.xAxis.slice(0, 1);
        options.tooltip.axisPointer.label = {
          show: true,
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          label: {
            fontsize: 12,
            precision: panelSchema.config?.decimals,
          },
          formatter: function (params: any) {
            try {
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              return params?.value?.toString();
            } catch (error) {
              return params?.value?.toString() ?? "";
            }
          },
        };
        const xAxisLabelRotation = hasTimestampField ? 0 : (panelSchema.config?.axis_label_rotate || 0);
        const xAxisLabelWidth = panelSchema.config?.axis_label_truncate_width || 120;
        options.xAxis[0].axisLabel = {
          rotate: xAxisLabelRotation,
        };
        options.xAxis[0].axisTick = {};
        options.xAxis[0].nameGap = dynamicXAxisNameGap;

        // get the unique value of the first xAxis's key
        options.xAxis[0].data = Array.from(
          new Set(getAxisDataFromKey(xAxisKeys[0])),
        );
        // options.xAxis[0].data = Array.from(new Set(options.xAxis[0].data));
      } else if (
        panelSchema.type !== "line" &&
        panelSchema.type !== "area" &&
        panelSchema.type !== "bar"
      ) {
        options.tooltip.formatter = function (name: any) {
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
              if (it.data != null) {
                // check if the series is the current series being hovered
                // if have than bold it
                if (
                  it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
                )
                  hoverText.push(
                    `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                      getUnitValue(
                        it.data,
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
                        it.data,
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
        };
      }

      options.series = getSeries(
        panelSchema.type == "line" || panelSchema.type == "area"
          ? { opacity: 0.8 }
          : panelSchema.type == "bar"
            ? { barMinHeight: 1 }
            : {},
      );

      if (
        (panelSchema.type === "line" ||
          panelSchema.type == "area" ||
          panelSchema.type == "scatter" ||
          panelSchema.type == "bar") &&
        panelSchema.config.trellis?.layout &&
        breakDownKeys.length
      )
        updateTrellisConfig();

      break;
    }
    case "h-bar": {
      //generate trace based on the y axis keys
      options.series = getSeries({ barMinHeight: 1 });

      if (panelSchema.config.trellis?.layout && breakDownKeys.length) {
        updateTrellisConfig();
      }

      //swap x and y axis
      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;

      // xAxisKeys will be 1
      if (!panelSchema.config.trellis?.layout) {
        const xAxisMaxLabel =
          calculateWidthText(
            xAxisKeys.reduce(
              (str: any, it: any) => largestLabel(getAxisDataFromKey(it)),
              "",
            ),
          ) + 16;

        // breakDownKeys will be 0 or 1
        const breakDownMaxLabel =
          calculateWidthText(
            breakDownKeys.reduce(
              (str: any, it: any) => largestLabel(getAxisDataFromKey(it)),
              "",
            ),
          ) + 16;

        options.yAxis.forEach((it: any) => {
          it.axisLabel.overflow = "truncate";
          it.nameGap =
            Math.min(
              Math.max(xAxisMaxLabel, breakDownMaxLabel),
              it.axisLabel.width,
            ) + 10;
        });

        options.xAxis.name =
          panelSchema.queries[0]?.fields?.y?.length >= 1
            ? panelSchema.queries[0]?.fields?.y[0]?.label
            : "";
        // For h-bar, xAxis is the bottom axis after swap
        // Apply dynamic nameGap calculation if rotation is configured
        options.xAxis.nameGap = dynamicXAxisNameGap;
      }

      break;
    }
    case "pie": {
      // Add more padding for pie chart
      options.grid = {
        containLabel: true,
        left: "15%",
        right: "15%",
        top: "15%",
        bottom: "15%",
      };
      options.tooltip = {
        trigger: "item",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        formatter: function (name: any) {
          try {
            // show tooltip for hovered panel only for other we only need axis so just return empty string
            if (
              hoveredSeriesState?.value &&
              panelSchema.id &&
              hoveredSeriesState?.value?.panelId != panelSchema.id
            )
              return "";
            return `${name?.marker} ${name?.name} : <b>${formatUnitValue(
              getUnitValue(
                name?.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
            )}</b>`;
          } catch (error) {
            return "";
          }
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...defaultSeriesProps,
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options?.xAxis[0]?.data[i] };
          }),
          itemStyle: {
            color: ["palette-classic"].includes(panelSchema.config?.color?.mode)
              ? null
              : (params: any) => {
                  return (
                    getSeriesColor(
                      panelSchema?.config?.color,
                      params.name,
                      [params.value],
                      chartMin,
                      chartMax,
                      store.state.theme,
                      panelSchema?.config?.color?.colorBySeries,
                    ) ?? null
                  );
                },
          },
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
          percentPrecision: panelSchema.config?.decimals ?? 2,
        };
        return seriesObj;
      });

      if (options.series.length > 0) {
        // Get current chart dimensions
        const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

        // Calculate responsive radius that accounts for dynamic resizing
        const pieRadius = getPieChartRadius(options.series[0].data);
        options.series[0].radius = `${pieRadius}%`;

        // Apply chart alignment - only when legend position is right and chart_align is explicitly set
        const shouldApplyAlignment =
          panelSchema.config?.show_legends &&
          panelSchema.config?.legends_position === "right" &&
          (panelSchema.config?.legends_type === "plain" ||
            panelSchema.config?.legends_type === "scroll" ||
            panelSchema.config?.legends_type === null) &&
          panelSchema.config?.chart_align; // Only apply when chart_align is explicitly set

        if (shouldApplyAlignment) {
          // Apply chart alignment based on container properties
          const containerProps = calculatePieChartContainer(
            panelSchema,
            chartWidth,
            chartHeight,
            options.series[0].data || [],
          );

          // Apply center positioning based on alignment requirements
          if (containerProps.shouldUseGridAlignment) {
            // Calculate center position for alignment within ONLY the chart area (excluding legend)
            const chartAlign = panelSchema.config?.chart_align;
            const chartAreaWidth = containerProps.availableWidth;

            let centerX = 50; // Default center
            let centerY = 50; // Default center

            // For right legends, adjust horizontal positioning
            const chartAreaRadius = Math.min(chartAreaWidth, chartHeight) * 0.4; // 40% of smaller dimension
            const radiusAsPercentOfTotal = (chartAreaRadius / chartWidth) * 100;
            const minSafeXInChartArea = radiusAsPercentOfTotal + 2; // 2% padding
            switch (chartAlign) {
              case "left": {
                // Position chart to the left within ONLY the chart area
                const leftPositionInChartArea = chartAreaWidth * 0.25; // 25% into chart area
                centerX = Math.max(
                  minSafeXInChartArea,
                  (leftPositionInChartArea / chartWidth) * 100,
                );
                break;
              }
              case "center":
              default: {
                // Center within ONLY the chart area
                const chartAreaCenter = chartAreaWidth / 2;
                centerX = (chartAreaCenter / chartWidth) * 100;
                break;
              }
            }

            const finalCenter = [`${centerX}%`, `${centerY}%`];
            options.series[0].center = finalCenter;
          } else {
            // Fallback to default center when grid alignment is not used
            options.series[0].center = ["50%", "50%"];
          }
        } else {
          applyPieDonutCenterAdjustment(
            panelSchema,
            options,
            chartWidth,
            chartHeight,
          );
        }
      }

      options.xAxis = [];
      options.yAxis = [];
      break;
    }
    case "donut": {
      // Add more padding for donut chart
      options.grid = {
        containLabel: true,
        left: "15%",
        right: "15%",
        top: "15%",
        bottom: "15%",
      };
      options.tooltip = {
        trigger: "item",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        formatter: function (name: any) {
          try {
            // show tooltip for hovered panel only for other we only need axis so just return empty string
            if (
              hoveredSeriesState?.value &&
              panelSchema.id &&
              hoveredSeriesState?.value?.panelId != panelSchema.id
            )
              return "";
            return `${name?.marker} ${name?.name} : <b>${formatUnitValue(
              getUnitValue(
                name?.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
            )}<b/>`;
          } catch (error) {
            return "";
          }
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...defaultSeriesProps,
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options?.xAxis[0]?.data[i] };
          }),
          itemStyle: {
            color: ["palette-classic"].includes(panelSchema.config?.color?.mode)
              ? null
              : (params: any) => {
                  return (
                    getSeriesColor(
                      panelSchema?.config?.color,
                      params.name,
                      [params.value],
                      chartMin,
                      chartMax,
                      store.state.theme,
                      panelSchema?.config?.color?.colorBySeries,
                    ) ?? null
                  );
                },
          },
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
          percentPrecision: panelSchema.config?.decimals ?? 2,
        };
        return seriesObj;
      });

      if (options.series.length > 0) {
        // Get current chart dimensions
        const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

        const outerRadius: number = getPieChartRadius(options.series[0].data);

        // Adjust inner radius based on outer radius size for better proportions
        const thickness = outerRadius > 70 ? 35 : 30;
        const innterRadius = Math.max(outerRadius - thickness, 20); // Ensure minimum inner radius

        options.series[0].radius = [`${innterRadius}%`, `${outerRadius}%`];

        // Apply chart alignment and center positioning using centralized function
        applyPieDonutChartAlignment(
          panelSchema,
          options,
          chartWidth,
          chartHeight,
        );
      }

      options.xAxis = [];
      options.yAxis = [];
      break;
    }
    case "stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0])),
      );
      options.xAxis = options.xAxis.slice(0, 1);
      options.tooltip.axisPointer.label = {
        show: true,
        backgroundColor: store.state.theme === "dark" ? "#333" : "",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
        },
        formatter: function (params: any) {
          try {
            if (params?.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  params?.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              );
            return params?.value?.toString();
          } catch (error) {
            return params?.value?.toString() ?? "";
          }
        },
      };
      const stackedXAxisRotation = hasTimestampField ? 0 : (options.xAxis[0].axisLabel?.rotate || 0);
      const stackedXAxisWidth = hasTimestampField ? 120 : (panelSchema.config?.axis_label_truncate_width || 120);
      options.xAxis[0].axisLabel.margin = 5;
      options.xAxis[0].axisLabel = {
        rotate: stackedXAxisRotation,
      };
      options.xAxis[0].axisTick = {};
      options.xAxis[0].nameGap = calculateDynamicNameGap(
        stackedXAxisRotation,
        stackedXAxisWidth,
        12,
        25,
        5,
      );

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      options.series = getSeries({ barMinHeight: 1 });

      break;
    }
    case "heatmap": {
      // get first x axis key
      const key0 = xAxisKeys[0];
      // get the unique value of the first xAxis's key
      let xAxisZerothPositionUniqueValue = [
        ...new Set(
          searchQueryData[0].map((obj: any) => getDataValue(obj, key0)),
        ),
      ].filter((it) => it);

      // get second x axis key
      const key1 = yAxisKeys[0];
      // get the unique value of the second xAxis's key
      const xAxisFirstPositionUniqueValue = [
        ...new Set(
          searchQueryData[0].map((obj: any) => getDataValue(obj, key1)),
        ),
      ].filter((it) => it);

      const yAxisKey0 = zAxisKeys[0];
      const zValues: any = xAxisFirstPositionUniqueValue.map((first: any) => {
        // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
        const data = searchQueryData[0].filter(
          (it: any) => getDataValue(it, key1) == first,
        );

        return xAxisZerothPositionUniqueValue.map((zero: any) => {
          return (
            getDataValue(
              data.find((it: any) => getDataValue(it, key0) == zero),
              yAxisKey0,
            ) || "-"
          );
        });
      });

      (options.visualMap = {
        min: 0,
        max: zValues.reduce(
          (a: any, b: any) =>
            Math.max(
              a,
              b.reduce((c: any, d: any) => Math.max(c, +d || 0), 0),
            ),
          0,
        ),
        calculable: true,
        orient: "horizontal",
        left: "center",
      }),
        (options.series = [
          {
            ...defaultSeriesProps,
            name: panelSchema?.queries[0]?.fields?.y[0].label,

            data: zValues
              .map((it: any, index: any) => {
                return xAxisZerothPositionUniqueValue.map(
                  (i: any, j: number) => {
                    return [j, index, it[j]];
                  },
                );
              })
              .flat(),
            label: {
              show: true,
              fontSize: 12,
              formatter: (params: any) => {
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
              },
            },
          },
        ]);
      // option.yAxis.data=xAxisFirstPositionUniqueValue;
      (options.tooltip = {
        position: "top",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
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
            return `${
              options?.yAxis?.data[params?.value[1]] || params?.seriesName
            } <br/> ${params?.marker} ${params?.name} : ${
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  panelSchema?.config?.unit,
                  panelSchema?.config?.unit_custom,
                  panelSchema?.config?.decimals,
                ),
              ) || params?.value?.[2]
            }`;
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
            backgroundColor: store.state.theme === "dark" ? "#333" : "",
          },
        });
      // if auto sql
      if (panelSchema?.queries[0]?.customQuery == false) {
        // check if x axis has histogram or not
        // for heatmap we only have one field in x axis event we have used find fn

        const field = panelSchema.queries[0].fields?.x.find(
          (it: any) =>
            it.functionName == "histogram" &&
            it?.args?.[0]?.value?.field ==
              store.state?.zoConfig?.timestamp_column,
        );
        // if histogram
        if (field) {
          // convert time string to selected timezone
          xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map(
            (it: any) => {
              return formatDate(toZonedTime(it + "Z", store.state.timezone));
            },
          );
        }
        // else custom sql
      } else {
        // sampling data to know whether data is timeseries or not
        const sample = xAxisZerothPositionUniqueValue.slice(
          0,
          Math.min(20, xAxisZerothPositionUniqueValue.length),
        );
        // if timeseries
        if (isTimeSeries(sample)) {
          // convert time string to selected timezone
          xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map(
            (it: any) => {
              return formatDate(toZonedTime(it + "Z", store.state.timezone));
            },
          );
        }
      }

      options.grid.bottom = 60;
      (options.xAxis = [
        {
          type: "category",
          data: xAxisZerothPositionUniqueValue,
          splitArea: {
            show: true,
          },
        },
      ]),
        [
          (options.yAxis = {
            type: "category",
            data: xAxisFirstPositionUniqueValue,
            splitArea: {
              show: true,
            },
          }),
        ];
      options.legend.show = false;
      break;
    }
    case "h-stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0])),
      );

      options.xAxis = options.xAxis.slice(0, 1);

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      options.series = getSeries({ barMinHeight: 1 });

      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;

      const maxYaxisWidth = options.yAxis.reduce((acc: number, it: any) => {
        return Math.max(acc, it.axisLabel.width || 0);
      }, 0);

      options.yAxis.map((it: any) => {
        it.nameGap =
          Math.min(calculateWidthText(largestLabel(it.data)), maxYaxisWidth) +
          10;
      });

      // For h-stacked, xAxis is actually the original yAxis (bottom axis after swap)
      // Apply dynamic nameGap calculation if rotation is configured
      options.xAxis.nameGap = dynamicXAxisNameGap;

      break;
    }
    case "metric": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);
      const unitValue = getUnitValue(
        yAxisValue.length > 0 ? yAxisValue[0] : 0,
        panelSchema.config?.unit,
        panelSchema.config?.unit_custom,
        panelSchema.config?.decimals,
      );
      options.backgroundColor =
        panelSchema.config?.background?.value?.color ?? "";
      options.dataset = { source: [[]] };
      options.tooltip = {
        show: false,
      };
      options.angleAxis = {
        show: false,
      };
      options.radiusAxis = {
        show: false,
      };
      options.polar = {};
      options.xAxis = [];
      options.yAxis = [];
      options.series = [
        {
          ...defaultSeriesProps,
          renderItem: function (params: any) {
            try {
              const backgroundColor =
                panelSchema.config?.background?.value?.color;
              const isDarkTheme = store.state.theme === "dark";

              return {
                type: "text",
                style: {
                  text: formatUnitValue(unitValue),
                  fontSize: calculateOptimalFontSize(
                    formatUnitValue(unitValue),
                    params?.coordSys?.cx * 2,
                  ), //coordSys is relative. so that we can use it to calculate the dynamic size
                  fontWeight: 500,
                  align: "center",
                  verticalAlign: "middle",
                  x: params?.coordSys?.cx,
                  y: params?.coordSys?.cy,
                  fill: getContrastColor(backgroundColor, isDarkTheme),
                },
              };
            } catch (error) {
              return "";
            }
          },
        },
      ];
      break;
    }
    case "gauge": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);
      // used for gague name
      const xAxisValue = getAxisDataFromKey(xAxisKeys[0]);

      // create grid array based on chart panel width, height and total no. of gauge
      const gridDataForGauge = calculateGridPositions(
        chartPanelRef.value.offsetWidth,
        chartPanelRef.value.offsetHeight,
        yAxisValue.length || 1,
      );

      options.dataset = { source: [[]] };
      options.tooltip = {
        show: true,
        trigger: "item",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        valueFormatter: (value: any) => {
          try {
            // unit conversion
            return formatUnitValue(
              getUnitValue(
                value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
            );
          } catch (error) {
            return value ?? "";
          }
        },
        enterable: true,
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        extraCssText:
          "max-height: 200px; overflow: auto; max-width: 500px; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.5) transparent;",
      };
      options.angleAxis = {
        show: false,
      };
      options.radiusAxis = {
        show: false,
      };
      options.polar = {};
      options.xAxis = [];
      options.yAxis = [];
      // for each gague we have separate grid
      options.grid = gridDataForGauge.gridArray;

      const gaugeData = yAxisValue.length > 0 ? yAxisValue : [0];
      const gaugeNames = xAxisValue.length > 0 ? xAxisValue : [""];

      options.series = gaugeData.map((it: any, index: any) => {
        return {
          ...defaultSeriesProps,
          min: panelSchema?.queries[0]?.config?.min || 0,
          max: panelSchema?.queries[0]?.config?.max || 100,

          //which grid will be used
          gridIndex: index,
          // radius, progress and axisline width will be calculated based on grid width and height
          radius: `${
            Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight) /
              2 -
            5
          }px`,
          progress: {
            show: true,
            width: `${
              Math.min(
                gridDataForGauge.gridWidth,
                gridDataForGauge.gridHeight,
              ) / 6
            }`,
          },
          axisLine: {
            lineStyle: {
              width: `${
                Math.min(
                  gridDataForGauge.gridWidth,
                  gridDataForGauge.gridHeight,
                ) / 6
              }`,
            },
          },
          title: {
            fontSize: 10,
            offsetCenter: [0, "70%"],
            // width: upto chart width
            width: `${gridDataForGauge.gridWidth}`,
            overflow: "truncate",
          },

          // center of gauge
          // x: left + width / 2,
          // y: top + height / 2,
          center: [
            `${
              parseFloat(options.grid[index].left) +
              parseFloat(options.grid[index].width) / 2
            }%`,
            `${
              parseFloat(options.grid[index].top) +
              parseFloat(options.grid[index].height) / 2
            }%`,
          ],

          data: [
            {
              // gauge name may have or may not have
              name: gaugeNames[index] ?? "",
              value: it,
              detail: {
                formatter: function (value: any) {
                  try {
                    const unitValue = getUnitValue(
                      value,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    );
                    return unitValue.value + unitValue.unit;
                  } catch (error) {
                    return value ?? "";
                  }
                },
              },
              itemStyle: {
                color:
                  getSeriesColor(
                    panelSchema?.config?.color,
                    gaugeNames[index] ?? "",
                    [it],
                    chartMin,
                    chartMax,
                    store.state.theme,
                    panelSchema?.config?.color?.colorBySeries,
                  ) ?? null,
              },
            },
          ],
          detail: {
            valueAnimation: true,
            offsetCenter: [0, 0],
            fontSize: 12,
          },
        };
      });
      break;
    }

    default: {
      break;
    }
  }

  // auto SQL: if x axis has time series
  if (
    panelSchema.type != "h-bar" &&
    panelSchema.type != "h-stacked" &&
    panelSchema.type != "heatmap" &&
    panelSchema.type != "metric" &&
    panelSchema.type != "pie" &&
    panelSchema.type != "donut" &&
    panelSchema?.queries[0]?.customQuery == false &&
    Array.isArray(options.xAxis) &&
    options.xAxis.length > 0 &&
    options.xAxis[0].data.length > 0
  ) {
    // auto SQL: if x axis has time series(aggregation function is histogram)
    const field = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        it.functionName == "histogram" &&
        it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
    );

    const timestampField = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        !it.functionName &&
        it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
    );

    //if x axis has time series
    if (field || timestampField) {
      // set timeseries flag as a true
      isTimeSeriesFlag = true;

      // if timezone is UTC then simply return x axis value which will be in UTC (note that need to remove Z from timezone string)
      // else check if xaxis value is integer(ie time will be in milliseconds)
      // if yes then return to convert into other timezone
      // if no then create new datetime object and get in milliseconds using getTime method
      const timeStringCache: any = {};
      options?.series?.forEach((seriesObj: any) => {
        // if value field is not present in the data than use null
        if (field) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => {
            const xKey = options.xAxis[0].data[index] + "Z";
            let x;
            if (timeStringCache[xKey]) {
              x = timeStringCache[xKey];
            } else {
              // need to consider time range gap
              x = toZonedTime(
                new Date(options.xAxis[0].data[index] + "Z").getTime() +
                  (metadata?.queries[0]?.timeRangeGap.seconds ?? 0),
                store.state.timezone,
              );
              timeStringCache[xKey] = x;
            }
            return [x, it ?? null];
          });
        } else if (timestampField) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => {
            const xKey = options.xAxis[0].data[index].toString();
            let x;
            if (timeStringCache[xKey]) {
              x = timeStringCache[xKey];
            } else {
              // need to consider time range gap
              x = toZonedTime(
                (new Date(options.xAxis[0].data[index]).getTime() +
                  (metadata?.queries[0]?.timeRangeGap.seconds ?? 0)) /
                  1000,
                store.state.timezone,
              );
              timeStringCache[xKey] = x;
            }
            return [x, it ?? null];
          });
        }
      });

      // Trellis has multiple x axis
      if (panelSchema.config.trellis?.layout) {
        options.xAxis.forEach((axis: any) => {
          axis.type = "time";
          // For time-based x-axis, reset axis label rotation and truncation
          if (axis.axisLabel) {
            axis.axisLabel.rotate = 0;
            axis.axisLabel.overflow = "none";
            axis.axisLabel.width = undefined;
          }
          // Recalculate nameGap with 0 rotation for time-based axis
          if (axis.name) {
            axis.nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
          }
        });
      } else {
        options.xAxis[0].type = "time";
        // For time-based x-axis, reset axis label rotation and truncation
        if (options.xAxis[0].axisLabel) {
          options.xAxis[0].axisLabel.rotate = 0;
          options.xAxis[0].axisLabel.overflow = "none";
          options.xAxis[0].axisLabel.width = undefined;
        }
        // Recalculate nameGap with 0 rotation for time-based axis
        if (options.xAxis[0].name) {
          options.xAxis[0].nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
        }
      }

      options.xAxis[0].data = [];

      options.tooltip.formatter = function (name: any) {
        // show tooltip for hovered panel only for other we only need axis so just return empty string

        // if (
        //   showTrellisConfig(panelSchema.type) &&
        //   panelSchema.config.trellis?.layout &&
        //   breakDownKeys.length
        // )
        //   name = [name[0]];

        if (
          hoveredSeriesState?.value &&
          panelSchema.id &&
          hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        if (name.length == 0) return "";

        const date = new Date(name[0].data[0]);

        // sort tooltip array based on value
        name.sort((a: any, b: any) => {
          return (b.value[1] || 0) - (a.value[1] || 0);
        });

        // if hovered series name is not null then move it to first position
        if (hoveredSeriesState?.value?.hoveredSeriesName) {
          // get the current series index from name
          const currentSeriesIndex = name.findIndex(
            (it: any) =>
              it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
          );

          // if hovered series index is not -1 then take it to very first position
          if (currentSeriesIndex != -1) {
            // shift all series to next position and place current series at first position
            const temp = name[currentSeriesIndex];
            for (let i = currentSeriesIndex; i > 0; i--) {
              name[i] = name[i - 1];
            }
            name[0] = temp;
          }
        }

        const hoverText: string[] = [];

        name.forEach((it: any) => {
          if (it.data[1] != null) {
            // check if the series is the current series being hovered
            // if have than bold it
            if (it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName)
              hoverText.push(
                `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data[1],
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
                    it.data[1],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )}`,
              );
          }
        });

        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      };

      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          formatter: function (params: any) {
            try {
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              return Number.isInteger(params?.value)
                ? formatDate(new Date(params?.value))
                : params?.value;
            } catch (error) {
              return params?.value ?? "";
            }
          },
        },
        formatter: function (params: any) {
          try {
            const date = new Date(params?.[0]?.value?.[0]);
            return formatDate(date)?.toString() ?? "";
          } catch (error) {
            return "";
          }
        },
      };
    }
  }

  //custom SQL: check if it is timeseries or not
  if (
    panelSchema.type != "h-bar" &&
    panelSchema.type != "h-stacked" &&
    panelSchema.type != "heatmap" &&
    panelSchema.type != "metric" &&
    panelSchema.type != "pie" &&
    panelSchema.type != "donut" &&
    panelSchema?.queries[0]?.customQuery == true &&
    Array.isArray(options.xAxis) &&
    options.xAxis.length > 0 &&
    options.xAxis[0].data.length > 0
  ) {
    const sample = options.xAxis[0].data.slice(
      0,
      Math.min(20, options.xAxis[0].data.length),
    );

    const isTimeSeriesData = isTimeSeries(sample);

    const isTimeStampData = isTimeStamp(sample, null);

    if (isTimeSeriesData || isTimeStampData) {
      // set timeseries flag as a true
      isTimeSeriesFlag = true;

      options?.series?.forEach((seriesObj: any) => {
        // if value field is not present in the data than use null
        if (isTimeSeriesData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              new Date(options.xAxis[0].data[index] + "Z").getTime() +
                (metadata?.queries[0]?.timeRangeGap.seconds ?? 0),
              store.state.timezone,
            ),
            it ?? null,
          ]);
        } else if (isTimeStampData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              (new Date(options.xAxis[0].data[index]).getTime() +
                (metadata?.queries[0]?.timeRangeGap.seconds ?? 0)) /
                1000,
              store.state.timezone,
            ),
            it ?? null,
          ]);
        }
      });

      // Trellis has multiple x axis
      if (panelSchema.config.trellis?.layout) {
        options.xAxis.forEach((axis: any) => {
          axis.type = "time";
          // For time-based x-axis, reset axis label rotation and truncation
          if (axis.axisLabel) {
            axis.axisLabel.rotate = 0;
            axis.axisLabel.overflow = "none";
            axis.axisLabel.width = undefined;
          }
          // Recalculate nameGap with 0 rotation for time-based axis
          if (axis.name) {
            axis.nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
          }
        });
      } else {
        options.xAxis[0].type = "time";
        // For time-based x-axis, reset axis label rotation and truncation
        if (options.xAxis[0].axisLabel) {
          options.xAxis[0].axisLabel.rotate = 0;
          options.xAxis[0].axisLabel.overflow = "none";
          options.xAxis[0].axisLabel.width = undefined;
        }
        // Recalculate nameGap with 0 rotation for time-based axis
        if (options.xAxis[0].name) {
          options.xAxis[0].nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
        }
      }

      options.xAxis[0].data = [];
      options.tooltip.formatter = function (name: any) {
        try {
          // if (
          //   showTrellisConfig(panelSchema.type) &&
          //   panelSchema.config.trellis?.layout &&
          //   breakDownKeys.length
          // )
          //   name = [name[0]];

          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          if (name?.length == 0) return "";

          const date = new Date(name?.[0]?.data?.[0]);

          // sort tooltip array based on value
          name?.sort((a: any, b: any) => {
            return (b?.value?.[1] || 0) - (a?.value?.[1] || 0);
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
            if (it?.data?.[1] != null) {
              // check if the series is the current series being hovered
              // if have than bold it
              if (
                it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
              )
                hoverText.push(
                  `<strong>${it?.marker} ${it?.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it?.data?.[1],
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
                      it?.data?.[1],
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )}`,
                );
            }
          });

          return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
        } catch (error) {
          return "";
        }
      };
      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          formatter: function (params: any) {
            try {
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              return formatDate(new Date(params?.value))?.toString() ?? "";
            } catch (error) {
              return params?.value ?? "";
            }
          },
        },
        formatter: function (params: any) {
          try {
            const date = new Date(params?.[0]?.value?.[0]);
            return formatDate(date)?.toString() ?? "";
          } catch (error) {
            return "";
          }
        },
      };
    }
  }

  // stacked chart sort by y axis
  // ignore if time series chart
  if (
    ["stacked", "h-stacked", "area-stacked"].includes(panelSchema?.type) &&
    isTimeSeriesFlag == false
  ) {
    // get x axis object
    // for h-stacked, categorical axis is y axis
    // for stacked and area-stacked, categorical axis is x axis
    const xAxisObj =
      panelSchema.type == "h-stacked" ? options.yAxis : options.xAxis;

    // check if order by uses y axis field
    // will return null if not exist
    // will return ASC or DESC if exist
    const isYAxisExistInOrderBy = await isGivenFieldInOrderBy(
      metadata?.queries[0]?.query ?? "",
      yAxisKeys[0],
    );
    if (isYAxisExistInOrderBy) {
      // Calculate the total for each series and combine it with the corresponding x-axis label
      const totals = new Map();
      for (let i = 0; i < xAxisObj[0]?.data?.length; i++) {
        const total = options?.series?.reduce(
          (sum: number, currentSeries: any) =>
            sum + (currentSeries?.data[i] ?? 0),
          0,
        );
        totals.set(i, { label: xAxisObj[0]?.data[i], total });
      }

      // Sort the indices by total in the specified order
      // ASC for ascending, DESC for descending
      const sortedIndices = Array.from(totals.keys()).sort((a, b) => {
        const diff = totals.get(a).total - totals.get(b).total;
        return isYAxisExistInOrderBy == "ASC" ? diff : -diff;
      });

      // Create new sorted arrays for the x-axis labels and series
      xAxisObj[0].data = sortedIndices.map((i) => totals.get(i).label);
      options.series = options?.series?.map((currentSeries: any) => {
        currentSeries.data = sortedIndices?.map((i) => currentSeries?.data[i]);
        return currentSeries;
      });
    }
  }

  // Apply all legend configurations using the new centralized function
  applyLegendConfiguration(
    panelSchema,
    chartPanelRef,
    hoveredSeriesState,
    options,
  );

  //check if is there any data else filter out axis or series data
  // for metric, gauge we does not have data field
  if (!["metric", "gauge"].includes(panelSchema.type)) {
    options.series = options.series.filter((it: any) => it.data?.length);
    if (panelSchema.type == "h-bar" || panelSchema.type == "h-stacked") {
      options.xAxis = options.xAxis;
    } else if (!["pie", "donut"].includes(panelSchema.type)) {
      options.yAxis = options.yAxis;
    }
  }
  // allowed to zoom, only if timeseries
  options.toolbox.show = options.toolbox.show && isTimeSeriesFlag;

  if (
    [
      "area",
      "area-stacked",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "stacked",
      "h-stacked",
    ].includes(panelSchema.type) &&
    isTimeSeriesFlag &&
    !panelSchema.config.trellis?.layout
  ) {
    options.series.push({
      type: "line",
      data: [[convertedTimeStampToDataFormat, null]],
      markLine: getAnnotationMarkLine(),
      markArea: getSeriesMarkArea(),
      zlevel: 1,
    });
  }

  // Apply series color mappings via reusable helper
  applySeriesColorMappings(
    options.series,
    panelSchema?.config?.color?.colorBySeries,
    store.state.theme,
  );

  // Apply label truncation to x-axis only
  if (panelSchema.config?.axis_label_truncate_width) {
    if (Array.isArray(options.xAxis)) {
      options.xAxis.forEach((axis: any) => {
        if (!axis.axisLabel) axis.axisLabel = {};
        axis.axisLabel.width = panelSchema.config.axis_label_truncate_width;
        axis.axisLabel.overflow = "truncate";
      });
    } else if (options.xAxis) {
      if (!options.xAxis.axisLabel) options.xAxis.axisLabel = {};
      options.xAxis.axisLabel.width =
        panelSchema.config.axis_label_truncate_width;
      options.xAxis.axisLabel.overflow = "truncate";
    }
  }

  return {
    options,
    extras: {
      ...extras,
      panelId: panelSchema?.id,
      isTimeSeries: isTimeSeriesFlag,
    },
  };
};

/**
 * Finds the largest label in the given data array.
 *
 * @param {any[]} data - An array of data.
 * @return {any} The largest label in the data array.
 */
const largestLabel = (data: any) => {
  const largestlabel = data.reduce((largest: any, label: any) => {
    return label?.toString().length > largest?.toString().length
      ? label
      : largest;
  }, "");

  return largestlabel;
};



const showTrellisConfig = (type: string) => {
  const supportedTypes = new Set(["area", "bar", "h-bar", "line", "scatter"]);
  return supportedTypes.has(type);
};

/**
 * Retrieves the properties for a given chart type and returns them as an object.
 *
 * @param {string} type - The type of chart.
 * @return {Object} - The properties for the given chart type.
 */
const getPropsByChartTypeForSeries = (panelSchema: any) => {
  switch (panelSchema.type) {
    case "bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "line":
      return {
        type: "line",
        emphasis: { focus: "series" },
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? // TODO: replace this with type integrations
          panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        showSymbol: panelSchema.config?.show_symbol ?? false,
        areaStyle: null,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
      };
    case "scatter":
      return {
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5,
      };
    case "pie":
      return {
        type: "pie",
        avoidLabelOverlap: false,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          label: {
            show: true,
          },
        },
        label: {
          show: true,
        },
        radius: "50%",
        lineStyle: { width: 1.5 },
      };
    case "donut":
      return {
        type: "pie",
        radius: ["25%", "50%"],
        avoidLabelOverlap: false,
        label: {
          show: true,
          // position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        lineStyle: { width: 1.5 },
      };
    case "h-bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "area":
      return {
        type: "line",
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        emphasis: { focus: "series" },
        areaStyle: {},
        showSymbol: panelSchema.config?.show_symbol ?? false,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
      };
    case "stacked":
      return {
        type: "bar",
        emphasis: {
          focus: "series",
        },
        lineStyle: { width: 1.5 },
      };
    case "heatmap":
      return {
        type: "heatmap",
        label: {
          show: true,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
        lineStyle: { width: 1.5 },
      };
    case "area-stacked":
      return {
        type: "line",
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        stack: "Total",
        areaStyle: {},
        emphasis: {
          focus: "series",
        },
        showSymbol: panelSchema.config?.show_symbol ?? false,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
      };
    case "metric":
      return {
        type: "custom",
        coordinateSystem: "polar",
      };
    case "h-stacked":
      return {
        type: "bar",
        emphasis: {
          focus: "series",
        },
        lineStyle: { width: 1.5 },
      };
    case "gauge":
      return {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        progress: {
          show: true,
          width: 10,
        },
        pointer: {
          show: false,
        },
        axisLine: {
          lineStyle: {
            width: 10,
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: false,
        },
      };
    default:
      return {
        type: "bar",
      };
  }
};
