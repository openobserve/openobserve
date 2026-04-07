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

import { getDataValue } from "./aliasUtils";

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
 * @param {any} store - The Vuex store object.
 * @param {string[]} yAxisKeys - Array of y-axis key aliases.
 * @param {string[]} breakDownKeys - Array of breakdown key aliases.
 * @param {string[]} xAxisKeys - Array of x-axis key aliases.
 * @param {any} extras - Mutable extras object for warning messages.
 * @returns {any[]} - The processed data array.
 */
export const processData = (
  data: any[],
  panelSchema: any,
  store: any,
  yAxisKeys: string[],
  breakDownKeys: string[],
  xAxisKeys: string[],
  extras: any,
): any[] => {
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
  const breakdown = innerDataArray.reduce((acc: any, item: any) => {
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

  innerDataArray.forEach((item: any) => {
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
