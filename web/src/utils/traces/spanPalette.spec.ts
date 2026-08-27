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
 * Structural guard on the span-bar palette.
 *
 * Span-event markers are identified against a span bar by HUE, not by contrast:
 * no colour clears 3:1 against an arbitrary service colour, because the palette
 * covers the whole hue circle across a wide luminance range. The markers draw
 * from `--color-status-*`, and the palette earns their hues by not using them.
 *
 * That is a property of a hand-maintained token list, so it decays the moment
 * someone adds "just one more" colour. Nothing in the type system or the CSS
 * build can catch it. This file is the thing that catches it — it reads the two
 * token files as text, which is the only way to see both themes at once.
 *
 * If a case here fails, the fix is to pick a different colour, not to widen the
 * threshold. See lib/styles/tokens/base.css for the rule and its rationale.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAN_COLOR_COUNT } from "./traceColors";

const TOKENS = resolve(__dirname, "../../lib/styles/tokens");

/** Reserved for span-event markers: rose → red → orange → amber → yellow. */
const RESERVED_HUE_START = 345;
const RESERVED_HUE_END = 115;

/**
 * Floor on OKLab ΔE between a bar colour and a marker colour.
 *
 * 0.10 is set just under the palette's measured worst case (0.127) — close
 * enough to catch a genuine regression, loose enough not to fail on a colour
 * swap that keeps the design intact.
 */
const MIN_MARKER_SEPARATION = 0.1;

/** The marker colours the palette must stay clear of, per theme. */
const MARKER_COLOURS = {
  light: { error: "#cc3645", warning: "#e56d17", info: "#6c707e" },
  dark: { error: "#eb938d", warning: "#f2c55c", info: "#9da0a8" },
} as const;

const readPalette = (file: string): string[] => {
  const css = readFileSync(resolve(TOKENS, file), "utf8");
  const found = new Map<number, string>();
  for (const [, index, hex] of css.matchAll(/--color-trace-span-(\d+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found.set(Number(index), hex.toLowerCase());
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, hex]) => hex);
};

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

const linearise = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB hex to OKLab. The hue and distance maths below both need it. */
const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = channels(hex).map(linearise);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const hueOf = (hex: string): number => {
  const [, a, b] = oklab(hex);
  return (Math.atan2(b, a) * (180 / Math.PI) + 360) % 360;
};

const deltaE = (x: string, y: string): number => {
  const a = oklab(x);
  const b = oklab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

/** The band wraps past 360°, so it is two ranges rather than one. */
const isReserved = (hex: string): boolean => {
  const h = hueOf(hex);
  return h >= RESERVED_HUE_START || h <= RESERVED_HUE_END;
};

const PALETTES = {
  light: readPalette("base.css"),
  dark: readPalette("dark.css"),
} as const;

describe("span-bar palette", () => {
  it("finds a palette in each theme's token file", () => {
    // Guards the regex itself: a token-file reformat that broke the match would
    // otherwise make every case below pass vacuously on an empty array.
    expect(PALETTES.light.length).toBeGreaterThan(0);
    expect(PALETTES.dark.length).toBeGreaterThan(0);
  });

  // SPAN_COLOR_COUNT is a single number used to wrap the index for BOTH themes,
  // so a theme with fewer slots would have unreachable services fall back to the
  // light hex, and a theme with more would carry tokens nothing can request.
  it("gives both themes the same number of slots, matching SPAN_COLOR_COUNT", () => {
    expect(PALETTES.dark.length).toBe(PALETTES.light.length);
    expect(PALETTES.light.length).toBe(SPAN_COLOR_COUNT);
  });

  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    const palette = PALETTES[theme];

    // The reservation is the whole mechanism by which a marker is identifiable:
    // a red or amber tick can only mean "event" if no bar is ever red or amber.
    it("uses no colour from the reserved marker hue band", () => {
      const offenders = palette
        .filter(isReserved)
        .map((hex) => `${hex} (hue ${hueOf(hex).toFixed(0)}°)`);
      expect(offenders).toEqual([]);
    });

    // Allocation is sequential (getSpanColorHex(registry.size)), so a duplicated
    // slot means two services in the same trace draw identical bars. The old
    // 35-slot palette held only 23 distinct values and did exactly that.
    it("holds no duplicate colours", () => {
      expect(new Set(palette).size).toBe(palette.length);
    });

    it("keeps every colour clear of every marker colour", () => {
      const markers = Object.entries(MARKER_COLOURS[theme]);
      const tooClose = palette.flatMap((bar) =>
        markers
          .filter(([, marker]) => deltaE(bar, marker) < MIN_MARKER_SEPARATION)
          .map(
            ([tier, marker]) => `${bar} vs ${tier} ${marker}: ΔE ${deltaE(bar, marker).toFixed(3)}`,
          ),
      );
      expect(tooClose).toEqual([]);
    });
  });
});
