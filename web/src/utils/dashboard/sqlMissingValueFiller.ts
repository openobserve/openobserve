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

  const intervalMillis = interval * 1000;

  // Use metadata endTime for the fill range end (user's selected end time).
  const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
  const endTime = new Date(parseInt(metaDataEndTime) / 1000);
  const endTimeForFill = format(
    toZonedTime(endTime, "UTC"),
    "yyyy-MM-dd'T'HH:mm:ss",
  );

  // Use resultMetaData's last entry's time_offset.start_time as the fill start.
  // Chunks arrive right-to-left (latest first), so the last entry has the earliest start.
  const resultMetaStartTime =
    resultMetaData?.[resultMetaData.length - 1]?.time_offset?.start_time ?? 0;
  const fillStartTime = resultMetaStartTime
    ? new Date(resultMetaStartTime / 1000)
    : binnedDate;
  const binnedFillStart = dateBin(interval, fillStartTime, origin);

  // Build map from processedData for O(1) lookup
  const hasBreakdown =
    xAxisKeysWithoutTimeStamp.length > 0 ||
    breakdownAxisKeysWithoutTimeStamp.length > 0;
  const searchDataMap = new Map();
  processedData?.forEach((d: any) => {
    const key = hasBreakdown
      ? `${getDataValue(d, timeKey)}-${getDataValue(d, uniqueKey)}`
      : `${getDataValue(d, timeKey)}`;
    searchDataMap.set(key, d);
  });

  const filledData: any = [];

  // Anchor entry: single null at user's selected start time to pin ECharts x-axis.
  // Skip if fill loop already covers user's start (all data has arrived).
  if (binnedFillStart > binnedDate) {
    const anchorFormattedTime = format(
      toZonedTime(binnedDate, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );
    // Also add a phantom point one interval before the first real data point.
    // This ensures ECharts calculates bar bandwidth as `interval` (e.g. 30s)
    // instead of the full gap between user-start anchor and first real data
    // (~days on the first streaming chunk). Without this, ECharts uses the
    // large gap as bar width and extends the visual axis far beyond min/max.
    const nearAnchorTime = new Date(
      binnedFillStart.getTime() - interval * 1000,
    );
    const nearAnchorFormattedTime = format(
      toZonedTime(nearAnchorTime, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );
    const anchorTimes = [anchorFormattedTime];
    // Only add the near-anchor if it's strictly between user start and first data
    if (nearAnchorTime > binnedDate) {
      anchorTimes.push(nearAnchorFormattedTime);
    }
    if (!hasBreakdown) {
      anchorTimes.forEach((t) => {
        const anchorEntry: any = { [timeKey]: t };
        keys.forEach((key) => {
          if (key !== timeKey) anchorEntry[key] = noValueConfigOption;
        });
        filledData.push(anchorEntry);
      });
    } else {
      anchorTimes.forEach((t) => {
        uniqueXAxisValues.forEach((uniqueValue: any) => {
          const anchorEntry: any = {
            [timeKey]: t,
            [uniqueKey]: uniqueValue,
          };
          keys.forEach((key) => {
            if (key !== timeKey && key !== uniqueKey) {
              anchorEntry[key] = noValueConfigOption;
            }
          });
          filledData.push(anchorEntry);
        });
      });
    }
  }

  // Fill slot-by-slot in chronological order from binnedFillStart
  // (resultMetaData start) to endTimeForFill (user's end).
  // Only covers the range where streaming data has been received.
  let currentTime = binnedFillStart;
  let currentFormattedTime = format(
    toZonedTime(currentTime, "UTC"),
    "yyyy-MM-dd'T'HH:mm:ss",
  );

  while (currentFormattedTime <= endTimeForFill) {
    if (!hasBreakdown) {
      const key = `${currentFormattedTime}`;
      const currentData = searchDataMap.get(key);
      if (currentData) {
        filledData.push(currentData);
      } else {
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
        if (currentData) {
          filledData.push(currentData);
        } else {
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

  return filledData;
};
