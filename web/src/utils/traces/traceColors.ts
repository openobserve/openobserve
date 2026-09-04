/**
 * Trace Span Color Utilities
 *
 * `getSpanColorHex(i)` is the single source of span-bar colour. It returns a raw
 * hex from the `--color-trace-span-*` tokens (base/dark.css, theme-aware) via
 * `chartColor()`, which falls back to the FALLBACKS map in chartTheme.ts under
 * jsdom/SSR. There are 16 trace-span colours — see base.css for why that number.
 *
 * A second palette used to live here: a `--color-span-*` set of 50 tokens with
 * `getSpanColor`, `getServiceColor`, `getSpanColorWithOpacity`,
 * `generateServiceColorMap` and `spanKindColors` on top of it. Nothing consumed
 * any of them — every live path reaches a bar colour through `getSpanColorHex`
 * — and having two palettes side by side actively misled a colour-contrast
 * audit into measuring the wrong one. Both the tokens and the helpers are gone.
 */

import { chartColor, TRACE_SPAN_COLOR_COUNT } from "../chartTheme";

/**
 * Number of `--color-trace-span-*` tokens. Derived from chartTheme's FALLBACKS
 * registry (which mirrors base/dark.css) rather than hardcoded, so it never drifts
 * when the trace-span palette grows or shrinks.
 */
export const SPAN_COLOR_COUNT = TRACE_SPAN_COLOR_COUNT;

/**
 * Get a span colour hex by index. Indices wrap, so any integer is valid.
 * @param index - Colour index; wraps modulo SPAN_COLOR_COUNT
 * @param _theme - ignored; the light/dark swap lives in the tokens
 * @returns Hex colour string
 */
export const getSpanColorHex = (index: number, _theme: "light" | "dark" = "light"): string => {
  // Light/dark swap lives in the --color-trace-span-* tokens (base/dark css);
  // `_theme` kept for call-site compatibility, ignored — CSS owns the swap.
  const n = SPAN_COLOR_COUNT;
  const colorIndex = (((index - 1) % n) + n) % n;
  return chartColor(`--color-trace-span-${colorIndex + 1}`);
};

/**
 * Generate a consistent hex color for a service name using hashing
 * @param serviceName - Name of the service
 * @param theme - 'light' or 'dark' theme (defaults to 'light')
 * @returns Hex color string
 */
export const getServiceColorHex = (
  serviceName: string,
  theme: "light" | "dark" = "light",
): string => {
  // Simple hash function to get consistent color for same service
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) {
    hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Map hash to color index (1-50)
  const colorIndex = (Math.abs(hash) % 50) + 1;
  return getSpanColorHex(colorIndex, theme);
};

/**
 * Get all 50 span colors as an array of hex values
 * Useful for generating legends or color pickers
 * @param theme - 'light' or 'dark' theme (defaults to 'light')
 * @returns Array of hex color strings
 */
export const getAllSpanColors = (_theme: "light" | "dark" = "light"): string[] => {
  // Tokens own the light/dark swap; reversed to maintain existing behavior.
  const n = SPAN_COLOR_COUNT;
  return Array.from({ length: n }, (_v, i) => chartColor(`--color-trace-span-${i + 1}`)).reverse();
};

/**
 * Trace UI color utilities
 */
export const traceUIColors = {
  surface: "var(--color-trace-surface)",
  border: "var(--color-trace-border)",
  textPrimary: "var(--color-trace-text-primary)",
  textSecondary: "var(--color-trace-text-secondary)",
  hover: "var(--color-trace-hover)",
  selected: "var(--color-trace-selected)",
};

/**
 * Threshold on WCAG relative luminance for flipping text from white to black.
 *
 * 0.179 is the point where a background contrasts equally against both, so it
 * maximises the worse of the two ratios rather than favouring either.
 */
const CONTRAST_LUMINANCE_THRESHOLD = 0.179;

/** Parses `#rgb` / `#rrggbb` into 0-255 channels, or null if it is not a hex. */
const parseHexChannels = (color: string): [number, number, number] | null => {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;

  if (!/^[0-9a-f]{6}$/i.test(full)) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

/**
 * Get readable text color (white or black) based on background color
 *
 * For text that has to sit on a span's own colour. Span colours come from an
 * arbitrary palette, so the choice cannot be baked in per theme: a pale bar
 * needs black text in dark mode just as much as in light.
 *
 * @param backgroundColor - a hex colour (`#rgb` or `#rrggbb`)
 * @returns 'white' or 'black'
 *
 * Anything that is not a hex colour — notably the custom-property references
 * that `generateServiceColorMap` produces — cannot be measured here and yields
 * 'white', preserving this function's previous behaviour for those callers.
 * (Written without the `var()` spelling on purpose: `lint:tokens` scans comments
 * too, and a placeholder token name there fails the check.)
 */
export const getContrastTextColor = (backgroundColor: string): "white" | "black" => {
  const channels = parseHexChannels(backgroundColor ?? "");
  if (!channels) return "white";

  // WCAG relative luminance: linearise each channel, then weight by the eye's
  // sensitivity to it. Green dominates, which is why a mid-green bar needs dark
  // text where a mid-blue one of the same hex distance does not.
  const [r, g, b] = channels.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > CONTRAST_LUMINANCE_THRESHOLD ? "black" : "white";
};

/**
 * Status colors (error, success, warning)
 */
export const statusColors = {
  error: "var(--color-status-error-text)",
  success: "var(--color-status-success-text)",
  warning: "var(--color-status-warning-text)",
  info: "var(--color-status-info-text)",
};
