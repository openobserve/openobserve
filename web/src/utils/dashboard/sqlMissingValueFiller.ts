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

const formatUtc = (date: Date) => format(toZonedTime(date, "UTC"), "yyyy-MM-dd'T'HH:mm:ss");

// Older cached responses have no bucket definition, and they all use the UTC 2001 grid.
const DEFAULT_ORIGIN_SECS = Date.UTC(2001, 0, 1) / 1000;

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
 * @param {any} loading - Whether chunks are still arriving.
 * @param {Function} onSharedTimestamps - Receives how many rows share a slot with another row.
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
  loading?: any,
  onSharedTimestamps?: (rowCount: number) => void,
): any[] => {
  // Get the interval in minutes
  const interval = resultMetaData?.map((it: any) => it?.histogram_interval)?.[0];

  if (
    !interval ||
    !metadata.queries ||
    !["area-stacked", "line", "area", "bar", "stacked", "scatter"].includes(panelSchema.type)
  ) {
    return JSON.parse(JSON.stringify(processedData));
  }

  // Extract and process metaDataStartTime
  const metaDataStartTime = metadata?.queries[0]?.startTime?.toString() ?? 0;
  const originSecs = resultMetaData?.[0]?.histogram_origin ?? DEFAULT_ORIGIN_SECS;
  const offsetMillis = (resultMetaData?.[0]?.histogram_offset ?? 0) * 1000;
  // Labels carry the timezone shift, so slots are built in the same shifted time.
  const toLabelTime = (micros: number) => new Date(micros / 1000 + offsetMillis);
  const startTime = toLabelTime(parseInt(metaDataStartTime));

  // Calculate the binnedDate
  const origin = new Date(originSecs * 1000);
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

  // If the time-based key is only in the breakdown field (not on the x-axis),
  // this is not a time series chart — skip missing value filling.
  // Filling would re-expand limited breakdown values into all time slots,
  // defeating the series limit and causing performance issues.
  if (breakDownKeys.includes(timeBasedKey) && !xAxisKeys.includes(timeBasedKey)) {
    return JSON.parse(JSON.stringify(processedData));
  }

  const xAxisKeysWithoutTimeStamp = xAxisKeys.filter((key: any) => key !== timeBasedKey);
  const breakdownAxisKeysWithoutTimeStamp = breakDownKeys.filter(
    (key: any) => key !== timeBasedKey,
  );

  const timeKey = timeBasedKey;
  const uniqueKey =
    xAxisKeysWithoutTimeStamp[0] !== undefined
      ? xAxisKeysWithoutTimeStamp[0]
      : breakdownAxisKeysWithoutTimeStamp[0];

  // Create a set of unique xAxis values
  const uniqueXAxisValues = new Set(processedData.map((d: any) => getDataValue(d, uniqueKey)));

  const intervalMillis = interval * 1000;

  // Use metadata endTime for the user's selected end time.
  const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
  const endTime = toLabelTime(parseInt(metaDataEndTime));
  const formattedUserEnd = formatUtc(endTime);

  // Detect chunking direction from first resultMetaData entry.
  const isLTR =
    detectChunkingDirection(
      resultMetaData?.[0]?.time_offset?.start_time ?? 0,
      resultMetaData?.[0]?.time_offset?.end_time ?? 0,
      parseInt(metaDataStartTime),
      parseInt(metaDataEndTime),
    ) ?? false;

  let binnedFillStart: Date;
  let endTimeForFill: string;

  if (!loading) {
    // Final render or cancel: fill the full user query range
    binnedFillStart = binnedDate;
    endTimeForFill = formattedUserEnd;
  } else if (isLTR) {
    // LTR streaming: fill from user's start to latest chunk's end
    binnedFillStart = binnedDate;
    const lastChunkEndTime =
      resultMetaData?.[resultMetaData.length - 1]?.time_offset?.end_time ?? 0;
    const fillEndTime = lastChunkEndTime ? toLabelTime(lastChunkEndTime) : endTime;
    endTimeForFill = formatUtc(fillEndTime);
  } else {
    // RTL streaming: fill from earliest chunk's start to user's end
    const resultMetaStartTime =
      resultMetaData?.[resultMetaData.length - 1]?.time_offset?.start_time ?? 0;
    const fillStartTime = resultMetaStartTime ? toLabelTime(resultMetaStartTime) : binnedDate;
    binnedFillStart = dateBin(interval, fillStartTime, origin);
    endTimeForFill = formattedUserEnd;
  }

  // Build map from processedData for O(1) lookup, and track actual data
  // time range so we only fill gaps between real data points.
  const hasBreakdown =
    xAxisKeysWithoutTimeStamp.length > 0 || breakdownAxisKeysWithoutTimeStamp.length > 0;
  const searchDataMap = new Map();
  let actualMinTime: string | null = null;
  let actualMaxTime: string | null = null;
  let sharedRowCount = 0;
  // for-of (not forEach) so the compiler tracks actualMin/MaxTime assignments
  // in this scope and keeps their declared string|null type at reads below.
  for (const d of processedData ?? []) {
    const timeVal = `${getDataValue(d, timeKey)}`;
    const key = hasBreakdown ? `${timeVal}-${getDataValue(d, uniqueKey)}` : timeVal;
    if (searchDataMap.has(key)) sharedRowCount++;
    searchDataMap.set(key, d);
    if (actualMinTime === null || timeVal < actualMinTime) actualMinTime = timeVal;
    if (actualMaxTime === null || timeVal > actualMaxTime) actualMaxTime = timeVal;
  }

  if (loading) {
    // LTR streaming: clamp both edges to actual data bounds. Timestamps
    // before actualMinTime or after actualMaxTime have no new data yet —
    // the overlay preserves previously rendered chart values for those.
    // RTL streaming: no clamping — the fill extends from chunkStart to
    // userEnd so the "newer" (right) side gets noValue entries.
    if (isLTR) {
      if (actualMinTime && actualMinTime > formatUtc(binnedFillStart)) {
        binnedFillStart = new Date(actualMinTime + "Z");
      }
      if (actualMaxTime && actualMaxTime < endTimeForFill) {
        endTimeForFill = actualMaxTime;
      }
    }
  }

  // A chart keeps one row per slot, so a second row on a slot means the bar is not the full value.
  if (sharedRowCount > 0) onSharedTimestamps?.(sharedRowCount);

  const filledData: any = [];

  // Fill slot-by-slot in chronological order, only between actual data points.
  let currentTime = binnedFillStart;
  let currentFormattedTime = formatUtc(currentTime);

  while (currentFormattedTime <= endTimeForFill) {
    if (!hasBreakdown) {
      const key = `${currentFormattedTime}`;
      const currentData = searchDataMap.get(key);
      if (currentData) {
        filledData.push(currentData);
        searchDataMap.delete(key);
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
          searchDataMap.delete(key);
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
    currentFormattedTime = formatUtc(currentTime);
  }

  // A row off every slot must still reach the chart, or real data disappears without a trace.
  if (searchDataMap.size > 0) {
    filledData.push(...searchDataMap.values());
    filledData.sort((a: any, b: any) =>
      `${getDataValue(a, timeKey)}`.localeCompare(`${getDataValue(b, timeKey)}`),
    );
  }

  return filledData;
};
