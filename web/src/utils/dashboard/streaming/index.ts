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

import { overlayNewDataOnOldOptions } from "./overlayNewDataOnOldOptions";

/**
 * Determine if overlay is eligible for the current panel configuration.
 * Overlay is only appropriate for time-series charts with [timestamp, value] data format.
 * Ineligible types (pie, donut, metric, gauge) have no timestamps to merge on.
 */
export function isOverlayEligible(
  panelSchema: any,
  oldOptions: any,
): boolean {
  // Chart type must support time-series overlay
  const eligibleTypes = new Set([
    "line",
    "area",
    "area-stacked",
    "bar",
    "stacked",
    "h-bar",
    "h-stacked",
    "scatter",
  ]);
  if (!eligibleTypes.has(panelSchema.type)) return false;

  // No old data to overlay on
  if (!oldOptions?.series?.length) return false;

  // Chart type must not have changed
  if (oldOptions._chartType && oldOptions._chartType !== panelSchema.type) {
    return false;
  }

  // Query count must not have changed
  if (
    oldOptions._queryCount !== undefined &&
    oldOptions._queryCount !== panelSchema.queries.length
  ) {
    return false;
  }

  return true;
}

export { overlayNewDataOnOldOptions };
