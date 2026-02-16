/**
 * Trace Span Color Utilities
 * Provides helper functions to access the 50 span colors defined in _variables.scss
 */

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
 * Get color with opacity
 * @param index - Color index (1-50)
 * @param opacity - Opacity value (0-1)
 * @returns RGB color string with alpha
 */
export const getSpanColorWithOpacity = (index: number, opacity: number = 1): string => {
  const colorIndex = ((index - 1) % 50) + 1;
  return `color-mix(in srgb, var(--o2-span-${colorIndex}) ${opacity * 100}%, transparent)`;
};

/**
 * Get all 50 span colors as an array
 * Useful for generating legends or color pickers
 * @returns Array of CSS variable strings
 */
export const getAllSpanColors = (): string[] => {
  return Array.from({ length: 50 }, (_, i) => `var(--o2-span-${i + 1})`);
};

/**
 * Trace UI color utilities
 */
export const traceUIColors = {
  surface: 'var(--o2-trace-surface)',
  border: 'var(--o2-trace-border)',
  textPrimary: 'var(--o2-trace-text-primary)',
  textSecondary: 'var(--o2-trace-text-secondary)',
  hover: 'var(--o2-trace-hover)',
  selected: 'var(--o2-trace-selected)',
};

/**
 * Generate service color map for multiple services
 * @param serviceNames - Array of service names
 * @returns Map of service name to color
 */
export const generateServiceColorMap = (serviceNames: string[]): Map<string, string> => {
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
  return 'white';
};

/**
 * Status colors (error, success, warning)
 */
export const statusColors = {
  error: 'var(--o2-red-800)',
  success: 'var(--o2-green-700)',
  warning: 'var(--o2-yellow-700)',
  info: 'var(--o2-blue-700)',
};

/**
 * Span kind colors (following OpenTelemetry span kinds)
 */
export const spanKindColors = {
  client: 'var(--o2-span-1)',      // Blue
  server: 'var(--o2-span-3)',      // Green
  producer: 'var(--o2-span-7)',    // Pink
  consumer: 'var(--o2-span-4)',    // Purple
  internal: 'var(--o2-span-10)',   // Amber
  unspecified: 'var(--o2-gray-700)',
};
