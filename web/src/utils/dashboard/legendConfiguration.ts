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
  MIN_SCROLL_WIDTH: 140,
  MAX_SCROLL_WIDTH: 200,
  MIN_SCROLL_RESERVED: 120,
} as const;

const CHART_TYPE_GROUPS = {
  PIE_DONUT: ["pie", "donut"] as const,
  EXCLUDED_STANDARD: ["gauge", "metric", "pie", "donut"] as const,
} as const;

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
  Boolean(panelSchema.config?.show_legends);

/**
 * Utility function to check if chart type is excluded from standard legend processing
 */
const isExcludedChartType = (chartType: string): boolean =>
  CHART_TYPE_GROUPS.EXCLUDED_STANDARD.includes(chartType);

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
  let reservedWidthPercentage = 0.5; // Default 50%
  if (chartWidth < 400) {
    reservedWidthPercentage = 0.6; // Use 60% for very small containers
  } else if (chartWidth < 600) {
    reservedWidthPercentage = 0.55; // Use 55% for small containers
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
): LegendOptions => {
  const legendPosition = getLegendPosition(
    panelSchema.config?.legends_position,
  );

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
      width: 100,
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
    // Constrain legend text to the reserved space to avoid overflow
    options.legend.textStyle.width = Math.max(legendWidth - 55, 60);
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

    // Calculate more appropriate reserved width based on container size
    let reservedWidthPercentage = 0.5; // Default 50%
    if (chartWidth < 400) {
      reservedWidthPercentage = 0.6; // Use 60% for very small containers
    } else if (chartWidth < 600) {
      reservedWidthPercentage = 0.55; // Use 55% for small containers
    }

    const minScrollLegendWidth = Math.min(
      chartWidth * reservedWidthPercentage,
      200,
    ); // Increased max to 200px
    const reservedWidth = Math.max(minScrollLegendWidth, 140); // Increased minimum to 140px for better scroll indicators

    // Reserve space on the right so that the chart doesn't overlap with legends
    options.grid.right = reservedWidth;

    // Position legend properly on the right side
    const containerWidth = chartPanelRef.value?.offsetWidth || 0;
    const legendLeftPx = Math.max(containerWidth - reservedWidth, 0);
    options.legend.left = legendLeftPx;
    options.legend.right = 0;
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
      options.legend.textStyle.width = Math.max(legendWidth - 55, 60);
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
      // Reserve minimum space for scroll legends to prevent chart overlap
      const minScrollLegendWidth = Math.min(chartWidth * 0.5, 170); // 50% of chart width or 170px max
      const reservedWidth = Math.max(minScrollLegendWidth, 120); // At least 120px for scroll legends (extra space for scroll indicators)

      // Position legend on the right side with reserved space
      const containerWidth = chartPanelRef.value?.offsetWidth || 0;
      const legendLeftPx = Math.max(containerWidth - reservedWidth, 0);
      options.legend.left = legendLeftPx;
      options.legend.right = 0;
      // Don't constrain legend text width for scroll legends - let them scroll naturally
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
      // Reserve minimum space for scroll legends and adjust center
      const minScrollLegendWidth = Math.min(chartWidth * 0.5, 170); // 50% of chart width or 170px max
      const reservedWidth = Math.max(minScrollLegendWidth, 120); // At least 120px for scroll legends (extra space for scroll indicators)
      const availableWidth = chartWidth - reservedWidth;
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

    // Adjust center positioning for pie/donut charts if needed
    const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);
    applyPieDonutCenterAdjustment(
      panelSchema,
      options,
      chartWidth,
      chartHeight,
    );
  }
};
