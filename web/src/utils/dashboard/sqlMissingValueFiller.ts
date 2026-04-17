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
import { detectChunkingDirection } from "./chunkingDirection";

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

  // Use metadata endTime for the user's selected end time.
  const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
  const endTime = new Date(parseInt(metaDataEndTime) / 1000);
  const formattedUserEnd = format(
    toZonedTime(endTime, "UTC"),
    "yyyy-MM-dd'T'HH:mm:ss",
  );

  // Detect chunking direction from first resultMetaData entry.
  const isLeftToRight =
    detectChunkingDirection(
      resultMetaData?.[0]?.time_offset?.start_time ?? 0,
      resultMetaData?.[0]?.time_offset?.end_time ?? 0,
      parseInt(metaDataStartTime),
      parseInt(metaDataEndTime),
    ) ?? false;

  let binnedFillStart: Date;
  let endTimeForFill: string;

  if (isLeftToRight) {
    // LTR: fill from user's start to latest chunk's end
    binnedFillStart = binnedDate;
    const lastChunkEndTime =
      resultMetaData?.[resultMetaData.length - 1]?.time_offset?.end_time ?? 0;
    const fillEndTime = lastChunkEndTime
      ? new Date(lastChunkEndTime / 1000)
      : endTime;
    endTimeForFill = format(
      toZonedTime(fillEndTime, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );
  } else {
    // RTL: fill from earliest chunk's start to user's end (existing behavior)
    const resultMetaStartTime =
      resultMetaData?.[resultMetaData.length - 1]?.time_offset?.start_time ?? 0;
    const fillStartTime = resultMetaStartTime
      ? new Date(resultMetaStartTime / 1000)
      : binnedDate;
    binnedFillStart = dateBin(interval, fillStartTime, origin);
    endTimeForFill = formattedUserEnd;
  }

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

  // RTL: insert an empty-string anchor at the user's selected start time when the fill
  // loop doesn't yet cover it. This pins the ECharts x-axis left edge to the
  // user's query range from the very first chunk.
  if (!isLeftToRight && binnedFillStart > binnedDate) {
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

    // Anchor/phantom entries use empty string (not noValueConfigOption) so
    // ECharts renders them as gaps rather than plotted points at the configured value.
    if (!hasBreakdown) {
      anchorTimes.forEach((t) => {
        const anchorEntry: any = { [timeKey]: t };
        keys.forEach((key) => {
          if (key !== timeKey) anchorEntry[key] = "";
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
              anchorEntry[key] = "";
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

  // LTR: insert an empty-string anchor at the user's selected end time when the fill
  // loop doesn't yet cover it. This pins the ECharts x-axis right edge to the
  // user's query range from the very first chunk.
  if (isLeftToRight) {
    const binnedUserEnd = dateBin(interval, endTime, origin);
    const formattedBinnedUserEnd = format(
      toZonedTime(binnedUserEnd, "UTC"),
      "yyyy-MM-dd'T'HH:mm:ss",
    );

    if (endTimeForFill < formattedBinnedUserEnd) {
      const anchorTimes: string[] = [];

      // Insert a phantom point one interval before the user's selected end
      // time when data is sparse (< 3 unique time slots). This gives ECharts a
      // known consecutive gap at the right edge so it sizes bars correctly.
      if (uniqueTimeSlotCount < 3) {
        const nearAnchorTime = new Date(
          binnedUserEnd.getTime() - interval * 1000,
        );
        const formattedNearAnchor = format(
          toZonedTime(nearAnchorTime, "UTC"),
          "yyyy-MM-dd'T'HH:mm:ss",
        );
        if (formattedNearAnchor > endTimeForFill) {
          anchorTimes.push(formattedNearAnchor);
        }
      }

      anchorTimes.push(formattedBinnedUserEnd);

      // Anchor/phantom entries use empty string (not noValueConfigOption) so
      // ECharts renders them as gaps rather than plotted points at the configured value.
      if (!hasBreakdown) {
        anchorTimes.forEach((t) => {
          const anchorEntry: any = { [timeKey]: t };
          keys.forEach((key) => {
            if (key !== timeKey) anchorEntry[key] = "";
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
                anchorEntry[key] = "";
              }
            });
            filledData.push(anchorEntry);
          });
        });
      }
    }
  }

  return filledData;
};
