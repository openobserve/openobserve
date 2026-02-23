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
 * Sparse gap-fill strategy for time-series data.
 *
 * Instead of generating a row for every time slot in the entire time range
 * (which can produce 100K+ rows for wide ranges with small intervals),
 * this function only inserts null-marker entries at the boundaries of gaps
 * in the actual data. For each gap between consecutive data points, we
 * insert at most 2 null entries (one at the gap start, one at the gap end).
 *
 * This produces output that is functionally equivalent for ECharts time-series
 * rendering (xAxis.type="time" with [timestamp, value] pairs) because:
 * 1. Real data points are preserved exactly as-is.
 * 2. Gaps are correctly represented by null boundary markers.
 * 3. The start/end of the time range are anchored with boundary entries.
 *
 * Performance: For 1000 actual data points with 5 gaps, this produces ~1010
 * rows instead of 100K rows from the dense approach.
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
 * Sparse fill for data WITHOUT breakdown dimensions.
 * Sorts data by time, walks through sorted data, and inserts null markers
 * only at gap boundaries.
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
  // Sort data by time
  const sorted = [...processedData].sort((a, b) => {
    const ta = parseTimeToMs(getDataValue(a, timeKey));
    const tb = parseTimeToMs(getDataValue(b, timeKey));
    return ta - tb;
  });

  const result: any[] = [];
  // Gap threshold: if the gap between two data points exceeds 1 interval,
  // insert null markers. We use 1.5x interval as the threshold to account
  // for floating-point rounding in date arithmetic.
  const gapThreshold = intervalMillis * 1.5;

  // Insert boundary null at binnedStart if first data point is after it
  const firstDataMs = parseTimeToMs(getDataValue(sorted[0], timeKey));
  if (firstDataMs - binnedStartMs > gapThreshold) {
    result.push(createNullEntry(formatTime(new Date(binnedStartMs))));
    // Null marker at one interval before first data point
    const preFirstMs = firstDataMs - intervalMillis;
    if (preFirstMs > binnedStartMs) {
      result.push(createNullEntry(formatTime(new Date(preFirstMs))));
    }
  }

  // Walk through sorted data and detect gaps
  for (let i = 0; i < sorted.length; i++) {
    const currentMs = parseTimeToMs(getDataValue(sorted[i], timeKey));

    // Insert gap markers between consecutive points
    if (i > 0) {
      const prevMs = parseTimeToMs(getDataValue(sorted[i - 1], timeKey));
      if (currentMs - prevMs > gapThreshold) {
        // Null at one interval after previous data point (gap start)
        const postPrevMs = prevMs + intervalMillis;
        if (postPrevMs < currentMs) {
          result.push(createNullEntry(formatTime(new Date(postPrevMs))));
        }
        // Null at one interval before current data point (gap end)
        const preCurrentMs = currentMs - intervalMillis;
        if (preCurrentMs > prevMs + intervalMillis) {
          result.push(createNullEntry(formatTime(new Date(preCurrentMs))));
        }
      }
    }

    // Push the actual data row
    result.push(sorted[i]);
  }

  // Insert boundary null at end if last data point is before endMs
  const lastDataMs = parseTimeToMs(
    getDataValue(sorted[sorted.length - 1], timeKey),
  );
  if (endMs - lastDataMs > gapThreshold) {
    // Null marker at one interval after last data point
    const postLastMs = lastDataMs + intervalMillis;
    if (postLastMs < endMs) {
      result.push(createNullEntry(formatTime(new Date(postLastMs))));
    }
    result.push(createNullEntry(formatTime(new Date(endMs))));
  }

  return result;
}

/**
 * Sparse fill for data WITH breakdown dimensions.
 * Groups data by breakdown value, applies sparse fill per group,
 * then merges all groups back.
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
  // Group data by breakdown value
  const groups = new Map<any, any[]>();
  for (const row of processedData) {
    const breakdownValue = getDataValue(row, uniqueKey);
    let group = groups.get(breakdownValue);
    if (!group) {
      group = [];
      groups.set(breakdownValue, group);
    }
    group.push(row);
  }

  const result: any[] = [];
  const gapThreshold = intervalMillis * 1.5;

  // Process each breakdown group independently
  for (const [breakdownValue, groupData] of groups) {
    // Sort group by time
    const sorted = groupData.sort((a, b) => {
      const ta = parseTimeToMs(getDataValue(a, timeKey));
      const tb = parseTimeToMs(getDataValue(b, timeKey));
      return ta - tb;
    });

    // Insert boundary null at binnedStart if first data point is after it
    const firstDataMs = parseTimeToMs(getDataValue(sorted[0], timeKey));
    if (firstDataMs - binnedStartMs > gapThreshold) {
      result.push(
        createNullEntry(formatTime(new Date(binnedStartMs)), breakdownValue),
      );
      const preFirstMs = firstDataMs - intervalMillis;
      if (preFirstMs > binnedStartMs) {
        result.push(
          createNullEntry(formatTime(new Date(preFirstMs)), breakdownValue),
        );
      }
    }

    // Walk through sorted data and detect gaps
    for (let i = 0; i < sorted.length; i++) {
      const currentMs = parseTimeToMs(getDataValue(sorted[i], timeKey));

      if (i > 0) {
        const prevMs = parseTimeToMs(getDataValue(sorted[i - 1], timeKey));
        if (currentMs - prevMs > gapThreshold) {
          const postPrevMs = prevMs + intervalMillis;
          if (postPrevMs < currentMs) {
            result.push(
              createNullEntry(
                formatTime(new Date(postPrevMs)),
                breakdownValue,
              ),
            );
          }
          const preCurrentMs = currentMs - intervalMillis;
          if (preCurrentMs > prevMs + intervalMillis) {
            result.push(
              createNullEntry(
                formatTime(new Date(preCurrentMs)),
                breakdownValue,
              ),
            );
          }
        }
      }

      result.push(sorted[i]);
    }

    // Insert boundary null at end if last data point is before endMs
    const lastDataMs = parseTimeToMs(
      getDataValue(sorted[sorted.length - 1], timeKey),
    );
    if (endMs - lastDataMs > gapThreshold) {
      const postLastMs = lastDataMs + intervalMillis;
      if (postLastMs < endMs) {
        result.push(
          createNullEntry(formatTime(new Date(postLastMs)), breakdownValue),
        );
      }
      result.push(
        createNullEntry(formatTime(new Date(endMs)), breakdownValue),
      );
    }
  }

  return result;
}
