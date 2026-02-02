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

import { toZonedTime } from "date-fns-tz";
import {
  PromQLResponse,
  ProcessedPromQLData,
  AggregationFunction,
} from "./types";
import { getPromqlLegendName } from "./legendBuilder";

/**
 * Preprocess PromQL responses into a common format for chart converters
 *
 * @param searchQueryData - Array of PromQL API responses (one per query)
 * @param panelSchema - Panel configuration schema
 * @param store - Vuex store instance
 * @returns Processed data array ready for chart-specific conversion
 */
export async function processPromQLData(
  searchQueryData: PromQLResponse[],
  panelSchema: any,
  store: any,
): Promise<ProcessedPromQLData[]> {
  const result: ProcessedPromQLData[] = [];

  // Apply series limit
  const seriesLimit = panelSchema.config?.promql_series_limit || 100;
  const limitedData = applySeriesLimit(searchQueryData, seriesLimit);

  // Collect all unique timestamps across all queries
  const allTimestamps = collectAllTimestamps(limitedData);

  // Format timestamps with timezone
  const formattedTimestamps = formatTimestamps(
    allTimestamps,
    store.state.timezone,
  );

  // Process each query
  limitedData.forEach((queryData, index) => {
    // Handle both standard PromQL format (queryData.data.result) and OpenObserve format (queryData.result)
    const resultData = queryData?.data?.result || queryData?.result;

    if (!resultData) {
      return;
    }

    const series = resultData.map((metric: any) => {
      // Generate series name using legend template
      const seriesName = getPromqlLegendName(
        metric.metric,
        panelSchema.queries[index]?.config?.promql_legend,
      );

      // Extract values (matrix has values[], vector has value)
      const values = metric.values || (metric.value ? [metric.value] : []);

      // Create timestamp -> value map for efficient lookup
      const dataObj: Record<number, string> = {};
      values.forEach(([ts, val]: [number, string]) => {
        dataObj[ts] = val;
      });

      return {
        name: seriesName,
        metric: metric.metric,
        values,
        data: dataObj,
      };
    });

    result.push({
      timestamps: formattedTimestamps,
      series,
      queryIndex: index,
      queryConfig: panelSchema.queries[index]?.config || {},
    });
  });

  return result;
}

/**
 * Collect all unique timestamps from all series across all queries
 *
 * @param data - Array of PromQL responses
 * @returns Set of unique timestamps
 */
function collectAllTimestamps(data: PromQLResponse[]): Set<number> {
  const timestamps = new Set<number>();

  data.forEach((queryData) => {
    // Handle both standard PromQL format and OpenObserve format
    const resultData = queryData?.data?.result || queryData?.result;
    if (!resultData) return;

    resultData.forEach((metric: any) => {
      const values = metric.values || (metric.value ? [metric.value] : []);
      values.forEach(([ts]: [number, string]) => {
        timestamps.add(ts);
      });
    });
  });

  return timestamps;
}

/**
 * Format timestamps with timezone support
 *
 * @param timestamps - Set of Unix timestamps (seconds)
 * @param timezone - Timezone string (e.g., "America/New_York" or "UTC")
 * @returns Array of [unix_ts, formatted_date] tuples
 */
function formatTimestamps(
  timestamps: Set<number>,
  timezone: string,
): Array<[number, Date | string]> {
  const sorted = Array.from(timestamps).sort((a, b) => a - b);

  return sorted.map((ts) => {
    const formatted =
      timezone !== "UTC"
        ? toZonedTime(ts * 1000, timezone)
        : new Date(ts * 1000).toISOString().slice(0, -1);

    return [ts, formatted];
  });
}

/**
 * Limit number of series per query to prevent performance issues
 *
 * @param data - Array of PromQL responses
 * @param limit - Maximum number of series to keep per query
 * @returns Limited data array
 */
function applySeriesLimit(
  data: PromQLResponse[],
  limit: number,
): PromQLResponse[] {
  return data.map((queryData) => {
    // Handle both standard PromQL format and OpenObserve format
    if (queryData?.data?.result) {
      // Standard PromQL format
      return {
        ...queryData,
        data: {
          ...queryData.data,
          result: queryData.data.result.slice(0, limit),
        },
      };
    } else if (queryData?.result) {
      // OpenObserve format
      return {
        ...queryData,
        result: queryData.result.slice(0, limit),
      };
    }

    return queryData;
  });
}

/**
 * Get instant query value (last value in time series)
 *
 * @param values - Array of [timestamp, value] tuples
 * @returns The most recent value, or "0" if empty
 */
export function getInstantValue(values: Array<[number, string]>): string {
  if (!values || values.length === 0) return "0";

  const sorted = values.sort((a, b) => a[0] - b[0]);
  return sorted[sorted.length - 1][1];
}

/**
 * Fill missing timestamps with null values for consistent chart rendering
 *
 * @param dataObj - Timestamp -> value mapping
 * @param timestamps - All timestamps that should be present
 * @returns Array of [formatted_timestamp, value] tuples with nulls for missing data
 */
export function fillMissingTimestamps(
  dataObj: Record<number, string>,
  timestamps: Array<[number, Date | string]>,
): Array<[Date | string, string | null]> {
  return timestamps.map(([ts, formattedTs]) => [
    formattedTs,
    dataObj[ts] ?? null,
  ]);
}

/**
 * Apply aggregation function to time series data
 *
 * @param values - Array of [timestamp, value] tuples
 * @param aggregation - Aggregation function to apply
 * @returns Aggregated single value
 */
export function applyAggregation(
  values: Array<[number, string]>,
  aggregation: AggregationFunction = "last",
): number {
  if (!values || values.length === 0) return 0;

  const numericValues = values.map(([, val]) => parseFloat(val));

  switch (aggregation) {
    case "last":
      return numericValues[numericValues.length - 1];
    case "first":
      return numericValues[0];
    case "min":
      return Math.min(...numericValues);
    case "max":
      return Math.max(...numericValues);
    case "avg":
      return numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    case "sum":
      return numericValues.reduce((a, b) => a + b, 0);
    case "count":
      return numericValues.length;
    case "range":
      return Math.max(...numericValues) - Math.min(...numericValues);
    case "diff":
      return numericValues[numericValues.length - 1] - numericValues[0];
    default:
      return numericValues[numericValues.length - 1];
  }
}
