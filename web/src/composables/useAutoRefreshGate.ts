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

import { parseCalendarToken, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";

const SECONDS_PER_UNIT: [string, number][] = [
  ["M", 30 * 86_400],
  ["w", 7 * 86_400],
  ["d", 86_400],
  ["h", 3600],
  ["m", 60],
];
const ROUNDING_TOLERANCE = 0.05;
// 120 months: within every unit's custom-value cap in the picker (120M, 3650d, 520w, 87600h).
const MAX_SUGGESTED_SECONDS = 120 * 30 * 86_400;

/** A picker value as pages keep it: `type` on logs, `valueType` on dashboards. */
export interface RefreshRangeValue {
  type?: string;
  valueType?: string;
  startTime?: number;
  endTime?: number;
  relativeTimePeriod?: string | null;
}

/** A range whose end does not move with now, in microseconds. */
export interface FixedRange {
  startUs: number;
  endUs: number;
}

/** The fixed window of an absolute range or a finished calendar period; null while the range follows now. */
export const fixedRangeOf = (
  value: RefreshRangeValue | null | undefined,
  nowMs: number = Date.now(),
): FixedRange | null => {
  if (!value) return null;
  const type = value.valueType ?? value.type;
  if (type === "absolute") {
    const startUs = Number(value.startTime);
    const endUs = Number(value.endTime);
    return Number.isFinite(startUs) && Number.isFinite(endUs) && endUs > 0
      ? { startUs, endUs }
      : null;
  }
  const token = value.relativeTimePeriod ?? null;
  if ((parseCalendarToken(token)?.offset ?? 0) >= 0) return null;
  const range = resolveCalendarPeriod(token, undefined, nowMs);
  return range ? { startUs: range.startTime, endUs: range.endTime } : null;
};

/** Whether a fixed range has ended, so a refresh can find no new data in it. */
export const rangeHasEnded = (
  range: FixedRange | null | undefined,
  nowMs: number = Date.now(),
): boolean => !!range && range.endUs <= nowMs * 1000;

/** The relative period closest to a duration, never longer than `maxUs`: the largest unit off by at most 5%, e.g. `2d`, `510m`. */
export const suggestRelativePeriod = (durationUs: number, maxUs = 0): string => {
  const limit = Math.min(
    MAX_SUGGESTED_SECONDS,
    maxUs > 0 ? Math.max(60, maxUs / 1_000_000) : MAX_SUGGESTED_SECONDS,
  );
  const seconds = Math.min(limit, Math.max(60, durationUs / 1_000_000));
  for (const [unit, size] of SECONDS_PER_UNIT) {
    const count = Math.round(seconds / size);
    const close = Math.abs(count * size - seconds) <= seconds * ROUNDING_TOLERANCE;
    if (count >= 1 && close && count * size <= limit) return `${count}${unit}`;
  }
  return `${Math.max(1, Math.min(Math.ceil(seconds / 60), Math.floor(limit / 60)))}m`;
};

/** Whether the page hides this tab, so a refresh tick would draw for no one. */
export const isTabHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/** The pause rule both refresh timers share: a tick is skipped once the range it would re-run has ended. */
export default function useAutoRefreshGate() {
  const shouldSkipTick = (value: RefreshRangeValue | null | undefined): boolean =>
    rangeHasEnded(fixedRangeOf(value));
  return { shouldSkipTick, fixedRangeOf, rangeHasEnded, suggestRelativePeriod, isTabHidden };
}
