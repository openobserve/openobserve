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
 * Pure helpers for the KPI cards on the LLM Insights dashboard.
 * Extracted from the SFC so the trend / formatter logic can be tested
 * without mounting the component (no Vue / quasar / echarts deps).
 */

export type TrendDirection = "up" | "down" | "flat";
export type TrendSentiment = "good" | "bad" | "neutral";

export interface KpiTrend {
  direction: TrendDirection;
  sentiment: TrendSentiment;
  /** Absolute delta as a percentage. */
  deltaPct: number;
}

/** A change of less than this percentage is considered "flat". */
export const FLAT_THRESHOLD = 1;

/**
 * Compare current vs previous values and produce a trend descriptor for
 * the "% vs prev" chip on a KPI card.
 *
 * Rules:
 *   - both ≤ 0   → null (no meaningful comparison)
 *   - prev ≤ 0   → up 100% (always render as a fresh increase)
 *   - |delta| < FLAT_THRESHOLD% → flat / neutral
 *   - else       → up or down, sentiment driven by `upIsBad`
 *
 * `upIsBad` is true for metrics where higher is worse (cost, error
 * rate, latency) and false for "more is better" metrics. We don't
 * have any of the latter on the dashboard today, but the helper is
 * generic to keep that flexibility.
 *
 * @example computeTrend(200, 100, true)  // {up, bad, deltaPct: 100}
 * @example computeTrend(50, 100, true)   // {down, good, deltaPct: 50}
 * @example computeTrend(100, 100, true)  // {flat, neutral, deltaPct: 0}
 * @example computeTrend(0, 0, true)      // null
 */
export function computeTrend(
  curr: number,
  prev: number,
  upIsBad: boolean,
): KpiTrend | null {
  if (!isFinite(curr) || !isFinite(prev)) return null;
  if (prev <= 0 && curr <= 0) return null;
  if (prev <= 0) {
    return {
      direction: "up",
      sentiment: upIsBad ? "bad" : "good",
      deltaPct: 100,
    };
  }
  const deltaPct = ((curr - prev) / prev) * 100;
  const abs = Math.abs(deltaPct);
  if (abs < FLAT_THRESHOLD) {
    return { direction: "flat", sentiment: "neutral", deltaPct: abs };
  }
  const direction: TrendDirection = deltaPct > 0 ? "up" : "down";
  const sentiment: TrendSentiment =
    direction === "up" ? (upIsBad ? "bad" : "good") : upIsBad ? "good" : "bad";
  return { direction, sentiment, deltaPct: abs };
}

/**
 * Pick the unicode arrow glyph for a trend direction.
 * Used as the visual lead-in to the % delta in each card.
 */
export function trendArrow(direction: TrendDirection): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "→";
}

/**
 * Split a count into `{ value, unit }` for the big number + small unit
 * suffix on KPI cards. Switches to K / M / B for large counts; keeps
 * up to 9999 as-is so 4-digit token counts read naturally.
 *
 * @example splitNumberWithUnit(2_500_000_000) // { value: "2.5", unit: "B" }
 * @example splitNumberWithUnit(2_500_000)     // { value: "2.5", unit: "M" }
 * @example splitNumberWithUnit(12_345)        // { value: "12.3", unit: "K" }
 * @example splitNumberWithUnit(9_999)         // { value: "9,999", unit: "" }
 */
export function splitNumberWithUnit(n: number): {
  value: string;
  unit: string;
} {
  if (n >= 1_000_000_000)
    return { value: (n / 1_000_000_000).toFixed(1), unit: "B" };
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: "M" };
  if (n >= 10_000) return { value: (n / 1_000).toFixed(1), unit: "K" };
  return { value: n.toLocaleString(), unit: "" };
}

/**
 * Split a duration in microseconds into `{ value, unit }`.
 *   < 1s   → ms (rounded)
 *   < 1m   → s  (1 decimal)
 *   else   → min (1 decimal)
 *
 * Falsy / zero input → `{ "0", "ms" }` so the card renders as "0 ms"
 * instead of "0 (no unit)".
 *
 * @example splitDuration(0)            // { value: "0",   unit: "ms" }
 * @example splitDuration(123_000)      // { value: "123", unit: "ms" }
 * @example splitDuration(2_500_000)    // { value: "2.5", unit: "s" }
 * @example splitDuration(120_000_000)  // { value: "2.0", unit: "min" }
 */
export function splitDuration(micros: number): {
  value: string;
  unit: string;
} {
  if (!micros || micros === 0) return { value: "0", unit: "ms" };
  const ms = micros / 1000;
  if (ms < 1000) return { value: Math.round(ms).toString(), unit: "ms" };
  if (ms < 60_000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  return { value: (ms / 60_000).toFixed(1), unit: "min" };
}

/**
 * Format a window duration (microseconds) as a short relative label
 * for the KPI trend chip — `"15m"`, `"12h"`, `"3d"`, etc. Used to
 * tell the user *what* "prev" refers to (so the chip reads
 * "▲ 100% vs prev 12h" instead of an ambiguous "▲ 100% vs prev").
 *
 * Boundaries are inclusive on the right so a 60-second window reads
 * as "1m", not "60s".
 *
 * @example formatWindowLabel(30 * 1_000_000)            // "30s"
 * @example formatWindowLabel(15 * 60 * 1_000_000)       // "15m"
 * @example formatWindowLabel(12 * 60 * 60 * 1_000_000)  // "12h"
 * @example formatWindowLabel(7 * 86400 * 1_000_000)     // "7d"
 * @example formatWindowLabel(0)                          // ""  (defensive)
 */
export function formatWindowLabel(durationMicros: number): string {
  if (!durationMicros || durationMicros <= 0) return "";
  const seconds = durationMicros / 1_000_000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  return `${Math.round(days)}d`;
}

/**
 * Split a USD cost into `{ value: "$X.XX", unit }` for the cost KPI.
 * The `$` prefix is part of the value (so the unit suffix can be a
 * separate "K"/"M" multiplier).
 *
 * @example splitCost(2_500_000) // { value: "$2.50", unit: "M" }
 * @example splitCost(12_345)    // { value: "$12.3", unit: "K" }
 * @example splitCost(123.45)    // { value: "$123.45", unit: "" }
 * @example splitCost(0)         // { value: "$0.00", unit: "" }
 */
export function splitCost(cost: number): { value: string; unit: string } {
  if (cost >= 1_000_000)
    return { value: `$${(cost / 1_000_000).toFixed(2)}`, unit: "M" };
  if (cost >= 1_000)
    return { value: `$${(cost / 1_000).toFixed(1)}`, unit: "K" };
  return { value: `$${cost.toFixed(2)}`, unit: "" };
}
