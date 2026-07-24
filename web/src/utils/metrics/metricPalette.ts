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
 * The metrics explorer's chart palette.
 *
 * Card series colour is assigned by card INDEX, cycling the palette — not by
 * metric type. The index is the card's position in the complete
 * filtered-and-sorted result set (not the virtualized render window), so
 * colours stay stable while scrolling and are deterministic for a given
 * filter/sort state. They reshuffle on re-filter/re-sort, which is expected.
 *
 * The colours themselves are NOT redeclared here. They are the same series
 * colours the dashboard charts already use, imported from the one place that
 * owns them, so a card and the panel you land on when you click it are drawn
 * from the same ramp. A second hard-coded list here would be free to drift.
 */

import {
  classicColorPaletteDarkTheme,
  classicColorPaletteLightTheme,
} from "@/utils/dashboard/colorPalette";

export interface PaletteColor {
  dark: string;
  light: string;
}

/** The shared dashboard series ramp, paired light/dark by index. */
export const CARD_PALETTE: PaletteColor[] = classicColorPaletteDarkTheme.map((dark, i) => ({
  dark,
  light: classicColorPaletteLightTheme[i],
}));

/** Area fill under a card's line: a wash, readable but never rivalling the line. */
export const CARD_AREA_FILL_OPACITY = 0.1;

/**
 * The colour for the card at `index` in the full filtered/sorted result set.
 */
export function cardColorForIndex(index: number, isDark: boolean): string {
  const size = CARD_PALETTE.length;
  const color = CARD_PALETTE[((index % size) + size) % size];
  return isDark ? color.dark : color.light;
}

/**
 * Metric-type badge colours, indexed into the shared ramp so the badges cannot
 * drift from the card colours. Badge colour is never the sole carrier of
 * meaning — the badge is also labelled, and the footer names the function.
 *
 * The ramp's order is blue, green, orange, pink, purple, … (see colorPalette).
 */
const BADGE_COLORS: Record<string, PaletteColor> = {
  counter: CARD_PALETTE[0], // blue
  gauge: CARD_PALETTE[1], // green
  histogram: CARD_PALETTE[4], // purple
  summary: CARD_PALETTE[2], // orange
};

const NEUTRAL_BADGE: PaletteColor = { dark: "#9AA0A6", light: "#6C737A" };

/**
 * @param typeFilterBucket one of counter | gauge | histogram | summary | other
 */
export function getBadgeStyle(
  typeFilterBucket: string,
  isDark: boolean,
): { color: string; background: string } {
  const entry = BADGE_COLORS[typeFilterBucket] ?? NEUTRAL_BADGE;
  const color = isDark ? entry.dark : entry.light;
  // Same hue at ~12% opacity for the pill background.
  return { color, background: `${color}1F` };
}

/** Human-facing badge text per type-filter bucket. */
export const BADGE_LABELS: Record<string, string> = {
  counter: "Counter",
  gauge: "Gauge",
  histogram: "Histogram",
  summary: "Summary",
  other: "Other",
};
