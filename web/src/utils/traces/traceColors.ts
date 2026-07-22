/**
 * Trace Span Color Utilities
 *
 * `getSpanColor(i)` returns the theme-aware CSS var for span colour i — the
 * `--color-span-*` set (50 colours) in tokens/base.css — prefer it wherever a CSS
 * colour is accepted.
 *
 * `getSpanColorHex(i, theme)` returns a raw hex from the two arrays below, for the
 * canvas/ECharts call sites that cannot consume a CSS var. NOTE: these arrays hold
 * 35 entries and do NOT match the 50 --color-span-* token values.
 */

/**
 * Light-mode span colours — 35-entry raw-hex fallback for getSpanColorHex (NOT the
 * --color-span-* token set; see the file header). Used only where a CSS var can't go.
 */
export const LIGHT_SPAN_COLORS = [
  "#10B981",
  "#06B6D4",
  "#84CC16",
  "#6366F1",
  "#F59E0B",
  "#3B82F6",
  "#14B8A6",
  "#D946EF",
  "#7C3AED",
  "#F59E0B",
  "#0284C7",
  "#84CC16",
  "#6366F1",
  "#F9A8D4",
  "#10B981",
  "#8B5CF6",
  "#F97316",
  "#22D3EE",
  "#06B6D4",
  "#21cb60",
  "#A855F7",
  "#FBBF24",
  "#3B82F6",
  "#14B8A6",
  "#6366F1",
  "#FB923C",
  "#0EA5E9",
  "#F472B6",
  "#A855F7",
  "#818CF8",
  "#F97316",
  "#FCA5A5",
  "#06B6D4",
  "#A78BFA",
  "#3B82F6",
] as const;

/**
 * Dark mode span colors (50 colors)
 */
export const DARK_SPAN_COLORS = [
  "#60A5FA",
  "#F87171",
  "#34D399",
  "#C084FC",
  "#FB923C",
  "#22D3EE",
  "#F472B6",
  "#A3E635",
  "#818CF8",
  "#FBBF24",
  "#2DD4BF",
  "#E879F9",
  "#4ADE80",
  "#A78BFA",
  "#FCD34D",
  "#38BDF8",
  "#FB7185",
  "#BEF264",
  "#818CF8",
  "#FCA5A5",
  "#6EE7B7",
  "#C084FC",
  "#FDBA74",
  "#67E8F9",
  "#F9A8D4",
  "#86EFAC",
  "#D8B4FE",
  "#FDE68A",
  "#93C5FD",
  "#FECACA",
  "#5EEAD4",
  "#F0ABFC",
  "#D9F99D",
  "#A5B4FC",
  "#FED7AA",
] as const;

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
export const getSpanColorHex = (index: number, theme: "light" | "dark" = "light"): string => {
  const colors = theme === "dark" ? DARK_SPAN_COLORS : LIGHT_SPAN_COLORS;
  const colorIndex = (((index - 1) % colors.length) + colors.length) % colors.length;
  return colors[colorIndex];
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
export const getAllSpanColors = (theme: "light" | "dark" = "light"): string[] => {
  const colors = theme === "dark" ? DARK_SPAN_COLORS : LIGHT_SPAN_COLORS;
  // Return reversed order to maintain existing behavior
  return [...colors].reverse();
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
