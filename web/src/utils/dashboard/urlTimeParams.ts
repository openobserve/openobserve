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

// Shared URL <-> time-range / refresh helpers (simple date-picker shape), lifted from ViewDashboard.
// ⚠️ Not the rich-shape date.ts helpers — those expect {tab,relative,absolute} and throw on this shape.

import type { LocationQuery } from "vue-router";
import { parseDuration, generateDurationLabel } from "@/utils/date";

export interface SelectedDate {
  valueType: "relative" | "absolute";
  startTime: number | string | null;
  endTime: number | string | null;
  relativeTimePeriod: string;
}

export type TimeQueryParams =
  | { period: string }
  | { from: number | string; to: number | string }
  | Record<string, never>;

// URL params -> selectedDate (period wins, else from/to, else relative 15m).
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

// selectedDate -> URL params: relative -> {period}, absolute -> {from,to}.
export const selectedDateToQueryParams = (
  data: SelectedDate | null | undefined,
): TimeQueryParams => {
  if (!data) return {};

  if (data.valueType === "relative" && data.relativeTimePeriod) {
    return { period: data.relativeTimePeriod };
  } else if (data.valueType === "absolute" && data.startTime && data.endTime) {
    return { from: data.startTime, to: data.endTime };
  }

  // fallback when valueType is missing
  if (data.relativeTimePeriod) {
    return { period: data.relativeTimePeriod };
  } else if (data.startTime && data.endTime) {
    return { from: data.startTime, to: data.endTime };
  }

  return {};
};

// refresh label (e.g. "30s") -> seconds, clamped to 0 (off) below the configured minimum.
export const refreshLabelToInterval = (
  label: string | undefined | null,
  minRefreshInterval = 0,
): number => {
  if (!label) return 0;
  const secs = parseDuration(label);
  if (minRefreshInterval && secs < minRefreshInterval) return 0;
  return secs;
};

export const refreshIntervalToLabel = (seconds: number): string =>
  generateDurationLabel(seconds);
