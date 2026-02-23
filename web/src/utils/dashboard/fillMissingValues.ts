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
import { isTimeSeries } from "./convertDataIntoUnitValue";
import { getDataValue } from "./aliasUtils";

export interface FillMissingValuesParams {
  processedData: any[];
  resultMetaData: any;
  metadata: any;
  panelType: string;
  noValueConfigOption: any;
  xAxisKeys: string[];
  yAxisKeys: string[];
  zAxisKeys: string[];
  breakDownKeys: string[];
}

/**
 * Bounded dense gap-fill for time-series data.
 *
 * Instead of filling the ENTIRE query time range (binnedStart → endTime) with
 * rows — which can produce 100K+ entries for wide ranges with small intervals —
 * this function:
 *
 * 1. Finds the actual data range (min → max timestamp from streamed data).
 * 2. Dense-fills ONLY within that range so gaps between real data points
 *    correctly show as zero/null in the chart.
 * 3. Adds just 2 boundary entries (at binnedStart and endTime) so the chart
 *    x-axis spans the full query range without generating thousands of empty rows
 *    where streaming data hasn't arrived yet.
 *
 * Performance: For 1000 data points spanning 10 min in a 24h query range,
 * this produces ~600 rows (10 min dense) instead of 86,400 (24h dense).
 */
export const fillMissingValues = (
  params: FillMissingValuesParams,
): any[] => {
  const {
    processedData,
    resultMetaData,
    metadata,
    panelType,
    noValueConfigOption,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
  } = params;

  // Get the interval in seconds
  const interval = resultMetaData?.map(
    (it: any) => it?.histogram_interval,
  )?.[0];

  if (
    !interval ||
    !metadata.queries ||
    !["area-stacked", "line", "area", "bar", "stacked", "scatter"].includes(
      panelType,
    )
  ) {
    return processedData;
  }

  if (!processedData || processedData.length === 0) {
    return processedData;
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
    ...xAxisKeys,
    ...yAxisKeys,
    ...zAxisKeys,
    ...breakDownKeys,
  ];
  const timeBasedKey = keys?.find((key) =>
    isTimeSeries([getDataValue(searchQueryDataFirstEntry, key)]),
  );

  if (!timeBasedKey) {
    return processedData;
  }

  // Extract and process metaDataEndTime
  const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
  const endTime = new Date(parseInt(metaDataEndTime) / 1000);

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

  // Pre-compute whether we have breakdown dimensions
  const hasBreakdown =
    xAxisKeysWithoutTimeStamp.length > 0 ||
    breakdownAxisKeysWithoutTimeStamp.length > 0;

  // Pre-compute non-time keys once
  const nonTimeKeys = hasBreakdown
    ? keys.filter((k) => k !== timeKey && k !== uniqueKey)
    : keys.filter((k) => k !== timeKey);

  // Helper: format a Date to the ISO string format used in data
  const formatTime = (date: Date): string =>
    format(toZonedTime(date, "UTC"), "yyyy-MM-dd'T'HH:mm:ss");

  // Helper: create a null-fill entry
  const createNullEntry = (formattedTime: string, uniqueValue?: any): any => {
    const entry: any = { [timeKey]: formattedTime };
    if (hasBreakdown) {
      entry[uniqueKey] = uniqueValue;
    }
    for (let k = 0; k < nonTimeKeys.length; k++) {
      entry[nonTimeKeys[k]] = noValueConfigOption;
    }
    return entry;
  };

  // Helper: parse a formatted time string back to epoch ms
  const parseTimeToMs = (formattedTime: string): number =>
    new Date(formattedTime + "Z").getTime();

  const binnedStartMs = binnedDate.getTime();
  const endMs = endTime.getTime();

  if (!hasBreakdown) {
    return fillWithoutBreakdown(
      processedData,
      timeKey,
      intervalMillis,
      binnedStartMs,
      endMs,
      formatTime,
      createNullEntry,
      parseTimeToMs,
    );
  } else {
    return fillWithBreakdown(
      processedData,
      timeKey,
      uniqueKey,
      intervalMillis,
      binnedStartMs,
      endMs,
      formatTime,
      createNullEntry,
      parseTimeToMs,
    );
  }
};

/**
 * Dense fill within data range, boundary-only outside.
 *
 * 1. Find min/max timestamps from actual data.
 * 2. Add boundary null entry at binnedStart (if before data range).
 * 3. Dense-fill from dataMin to dataMax at every interval step.
 * 4. Add boundary null entry at endTime (if after data range).
 */
function denseFillRange(
  searchDataMap: Map<string, any>,
  dataMinMs: number,
  dataMaxMs: number,
  intervalMillis: number,
  binnedStartMs: number,
  endMs: number,
  formatTime: (d: Date) => string,
  createNullEntry: (time: string, uniqueValue?: any) => any,
  breakdownValue?: any,
  hasBreakdown?: boolean,
): any[] {
  const result: any[] = [];

  // Boundary entry at binnedStart if it's before the data range
  if (binnedStartMs < dataMinMs - intervalMillis) {
    result.push(
      hasBreakdown
        ? createNullEntry(formatTime(new Date(binnedStartMs)), breakdownValue)
        : createNullEntry(formatTime(new Date(binnedStartMs))),
    );
  }

  // Align dataMin to the interval grid
  const alignedStartMs =
    Math.floor((dataMinMs - binnedStartMs) / intervalMillis) * intervalMillis +
    binnedStartMs;

  // Align dataMax to the next interval boundary
  const alignedEndMs =
    Math.ceil((dataMaxMs - binnedStartMs) / intervalMillis) * intervalMillis +
    binnedStartMs;

  // Dense fill from aligned start to aligned end
  let currentMs = alignedStartMs;
  while (currentMs <= alignedEndMs) {
    const formattedTime = formatTime(new Date(currentMs));

    if (hasBreakdown) {
      const key = `${formattedTime}-${breakdownValue}`;
      const existing = searchDataMap.get(key);
      if (existing) {
        result.push(existing);
      } else {
        result.push(createNullEntry(formattedTime, breakdownValue));
      }
    } else {
      const existing = searchDataMap.get(formattedTime);
      if (existing) {
        result.push(existing);
      } else {
        result.push(createNullEntry(formattedTime));
      }
    }

    currentMs += intervalMillis;
  }

  // Boundary entry at endTime if it's after the data range
  if (endMs > dataMaxMs + intervalMillis) {
    result.push(
      hasBreakdown
        ? createNullEntry(formatTime(new Date(endMs)), breakdownValue)
        : createNullEntry(formatTime(new Date(endMs))),
    );
  }

  return result;
}

/**
 * Bounded dense fill for data WITHOUT breakdown dimensions.
 */
function fillWithoutBreakdown(
  processedData: any[],
  timeKey: string,
  intervalMillis: number,
  binnedStartMs: number,
  endMs: number,
  formatTime: (d: Date) => string,
  createNullEntry: (time: string, uniqueValue?: any) => any,
  parseTimeToMs: (time: string) => number,
): any[] {
  // Build a map of existing data for O(1) lookups
  const searchDataMap = new Map<string, any>();
  let dataMinMs = Infinity;
  let dataMaxMs = -Infinity;

  for (const d of processedData) {
    const timeVal = getDataValue(d, timeKey);
    const ms = parseTimeToMs(timeVal);
    if (ms < dataMinMs) dataMinMs = ms;
    if (ms > dataMaxMs) dataMaxMs = ms;
    searchDataMap.set(timeVal, d);
  }

  return denseFillRange(
    searchDataMap,
    dataMinMs,
    dataMaxMs,
    intervalMillis,
    binnedStartMs,
    endMs,
    formatTime,
    createNullEntry,
    undefined,
    false,
  );
}

/**
 * Bounded dense fill for data WITH breakdown dimensions.
 * Groups data by breakdown value, dense-fills each group within its own
 * data range, then merges all groups.
 */
function fillWithBreakdown(
  processedData: any[],
  timeKey: string,
  uniqueKey: string,
  intervalMillis: number,
  binnedStartMs: number,
  endMs: number,
  formatTime: (d: Date) => string,
  createNullEntry: (time: string, uniqueValue?: any) => any,
  parseTimeToMs: (time: string) => number,
): any[] {
  // Group data by breakdown value and track min/max per group
  const groups = new Map<
    any,
    { rows: Map<string, any>; minMs: number; maxMs: number }
  >();

  for (const row of processedData) {
    const breakdownValue = getDataValue(row, uniqueKey);
    const timeVal = getDataValue(row, timeKey);
    const ms = parseTimeToMs(timeVal);

    let group = groups.get(breakdownValue);
    if (!group) {
      group = { rows: new Map(), minMs: Infinity, maxMs: -Infinity };
      groups.set(breakdownValue, group);
    }

    const key = `${timeVal}-${breakdownValue}`;
    if (!group.rows.has(key)) {
      group.rows.set(key, row);
    }
    if (ms < group.minMs) group.minMs = ms;
    if (ms > group.maxMs) group.maxMs = ms;
  }

  const result: any[] = [];

  groups.forEach((group, breakdownValue) => {
    const groupResult = denseFillRange(
      group.rows,
      group.minMs,
      group.maxMs,
      intervalMillis,
      binnedStartMs,
      endMs,
      formatTime,
      createNullEntry,
      breakdownValue,
      true,
    );
    for (const row of groupResult) {
      result.push(row);
    }
  });

  return result;
}
