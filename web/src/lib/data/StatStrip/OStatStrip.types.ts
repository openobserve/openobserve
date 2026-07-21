// Copyright 2026 OpenObserve Inc.
//
// Types for OStatCard / OStatStrip — the reusable summary-stat tiles used at the
// top of list / table / dashboard screens. `tone` is the ONE knob that drives a
// stat's colour, so the same semantic state reads the same colour everywhere.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** Semantic colour of a stat. Maps to one icon-chip + value colour pair. */
export type StatTone =
  | "success"
  | "warning"
  | "error"
  | "primary"
  | "neutral";

/** Optional delta shown beside the value (e.g. "▲ 12%"). */
export interface StatTrend {
  direction: "up" | "down" | "flat";
  /** Already-formatted delta text, e.g. "12%" or "+4". */
  label: string;
  /** Colour of the trend text. Defaults to neutral. */
  tone?: StatTone;
}

export interface StatItem {
  /** Stable key for the v-for. */
  key: string;
  /** Uppercase caption under the value (already localised by the caller). */
  label: string;
  /** The number / text shown large. */
  value: string | number;
  /** Optional leading glyph, shown in a tone-coloured chip. */
  icon?: IconName;
  /** Semantic colour. Defaults to `neutral`. */
  tone?: StatTone;
  /** Optional trend delta. */
  trend?: StatTrend;
  /**
   * When set, the tile shows a thin tone-coloured proportion bar filled to
   * `value / max` (e.g. this state's share of the total). Omit for no bar.
   */
  max?: number;
  /**
   * When the strip is `selectable`, set this to false to make THIS tile a plain
   * display (not a clickable filter) — e.g. a "Total" tile. Defaults to true.
   */
  selectable?: boolean;
  /** data-test hook for the tile root. */
  dataTest?: string;
}
