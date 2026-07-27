/**
 * Trace Span Color Utilities
 *
 * `getSpanColor(i)` returns the theme-aware CSS var for span colour i — the
 * `--color-span-*` set (50 colours) in tokens/base.css — prefer it wherever a CSS
 * colour is accepted.
 *
 * `getSpanColorHex(i, theme)` returns a raw hex for the canvas/ECharts call sites
 * that cannot consume a CSS var. The hex now comes from the `--color-trace-span-*`
 * tokens (base/dark.css, theme-aware) via `chartColor()`, which falls back to the
 * FALLBACKS map in chartTheme.ts under jsdom/SSR. There are 35 trace-span colours.
 */

import { chartColor, TRACE_SPAN_COLOR_COUNT } from "../chartTheme";

/**
 * Number of `--color-trace-span-*` tokens. Derived from chartTheme's FALLBACKS
 * registry (which mirrors base/dark.css) rather than hardcoded, so it never drifts
 * when the trace-span palette grows or shrinks.
 */
export const SPAN_COLOR_COUNT = TRACE_SPAN_COLOR_COUNT;

/**
 * Get a span color by index (1-50)
 * Uses CSS custom properties that automatically switch with theme
 * @param index - Color index (1-50)
 * @returns CSS variable string
 */
export const getSpanColor = (index: number): string => {
  // Ensure index is within bounds (1-50)
  const colorIndex = ((index - 1) % 50) + 1;
  return `var(--color-span-${colorIndex})`;
};

/**
 * Get a span color hex value by index (1-50)
 * @param index - Color index (1-50)
 * @param theme - 'light' or 'dark' theme (defaults to 'light')
 * @returns Hex color string
 */
export const getSpanColorHex = (index: number, _theme: "light" | "dark" = "light"): string => {
  // Light/dark swap lives in the --color-trace-span-* tokens (base/dark css);
  // `_theme` kept for call-site compatibility, ignored — CSS owns the swap.
  const n = SPAN_COLOR_COUNT;
  const colorIndex = (((index - 1) % n) + n) % n;
  return chartColor(`--color-trace-span-${colorIndex + 1}`);
};

/**
 * Generate a consistent color for a service name using hashing
 * @param serviceName - Name of the service
 * @returns CSS variable string
 */
export const getServiceColor = (serviceName: string): string => {
  // Simple hash function to get consistent color for same service
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) {
    hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Map hash to color index (1-50)
  const colorIndex = (Math.abs(hash) % 50) + 1;
  return `var(--color-span-${colorIndex})`;
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
 * Get color with opacity
 * @param index - Color index (1-50)
 * @param opacity - Opacity value (0-1)
 * @returns RGB color string with alpha
 */
export const getSpanColorWithOpacity = (index: number, opacity: number = 1): string => {
  const colorIndex = ((index - 1) % 50) + 1;
  return `color-mix(in srgb, var(--color-span-${colorIndex}) ${opacity * 100}%, transparent)`;
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
 * Generate service color map for multiple services
 * @param serviceNames - Array of service names
 * @returns Map of service name to color
 */
export const generateServiceColorMap = (serviceNames: string[]): Map<string, string> => {
  const colorMap = new Map<string, string>();
  const usedColors = new Set<number>();

  serviceNames.forEach((serviceName) => {
    // Use hash for consistency, but track used colors to maximize distinction
    let hash = 0;
    for (let i = 0; i < serviceName.length; i++) {
      hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
    }

    let colorIndex = (Math.abs(hash) % 50) + 1;

    // If color is already used, find next available
    let attempts = 0;
    while (usedColors.has(colorIndex) && attempts < 50) {
      colorIndex = (colorIndex % 50) + 1;
      attempts++;
    }

    usedColors.add(colorIndex);
    colorMap.set(serviceName, `var(--color-span-${colorIndex})`);
  });

  return colorMap;
};

/**
 * Get readable text color (white or black) based on background color
 * @param backgroundColor - Background color CSS variable
 * @returns 'white' or 'black'
 */
export const getContrastTextColor = (_backgroundColor: string): string => {
  // For now, return white for all span colors as they're designed with good contrast
  // Can be enhanced with actual luminance calculation if needed
  return "white";
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

/**
 * Span kind colors (following OpenTelemetry span kinds)
 */
export const spanKindColors = {
  client: "var(--color-span-1)", // Blue
  server: "var(--color-span-3)", // Green
  producer: "var(--color-span-7)", // Pink
  consumer: "var(--color-span-4)", // Purple
  internal: "var(--color-span-10)", // Amber
  unspecified: "var(--color-text-muted)",
};
