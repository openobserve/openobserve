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

type MissingValueCacheEntry = {
  filledData: any[];
  binnedFillStartMs: number;
  binnedDateMs: number;
  anchorTimes: string[];
  anchorEntryCount: number;
  timeKey: string;
  uniqueKey?: string;
  hasBreakdown: boolean;
  uniqueValues: Set<any>;
  interval: number;
  noValueConfigOption: any;
  endTimeForFill: string;
  isLeftToRight: boolean;
};

const missingValueCache = new Map<string, MissingValueCacheEntry>();

const formatUtc = (date: Date) =>
  format(toZonedTime(date, "UTC"), "yyyy-MM-dd'T'HH:mm:ss");

const areSetsEqual = (a: Set<any>, b: Set<any>) => {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

const areAnchorTimesEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const getStreamingCacheKey = (
  metadata: any,
  panelSchema: any,
  interval: number,
  xAxisKeys: string[],
  yAxisKeys: string[],
  zAxisKeys: string[],
  breakDownKeys: string[],
  noValueConfigOption: any,
) => {
  const panelId = metadata?.panelId ?? panelSchema?.id;
  const queryIndex = metadata?.queryIndex;
  if (panelId == null || queryIndex == null) return null;

  const query = metadata?.queries?.[0]?.query ?? "";
  const startTime = metadata?.queries?.[0]?.startTime ?? "";
  const endTime = metadata?.queries?.[0]?.endTime ?? "";
  const type = panelSchema?.type ?? "";

  return JSON.stringify({
    panelId,
    queryIndex,
    query,
    startTime,
    endTime,
    type,
    interval,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    noValueConfigOption,
  });
};

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
  const formattedUserEnd = formatUtc(endTime);

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
    endTimeForFill = formatUtc(fillEndTime);
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

  const cacheKey = getStreamingCacheKey(
    metadata,
    panelSchema,
    interval,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    noValueConfigOption,
  );

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

  // Build start-edge anchors (RTL only). For LTR, the fill loop already covers
  // the user's start; anchors are added at the end-edge after the fill loop.
  const startAnchorTimes: string[] = [];
  if (!isLeftToRight && binnedFillStart > binnedDate) {
    startAnchorTimes.push(formatUtc(binnedDate));

    // Insert a phantom point one interval before the first real data point.
    // This gives ECharts a consecutive pair (nearAnchor → first data) so it
    // can derive the correct bar width, instead of using the huge gap from
    // user-start to first chunk (~hours/days).
    const nearAnchorTime = new Date(
      binnedFillStart.getTime() - interval * 1000,
    );
    // Only add the near-anchor if it's strictly after the starting anchor
    if (nearAnchorTime > binnedDate) {
      startAnchorTimes.push(formatUtc(nearAnchorTime));
    }
  }

  const hasTimeOffset = Boolean(
    resultMetaData?.[resultMetaData.length - 1]?.time_offset?.start_time,
  );

  // Build a lookup map from old cached filledData to use as fallback when the
  // current processedData doesn't cover a time slot. During streaming, previously
  // rendered real data is preserved instead of being replaced by null entries.
  // This works in tandem with overlayNewDataOnOldOptions at the chart level.
  let oldFilledDataMap: Map<string, any> | null = null;

  if (cacheKey) {
    const cacheEntry = missingValueCache.get(cacheKey);

    // Build old data map BEFORE the cache entry might be deleted below
    if (cacheEntry?.filledData?.length) {
      oldFilledDataMap = new Map();
      for (const entry of cacheEntry.filledData) {
        const mapKey = hasBreakdown
          ? `${getDataValue(entry, timeKey)}-${getDataValue(entry, uniqueKey)}`
          : `${getDataValue(entry, timeKey)}`;
        oldFilledDataMap.set(mapKey, entry);
      }
    }

    if (
      cacheEntry &&
      cacheEntry.anchorTimes.length > 0 &&
      !isLeftToRight &&
      binnedFillStart.getTime() <= cacheEntry.binnedDateMs
    ) {
      // RTL: real data has reached the user's start time. Drop cached anchors
      // and rebuild once so anchors are replaced by actual data points.
      missingValueCache.delete(cacheKey);
    }
    if (
      hasTimeOffset &&
      !isLeftToRight &&
      cacheEntry &&
      cacheEntry.isLeftToRight === false &&
      cacheEntry.interval === interval &&
      cacheEntry.noValueConfigOption === noValueConfigOption &&
      cacheEntry.timeKey === timeKey &&
      cacheEntry.hasBreakdown === hasBreakdown &&
      cacheEntry.endTimeForFill === endTimeForFill &&
      cacheEntry.binnedDateMs === binnedDate.getTime() &&
      cacheEntry.anchorEntryCount ===
        (cacheEntry.anchorTimes.length *
          (cacheEntry.hasBreakdown ? cacheEntry.uniqueValues.size : 1) || 0) &&
      cacheEntry.binnedFillStartMs > binnedFillStart.getTime() &&
      areAnchorTimesEqual(cacheEntry.anchorTimes, startAnchorTimes) &&
      areSetsEqual(cacheEntry.uniqueValues, uniqueXAxisValues)
    ) {
      // RTL patch-prefix: new chunks arrived with earlier start times.
      // Instead of rebuilding the whole array, fill only the new prefix
      // from the new binnedFillStart to just before the cached one.
      const prependStart = binnedFillStart;
      const prependEnd = new Date(
        cacheEntry.binnedFillStartMs - intervalMillis,
      );

      const patchData: any[] = [];

      let currentTime = prependStart;
      let currentFormattedTime = formatUtc(currentTime);
      const prependEndFormatted = formatUtc(prependEnd);

      while (currentFormattedTime <= prependEndFormatted) {
        if (!hasBreakdown) {
          const key = `${currentFormattedTime}`;
          const currentData = searchDataMap.get(key);
          if (currentData) {
            patchData.push(currentData);
          } else {
            const nullEntry: any = { [timeKey]: currentFormattedTime };
            keys.forEach((key) => {
              if (key !== timeKey) nullEntry[key] = noValueConfigOption;
            });
            patchData.push(nullEntry);
          }
        } else {
          uniqueXAxisValues.forEach((uniqueValue: any) => {
            const key = `${currentFormattedTime}-${uniqueValue}`;
            const currentData = searchDataMap.get(key);
            if (currentData) {
              patchData.push(currentData);
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
              patchData.push(nullEntry);
            }
          });
        }

        currentTime = new Date(currentTime.getTime() + intervalMillis);
        currentFormattedTime = formatUtc(currentTime);
      }

      const combined = patchData.concat(cacheEntry.filledData);
      missingValueCache.set(cacheKey, {
        filledData: combined,
        binnedFillStartMs: binnedFillStart.getTime(),
        binnedDateMs: binnedDate.getTime(),
        anchorTimes: startAnchorTimes,
        anchorEntryCount:
          startAnchorTimes.length *
          (hasBreakdown ? uniqueXAxisValues.size : 1),
        timeKey,
        uniqueKey,
        hasBreakdown,
        uniqueValues: new Set(uniqueXAxisValues),
        interval,
        noValueConfigOption,
        endTimeForFill,
        isLeftToRight,
      });

      return combined;
    }
  }

  // RTL: insert anchors at the user's selected start time when the fill loop
  // doesn't yet cover it. Real data is preserved from cache when available.
  // Anchor/phantom entries use empty string (not noValueConfigOption) so
  // ECharts renders them as gaps rather than plotted points at the configured value.
  if (startAnchorTimes.length > 0) {
    if (!hasBreakdown) {
      startAnchorTimes.forEach((t) => {
        const lookupKey = `${t}`;
        const oldEntry = oldFilledDataMap?.get(lookupKey);
        if (oldEntry) {
          filledData.push(oldEntry);
        } else {
          const anchorEntry: any = { [timeKey]: t };
          keys.forEach((key) => {
            if (key !== timeKey) anchorEntry[key] = "";
          });
          filledData.push(anchorEntry);
        }
      });
    } else {
      startAnchorTimes.forEach((t) => {
        uniqueXAxisValues.forEach((uniqueValue: any) => {
          const lookupKey = `${t}-${uniqueValue}`;
          const oldEntry = oldFilledDataMap?.get(lookupKey);
          if (oldEntry) {
            filledData.push(oldEntry);
          } else {
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
          }
        });
      });
    }
  }

  // Fill slot-by-slot in chronological order from binnedFillStart
  // (resultMetaData start) to endTimeForFill (user's end).
  // Only covers the range where streaming data has been received.
  let currentTime = binnedFillStart;
  let currentFormattedTime = formatUtc(currentTime);

  while (currentFormattedTime <= endTimeForFill) {
    if (!hasBreakdown) {
      const key = `${currentFormattedTime}`;
      const currentData = searchDataMap.get(key);
      if (currentData) {
        filledData.push(currentData);
      } else {
        // Use old cached data if available, otherwise create null entry
        const oldEntry = oldFilledDataMap?.get(key);
        if (oldEntry) {
          filledData.push(oldEntry);
        } else {
          const nullEntry: any = { [timeKey]: currentFormattedTime };
          keys.forEach((key) => {
            if (key !== timeKey) nullEntry[key] = noValueConfigOption;
          });
          filledData.push(nullEntry);
        }
      }
    } else {
      uniqueXAxisValues.forEach((uniqueValue: any) => {
        const key = `${currentFormattedTime}-${uniqueValue}`;
        const currentData = searchDataMap.get(key);
        if (currentData) {
          filledData.push(currentData);
        } else {
          // Use old cached data if available, otherwise create null entry
          const oldEntry = oldFilledDataMap?.get(key);
          if (oldEntry) {
            filledData.push(oldEntry);
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
        }
      });
    }

    currentTime = new Date(currentTime.getTime() + intervalMillis);
    currentFormattedTime = formatUtc(currentTime);
  }

  // LTR: insert anchors at the user's selected end time when the fill loop
  // doesn't yet cover it. Real data is preserved from cache when available.
  // Anchor/phantom entries use empty string (not noValueConfigOption) so
  // ECharts renders them as gaps rather than plotted points at the configured value.
  const endAnchorTimes: string[] = [];
  if (isLeftToRight) {
    const binnedUserEnd = dateBin(interval, endTime, origin);
    const formattedBinnedUserEnd = formatUtc(binnedUserEnd);

    if (endTimeForFill < formattedBinnedUserEnd) {
      // Phantom point one interval after the last real data point.
      // `currentTime` after the fill loop is one interval past the last filled
      // slot, giving ECharts a consecutive pair (last data → nearAnchor) so it
      // can derive the correct bar width, instead of using the huge gap from
      // last chunk to user-end (~hours/days).
      if (currentFormattedTime < formattedBinnedUserEnd) {
        endAnchorTimes.push(currentFormattedTime);
      }
      endAnchorTimes.push(formattedBinnedUserEnd);

      if (!hasBreakdown) {
        endAnchorTimes.forEach((t) => {
          const lookupKey = `${t}`;
          const oldEntry = oldFilledDataMap?.get(lookupKey);
          if (oldEntry) {
            filledData.push(oldEntry);
          } else {
            const anchorEntry: any = { [timeKey]: t };
            keys.forEach((key) => {
              if (key !== timeKey) anchorEntry[key] = "";
            });
            filledData.push(anchorEntry);
          }
        });
      } else {
        endAnchorTimes.forEach((t) => {
          uniqueXAxisValues.forEach((uniqueValue: any) => {
            const lookupKey = `${t}-${uniqueValue}`;
            const oldEntry = oldFilledDataMap?.get(lookupKey);
            if (oldEntry) {
              filledData.push(oldEntry);
            } else {
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
            }
          });
        });
      }
    }
  }

  if (cacheKey) {
    const cachedAnchorTimes = isLeftToRight ? endAnchorTimes : startAnchorTimes;
    missingValueCache.set(cacheKey, {
      filledData,
      binnedFillStartMs: binnedFillStart.getTime(),
      binnedDateMs: binnedDate.getTime(),
      anchorTimes: cachedAnchorTimes,
      anchorEntryCount:
        cachedAnchorTimes.length *
        (hasBreakdown ? uniqueXAxisValues.size : 1),
      timeKey,
      uniqueKey,
      hasBreakdown,
      uniqueValues: new Set(uniqueXAxisValues),
      interval,
      noValueConfigOption,
      endTimeForFill,
      isLeftToRight,
    });
  }

  return filledData;
};
