/**
 * Trace Span Color Utilities
 * Provides helper functions to access the 50 span colors defined in _variables.scss
 */

/**
 * Light mode span colors (50 colors)
 */
export const LIGHT_SPAN_COLORS = [
  "#3B82F6",
  "#10B981",
  "#06B6D4",
  "#EC4899",
  "#84CC16",
  "#6366F1",
  "#F59E0B",
  "#14B8A6",
  "#D946EF",
  "#16A34A",
  "#7C3AED",
  "#F59E0B",
  "#0284C7",
  "#84CC16",
  "#6366F1",
  "#F9A8D4",
  "#10B981",
  "#8B5CF6",
  "#F97316",
  "#06B6D4",
  "#EC4899",
  "#22C55E",
  "#A855F7",
  "#FBBF24",
  "#3B82F6",
  "#F43F5E",
  "#14B8A6",
  "#D946EF",
  "#6366F1",
  "#FB923C",
  "#0EA5E9",
  "#F472B6",
  "#22D3EE",
  "#A78BFA",
  "#A855F7",
  "#F97316",
  "#FCA5A5",
  "#818CF8",
  "#FCD34D",
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
  "#7DD3FC",
  "#FBCFE8",
  "#A5F3FC",
  "#DDD6FE",
  "#BBF7D0",
  "#FED7AA",
  "#C7D2FE",
  "#FEF3C7",
  "#99F6E4",
  "#FBE2F4",
  "#CFFAFE",
  "#EDE9FE",
  "#D1FAE5",
  "#FEF9C3",
  "#FEE2E2",
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
  return `var(--o2-span-${colorIndex})`;
};

/**
 * Get a span color hex value by index (1-50)
 * @param index - Color index (1-50)
 * @param theme - 'light' or 'dark' theme (defaults to 'light')
 * @returns Hex color string
 */
export const getSpanColorHex = (
  index: number,
  theme: "light" | "dark" = "light",
): string => {
  const colors =
    theme === "dark" ? DARK_SPAN_COLORS : LIGHT_SPAN_COLORS.reverse();
  const colorIndex = (index - 1) % 50;
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
  return `var(--o2-span-${colorIndex})`;
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
export const getSpanColorWithOpacity = (
  index: number,
  opacity: number = 1,
): string => {
  const colorIndex = ((index - 1) % 50) + 1;
  return `color-mix(in srgb, var(--o2-span-${colorIndex}) ${opacity * 100}%, transparent)`;
};

/**
 * Get all 50 span colors as an array of hex values
 * Useful for generating legends or color pickers
 * @param theme - 'light' or 'dark' theme (defaults to 'light')
 * @returns Array of hex color strings
 */
export const getAllSpanColors = (
  theme: "light" | "dark" = "light",
): string[] => {
  const colors = theme === "dark" ? DARK_SPAN_COLORS : LIGHT_SPAN_COLORS;
  // Return reversed order to maintain existing behavior (was 50-i)
  return [...colors].reverse();
};

/**
 * Trace UI color utilities
 */
export const traceUIColors = {
  surface: "var(--o2-trace-surface)",
  border: "var(--o2-trace-border)",
  textPrimary: "var(--o2-trace-text-primary)",
  textSecondary: "var(--o2-trace-text-secondary)",
  hover: "var(--o2-trace-hover)",
  selected: "var(--o2-trace-selected)",
};

/**
 * Generate service color map for multiple services
 * @param serviceNames - Array of service names
 * @returns Map of service name to color
 */
export const generateServiceColorMap = (
  serviceNames: string[],
): Map<string, string> => {
  const colorMap = new Map<string, string>();
  const usedColors = new Set<number>();

  serviceNames.forEach((serviceName, index) => {
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
    colorMap.set(serviceName, `var(--o2-span-${colorIndex})`);
  });

  return colorMap;
};

/**
 * Get readable text color (white or black) based on background color
 * @param backgroundColor - Background color CSS variable
 * @returns 'white' or 'black'
 */
export const getContrastTextColor = (backgroundColor: string): string => {
  // For now, return white for all span colors as they're designed with good contrast
  // Can be enhanced with actual luminance calculation if needed
  return "white";
};

/**
 * Status colors (error, success, warning)
 */
export const statusColors = {
  error: "var(--o2-red-800)",
  success: "var(--o2-green-700)",
  warning: "var(--o2-yellow-700)",
  info: "var(--o2-blue-700)",
};

/**
 * Span kind colors (following OpenTelemetry span kinds)
 */
export const spanKindColors = {
  client: "var(--o2-span-1)", // Blue
  server: "var(--o2-span-3)", // Green
  producer: "var(--o2-span-7)", // Pink
  consumer: "var(--o2-span-4)", // Purple
  internal: "var(--o2-span-10)", // Amber
  unspecified: "var(--o2-gray-700)",
};
