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

import type { LocationQuery } from "vue-router";

/**
 * Panel time range types for picker format
 */
export interface PanelTimePickerValue {
  type: "relative" | "absolute";
  valueType: "relative" | "absolute";
  relativeTimePeriod?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Panel time range configuration stored in panel config
 */
export interface PanelTimeRange {
  type: "relative" | "absolute";
  relativeTimePeriod?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Extract panel time from URL query parameters
 * Checks for both relative time (pt-period.{id}) and absolute time (pt-from.{id}, pt-to.{id})
 */
export const getPanelTimeFromURL = (
  panelId: string,
  query?: LocationQuery
): PanelTimePickerValue | null => {
  if (!query) return null;

  const relativeParam = query[`pt-period.${panelId}`];
  const fromParam = query[`pt-from.${panelId}`];
  const toParam = query[`pt-to.${panelId}`];

  if (relativeParam) {
    return {
      type: "relative",
      valueType: "relative",
      relativeTimePeriod: relativeParam as string,
    };
  }

  if (fromParam && toParam) {
    return {
      type: "absolute",
      valueType: "absolute",
      startTime: parseInt(fromParam as string),
      endTime: parseInt(toParam as string),
    };
  }

  return null;
};

/**
 * Convert panel time range config to date picker format
 */
export const convertPanelTimeRangeToPicker = (
  range: PanelTimeRange | null | undefined
): PanelTimePickerValue | null => {
  if (!range) return null;

  if (range.type === "relative") {
    return {
      type: "relative",
      valueType: "relative",
      relativeTimePeriod: range.relativeTimePeriod,
    };
  }

  return {
    type: "absolute",
    valueType: "absolute",
    startTime: range.startTime,
    endTime: range.endTime,
  };
};

/**
 * Convert time object (with Date objects) to picker format
 */
export const convertTimeObjToPickerFormat = (timeObj: any): PanelTimePickerValue | null => {
  if (!timeObj || !timeObj.start_time || !timeObj.end_time) {
    return null;
  }

  return {
    type: "absolute",
    valueType: "absolute",
    startTime: timeObj.start_time.getTime(),
    endTime: timeObj.end_time.getTime(),
  };
};

/**
 * Convert global time object to picker format
 */
export const convertGlobalTimeToPickerFormat = (
  globalTime: any
): PanelTimePickerValue | null => {
  if (!globalTime || !globalTime.start_time || !globalTime.end_time) {
    return null;
  }

  return {
    type: "absolute",
    valueType: "absolute",
    startTime: globalTime.start_time.getTime(),
    endTime: globalTime.end_time.getTime(),
  };
};

/**
 * Build panel time range object from picker value
 */
export const buildPanelTimeRange = (
  pickerValue: PanelTimePickerValue
): PanelTimeRange => {
  const timeType = pickerValue.valueType || pickerValue.type;

  if (timeType === "relative") {
    return {
      type: "relative",
      relativeTimePeriod: pickerValue.relativeTimePeriod,
    };
  }

  return {
    type: "absolute",
    startTime: pickerValue.startTime,
    endTime: pickerValue.endTime,
  };
};

/**
 * Check if a panel has custom time configuration
 */
export const hasPanelTime = (
  panel: any,
  panelId: string,
  query?: LocationQuery
): boolean => {
  return !!(
    panel?.config?.panel_time_range ||
    query?.[`pt-period.${panelId}`] ||
    query?.[`pt-from.${panelId}`]
  );
};

/**
 * Check if panel should use individual time (not global)
 */
export const shouldUsePanelTime = (panel: any): boolean => {
  return !!(
    panel?.config?.allow_panel_time &&
    panel?.config?.panel_time_mode === "individual" &&
    panel?.config?.panel_time_range
  );
};

/**
 * Resolve panel time value with priority:
 * 1. URL parameters (highest priority)
 * 2. Panel config
 * 3. Current time object for specific panel
 * 4. Global time (lowest priority)
 */
export const resolvePanelTimeValue = (
  panel: any,
  panelId: string,
  query?: LocationQuery,
  currentTimeObj?: any
): PanelTimePickerValue | null => {
  // Priority 1: URL params
  if (query) {
    const urlPanelTime = getPanelTimeFromURL(panelId, query);
    if (urlPanelTime) return urlPanelTime;
  }

  // Priority 2: Panel config
  const configTime = panel?.config?.panel_time_range;
  if (configTime) {
    const pickerValue = convertPanelTimeRangeToPicker(configTime);
    if (pickerValue) return pickerValue;
  }

  // Priority 3: Current time for this specific panel
  if (currentTimeObj?.[panelId]) {
    const pickerValue = convertTimeObjToPickerFormat(currentTimeObj[panelId]);
    if (pickerValue) return pickerValue;
  }

  // Priority 4: Global time
  if (currentTimeObj?.["__global"]) {
    return convertGlobalTimeToPickerFormat(currentTimeObj["__global"]);
  }

  return null;
};
