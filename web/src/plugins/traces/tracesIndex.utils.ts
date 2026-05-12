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

/**
 * Pure helpers for the traces page (`Index.vue`). Extracted so we can
 * unit-test the LLM Insights time-range resolution without mounting
 * the entire SFC.
 */

export interface TraceDatetime {
  type?: "relative" | "absolute" | string;
  startTime?: number | string;
  endTime?: number | string;
  relativeTimePeriod?: string | null;
}

export interface InsightsTimeRange {
  startTime: number;
  endTime: number;
}

/** Empty result used when no usable datetime is available. */
export const EMPTY_INSIGHTS_TIME_RANGE: InsightsTimeRange = {
  startTime: 0,
  endTime: 0,
};

/**
 * Resolve a datetime descriptor into a concrete (startTime, endTime)
 * window in microseconds for the LLM Insights dashboard.
 *
 * Behaviour:
 *   - null / undefined dt        → {0, 0}
 *   - dt.type === "relative" + relativeTimePeriod → call
 *     `getConsumableRelativeTime(period)` to anchor the window to
 *     `Date.now()` at call time. Falsy result → {0, 0}.
 *   - dt.type === "absolute"     → use raw startTime/endTime, coercing
 *     ISO strings via Date.parse (× 1000 to get microseconds).
 *
 * `getConsumableRelativeTime` is injected (rather than imported) so
 * the helper stays pure and testable. Production code passes the real
 * implementation from `@/utils/date`.
 *
 * @example computeInsightsTimeRange(
 *   { type: "absolute", startTime: 100, endTime: 200 },
 *   () => null,
 * ) // { startTime: 100, endTime: 200 }
 *
 * @example computeInsightsTimeRange(
 *   { type: "relative", relativeTimePeriod: "12h" },
 *   () => ({ startTime: 1000, endTime: 2000 }),
 * ) // { startTime: 1000, endTime: 2000 }
 *
 * @example computeInsightsTimeRange(null, () => null) // { 0, 0 }
 */
export function computeInsightsTimeRange(
  dt: TraceDatetime | null | undefined,
  getConsumableRelativeTime: (
    period: string,
  ) => InsightsTimeRange | null | undefined,
): InsightsTimeRange {
  if (!dt) return { ...EMPTY_INSIGHTS_TIME_RANGE };

  if (dt.type === "relative") {
    const period = dt.relativeTimePeriod;
    if (!period) return { ...EMPTY_INSIGHTS_TIME_RANGE };
    return (
      getConsumableRelativeTime(period) || { ...EMPTY_INSIGHTS_TIME_RANGE }
    );
  }

  // Absolute (or unspecified type — treat as absolute fall-through).
  // ISO/string inputs are converted via Date.parse and scaled to
  // microseconds; numeric inputs are taken as-is.
  return {
    startTime:
      typeof dt.startTime === "number"
        ? dt.startTime
        : new Date(dt.startTime as string).getTime() * 1000,
    endTime:
      typeof dt.endTime === "number"
        ? dt.endTime
        : new Date(dt.endTime as string).getTime() * 1000,
  };
}
