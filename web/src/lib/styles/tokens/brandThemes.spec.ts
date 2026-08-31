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
 * Focus-ring contrast under every brand theme.
 *
 * `contrast.spec.ts` reads the token sheets as text, so it only ever sees the
 * shipped palette. `--color-primary-*` is not shipped: `applyThemeColors` writes
 * all eleven shades onto the document as inline styles, derived from one hex per
 * theme per mode. `--color-focus-ring-accent` is `var(--color-primary-600)` in
 * light and `var(--color-primary-400)` in dark, so the keyboard focus indicator
 * — the only thing telling a keyboard user where they are — is a different
 * colour under every theme, and the sheets cannot show that.
 *
 * These cases drive the real generator through `applyThemeColors`, read the
 * palette back off the DOM, and re-resolve the four ring primitives against the
 * page surface. A failure means keyboard focus is invisible under that theme;
 * the fix is a different `themeColor` in `constants/themes.ts`, or a different
 * shade behind the ring token — never a lower threshold.
 *
 * LIMITATION, not an oversight: `CUSTOM_THEME_NAME` persists an arbitrary hex
 * the user picked, and the same generator runs on it. Nothing here can bound
 * that, so custom themes have no guaranteed contrast floor.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { PREDEFINED_THEMES } from "@/constants/themes";
import { applyThemeColors } from "@/utils/theme";

import { composite, contrastRatio, resolveColor, resolveTokens } from "./colorMath";

const here = dirname(fileURLToPath(import.meta.url));

/** The sheets that make up a theme, in cascade order. */
const TOKEN_FILES = ["base.css", "semantic.css", "component.css", "dark.css"];

const SURFACE_BASE = "--color-surface-base";

/** SC 1.4.11: a focus indicator is a non-text contrast requirement. */
const FOCUS_RING_MIN = 3;

/** The library draws every ring with `ring-offset-surface-base`. */
const FOCUS_RINGS = [
  "--color-focus-ring-accent",
  "--color-focus-ring-danger",
  "--color-focus-ring-success",
  "--color-focus-ring-warning",
];

/** Every shade `generatePrimaryPalette` emits, in the order it emits them. */
const PRIMARY_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

const SHEETS = TOKEN_FILES.map((file) => readFileSync(join(here, file), "utf8"));
const THEMES = resolveTokens(SHEETS);

/** Apply a brand theme for real, then read the generated palette off the DOM. */
const paletteFor = (themeColor: string, mode: "light" | "dark"): Map<string, string> => {
  applyThemeColors(themeColor, mode, false);
  const root = document.documentElement;
  const palette = new Map<string, string>();
  for (const shade of PRIMARY_SHADES) {
    const name = `--color-primary-${shade}`;
    const value = root.style.getPropertyValue(name).trim();
    if (value) palette.set(name, value);
  }
  return palette;
};

const scopeFor = (themeColor: string, mode: "light" | "dark"): Map<string, string> => {
  const scope = new Map(THEMES[mode]);
  for (const [name, value] of paletteFor(themeColor, mode)) scope.set(name, value);
  return scope;
};

const CASES = PREDEFINED_THEMES.flatMap((theme) =>
  (["light", "dark"] as const).map((mode) => ({
    name: theme.name,
    mode,
    themeColor: theme[mode].themeColor,
  })),
);

describe("brand theme focus rings", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  // Guards every case below: an empty registry, or a generator that stopped
  // writing the palette, would otherwise leave nothing to fail.
  it("generates a full primary palette for every predefined theme", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(2 * PREDEFINED_THEMES.length);
    const offenders = CASES.filter(
      ({ themeColor, mode }) => paletteFor(themeColor, mode).size !== PRIMARY_SHADES.length,
    ).map(({ name, mode }) => `${name} (${mode})`);
    expect(offenders).toEqual([]);
  });

  it.each(CASES)("keeps every focus ring visible under $name in $mode", ({ themeColor, mode }) => {
    const scope = scopeFor(themeColor, mode);
    const surface = resolveColor(SURFACE_BASE, scope);
    expect(surface).not.toBeNull();

    const offenders = FOCUS_RINGS.map((ring) => [ring, resolveColor(ring, scope)] as const)
      .map(([ring, color]) => {
        if (!color) return `${ring} on ${SURFACE_BASE}: unresolved (need ${FOCUS_RING_MIN})`;
        const ratio = contrastRatio(composite(color, surface!), surface!);
        return ratio < FOCUS_RING_MIN
          ? `${ring} on ${SURFACE_BASE}: ${ratio.toFixed(2)}:1 (need ${FOCUS_RING_MIN})`
          : null;
      })
      .filter((line): line is string => line !== null);
    expect(offenders).toEqual([]);
  });
});
