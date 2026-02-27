import { getColorPalette } from "./colorPalette";

/**
 * Applies user-configured series-to-color mappings to the given series list and
 * ensures auto-generated colors do not conflict with configured colors.
 *
 * - Enforces configured colors for mapped series names
 * - Tracks colors already in use (configured + existing on series)
 * - Reassigns auto-generated colors that collide with configured ones to the
 *   next available color from the theme palette; if exhausted, uses an HSL fallback
 *
 * This function mutates the provided `series` array in place.
 */
export const applySeriesColorMappings = (
  series: any[],
  colorBySeries:
    | Array<{ value: string; color: string | null }>
    | undefined
    | null,
  theme: string,
): void => {
  if (!Array.isArray(series) || !colorBySeries?.length) return;

  const configuredSeriesToColor = new Map<string, string>();
  const configuredColors = new Set<string>();
  for (const mapping of colorBySeries) {
    if (mapping?.value && mapping?.color) {
      configuredSeriesToColor.set(String(mapping.value), String(mapping.color));
      configuredColors.add(String(mapping.color));
    }
  }

  if (configuredSeriesToColor.size === 0) return;

  const usedColors = new Set<string>(configuredColors);

  const getSeriesColor = (s: any): string | undefined =>
    s?.color ?? s?.itemStyle?.color;
  const setSeriesColor = (s: any, clr: string) => {
    if (!s) return;
    if (s.color !== undefined) s.color = clr;
    if (s.itemStyle?.color !== undefined) s.itemStyle.color = clr;
  };

  // Enforce configured colors and collect currently used colors
  series.forEach((s: any) => {
    const mapped = configuredSeriesToColor.get(s?.name);
    if (mapped) {
      setSeriesColor(s, mapped);
      usedColors.add(mapped);
    } else {
      const current = getSeriesColor(s);
      if (current) usedColors.add(current);
    }
  });

  // Generate a unique non-conflicting color
  const generateUniqueColor = (
    used: Set<string>,
    themeName: string,
  ): string => {
    const palette = getColorPalette(themeName);
    for (const c of palette) {
      if (!used.has(c)) return c;
    }
    const hue = (used.size * 137.508) % 360;
    const saturation = 70 + (used.size % 20);
    const lightness = 45 + (used.size % 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  // Reassign auto-generated colors that collide with configured colors
  series.forEach((s: any) => {
    if (configuredSeriesToColor.has(s?.name)) return;
    const current = getSeriesColor(s);
    if (current && configuredColors.has(current)) {
      const next = generateUniqueColor(usedColors, theme);
      usedColors.add(next);
      setSeriesColor(s, next);
    }
  });
};

// Modify the getContrastColor function to consider theme
export const getContrastColor = (
  backgroundColor: string,
  isDarkTheme: boolean,
): string => {
  // If no background color, return based on theme
  if (!backgroundColor) {
    return isDarkTheme ? "#FFFFFF" : "#000000";
  }

  // Normalize input (support hex, rgb, rgba)
  const normalizeColor = (
    color: string,
  ): { r: number; g: number; b: number } => {
    // Remove spaces and convert to lowercase
    color = color.replace(/\s/g, "").toLowerCase();

    // Hex color
    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      return {
        r: parseInt(hex.substr(0, 2), 16),
        g: parseInt(hex.substr(2, 2), 16),
        b: parseInt(hex.substr(4, 2), 16),
      };
    }

    // RGB or RGBA
    if (color.startsWith("rgb")) {
      const matches = color.match(/rgba?\((\d+),(\d+),(\d+)(?:,([.\d]+))?\)/);
      if (matches) {
        return {
          r: parseInt(matches[1], 10),
          g: parseInt(matches[2], 10),
          b: parseInt(matches[3], 10),
        };
      }
    }

    // Fallback
    return { r: 255, g: 255, b: 255 };
  };

  // Normalize the background color
  const { r, g, b } = normalizeColor(backgroundColor);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance and theme
  if (isDarkTheme) {
    // In dark theme, prefer white text unless background is very light
    return luminance > 0.8 ? "#000000" : "#FFFFFF";
  } else {
    // In light theme, prefer black text unless background is very dark
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  }
};
