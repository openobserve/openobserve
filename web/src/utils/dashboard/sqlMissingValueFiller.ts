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

  // Use the minimum time_offset.start_time across all received metadata entries.
  // This is robust regardless of chunk arrival order:
  //   - Dashboards search_type: chunks arrive latest-first, so the last entry has
  //     the earliest start — min converges correctly as chunks accumulate.
  //   - UI search_type (metrics page): chunks arrive earliest-first, so the FIRST
  //     entry already has the earliest start — min stays stable throughout streaming.
  // Using the last entry's start_time alone was wrong for UI search_type, where the
  // last chunk has the LATEST start_time, causing binnedFillStart to jump near
  // endTime and the fill loop to produce almost no data (chart goes blank).
  const resultMetaStartTime = resultMetaData
    ?.map((meta: any) => meta?.time_offset?.start_time ?? 0)
    .filter((t: number) => t > 0)
    .reduce((min: number, t: number) => Math.min(min, t), Infinity);
  const fillStartTime =
    resultMetaStartTime && isFinite(resultMetaStartTime)
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

  // Count unique time slots up to 3. We only need to know if there are < 3
  // (phantom anchor needed) or >= 3 (ECharts can derive interval from data).
  // Break early once 3 distinct slots are found to avoid iterating all rows.
  const uniqueTimeSlots = new Set<string>();
  for (const d of processedData) {
    uniqueTimeSlots.add(getDataValue(d, timeKey));
    if (uniqueTimeSlots.size >= 3) break;
  }
  const uniqueTimeSlotCount = uniqueTimeSlots.size;

  // Always insert a null anchor at the user's selected start time when the fill
  // loop doesn't yet cover it. This pins the ECharts x-axis left edge to the
  // user's query range from the very first chunk.
  if (binnedFillStart > binnedDate) {
    const anchorFormattedTime = format(
      toZonedTime(binnedDate, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );
    const anchorTimes = [anchorFormattedTime];

    // Also insert a phantom point one interval after the user's selected start
    // time when data is sparse (< 3 unique time slots). This gives ECharts a
    // known 30s consecutive gap at the left edge of the axis so it sizes bars
    // correctly instead of using the huge gap from user-start to first chunk
    // (~hours/days). Only added when it falls strictly before the first real
    // data point (binnedFillStart), otherwise it would overlap real data.
    // Once there are >= 3 real time slots ECharts can derive the interval from
    // the data itself and the phantom is no longer needed.
    if (uniqueTimeSlotCount < 3) {
      const nearAnchorTime = new Date(binnedDate.getTime() + interval * 1000);
      // Only add the near-anchor if it's strictly before the first real data
      if (nearAnchorTime < binnedFillStart) {
        const nearAnchorFormattedTime = format(
          toZonedTime(nearAnchorTime, "UTC"),
          "yyyy-MM-dd'T'HH:mm:ss",
        );
        anchorTimes.push(nearAnchorFormattedTime);
      }
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
