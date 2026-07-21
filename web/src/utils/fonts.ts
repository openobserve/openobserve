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
 * JS-side access to the two font tokens.
 *
 * CSS reaches fonts via `var(--font-sans)` / `var(--font-mono)`. Anything that
 * paints outside the CSS cascade cannot — canvas, ECharts (canvas renderer) and
 * Monaco all need a real font string. This module is the single bridge, so those
 * consumers stay in sync with `tokens/base.css` instead of hardcoding a stack.
 *
 * Read once and cached: the tokens are static (they do not vary by light/dark
 * theme), and `getComputedStyle` forces a style recalc we don't want on every
 * axis label of every panel.
 */

/** Compile-time fallbacks — used only when there is no DOM (SSR, jsdom). */
const FALLBACK_SANS =
  "'Geist', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const FALLBACK_MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace";

let sansCache: string | undefined;
let monoCache: string | undefined;

const readToken = (name: string, fallback: string): string => {
  if (typeof document === "undefined" || !document.documentElement) {
    return fallback;
  }
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
};

/** The app's sans family stack — mirrors `--font-sans`. */
export const getFontSans = (): string => {
  if (sansCache === undefined) {
    sansCache = readToken("--font-sans", FALLBACK_SANS);
  }
  return sansCache;
};

/** The app's mono family stack — mirrors `--font-mono`. */
export const getFontMono = (): string => {
  if (monoCache === undefined) {
    monoCache = readToken("--font-mono", FALLBACK_MONO);
  }
  return monoCache;
};

/**
 * Build a canvas `ctx.font` shorthand using a token stack.
 *
 * Canvas text measurement must use the same family the text will actually be
 * painted in, otherwise computed column widths are wrong and cells truncate or
 * overflow unpredictably.
 *
 * @param size  CSS size incl. unit, e.g. "12px"
 * @param family "sans" | "mono"
 * @param weight optional prefix, e.g. "bold"
 */
export const canvasFont = (
  size: string,
  family: "sans" | "mono" = "sans",
  weight?: string,
): string => {
  const stack = family === "mono" ? getFontMono() : getFontSans();
  return `${weight ? `${weight} ` : ""}${size} ${stack}`;
};

/**
 * Stamp the sans token onto an ECharts option object as its default text family.
 *
 * ECharts renders to canvas, so it never inherits the CSS cascade — without this
 * every axis, legend, label and tooltip falls back to ECharts' own `sans-serif`.
 *
 * Applied to the *options* rather than via `registerTheme` for two reasons:
 * the renderers pass ECharts' built-in "dark"/"light" themes and a custom theme
 * would replace (not extend) those palettes; and several `setOption` calls use
 * `notMerge`, which discards anything applied post-init.
 *
 * Any `textStyle.fontFamily` already present in the options wins, so per-chart
 * overrides keep working.
 *
 * Returns a NEW object — never mutates. The renderers pass `props.data.options`
 * straight in, and writing to a reactive prop from inside the render watcher
 * retriggers that watcher, which spins until the worker dies.
 */
export const withChartFont = <T extends Record<string, any>>(options: T): T => {
  if (!options || typeof options !== "object") return options;
  return {
    ...options,
    textStyle: { fontFamily: getFontSans(), ...(options.textStyle ?? {}) },
  };
};

/** Test-only: drop the cached values so a fresh token read happens. */
export const __resetFontCache = (): void => {
  sansCache = undefined;
  monoCache = undefined;
};
