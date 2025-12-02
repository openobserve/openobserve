// Copyright 2023 OpenObserve Inc.
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

import { calculateWidthText } from "./convertDataIntoUnitValue";

// Constants for better maintainability
const LEGEND_CONSTANTS = {
  DEFAULT_WIDTH: 800,
  DEFAULT_HEIGHT: 400,
  MIN_TEXT_WIDTH: 60,
  TEXT_WIDTH_OFFSET: 55,
  PADDING: [10, 20, 10, 10] as [number, number, number, number],
  FONT_SIZE: 12,
  PADDING_OFFSET: 10,
  HEIGHT_OFFSET: 20,
  MIN_SCROLL_WIDTH: 120,
  MAX_SCROLL_WIDTH: 150,
  MIN_SCROLL_RESERVED: 120,
} as const;

/**
 * Utility function to get chart dimensions safely
 */
export const getChartDimensions = (chartPanelRef: any) => ({
  chartWidth:
    chartPanelRef.value?.offsetWidth || LEGEND_CONSTANTS.DEFAULT_WIDTH,
  chartHeight:
    chartPanelRef.value?.offsetHeight || LEGEND_CONSTANTS.DEFAULT_HEIGHT,
  containerWidth: chartPanelRef.value?.offsetWidth || 0,
});

/**
 * Utility function to check if legends should be shown
 */
const shouldShowLegends = (panelSchema: any): boolean =>
  Boolean(panelSchema.config?.show_legends) &&
  (panelSchema.config?.trellis?.layout === null ||
    panelSchema.config?.trellis?.layout === undefined);

/**
 * Converts the legend position string to the format expected by ECharts.
 *
 * @param {string} legendPosition - The desired position of the legend. Possible values are "bottom" and "right".
 * @return {string} The format of the legend position. Possible values are "horizontal" and "vertical".
 */
export const getLegendPosition = (legendPosition?: string): string => {
  switch (legendPosition) {
    case "bottom":
      return "horizontal";
    case "right":
      return "vertical";
    default:
      return "horizontal";
  }
};

/**
 * Converts rem units to pixels based on the root font size (typically 16px)
 * @param {number} rem - The rem value to convert
 * @param {number} rootFontSize - The root font size in pixels (default: 16)
 * @returns {number} The value in pixels
 */
const remToPx = (rem: number, rootFontSize: number = 16): number => {
  return rem * rootFontSize;
};

/**
 * Calculates and configures the height needed for legends when positioned at the bottom
 * @param {number} legendCount - Number of legend items
 * @param {number} chartWidth - Width of the chart container
 * @param {any[]} seriesData - Series data to get actual legend names
 * @param {number} maxHeight - Maximum available height for chart container (optional)
 * @param {any} legendConfig - Legend configuration object to modify (optional)
 * @param {any} gridConfig - Grid configuration object to modify (optional)
 * @param {number} chartHeight - Height of the chart container (required if configuring position)
 * @returns {number} Height in pixels to reserve at the bottom
 */
export const calculateBottomLegendHeight = (
  legendCount: number,
  chartWidth: number,
  seriesData: any[] = [],
  maxHeight?: number,
  legendConfig?: any,
  gridConfig?: any,
  chartHeight?: number,
): number => {
  if (legendCount === 0) return 0;

  // Constants for legend sizing in rem units (converted to pixels)
  const LEGEND_ITEM_HEIGHT = remToPx(1.25); // 1.25rem = 20px (Height per legend item row)
  const LEGEND_PADDING = remToPx(1.5); // 1.5rem = 24px (Top and bottom padding)
  const LEGEND_ICON_WIDTH = remToPx(0.875); // 0.875rem = 14px (Width of legend icon/symbol)
  const LEGEND_ICON_MARGIN = remToPx(0.5); // 0.5rem = 8px (Margin between icon and text)
  const LEGEND_ITEM_MARGIN = remToPx(1.25); // 1.25rem = 20px (Horizontal margin between legend items)
  const MIN_TEXT_WIDTH = remToPx(3.125); // 3.125rem = 50px (Minimum text width per legend item)
  const MAX_TEXT_WIDTH = remToPx(9.375); // 9.375rem = 150px (Maximum text width per legend item)

  // Calculate average text width based on actual series names
  let avgTextWidth = MIN_TEXT_WIDTH;
  if (seriesData.length > 0) {
    const totalTextWidth = seriesData.reduce((sum, series) => {
      const name = (series.name || series.seriesName || "").toString();
      // Use calculateWidthText for accurate font-based measurements
      const textWidth = calculateWidthText(name, "12px");
      return sum + textWidth;
    }, 0);
    const avgTextLength = totalTextWidth / seriesData.length;
    // Use actual calculated width, constrained by min/max
    avgTextWidth = Math.min(
      Math.max(avgTextLength, MIN_TEXT_WIDTH),
      MAX_TEXT_WIDTH,
    );
  }

  // Calculate total width needed per legend item
  const itemWidth =
    LEGEND_ICON_WIDTH + LEGEND_ICON_MARGIN + avgTextWidth + LEGEND_ITEM_MARGIN;

  // Calculate how many items can fit per row
  const availableWidth = chartWidth - LEGEND_PADDING * 2;
  const itemsPerRow = Math.max(1, Math.floor(availableWidth / itemWidth));

  // Calculate number of rows needed
  const numRows = Math.ceil(legendCount / itemsPerRow);

  // Calculate total height
  const totalHeight = numRows * LEGEND_ITEM_HEIGHT + LEGEND_PADDING;

  // Apply 50% maximum height constraint if maxHeight is provided
  // This ensures 50% of space is reserved for the chart and 50% maximum for legends
  let finalHeight = Math.max(totalHeight, remToPx(3.125)); // Minimum height of 3.125rem = 50px

  if (maxHeight && maxHeight > 0) {
    const maxAllowedHeight = maxHeight * 0.5; // 50% maximum for legends, 50% for chart
    finalHeight = Math.min(finalHeight, maxAllowedHeight);
  }

  // If configuration objects are provided, also configure positioning
  if (legendConfig && gridConfig && chartHeight) {
    // Set grid bottom margin
    gridConfig.bottom = finalHeight;

    // Position legend at exact location to prevent overflow to top
    const legendTopPosition = chartHeight - finalHeight + 10; // 10px padding from bottom
    legendConfig.top = legendTopPosition;
    legendConfig.height = finalHeight - 20; // Constrain height within allocated space
  }

  return finalHeight;
};

/**
 * Calculates the width needed for legends when positioned on the right
 * Keeps chart height unchanged and ensures legends do not overlap the plot
 * @param {number} legendCount - Number of legend items
 * @param {number} chartWidth - Width of the chart container
 * @param {number} chartHeight - Height of the chart container
 * @param {any[]} seriesData - Series data to get actual legend names
 * @param {boolean} isScrollable - Whether the legend is scrollable
 * @returns {number} Width in pixels to reserve on the right
 */
export const calculateRightLegendWidth = (
  legendCount: number,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[] = [],
  isScrollable: boolean = false,
): number => {
  if (legendCount === 0) return 0;

  // Sizing constants in rem units (converted to pixels)
  const LEGEND_ROW_HEIGHT = remToPx(1.125); // 1.125rem = 18px (per line height)
  const LEGEND_ICON_WIDTH = remToPx(0.875); // 0.875rem = 14px
  const LEGEND_ICON_MARGIN = remToPx(0.625); // 0.625rem = 10px
  const HORIZONTAL_PADDING = remToPx(1.5); // 1.5rem = 24px (left+right padding for legend area)
  const VERTICAL_PADDING = remToPx(1); // 1rem = 16px
  const MIN_TEXT_WIDTH = remToPx(5); // 5rem = 80px
  const MAX_TEXT_WIDTH = remToPx(11.25); // 11.25rem = 180px (allow wider names)

  // Longest text width to avoid truncation
  let longestTextWidth = MIN_TEXT_WIDTH;
  if (seriesData.length > 0) {
    longestTextWidth = seriesData.reduce((max, series) => {
      const name = (series.name || series.seriesName || "").toString();
      const width = calculateWidthText(name);
      return Math.max(max, width);
    }, MIN_TEXT_WIDTH);
    longestTextWidth = Math.min(
      Math.max(longestTextWidth, MIN_TEXT_WIDTH),
      MAX_TEXT_WIDTH,
    );
  }

  // Width per legend column (icon + gap + text)
  const perColumnWidth =
    LEGEND_ICON_WIDTH + LEGEND_ICON_MARGIN + longestTextWidth;

  // Determine rows that fit vertically and required columns
  const availableHeight = Math.max(
    chartHeight - VERTICAL_PADDING * 2,
    LEGEND_ROW_HEIGHT,
  );
  const rows = Math.max(1, Math.floor(availableHeight / LEGEND_ROW_HEIGHT));
  const cols = isScrollable ? 1 : Math.ceil(legendCount / rows);

  // Total width reserved for legends
  const totalLegendWidth = cols * perColumnWidth + HORIZONTAL_PADDING * 2;

  // Apply constraint: max 50% of chart width to ensure chart remains visible
  const maxAllowedWidth = chartWidth * 0.5;
  return Math.min(totalLegendWidth, maxAllowedWidth);
};

/**
 * Calculates available space dimensions for charts based on legend configuration
 * @param {any} panelSchema - Panel configuration schema
 * @param {number} chartWidth - Original chart width
 * @param {number} chartHeight - Original chart height
 * @param {any[]} seriesData - Series data for legend calculations
 * @returns {object} Available dimensions and legend space info
 */
export const calculateChartDimensions = (
  panelSchema: any,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[] = [],
) => {
  const config = panelSchema.config || {};
  const legendPosition = config.legends_position;
  const showLegends = config.show_legends;
  const legendCount = seriesData?.length || 0;

  let availableWidth = chartWidth;
  let availableHeight = chartHeight;
  let legendWidth = 0;
  let legendHeight = 0;

  // Early return if no legends to display
  if (!showLegends || legendCount === 0) {
    return {
      availableWidth,
      availableHeight,
      legendWidth,
      legendHeight,
      hasLegends: false,
    };
  }

  const hasExplicitWidth =
    config.legend_width && !isNaN(parseFloat(config.legend_width.value));
  const hasExplicitHeight =
    config.legend_height && !isNaN(parseFloat(config.legend_height.value));

  // Calculate legend dimensions based on position and type
  if (legendPosition === "right") {
    legendWidth = calculateLegendWidth(
      panelSchema,
      chartWidth,
      chartHeight,
      seriesData,
      hasExplicitWidth,
    );
    availableWidth = chartWidth - legendWidth;
  } else if (legendPosition === "bottom" || legendPosition === null) {
    legendHeight = calculateLegendHeight(
      panelSchema,
      chartWidth,
      chartHeight,
      seriesData,
      hasExplicitHeight,
    );
    availableHeight = chartHeight - legendHeight;
  }

  return {
    availableWidth,
    availableHeight,
    legendWidth,
    legendHeight,
    hasLegends: true,
  };
};

/**
 * Calculates legend width for right-positioned legends with proper fallbacks
 * @param {any} panelSchema - Panel configuration
 * @param {number} chartWidth - Chart container width
 * @param {number} chartHeight - Chart container height
 * @param {any[]} seriesData - Series data
 * @param {boolean} hasExplicitWidth - Whether explicit width is configured
 * @returns {number} Legend width in pixels
 */
const calculateLegendWidth = (
  panelSchema: any,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[],
  hasExplicitWidth: boolean,
): number => {
  const config = panelSchema.config;
  const legendsType = config.legends_type;
  const legendCount = seriesData?.length || 0;

  // Use explicit width if provided
  if (hasExplicitWidth) {
    return config.legend_width.unit === "%"
      ? chartWidth * (config.legend_width.value / 100)
      : config.legend_width.value;
  }

  // Handle different legend types
  if (legendsType === "plain") {
    return calculateRightLegendWidth(
      legendCount,
      chartWidth,
      chartHeight,
      seriesData,
      false,
    );
  }

  // Scroll legends - reserve minimum space
  const minScrollLegendWidth = Math.min(chartWidth * 0.22, 170);
  return Math.max(minScrollLegendWidth, 120);
};

/**
 * Calculates legend height for bottom-positioned legends with proper fallbacks
 * @param {any} panelSchema - Panel configuration
 * @param {number} chartWidth - Chart container width
 * @param {number} chartHeight - Chart container height
 * @param {any[]} seriesData - Series data
 * @param {boolean} hasExplicitHeight - Whether explicit height is configured
 * @returns {number} Legend height in pixels
 */
const calculateLegendHeight = (
  panelSchema: any,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[],
  hasExplicitHeight: boolean,
): number => {
  const config = panelSchema.config;
  const legendsType = config.legends_type;
  const legendCount = seriesData?.length || 0;

  // Use explicit height if provided
  if (hasExplicitHeight) {
    return config.legend_height.unit === "%"
      ? chartHeight * (config.legend_height.value / 100)
      : config.legend_height.value;
  }

  // Handle different legend types
  if (legendsType === "plain") {
    return calculateBottomLegendHeight(
      legendCount,
      chartWidth,
      seriesData,
      chartHeight,
    );
  }

  // Scroll legends - reserve minimum space
  const minScrollLegendHeight = Math.min(chartHeight * 0.25, 100);
  return Math.max(minScrollLegendHeight, 60);
};

/**
 * Generates CSS grid properties for chart alignment
 * @param {string} chartAlign - Chart alignment ('left', 'center', or null)
 * @param {string} legendPosition - Legend position
 * @param {boolean} shouldApplyAlignment - Whether alignment should be applied
 * @returns {object} CSS grid properties
 */
export const generateChartAlignmentProperties = (
  chartAlign: string | null,
  legendPosition: string | null,
  shouldApplyAlignment: boolean,
): object => {
  if (!shouldApplyAlignment || legendPosition !== "right") {
    return {};
  }

  const baseProperties = {
    display: "grid",
    gridTemplateRows: "1fr",
  };

  switch (chartAlign) {
    case "left":
      return {
        ...baseProperties,
        gridTemplateColumns: "minmax(0, 1fr) auto",
        justifyItems: "start",
        alignItems: "center",
        paddingLeft: "5%",
      };

    case "center":
      return {
        ...baseProperties,
        gridTemplateColumns: "1fr",
        justifyItems: "center",
        alignItems: "center",
      };

    default: // auto - default to center
      return {
        ...baseProperties,
        gridTemplateColumns: "1fr",
        justifyItems: "center",
        alignItems: "center",
      };
  }
};

/**
 * Calculates optimal pie chart radius based on available space and configuration
 * @param {any} panelSchema - Panel configuration schema
 * @param {number} availableWidth - Available width for chart
 * @param {number} availableHeight - Available height for chart
 * @param {number} originalWidth - Original container width (optional)
 * @param {number} originalHeight - Original container height (optional)
 * @returns {number} Optimal radius percentage (0-100)
 */
export const calculatePieChartRadius = (
  panelSchema: any,
  availableWidth: number,
  availableHeight: number,
  originalWidth?: number,
  originalHeight?: number,
): number => {
    // Calculate the optimal radius in pixels based on available space
    const maxAvailableRadius = Math.min(availableWidth, availableHeight) / 2;
    const optimalRadiusPixels = maxAvailableRadius * 0.75; // 75% of available space for padding

    // If original dimensions are provided, convert to percentage of original container
    if (originalWidth && originalHeight) {
      const originalMaxRadius = Math.min(originalWidth, originalHeight) / 2;
      return Math.min(
        Math.max((optimalRadiusPixels / originalMaxRadius) * 100, 30),
        90,
      );
    }

    // Fallback: use a conservative percentage
    return 60;
};

/**
 * Determines if chart alignment should be applied based on configuration
 * @param {any} panelSchema - Panel configuration schema
 * @param {any[]} seriesData - Series data
 * @returns {boolean} Whether alignment should be applied
 */
export const shouldApplyChartAlignment = (
  panelSchema: any,
  seriesData: any[] = [],
): boolean => {
  const config = panelSchema.config || {};
  const showLegends = config.show_legends;
  const legendPosition = config.legends_position;
  const legendsType = config.legends_type;
  const legendCount = seriesData?.length || 0;

  return (
    showLegends &&
    legendCount > 0 &&
    legendPosition === "right" &&
    (legendsType === "plain" || legendsType === "scroll" || legendsType == null)
  );
};

/**
 * Creates the base legend configuration object with common properties
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} hoveredSeriesState - State for handling hovered series
 * @returns {object} Base legend configuration object
 */
export const createBaseLegendConfig = (
  panelSchema: any,
  hoveredSeriesState: any,
  // chartPanelRef?: any, // Add optional chart panel ref for container size calculation
) => {
  const legendPosition = getLegendPosition(
    panelSchema.config?.legends_position,
  );

  // Simple responsive text width: max 120px, but scale down for small containers
  // const containerWidth = chartPanelRef?.value?.offsetWidth || 800;
  // const maxTextWidth = 120;
  // const minTextWidth = 30;

  // // For small containers, scale down proportionally but never go below minimum
  // const responsiveTextWidth =
  //   containerWidth < 400
  //     ? Math.max(containerWidth * 0.2, minTextWidth)
  //     : maxTextWidth;

  const legendConfig: any = {
    show: shouldShowLegends(panelSchema),
    type: panelSchema.config?.legends_type === "plain" ? "plain" : "scroll",
    orient: legendPosition,
    padding: LEGEND_CONSTANTS.PADDING,
    tooltip: {
      show: true,
      padding: LEGEND_CONSTANTS.PADDING_OFFSET,
      textStyle: {
        fontSize: LEGEND_CONSTANTS.FONT_SIZE,
      },
      formatter: (params: any) => {
        try {
          hoveredSeriesState?.value?.setHoveredSeriesName(params?.name);
          return params?.name;
        } catch {
          return params?.name ?? "";
        }
      },
    },
    textStyle: {
      width: 120,
      // width: responsiveTextWidth,
      overflow: "truncate",
      rich: {
        a: { fontWeight: "bold" },
        b: { fontStyle: "normal" },
      },
    },
    formatter: (name: any) =>
      name === hoveredSeriesState?.value?.hoveredSeriesName
        ? `{a|${name}}`
        : `{b|${name}}`,
  };

  // Additional logic to adjust the legend position
  if (legendPosition === "vertical") {
    Object.assign(legendConfig, {
      left: null,
      right: 0,
      top: "center",
    });
  } else {
    Object.assign(legendConfig, {
      left: "0",
      top: "bottom",
    });
  }

  return legendConfig;
};

/**
 * Applies right legend positioning for standard charts (bar, line, area, etc.)
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} options - The chart options object to modify
 * @param {any} chartPanelRef - Reference to the chart panel element
 */
export const applyRightLegendPositioning = (
  panelSchema: any,
  options: any,
  chartPanelRef: any,
) => {
  // For plain legends or when explicit width is set
  if (
    panelSchema.config?.show_legends &&
    panelSchema.type != "gauge" &&
    panelSchema.type != "metric" &&
    !["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.legends_position == "right" &&
    (panelSchema?.config?.legends_type === "plain" ||
      (panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))))
  ) {
    // Prefer explicit legend width if provided in config
    let legendWidth;
    if (
      panelSchema.config.legend_width &&
      !isNaN(parseFloat(panelSchema.config.legend_width.value))
    ) {
      legendWidth =
        panelSchema.config.legend_width.unit === "%"
          ? (chartPanelRef.value?.offsetWidth || 0) *
            (panelSchema.config.legend_width.value / 100)
          : panelSchema.config.legend_width.value;
    } else {
      // Dynamically compute width to ensure legends do not overlap the chart
      legendWidth = calculateRightLegendWidth(
        options.series?.length || 0,
        chartPanelRef.value?.offsetWidth || 800,
        chartPanelRef.value?.offsetHeight || 400,
        options.series || [],
        false, // plain legends are not scrollable
      );
    }

    // Reserve space on the right so that the plot shrinks horizontally
    options.grid.right = legendWidth;
    // Note: textStyle.width is already set responsively in createBaseLegendConfig
    // Explicitly bound the legend area to the reserved right-side width
    const containerWidth = chartPanelRef.value?.offsetWidth || 0;
    const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
    options.legend.left = legendLeftPx;
    options.legend.right = 0;
  }

  // Handle scroll legends - reserve minimum space to prevent overlap but don't constrain the legend itself
  if (
    panelSchema.config?.show_legends &&
    panelSchema.type != "gauge" &&
    panelSchema.type != "metric" &&
    !["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.legends_position == "right" &&
    (panelSchema?.config?.legends_type === "scroll" ||
      panelSchema?.config?.legends_type == null) && // null means auto, which can be scroll
    !(
      panelSchema.config.legend_width &&
      !isNaN(parseFloat(panelSchema.config.legend_width.value))
    ) // Don't apply if explicit width is set
  ) {
    // Reserve minimum space for scroll legends to prevent chart overlap
    const chartWidth = chartPanelRef.value?.offsetWidth || 800;

    // Calculate legend width similar to old code approach - ensuring proper space reservation
    let legendWidth;

    // Get the longest series name to calculate appropriate width
    let maxValue: string = "";
    if (panelSchema.type === "pie" || panelSchema.type === "donut") {
      maxValue = (options.series?.[0]?.data || []).reduce(
        (max: any, it: any) => {
          return max.length < (it?.name?.length || 0) ? it?.name : max;
        },
        "",
      );
    } else {
      maxValue = (options.series || []).reduce((max: any, it: any) => {
        return max.length < (it?.name?.length || 0) ? it?.name : max;
      }, "");
    }

    // Calculate legend width based on content, with constraints for different container sizes
    // Use the same logic as the old code - ensure legends and chart both get reasonable space
    legendWidth = Math.min(
      chartWidth / 3, // Never take more than 1/3 of the chart width
      calculateWidthText(maxValue) + 60, // Calculate based on text width + padding for icons and scroll
    );

    // Ensure minimum width for scroll functionality but not too large for small containers
    legendWidth = Math.max(legendWidth, Math.min(120, chartWidth * 0.2));

    // Reserve space on the right so that the chart doesn't overlap with legends
    options.grid.right = legendWidth;

    // Position legend properly on the right side
    const containerWidth = chartPanelRef.value?.offsetWidth || 0;
    const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
    options.legend.left = legendLeftPx;
    options.legend.right = 0;

    // Set text width for truncation similar to old code
    options.legend.textStyle = options.legend.textStyle || {};
    options.legend.textStyle.width = legendWidth - 55; // Account for padding and scroll indicators
  }

  // Handle scroll/auto legends with explicit width - ensure proper spacing and positioning
  if (
    panelSchema.config?.show_legends &&
    panelSchema.type != "gauge" &&
    panelSchema.type != "metric" &&
    !["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.legends_position == "right" &&
    (panelSchema?.config?.legends_type === "scroll" ||
      panelSchema?.config?.legends_type == null) && // null means auto, which can be scroll
    panelSchema.config.legend_width &&
    !isNaN(parseFloat(panelSchema.config.legend_width.value))
  ) {
    // Apply explicit legend width for scroll/auto legends
    const legendWidth =
      panelSchema.config.legend_width.unit === "%"
        ? (chartPanelRef.value?.offsetWidth || 0) *
          (panelSchema.config.legend_width.value / 100)
        : panelSchema.config.legend_width.value;

    // Reserve space on the right so that the chart doesn't overlap with legends
    options.grid.right = legendWidth;

    // Position legend properly on the right side
    const containerWidth = chartPanelRef.value?.offsetWidth || 0;
    const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
    options.legend.left = legendLeftPx;
    options.legend.right = 0;

    // Don't constrain legend text width for scroll legends - let them scroll naturally
  }
};

/**
 * Applies bottom legend positioning for standard charts (bar, line, area, etc.)
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} options - The chart options object to modify
 * @param {any} chartPanelRef - Reference to the chart panel element
 */
export const applyBottomLegendPositioning = (
  panelSchema: any,
  options: any,
  chartPanelRef: any,
) => {
  // Apply dynamic legend height for bottom legends if conditions are met (other chart types)
  if (
    !["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.show_legends &&
    (panelSchema?.config?.legends_type === "plain" ||
      (panelSchema.config.legend_height &&
        !isNaN(parseFloat(panelSchema.config.legend_height.value)))) &&
    (panelSchema?.config?.legends_position === "bottom" ||
      panelSchema?.config?.legends_position === null) // Handle null/undefined as auto
  ) {
    // Get chart dimensions from chartPanelRef
    const chartWidth = chartPanelRef.value?.offsetWidth || 800;
    const chartHeight = chartPanelRef.value?.offsetHeight || 400;
    // Count legend items from series data
    const legendCount = options.series?.length || 0;

    // Apply 50% height constraint for plain legends with bottom or auto position
    const maxHeight =
      panelSchema?.config?.legends_position === "bottom" ||
      panelSchema?.config?.legends_position === null
        ? chartHeight
        : undefined;

    // Calculate and configure bottom legend positioning to prevent overflow to top
    // Prefer explicit legend height if provided in config
    if (
      panelSchema.config.legend_height &&
      !isNaN(parseFloat(panelSchema.config.legend_height.value))
    ) {
      const legendHeight =
        panelSchema.config.legend_height.unit === "%"
          ? chartHeight * (panelSchema.config.legend_height.value / 100)
          : panelSchema.config.legend_height.value;

      // Apply the configured height using the same approach as calculateBottomLegendHeight
      if (options.grid) {
        options.grid.bottom = legendHeight;
      }

      const legendTopPosition = chartHeight - legendHeight + 10; // 10px padding from bottom
      options.legend.top = legendTopPosition;
      options.legend.height = legendHeight - 20; // Constrain height within allocated space
    } else {
      // Dynamically compute height to ensure legends do not overlap the chart
      calculateBottomLegendHeight(
        legendCount,
        chartWidth,
        options.series || [],
        maxHeight,
        options.legend,
        options.grid,
        chartHeight,
      );
    }
  }

  // Apply legend height for scroll/auto legends at bottom position (other chart types)
  if (
    !["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.show_legends &&
    (panelSchema?.config?.legends_type === "scroll" ||
      panelSchema?.config?.legends_type == null) && // null means auto, which can be scroll
    (panelSchema?.config?.legends_position === "bottom" ||
      panelSchema?.config?.legends_position === null) &&
    panelSchema.config.legend_height &&
    !isNaN(parseFloat(panelSchema.config.legend_height.value))
  ) {
    // Get chart dimensions from chartPanelRef
    const chartHeight = chartPanelRef.value?.offsetHeight || 400;

    // Apply explicit legend height for scroll/auto legends
    const legendHeight =
      panelSchema.config.legend_height.unit === "%"
        ? chartHeight * (panelSchema.config.legend_height.value / 100)
        : panelSchema.config.legend_height.value;

    // Apply the configured height using the same approach as calculateBottomLegendHeight
    if (options.grid) {
      options.grid.bottom = legendHeight;
    }

    const legendTopPosition = chartHeight - legendHeight + 10; // 10px padding from bottom
    options.legend.top = legendTopPosition;
    options.legend.height = legendHeight - 20; // Constrain height within allocated space
  }
};

/**
 * Applies legend positioning for pie and donut charts
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} options - The chart options object to modify
 * @param {any} chartPanelRef - Reference to the chart panel element
 */
export const applyPieDonutLegendPositioning = (
  panelSchema: any,
  options: any,
  chartPanelRef: any,
) => {
  // Apply legend positioning for pie and donut charts - for plain legends or when explicit width/height is set
  if (
    ["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.show_legends &&
    (panelSchema.config?.legends_type === "plain" ||
      (panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))) ||
      (panelSchema.config.legend_height &&
        !isNaN(parseFloat(panelSchema.config.legend_height.value)) &&
        // Don't apply legend height config when legend type is auto/scroll and position is auto/bottom
        !(
          (panelSchema.config?.legends_position === "bottom" ||
            panelSchema.config?.legends_position === null) &&
          (panelSchema.config?.legends_type === "scroll" ||
            panelSchema.config?.legends_type === null)
        )))
  ) {
    // Get chart dimensions from chartPanelRef
    const chartWidth = chartPanelRef.value?.offsetWidth || 800;
    const chartHeight = chartPanelRef.value?.offsetHeight || 400;
    // Count legend items from series data
    const legendCount = options.series?.[0]?.data?.length || 0;

    if (panelSchema?.config?.legends_position === "right") {
      // Calculate and apply legend width for right position
      // Prefer explicit legend width if provided in config
      let legendWidth;
      if (
        panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))
      ) {
        legendWidth =
          panelSchema.config.legend_width.unit === "%"
            ? chartWidth * (panelSchema.config.legend_width.value / 100)
            : panelSchema.config.legend_width.value;
      } else {
        // Dynamically compute width to ensure legends do not overlap the chart
        legendWidth = calculateRightLegendWidth(
          legendCount,
          chartWidth,
          chartHeight,
          options.series?.[0]?.data || [],
          false, // plain legends are not scrollable
        );
      }

      // Position legend on the right side
      const containerWidth = chartPanelRef.value?.offsetWidth || 0;
      const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
      options.legend.left = legendLeftPx;
      options.legend.right = 0;
      // Note: textStyle.width is already set responsively in createBaseLegendConfig
    } else if (
      panelSchema?.config?.legends_position === "bottom" ||
      panelSchema?.config?.legends_position === null
    ) {
      // Calculate and apply legend height for bottom position
      // Prefer explicit legend height if provided in config, but not for scroll legends when position is auto/bottom
      if (
        panelSchema.config.legend_height &&
        !isNaN(parseFloat(panelSchema.config.legend_height.value)) &&
        // Don't apply legend height config when legend type is auto/scroll and position is auto/bottom
        !(
          (panelSchema.config?.legends_position === "bottom" ||
            panelSchema.config?.legends_position === null) &&
          (panelSchema.config?.legends_type === "scroll" ||
            panelSchema.config?.legends_type === null)
        )
      ) {
        const legendHeight =
          panelSchema.config.legend_height.unit === "%"
            ? chartHeight * (panelSchema.config.legend_height.value / 100)
            : panelSchema.config.legend_height.value;

        // Apply the configured height using the same approach as calculateBottomLegendHeight
        const legendTopPosition = chartHeight - legendHeight + 10; // 10px padding from bottom
        options.legend.top = legendTopPosition;
        options.legend.height = legendHeight - 20; // Constrain height within allocated space
      } else {
        // Dynamically compute height to ensure legends do not overlap the chart
        calculateBottomLegendHeight(
          legendCount,
          chartWidth,
          options.series?.[0]?.data || [],
          chartHeight, // Apply 50% constraint
          options.legend,
          {}, // No grid config needed for pie/donut
          chartHeight,
        );
      }
    }
  }

  // Handle scroll legends for pie and donut charts - reserve minimum space to prevent overlap or apply explicit size
  if (
    ["pie", "donut"].includes(panelSchema.type) &&
    panelSchema?.config?.show_legends &&
    (panelSchema?.config?.legends_type === "scroll" ||
      panelSchema?.config?.legends_type == null) // null means auto, which can be scroll
  ) {
    // Get chart dimensions from chartPanelRef
    const chartWidth = chartPanelRef.value?.offsetWidth || 800;
    const chartHeight = chartPanelRef.value?.offsetHeight || 400;

    if (
      panelSchema?.config?.legends_position === "right" &&
      !(
        panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))
      ) // Don't apply if explicit width is set
    ) {
      // Calculate legend width using the helper function to ensure consistency
      const legendWidth = calculatePieDonutScrollLegendWidth(
        options,
        chartWidth,
      );

      // Position legend on the right side with calculated space
      const containerWidth = chartPanelRef.value?.offsetWidth || 0;
      const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
      options.legend.left = legendLeftPx;
      options.legend.right = 0;

      // Set text width for truncation similar to regular charts
      options.legend.textStyle = options.legend.textStyle || {};
      options.legend.textStyle.width = legendWidth - 55; // Account for padding and scroll indicators
    } else if (
      (panelSchema?.config?.legends_position === "bottom" ||
        panelSchema?.config?.legends_position === null) &&
      panelSchema.config.legend_height &&
      !isNaN(parseFloat(panelSchema.config.legend_height.value)) &&
      // Don't apply legend height config when legend type is auto/scroll and position is auto/bottom
      !(
        (panelSchema.config?.legends_position === "bottom" ||
          panelSchema.config?.legends_position === null) &&
        (panelSchema.config?.legends_type === "scroll" ||
          panelSchema.config?.legends_type === null)
      )
    ) {
      // Apply explicit legend height for scroll/auto legends at bottom/auto position
      const legendHeight =
        panelSchema.config.legend_height.unit === "%"
          ? chartHeight * (panelSchema.config.legend_height.value / 100)
          : panelSchema.config.legend_height.value;

      // Apply the configured height using the same approach as calculateBottomLegendHeight
      const legendTopPosition = chartHeight - legendHeight + 10; // 10px padding from bottom
      options.legend.top = legendTopPosition;
      options.legend.height = legendHeight - 20; // Constrain height within allocated space

      // Adjust pie/donut chart center position to account for legend height
      if (
        options.series &&
        options.series[0] &&
        options.series[0].type === "pie"
      ) {
        const availableHeight = chartHeight - legendHeight;
        const centerY = (availableHeight / 2 / chartHeight) * 100; // Convert to percentage
        options.series[0].center = ["50%", `${centerY}%`];
      }
    }
  }
};

/**
 * Calculates chart container properties for pie/donut charts based on legend position and chart alignment
 * @param {any} panelSchema - The panel schema containing configuration
 * @param {number} chartWidth - Width of the chart container
 * @param {number} chartHeight - Height of the chart container
 * @param {any[]} seriesData - Series data for legend calculations
 * @returns {object} Object containing grid properties and available dimensions
 */
const calculatePieChartContainer = (
  panelSchema: any,
  chartWidth: number,
  chartHeight: number,
  seriesData: any[] = [],
) => {
  const chartAlign = panelSchema.config?.chart_align;
  const legendPosition = panelSchema.config?.legends_position;

  // Calculate available space using our centralized helper function
  const dimensions = calculateChartDimensions(
    panelSchema,
    chartWidth,
    chartHeight,
    seriesData,
  );

  // Determine if chart alignment should be applied
  const shouldApplyAlignment = shouldApplyChartAlignment(
    panelSchema,
    seriesData,
  );

  // Generate CSS grid properties for chart alignment
  const gridProperties = generateChartAlignmentProperties(
    chartAlign,
    legendPosition,
    shouldApplyAlignment,
  );

  return {
    gridProperties,
    availableWidth: dimensions.availableWidth,
    availableHeight: dimensions.availableHeight,
    shouldUseGridAlignment: shouldApplyAlignment,
  };
};

/**
 * Applies chart alignment for pie and donut charts when configured
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} options - The chart options object to modify
 * @param {number} chartWidth - The chart container width
 * @param {number} chartHeight - The chart container height
 */
export const applyPieDonutChartAlignment = (
  panelSchema: any,
  options: any,
  chartWidth: number,
  chartHeight: number,
) => {
  // Apply chart alignment - only when legend position is right and chart_align is explicitly set
  const shouldApplyAlignment =
    panelSchema.config?.show_legends &&
    panelSchema.config?.legends_position === "right" &&
    (panelSchema.config?.legends_type === "plain" ||
      panelSchema.config?.legends_type === "scroll" ||
      panelSchema.config?.legends_type === null) &&
    panelSchema.config?.chart_align; // Only apply when chart_align is explicitly set

  if (shouldApplyAlignment) {
    // Apply chart alignment based on container properties
    const containerProps = calculatePieChartContainer(
      panelSchema,
      chartWidth,
      chartHeight,
      options.series?.[0]?.data || [],
    );

    // Apply center positioning based on alignment requirements
    if (containerProps.shouldUseGridAlignment) {
      // Calculate center position for alignment within ONLY the chart area (excluding legend)
      const chartAlign = panelSchema.config?.chart_align;
      const chartAreaWidth = containerProps.availableWidth;

      let centerX = 50; // Default center
      let centerY = 50; // Default center

      // For right legends, adjust horizontal positioning
      const chartAreaRadius = Math.min(chartAreaWidth, chartHeight) * 0.4; // 40% of smaller dimension
      const radiusAsPercentOfTotal = (chartAreaRadius / chartWidth) * 100;
      const minSafeXInChartArea = radiusAsPercentOfTotal + 2; // 2% padding

      switch (chartAlign) {
        case "left": {
          // Position chart to the left within ONLY the chart area
          const leftPositionInChartArea = chartAreaWidth * 0.25; // 25% into chart area
          centerX = Math.max(
            minSafeXInChartArea,
            (leftPositionInChartArea / chartWidth) * 100,
          );
          break;
        }
        case "center":
        default: {
          // Center within ONLY the chart area
          const chartAreaCenter = chartAreaWidth / 2;
          centerX = (chartAreaCenter / chartWidth) * 100;
          break;
        }
      }

      options.series[0].center = [`${centerX}%`, `${centerY}%`];
    } else {
      // Fallback to default center when grid alignment is not used
      options.series[0].center = ["50%", "50%"];
    }
  } else {
    // Apply default center adjustments when chart alignment is not used
    applyPieDonutCenterAdjustment(
      panelSchema,
      options,
      chartWidth,
      chartHeight,
    );
  }
};

/**
 * Helper function to calculate scroll legend width for pie/donut charts
 * This ensures consistency between legend positioning and center adjustment
 */
const calculatePieDonutScrollLegendWidth = (
  options: any,
  chartWidth: number,
): number => {
  // Get the longest pie/donut label name to calculate appropriate width
  const maxValue = (options.series?.[0]?.data || []).reduce(
    (max: any, it: any) => {
      return max.length < (it?.name?.length || 0) ? it?.name : max;
    },
    "",
  );

  // Calculate legend width based on content, with constraints for different container sizes
  let legendWidth = Math.min(
    chartWidth / 3, // Never take more than 1/3 of the chart width
    calculateWidthText(maxValue) + 60, // Calculate based on text width + padding for icons and scroll
  );

  // Ensure minimum width for scroll functionality but not too large for small containers
  legendWidth = Math.max(legendWidth, Math.min(120, chartWidth * 0.2));

  return legendWidth;
};

/**
 * Applies legend center positioning adjustments for pie and donut charts
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} options - The chart options object to modify
 * @param {number} chartWidth - The chart container width
 * @param {number} chartHeight - The chart container height
 */
export const applyPieDonutCenterAdjustment = (
  panelSchema: any,
  options: any,
  chartWidth: number,
  chartHeight: number,
) => {
  // Default positioning for all other cases - don't interfere with existing functionality
  // Adjust center position based on legend position - only for plain legends or when explicit width is set
  if (
    panelSchema.config?.show_legends &&
    (panelSchema.config?.legends_type === "plain" ||
      (panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))))
  ) {
    if (panelSchema.config?.legends_position === "right") {
      // Calculate legend width and move chart center to the left
      const legendCount = options.series[0].data?.length || 0;

      // Prefer explicit legend width if provided in config
      let legendWidth;
      if (
        panelSchema.config.legend_width &&
        !isNaN(parseFloat(panelSchema.config.legend_width.value))
      ) {
        legendWidth =
          panelSchema.config.legend_width.unit === "%"
            ? chartWidth * (panelSchema.config.legend_width.value / 100)
            : panelSchema.config.legend_width.value;
      } else {
        // Dynamically compute width to ensure legends do not overlap the chart
        legendWidth = calculateRightLegendWidth(
          legendCount,
          chartWidth,
          chartHeight,
          options.series[0].data || [],
          false, // plain legends are not scrollable
        );
      }

      const availableWidth = chartWidth - legendWidth;
      const centerX = (availableWidth / 2 / chartWidth) * 100; // Convert to percentage
      options.series[0].center = [`${centerX}%`, "50%"];
    } else if (
      panelSchema.config?.legends_position === "bottom" ||
      panelSchema.config?.legends_position === null
    ) {
      // Calculate legend height and move chart center up
      const legendCount = options.series[0].data?.length || 0;
      // Prefer explicit legend height if provided in config, but not for scroll legends when position is auto/bottom
      let legendHeight;
      if (
        panelSchema.config.legend_height &&
        !isNaN(parseFloat(panelSchema.config.legend_height.value)) &&
        // Don't apply legend height config when legend type is auto/scroll and position is auto/bottom
        !(
          (panelSchema.config?.legends_position === "bottom" ||
            panelSchema.config?.legends_position === null) &&
          (panelSchema.config?.legends_type === "scroll" ||
            panelSchema.config?.legends_type === null)
        )
      ) {
        legendHeight =
          panelSchema.config.legend_height.unit === "%"
            ? chartHeight * (panelSchema.config.legend_height.value / 100)
            : panelSchema.config.legend_height.value;
      } else {
        // Dynamically compute height to ensure legends do not overlap the chart
        legendHeight = calculateBottomLegendHeight(
          legendCount,
          chartWidth,
          options.series[0].data || [],
          chartHeight,
        );
      }
      const availableHeight = chartHeight - legendHeight;
      const centerY = (availableHeight / 2 / chartHeight) * 100; // Convert to percentage
      options.series[0].center = ["50%", `${centerY}%`];
    }
  }

  // Handle scroll legends - adjust center position with minimum space reservation
  if (
    panelSchema.config?.show_legends &&
    (panelSchema.config?.legends_type === "scroll" ||
      panelSchema.config?.legends_type == null) && // null means auto, which can be scroll
    !(
      panelSchema.config.legend_width &&
      !isNaN(parseFloat(panelSchema.config.legend_width.value))
    ) // Don't apply if explicit width is set
  ) {
    if (panelSchema.config?.legends_position === "right") {
      // Calculate legend width using the same helper function to ensure consistency
      const legendWidth = calculatePieDonutScrollLegendWidth(
        options,
        chartWidth,
      );

      // Adjust center position based on the calculated legend width
      const availableWidth = chartWidth - legendWidth;
      const centerX = (availableWidth / 2 / chartWidth) * 100; // Convert to percentage
      options.series[0].center = [`${centerX}%`, "50%"];
    }
  }
};

/**
 * Applies all legend configurations to the chart options
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} chartPanelRef - Reference to the chart panel element
 * @param {any} hoveredSeriesState - State for handling hovered series
 * @param {any} options - The chart options object to modify
 */
export const applyLegendConfiguration = (
  panelSchema: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  options: any,
) => {
  // If trellis is enabled (layout is not null), disable all legend configurations
  if (
    panelSchema.config?.trellis?.layout !== null &&
    panelSchema.config?.trellis?.layout !== undefined
  ) {
    // Set legend to not show when trellis is enabled
    options.legend = { show: false };
    return;
  }

  // Create base legend configuration
  const legendConfig = createBaseLegendConfig(panelSchema, hoveredSeriesState);
  options.legend = legendConfig;

  // Apply positioning based on chart type and legend position
  const legendPosition = getLegendPosition(
    panelSchema.config?.legends_position,
  );

  if (legendPosition === "vertical") {
    applyRightLegendPositioning(panelSchema, options, chartPanelRef);
  } else {
    applyBottomLegendPositioning(panelSchema, options, chartPanelRef);
  }

  // Apply special positioning for pie and donut charts
  if (["pie", "donut"].includes(panelSchema.type)) {
    applyPieDonutLegendPositioning(panelSchema, options, chartPanelRef);

    // Adjust center positioning for pie/donut charts with chart alignment support
    const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);
    applyPieDonutChartAlignment(panelSchema, options, chartWidth, chartHeight);
  }
};
