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

import type { InjectionKey } from "vue";
import { getConsumableRelativeTime, isInvalidDate } from "@/utils/date";

export interface PanelTime {
  start_time: Date;
  end_time: Date;
}

/** Resolves a panel's time as of now; nothing means the time the panel was handed still stands. */
export type ResolveFreshPanelTime = (panelId: string) => PanelTime | null | undefined;

// Auto Run re-queries a panel without Refresh, the only step that otherwise moves a relative range forward.
export const DASHBOARD_FRESH_PANEL_TIME: InjectionKey<ResolveFreshPanelTime> =
  Symbol("dashboardFreshPanelTime");

// Read from the applied range, never the picker itself, which keeps a selection nobody applied.
export const resolveAppliedRangeNow = (appliedRange: any): PanelTime | undefined => {
  const range =
    appliedRange?.valueType === "relative" && appliedRange.relativeTimePeriod
      ? getConsumableRelativeTime(appliedRange.relativeTimePeriod)
      : appliedRange;
  if (!range?.startTime || !range?.endTime) return undefined;
  const time = { start_time: new Date(range.startTime), end_time: new Date(range.endTime) };
  return isInvalidDate(time.start_time) || isInvalidDate(time.end_time) ? undefined : time;
};

/** A resolver for a view whose panels all follow one applied time range. */
export const freshTimeFromAppliedRange =
  (isAutoRunOn: () => boolean, appliedRange: () => any): ResolveFreshPanelTime =>
  () =>
    isAutoRunOn() ? resolveAppliedRangeNow(appliedRange()) : undefined;
