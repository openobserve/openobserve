// Copyright 2026 OpenObserve Inc.
//
// Types for OStatCard / OStatStrip, the one stat tile of the app (guidelines F7, C4, C6).

import type { I18nText } from "@/types/i18n";

import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** Status colour of a stat. Applied only while the value is above 0. */
export type StatTone = "neutral" | "ok" | "warn" | "err" | "crit" | "info";

/** Value size: `lg` is for overview pages. */
export type StatSize = "md" | "lg";

/** Change beside the value, e.g. "▲ 4%". */
export interface StatDelta {
  direction: "up" | "down" | "flat";
  /** Already-formatted change, e.g. "12%" or "+4". */
  label: I18nText;
  tone?: "ok" | "warn" | "err" | "neutral";
}

/** A tile value: null or undefined is unknown and renders "—"; a failed load passes null, never 0. */
export type StatValue = string | number | null | undefined;

export interface StatItem {
  key: string;
  label: I18nText;
  value: StatValue;
  /** Qualifier beside the label that says what the value is when the label is ambiguous. */
  sub?: I18nText;
  /** Shows `sub` as this glyph; `sub` becomes its accessible name and default tooltip. */
  subIcon?: IconName;
  subTooltip?: I18nText;
  icon?: IconName;
  tone?: StatTone;
  delta?: StatDelta;
  /** Denominator of the proportion track; without it the track stays empty. */
  max?: number;
  /** Shows a number as "819.5K"; the exact number moves to the tooltip. */
  compactValue?: boolean;
  /** In a selectable strip, false makes this tile a read-out rather than a filter. */
  selectable?: boolean;
  /** The reset tile ("All"): clears the filter and is never drawn as selected. Key "all" implies it. */
  all?: boolean;
  dataTest?: string;
}

/** Key the strip emits on select: null clears the filter. */
export type StatSelectKey = string | null;

export interface OStatCardProps {
  label?: I18nText;
  value?: StatValue;
  sub?: I18nText;
  subIcon?: IconName;
  subTooltip?: I18nText;
  icon?: IconName;
  tone?: StatTone;
  delta?: StatDelta;
  max?: number;
  compactValue?: boolean;
  size?: StatSize;
  /** Puts the label under the value, for tiles too narrow to fit them side by side. */
  stacked?: boolean;
  /** Renders the tile as a filter button. */
  clickable?: boolean;
  selected?: boolean;
  /** What clicking the filter tile does, shown as its tooltip. */
  hint?: I18nText;
  /** Shimmer in place of the value until it first arrives, never a "0" (K4). */
  loading?: boolean;
  dataTest?: string;
}

export interface OStatCardSlots {
  value?(): unknown;
  icon?(): unknown;
  /** Overview sparkline under the track. */
  chart?(): unknown;
}

export interface OStatStripProps {
  items?: StatItem[];
  loading?: boolean;
  /** Turns the tiles into filter buttons. */
  selectable?: boolean;
  selectedKey?: StatSelectKey;
  /** Tiles toggle independently into `selectedKeys`; none selected means unfiltered. */
  multiple?: boolean;
  /** The selected tiles in `multiple` mode. */
  selectedKeys?: string[];
  size?: StatSize;
  stacked?: boolean;
  /** What the numbers describe; a change shows the skeleton again on the next load. */
  resetKey?: string | number | null;
  /** Default for every item's `compactValue`. */
  compactValues?: boolean;
}

export interface OStatStripEmits {
  select: [key: StatSelectKey];
  "update:selectedKey": [key: StatSelectKey];
  "update:selectedKeys": [keys: string[]];
}

export interface OStatStripSlots {
  /** Composed tiles: OStatCard children. */
  default?(): unknown;
}
