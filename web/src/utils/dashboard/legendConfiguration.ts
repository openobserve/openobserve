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

import {
  calculateBottomLegendHeight,
  calculateRightLegendWidth,
  calculateChartDimensions,
  generateChartAlignmentProperties,
  shouldApplyChartAlignment,
  calculateWidthText,
} from "./convertDataIntoUnitValue";

// TypeScript interfaces for better type safety
interface LegendDimensions {
  width: number;
  height: number;
}

interface ChartDimensions {
  chartWidth: number;
  chartHeight: number;
  containerWidth: number;
}

interface PanelConfig {
  show_legends?: boolean;
  legends_position?: "bottom" | "right" | null;
  legends_type?: "plain" | "scroll" | null;
  legend_width?: { value: number; unit: string };
  legend_height?: { value: number; unit: string };
  trellis?: { layout?: any };
}

interface PanelSchema {
  type: string;
  config?: PanelConfig;
}

interface LegendOptions {
  show?: boolean;
  type?: string;
  orient?: string;
  left?: string | number | null;
  right?: string | number;
  top?: string | number;
  bottom?: string | number;
  textStyle?: any;
  height?: number;
  padding?: number[];
  tooltip?: any;
  formatter?: (name: any) => string;
}

interface ChartOptions {
  legend: LegendOptions;
  grid: any;
  series: any[];
}

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

const CHART_TYPE_GROUPS = {
  PIE_DONUT: ["pie", "donut"] as const,
  EXCLUDED_STANDARD: ["gauge", "metric", "pie", "donut"] as const,
} as const;

type ExcludedChartType = (typeof CHART_TYPE_GROUPS.EXCLUDED_STANDARD)[number];

/**
 * Utility function to get chart dimensions safely
 */
export const getChartDimensions = (chartPanelRef: any): ChartDimensions => ({
  chartWidth:
    chartPanelRef.value?.offsetWidth || LEGEND_CONSTANTS.DEFAULT_WIDTH,
  chartHeight:
    chartPanelRef.value?.offsetHeight || LEGEND_CONSTANTS.DEFAULT_HEIGHT,
  containerWidth: chartPanelRef.value?.offsetWidth || 0,
});

/**
 * Utility function to check if legends should be shown
 */
const shouldShowLegends = (panelSchema: PanelSchema): boolean =>
  Boolean(panelSchema.config?.show_legends) &&
  (panelSchema.config?.trellis?.layout === null ||
    panelSchema.config?.trellis?.layout === undefined);

/**
 * Utility function to check if chart type is excluded from standard legend processing
 */
const isExcludedChartType = (chartType: string): boolean =>
  CHART_TYPE_GROUPS.EXCLUDED_STANDARD.includes(chartType as any);

/**
 * Utility function to check if explicit legend dimension is set
 */
const hasExplicitLegendWidth = (panelSchema: PanelSchema): boolean =>
  Boolean(
    panelSchema.config?.legend_width &&
      !isNaN(parseFloat(panelSchema.config.legend_width.value.toString())),
  );

const hasExplicitLegendHeight = (panelSchema: PanelSchema): boolean =>
  Boolean(
    panelSchema.config?.legend_height &&
      !isNaN(parseFloat(panelSchema.config.legend_height.value.toString())),
  );

/**
 * Utility function to calculate legend width from config
 */
const calculateLegendWidthFromConfig = (
  panelSchema: PanelSchema,
  chartWidth: number,
): number => {
  const widthConfig = panelSchema.config?.legend_width;
  if (!widthConfig) return 0;

  return widthConfig.unit === "%"
    ? chartWidth * (widthConfig.value / 100)
    : widthConfig.value;
};

/**
 * Utility function to calculate legend height from config
 */
const calculateLegendHeightFromConfig = (
  panelSchema: PanelSchema,
  chartHeight: number,
): number => {
  const heightConfig = panelSchema.config?.legend_height;
  if (!heightConfig) return 0;

  return heightConfig.unit === "%"
    ? chartHeight * (heightConfig.value / 100)
    : heightConfig.value;
};

/**
 * Shared condition checker for right legend positioning
 */
const shouldApplyRightLegendPositioning = (
  panelSchema: PanelSchema,
  isPlainOrExplicit: boolean,
): boolean =>
  shouldShowLegends(panelSchema) &&
  !CHART_TYPE_GROUPS.EXCLUDED_STANDARD.includes(panelSchema.type as any) &&
  panelSchema.config?.legends_position === "right" &&
  isPlainOrExplicit;

/**
 * Calculates reserved width for scroll legends based on container size
 */
const calculateScrollLegendReservedWidth = (chartWidth: number): number => {
  let reservedWidthPercentage = 0.25; // Default 25%
  if (chartWidth < 400) {
    reservedWidthPercentage = 0.3; // Use 30% for very small containers
  } else if (chartWidth < 600) {
    reservedWidthPercentage = 0.4; // Use 40% for small containers
  }

  const minScrollLegendWidth = Math.min(
    chartWidth * reservedWidthPercentage,
    LEGEND_CONSTANTS.MAX_SCROLL_WIDTH,
  );
  return Math.max(minScrollLegendWidth, LEGEND_CONSTANTS.MIN_SCROLL_WIDTH);
};

/**
 * Applies legend positioning to the right side of the chart
 */
const applyRightSidePositioning = (
  options: ChartOptions,
  legendWidth: number,
  containerWidth: number,
): void => {
  options.grid.right = legendWidth;
  const legendLeftPx = Math.max(containerWidth - legendWidth, 0);
  options.legend.left = legendLeftPx;
  options.legend.right = 0;
};

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
 * Creates the base legend configuration object with common properties
 *
 * @param {any} panelSchema - The panel schema containing legend configuration
 * @param {any} hoveredSeriesState - State for handling hovered series
 * @returns {object} Base legend configuration object
 */
export const createBaseLegendConfig = (
  panelSchema: PanelSchema,
  hoveredSeriesState: any,
  // chartPanelRef?: any, // Add optional chart panel ref for container size calculation
): LegendOptions => {
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

  const legendConfig: LegendOptions = {
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
 * @param {any} options - The chart options object to modify
 * @param {any} chartPanelRef - Reference to the chart panel element
 * @param {any} hoveredSeriesState - State for handling hovered series
 */
export const applyLegendConfiguration = (
  panelSchema: any,
  options: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
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
