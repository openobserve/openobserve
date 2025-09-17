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
 * Data processing utilities for SQL data conversion
 */

import { largestLabel } from "./chartConfig";
import { getAxisDataFromKey } from "./axisUtils";

/**
 * Process the SQL data and convert it into a format suitable for the echarts
 * library.
 *
 * This function takes in the raw data returned from the SQL query and the
 * panel schema, and returns a processed data array that can be fed into the
 * echarts library.
 *
 * @param {any[]} data - The data returned from the SQL query.
 * @param {any} panelSchema - The schema of the panel.
 * @param {any} store - The store object.
 * @param {string[]} xAxisKeys - Array of X-axis keys.
 * @param {string[]} yAxisKeys - Array of Y-axis keys.
 * @param {string[]} breakDownKeys - Array of breakdown keys.
 * @param {any} extras - Extra configuration object.
 * @returns {any[]} - The processed data array.
 */
export const processData = (
  data: any[],
  panelSchema: any,
  store: any,
  xAxisKeys: string[],
  yAxisKeys: string[],
  breakDownKeys: string[],
  extras: any,
): any[] => {
  if (!data.length || !Array.isArray(data[0])) {
    return [];
  }

  const { top_results, top_results_others } = panelSchema.config;

  // get the limit series from the config
  // if top_results is enabled then use the top_results value
  // otherwise use the max_dashboard_series value
  const limitSeries = top_results
    ? (Math.min(
        top_results,
        store.state?.zoConfig?.max_dashboard_series ?? 100,
      ) ?? 100)
    : (store.state?.zoConfig?.max_dashboard_series ?? 100);

  const innerDataArray = data[0];

  if (!breakDownKeys.length) {
    return innerDataArray;
  }

  const breakdownKey = breakDownKeys[0];
  const yAxisKey = yAxisKeys[0];
  const xAxisKey = xAxisKeys[0];

  // Step 1: Aggregate y_axis values by breakdown, ensuring missing values are set to empty string
  const breakdown = innerDataArray.reduce((acc: any, item: any) => {
    let breakdownValue = item[breakdownKey];

    // Convert null, undefined, and empty string to a default empty string
    if (
      breakdownValue == null ||
      breakdownValue === "" ||
      breakdownValue === undefined
    ) {
      breakdownValue = "";
    }

    const yAxisValue = item[yAxisKey];

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

  innerDataArray.forEach((item: any) => {
    let breakdownValue = item[breakdownKey];

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
      const xAxisValue = String(item[xAxisKey]);
      othersObj[xAxisValue] =
        (othersObj[xAxisValue] || 0) + (+item[yAxisKey] || 0);
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

/**
 * Returns the largest label from the stacked chart data.
 * Calculates the largest value for each unique breakdown and sums those values.
 * @param axisKey - key of the yaxis
 * @param breakDownkey - key of the breakdown
 * @param missingValueData - filtered data array
 * @param xAxisKeys - Array of X-axis keys
 * @param yAxisKeys - Array of Y-axis keys
 * @param breakDownKeys - Array of breakdown keys
 * @returns {number} - the largest value
 */
export const largestStackLabel = (
  axisKey: string,
  breakDownkey: string,
  missingValueData: any[],
  xAxisKeys: string[],
  yAxisKeys: string[],
  breakDownKeys: string[],
) => {
  const data =
    missingValueData?.filter((item: any) => {
      return (
        xAxisKeys.every((key: any) => item[key] != null) &&
        yAxisKeys.every((key: any) => item[key] != null) &&
        breakDownKeys.every((key: any) => item[key] != null)
      );
    }) || [];

  const maxValues: any = {};

  data.forEach((obj: any) => {
    if (maxValues[obj[breakDownkey]]) {
      if (obj[axisKey] > maxValues[obj[breakDownkey]]) {
        maxValues[obj[breakDownkey]] = obj[axisKey];
      }
    } else {
      maxValues[obj[breakDownkey]] =
        typeof obj[axisKey] === "number" ? obj[axisKey] : 0;
    }
  });

  return Object.values(maxValues).reduce((a: any, b: any) => a + b, 0);
};

/**
 * Get the largest label for the chart based on chart type
 * @param panelSchema - Panel schema configuration
 * @param yAxisKeys - Array of Y-axis keys
 * @param breakDownKeys - Array of breakdown keys
 * @param missingValueData - Filtered data array
 * @param xAxisKeys - Array of X-axis keys
 * @returns The largest label value
 */
export const getLargestLabel = (
  panelSchema: any,
  yAxisKeys: string[],
  breakDownKeys: string[],
  missingValueData: any[],
  xAxisKeys: string[],
) => {
  if (
    (panelSchema.type === "stacked" || panelSchema.type === "area-stacked") &&
    breakDownKeys.length > 0
  ) {
    return largestStackLabel(
      yAxisKeys[0],
      breakDownKeys[0],
      missingValueData,
      xAxisKeys,
      yAxisKeys,
      breakDownKeys,
    );
  } else {
    return largestLabel(getAxisDataFromKey(yAxisKeys[0], missingValueData));
  }
};

/**
 * Returns the pie chart radius based on panel layout
 * @param panelSchema - Panel schema configuration
 * @returns {number} - the radius percentage
 */
export const getPieChartRadius = (panelSchema: any) => {
  if (!panelSchema.layout) {
    return 80;
  }
  const minRadius = Math.min(
    panelSchema.layout.w * 30,
    panelSchema.layout.h * 30,
  );

  if (minRadius === 0) {
    return 0;
  }

  const radius = minRadius / 2;

  let multiplier = 110;

  if (radius > 90) multiplier = 130;

  if (radius > 150) multiplier = 150;

  return (radius / minRadius) * multiplier;
};

/**
 * Get mark line data configuration for the chart
 * @param panelSchema - Panel schema configuration
 * @returns Array of mark line configurations
 */
export const getMarkLineData = (panelSchema: any) => {
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
