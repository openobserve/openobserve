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

import { gt } from "@/types/i18n";

import { getDataValue } from "./aliasUtils";
import { addCommasToNumber } from "@/utils/formatters";

/** Stands in for a NULL breakdown value, which must stay a separate series from "". */
export const NULL_BREAKDOWN_VALUE = "\u0000null";

/** Stands in for the folded "others" bucket, so a real value "others" stays a separate series. */
export const OTHERS_BREAKDOWN_VALUE = "\u0000others";

/** The series name for a breakdown value, with stand-in names for NULL, "" and the others bucket. */
export const breakdownValueLabel = (value: string): string => {
  // Series names key saved colours, overrides and ${series.__name}, so they must not vary by locale.
  if (value === NULL_BREAKDOWN_VALUE) return "(null)";
  if (value === OTHERS_BREAKDOWN_VALUE) return "others";
  return value === "" ? "(empty)" : value;
};

const breakdownValueOf = (item: Record<string, unknown>, breakdownKey: string): string | number => {
  const value = getDataValue(item, breakdownKey);
  return value === null || value === undefined ? NULL_BREAKDOWN_VALUE : value;
};

/**
 * Process the SQL data and convert it into a format suitable for the echarts
 * library.
 *
 * This function takes in the raw data returned from the SQL query and the
 * panel schema, and returns a processed data array that can be fed into the
 * echarts library. When top_results is enabled it aggregates y-axis values by
 * breakdown, keeps the top-N breakdown keys, and optionally folds the rest into
 * an "others" bucket.
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

  // Each y-axis draws its own copy of every breakdown series, so the panel cap is shared between them.
  const maxSeries = store.state?.zoConfig?.max_dashboard_series ?? 100;
  const cap =
    yAxisKeys.length > 1 && breakDownKeys.length > 0
      ? Math.floor(maxSeries / yAxisKeys.length)
      : maxSeries;
  const limitSeries = top_results ? Math.min(top_results, cap) : cap;

  const innerDataArray = data[0];

  if (!breakDownKeys.length) {
    return innerDataArray;
  }

  const breakdownKey = breakDownKeys[0];
  const yAxisKey = yAxisKeys[0];
  const xAxisKey = xAxisKeys[0];

  // Step 1: Aggregate y_axis values by breakdown
  const breakdown = innerDataArray.reduce((acc: any, item: any) => {
    const breakdownValue = breakdownValueOf(item, breakdownKey);
    const yAxisValue = getDataValue(item, yAxisKey);

    acc[breakdownValue] = (acc[breakdownValue] || 0) + (+yAxisValue || 0);
    return acc;
  }, {});

  // Step 2: Sort and extract the top keys based on the configured number of top results
  const allKeys = Object.entries(breakdown).sort(([, a]: any, [, b]: any) => b - a);

  // A user's Top N cutting series is their choice; only the panel cap cutting them warns.
  if (allKeys.length > cap && (!top_results || top_results > cap)) {
    const seriesPerKey = yAxisKeys.length || 1;
    const shown = Math.min(limitSeries, allKeys.length) * seriesPerKey;
    const total = allKeys.length * seriesPerKey;
    extras.seriesLimit = { shown, total, cap: maxSeries };
    extras.limitNumberOfSeriesWarningMessage = gt("dashboard.utils.seriesLimitWarningCounts", {
      shown: addCommasToNumber(shown),
      total: addCommasToNumber(total),
    });
  }

  const topKeys = allKeys.slice(0, limitSeries).map(([key]) => key);

  // Step 3: Initialize result array and others object for aggregation
  const resultArray: any[] = [];
  const othersObj: any = {};

  innerDataArray.forEach((item: any) => {
    const breakdownValue = breakdownValueOf(item, breakdownKey);

    if (topKeys.includes(breakdownValue.toString())) {
      resultArray.push({ ...item, [breakdownKey]: breakdownValue });
    } else if (top_results_others) {
      const xAxisValue = String(getDataValue(item, xAxisKey));
      othersObj[xAxisValue] = (othersObj[xAxisValue] || 0) + (+getDataValue(item, yAxisKey) || 0);
    }
  });

  // Step 4: Add 'others' aggregation to the result array if enabled
  if (top_results_others) {
    Object.entries(othersObj).forEach(([xAxisValue, yAxisValue]) => {
      resultArray.push({
        [breakdownKey]: OTHERS_BREAKDOWN_VALUE,
        [xAxisKey]: xAxisValue,
        [yAxisKey]: yAxisValue,
      });
    });
  }

  return resultArray;
};
