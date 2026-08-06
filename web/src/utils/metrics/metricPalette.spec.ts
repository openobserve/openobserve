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

import { describe, it, expect } from "vitest";
import { BADGE_LABELS, CARD_PALETTE, cardColorForIndex, getBadgeStyle } from "./metricPalette";

describe("getBadgeStyle", () => {
  /**
   * The badge is keyed on the type-filter BUCKET id, and on nothing else.
   *
   * This is the contract that a caller once broke by round-tripping: it mapped
   * the bucket to its human label and then recovered the id with
   * `label.toLowerCase()`. That worked only for as long as every label stayed
   * the capitalized spelling of its id — the day one reads "Gauge (native)", or
   * is translated, the lookup misses and the badge silently turns grey, which
   * looks like a metric with no type rather than a bug. Pinning the contract
   * here is what makes that mistake visible.
   */
  const BUCKETS = ["counter", "gauge", "histogram", "summary"];

  it.each(BUCKETS)("gives %s a colour of its own", (bucket) => {
    const { color } = getBadgeStyle(bucket, true);

    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color).not.toBe(getBadgeStyle("other", true).color);
  });

  it("gives the four types four DIFFERENT colours", () => {
    const colors = BUCKETS.map((b) => getBadgeStyle(b, true).color);

    expect(new Set(colors).size).toBe(BUCKETS.length);
  });

  it("draws from the shared dashboard ramp, not a palette of its own", () => {
    // The card and the panel you land on when you click it must agree.
    const ramp = new Set(CARD_PALETTE.flatMap((c) => [c.dark, c.light]));

    for (const bucket of BUCKETS) {
      expect(ramp.has(getBadgeStyle(bucket, true).color)).toBe(true);
      expect(ramp.has(getBadgeStyle(bucket, false).color)).toBe(true);
    }
  });

  it("falls back to neutral for anything that is not a bucket id", () => {
    const neutral = getBadgeStyle("other", true).color;

    // A human LABEL is not a bucket id — which is precisely why nothing may
    // reconstruct the id from the label.
    expect(getBadgeStyle("Counter", true).color).toBe(neutral);
    expect(getBadgeStyle("", true).color).toBe(neutral);
    expect(getBadgeStyle("something-new", true).color).toBe(neutral);
  });

  it("answers differently for light and dark", () => {
    expect(getBadgeStyle("counter", true).color).not.toBe(getBadgeStyle("counter", false).color);
  });

  it("tints the pill background from the same hue as its text", () => {
    const { color, background } = getBadgeStyle("gauge", true);

    expect(background.startsWith(color)).toBe(true);
  });

  it("has a label for every bucket it colours", () => {
    for (const bucket of [...BUCKETS, "other"]) {
      expect(BADGE_LABELS[bucket]).toBeTruthy();
    }
  });
});

describe("cardColorForIndex", () => {
  it("cycles the ramp, so colours are stable while scrolling", () => {
    const size = CARD_PALETTE.length;

    expect(cardColorForIndex(0, true)).toBe(cardColorForIndex(size, true));
    expect(cardColorForIndex(1, true)).toBe(cardColorForIndex(size + 1, true));
  });

  it("survives a negative index rather than returning undefined", () => {
    // The grid subtracts to find a card's place in the filtered set, and an
    // off-by-one there would otherwise paint `undefined` into the chart config.
    expect(cardColorForIndex(-1, true)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
