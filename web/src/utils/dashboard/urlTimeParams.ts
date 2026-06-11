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

// ---------------------------------------------------------------------------
// Shared URL <-> time-range / refresh helpers (the SIMPLE date-picker shape).
//
// These were lifted verbatim from ViewDashboard.vue's local helpers so that the
// Metrics page and dashboards encode time the same way and can't drift.
//
// ⚠️ Do NOT route the simple `selectedDate` shape through `date.ts`'s
// `getQueryParamsForDuration` / `getDurationObjectFromParams` — those expect the
// RICH `{ tab, relative, absolute }` shape (RUM picker) and throw on this one.
// ---------------------------------------------------------------------------

import type { LocationQuery } from "vue-router";
import { parseDuration, generateDurationLabel } from "@/utils/date";

/**
 * The simple date-picker value shape used by `DateTimePickerDashboard`
 * (v-model) on the Metrics page and dashboards.
 */
export interface SelectedDate {
  valueType: "relative" | "absolute";
  startTime: number | string | null;
  endTime: number | string | null;
  relativeTimePeriod: string;
}

/** Time params on the URL: either a relative `period` OR absolute `from`+`to`. */
export type TimeQueryParams =
  | { period: string }
  | { from: number | string; to: number | string }
  | Record<string, never>;

/**
 * URL query params -> `selectedDate`. Mirrors ViewDashboard's
 * `getSelectedDateFromQueryParams`: `period` wins, else `from`+`to`, else a
 * relative default of `15m`.
 */
export const queryParamsToSelectedDate = (
  params: LocationQuery | Record<string, any>,
): SelectedDate => ({
  valueType: params.period
    ? "relative"
    : params.from && params.to
      ? "absolute"
      : "relative",
  startTime: params.from ? params.from : null,
  endTime: params.to ? params.to : null,
  relativeTimePeriod: params.period ? (params.period as string) : "15m",
});

/**
 * `selectedDate` -> URL query params. Mirrors ViewDashboard's local
 * `getQueryParamsForDuration`: relative -> `{ period }`, absolute ->
 * `{ from, to }`, with a fallback when `valueType` is missing.
 */
export const selectedDateToQueryParams = (
  data: SelectedDate | null | undefined,
): TimeQueryParams => {
  if (!data) return {};

  // Primary: use valueType when present.
  if (data.valueType === "relative" && data.relativeTimePeriod) {
    return { period: data.relativeTimePeriod };
  } else if (data.valueType === "absolute" && data.startTime && data.endTime) {
    return { from: data.startTime, to: data.endTime };
  }

  // Fallback for backward compatibility (valueType missing).
  if (data.relativeTimePeriod) {
    return { period: data.relativeTimePeriod };
  } else if (data.startTime && data.endTime) {
    return { from: data.startTime, to: data.endTime };
  }

  return {};
};

/**
 * URL `refresh` label (e.g. `30s`) -> interval in seconds, clamped to `0`
 * (off) when below the configured minimum. Mirrors ViewDashboard's read path.
 */
export const refreshLabelToInterval = (
  label: string | undefined | null,
  minRefreshInterval = 0,
): number => {
  if (!label) return 0;
  const secs = parseDuration(label);
  if (minRefreshInterval && secs < minRefreshInterval) return 0;
  return secs;
};

/** Interval in seconds -> URL `refresh` label (e.g. `30s`, `Off`). */
export const refreshIntervalToLabel = (seconds: number): string =>
  generateDurationLabel(seconds);
