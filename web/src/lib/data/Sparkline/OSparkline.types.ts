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
 * OSparkline.types.ts — public types for OSparkline.
 *
 * A trend shape small enough to live inside a table cell. Generic by design:
 * it knows nothing about any domain and takes points, not a series object.
 */

import type { I18nText } from "@/types/i18n";

/**
 * One point of the series.
 *
 * `value: null` is the load-bearing case and the reason this is an object
 * rather than a bare `number[]`. A gap in a series is NOT a zero — a metric
 * that was not observed in a window (ranked out of a top-N, not yet
 * aggregated) must break the line rather than dive to the baseline, because a
 * line drawn to zero says "this stopped" when the truth is "we did not look".
 */
export interface SparklinePoint {
  value: number | null;
  /**
   * Renders the point muted and outside the line, for a value whose provenance
   * differs from its neighbours (a not-yet-aggregated live tail).
   */
  provisional?: boolean;
}

/** Tone of the trend shape. Semantic, not decorative. */
export type SparklineTone = "default" | "success" | "warning" | "danger" | "neutral";

export interface SparklineProps {
  /** The series, oldest → newest. Bare numbers are accepted for the simple case. */
  points?: readonly (SparklinePoint | number | null)[];
  /** `area` fills under the line; `bar` draws one column per point. */
  shape?: "area" | "bar";
  tone?: SparklineTone;
  /**
   * Fixes the vertical scale's ceiling. Omit to scale to the series' own max —
   * pass a shared value when several sparklines must be comparable to each
   * other, since independently-scaled shapes cannot be compared by eye.
   */
  max?: number;
  /** Height step. Cells use `xs`; a card's `#chart` slot uses `sm`. */
  size?: "xs" | "sm";
  /** Accessible description of the trend, e.g. "calls over the last 6 windows". */
  ariaLabel?: I18nText;
  dataTest?: string;
}
