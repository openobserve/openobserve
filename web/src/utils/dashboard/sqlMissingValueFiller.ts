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
import { dateBin } from "@/utils/dashboard/datetimeStartPoint";
import { format } from "date-fns";
import { isTimeSeries } from "./dateTimeUtils";
import { getDataValue } from "./aliasUtils";

/**
 * Fills in missing time-series data points between the start and end time
 * based on the histogram interval, inserting null/no-value entries where data
 * is absent. Returns a deep copy of processedData unchanged when the panel
 * type or metadata does not require gap-filling.
 *
 * @param {any[]} processedData - The already-processed (top_results filtered) data array.
 * @param {any} panelSchema - The panel schema object.
 * @param {any} resultMetaData - Array of result metadata objects (histogram_interval, etc.).
 * @param {any} metadata - Query metadata (startTime, endTime, queries, etc.).
 * @param {string[]} xAxisKeys - Array of x-axis key aliases.
 * @param {string[]} yAxisKeys - Array of y-axis key aliases.
 * @param {string[]} zAxisKeys - Array of z-axis key aliases.
 * @param {string[]} breakDownKeys - Array of breakdown key aliases.
 * @param {any} noValueConfigOption - The value to use for missing data points.
 * @returns {any[]} - The data array with gaps filled in.
 */
export const fillMissingValues = (
  processedData: any[],
  panelSchema: any,
  resultMetaData: any,
  metadata: any,
  xAxisKeys: string[],
  yAxisKeys: string[],
  zAxisKeys: string[],
  breakDownKeys: string[],
  noValueConfigOption: any,
): any[] => {
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

  // Identify the time-based key
  const searchQueryDataFirstEntry = processedData[0];

  const keys = [...xAxisKeys, ...yAxisKeys, ...zAxisKeys, ...breakDownKeys];
  const timeBasedKey = keys?.find((key) =>
    isTimeSeries([getDataValue(searchQueryDataFirstEntry, key)]),
  );

  if (!timeBasedKey) {
    return JSON.parse(JSON.stringify(processedData));
  }

  const xAxisKeysWithoutTimeStamp = xAxisKeys.filter(
    (key: any) => key !== timeBasedKey,
  );
  const breakdownAxisKeysWithoutTimeStamp = breakDownKeys.filter(
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

  // Anchor entry: add null at user's selected start time so ECharts x-axis is stable
  // Format using same method as processedData
  const anchorFormattedTime = format(
    toZonedTime(binnedDate, "UTC"),
    "yyyy-MM-dd'T'HH:mm:ss",
  );
  if (
    xAxisKeysWithoutTimeStamp.length === 0 &&
    breakdownAxisKeysWithoutTimeStamp.length === 0
  ) {
    const anchorEntry: any = { [timeKey]: anchorFormattedTime };
    keys.forEach((key) => {
      if (key !== timeKey) anchorEntry[key] = noValueConfigOption;
    });
    filledData.push(anchorEntry);
  } else {
    uniqueXAxisValues.forEach((uniqueValue: any) => {
      const anchorEntry: any = {
        [timeKey]: anchorFormattedTime,
        [uniqueKey]: uniqueValue,
      };
      keys.forEach((key) => {
        if (key !== timeKey && key !== uniqueKey) {
          anchorEntry[key] = noValueConfigOption;
        }
      });
      filledData.push(anchorEntry);
    });
  }

  // Add existing processedData after the anchor without using spread,
  // which can overflow call stack for large datasets.
  for (const row of processedData) {
    filledData.push(row);
  }

  const intervalMillis = interval * 1000;

  // Fill gaps only within the received data range
  // Data arrives from the end during streaming, so avoid filling before firstDataTimestamp.
  const firstDataTimestamp =
    processedData.length > 0 ? getDataValue(processedData[0], timeKey) : null;
  const lastDataTimestamp =
    processedData.length > 0
      ? getDataValue(processedData[processedData.length - 1], timeKey)
      : null;

  if (firstDataTimestamp && lastDataTimestamp) {
    const firstDataDate = new Date(firstDataTimestamp + "Z");
    const lastDataDate = new Date(lastDataTimestamp + "Z");
    const binnedFillStart = dateBin(interval, firstDataDate, origin);
    const endTimeForFill = format(
      toZonedTime(lastDataDate, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );

    // Build map from processedData for O(1) lookup
    const searchDataMap = new Map();
    processedData?.forEach((d: any) => {
      const key =
        xAxisKeysWithoutTimeStamp.length > 0 ||
        breakdownAxisKeysWithoutTimeStamp.length > 0
          ? `${getDataValue(d, timeKey)}-${getDataValue(d, uniqueKey)}`
          : `${getDataValue(d, timeKey)}`;
      searchDataMap.set(key, d);
    });

    let currentTime = binnedFillStart;
    let currentFormattedTime = format(
      toZonedTime(currentTime, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );
    while (currentFormattedTime <= endTimeForFill) {
      if (
        xAxisKeysWithoutTimeStamp.length === 0 &&
        breakdownAxisKeysWithoutTimeStamp.length === 0
      ) {
        const key = `${currentFormattedTime}`;
        const currentData = searchDataMap.get(key);
        if (!currentData) {
          const nullEntry: any = { [timeKey]: currentFormattedTime };
          keys.forEach((key) => {
            if (key !== timeKey) nullEntry[key] = noValueConfigOption;
          });
          filledData.push(nullEntry);
        }
      } else {
        uniqueXAxisValues.forEach((uniqueValue: any) => {
          const key = `${currentFormattedTime}-${uniqueValue}`;
          const currentData = searchDataMap.get(key);
          if (!currentData) {
            const nullEntry: any = {
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
      currentFormattedTime = format(
        toZonedTime(currentTime, "UTC"),
        "yyyy-MM-dd'T'HH:mm:ss",
      );
    }
  }

  return filledData;
};
