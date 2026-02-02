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
  getChartDimensions,
  calculatePieChartRadius,
  calculateChartDimensions,
} from "../../legendConfiguration";

/**
 * Build dynamic grid configuration based on legend position and chart panel dimensions
 * This matches SQL chart behavior for consistent grid spacing
 *
 * @param panelSchema - Panel configuration schema
 * @param chartPanelRef - Reference to chart panel element (for dimensions)
 * @param seriesData - Array of series for legend width calculations
 * @returns Grid configuration object for ECharts
 */
export function buildDynamicGrid(
  panelSchema: any,
  chartPanelRef: any,
  seriesData: any[] = [],
): any {
  const config = panelSchema.config || {};
  const legendPosition = config.legends_position || "bottom";
  const showLegends = config.show_legends !== false;

  // Get chart dimensions
  const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

  // Base grid configuration
  const grid: any = {
    left: "3%",
    right: "4%",
    top: "3%",
    bottom: "3%",
    containLabel: true,
  };

  // Apply custom axis width if configured
  if (config.axis_width) {
    grid.left = config.axis_width;
  }

  // Adjust grid based on legend position
  if (showLegends && seriesData.length > 0) {
    switch (legendPosition) {
      case "bottom": {
        // Calculate dynamic bottom spacing for legend
        const bottomHeight = calculateBottomLegendHeight(
          seriesData.length,
          chartWidth,
          seriesData,
          chartHeight,
        );
        grid.bottom = bottomHeight;
        break;
      }

      case "right": {
        // Calculate dynamic right spacing for legend
        // Default to scroll (same as SQL charts) - only use plain if explicitly set
        const isScrollable = config.legends_type !== "plain";
        const rightWidth = calculateRightLegendWidth(
          seriesData.length,
          chartWidth,
          chartHeight,
          seriesData,
          isScrollable,
        );
        grid.right = rightWidth;
        break;
      }

      case "top": {
        // Reserve space at top for legend
        grid.top = "15%";
        break;
      }

      case "left": {
        // Reserve space at left for legend
        grid.left = config.axis_width || "15%";
        break;
      }
    }
  }

  return grid;
}

/**
 * Build legend configuration with proper positioning
 * This matches SQL chart behavior
 *
 * @param panelSchema - Panel configuration schema
 * @param chartPanelRef - Reference to chart panel element
 * @param seriesData - Array of series for legend calculations
 * @returns Legend configuration object for ECharts
 */
export function buildLegendConfig(
  panelSchema: any,
  chartPanelRef: any,
  seriesData: any[] = [],
): any {
  const config = panelSchema.config || {};
  const legendPosition = config.legends_position || "bottom";
  // Default to "scroll" (same as SQL charts) - only use "plain" if explicitly set
  const legendType = config.legends_type === "plain" ? "plain" : "scroll";
  const showLegends = config.show_legends !== false;

  if (!showLegends) {
    return { show: false };
  }

  // Get chart dimensions
  const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

  // Base legend configuration (match line chart legend config exactly)
  const legend: any = {
    show: true,
    type: legendType,
    orient:
      legendPosition === "bottom" || legendPosition === "top"
        ? "horizontal"
        : "vertical",
    padding: [10, 20, 10, 10],
    textStyle: {
      width: 150, // Same as line charts
      overflow: "truncate",
      rich: {
        a: { fontWeight: "bold" },
        b: { fontStyle: "normal" },
      },
    },
    tooltip: {
      show: true,
      padding: 10,
      textStyle: {
        fontSize: 12,
      },
    },
  };

  // Position legend based on configuration (match line chart positioning exactly)
  if (legendPosition === "right" || legendPosition === "vertical") {
    legend.left = null;
    legend.right = 0;
    legend.top = "center";
    // Calculate width for scroll legends
    if (legendType === "scroll") {
      const rightWidth = calculateRightLegendWidth(
        seriesData.length,
        chartWidth,
        chartHeight,
        seriesData,
        true,
      );
      legend.width = rightWidth - 20;
    }
  } else {
    // Bottom, top, or default positioning (same as line charts)
    legend.left = "0";
    legend.top = "bottom";
  }

  return legend;
}

/**
 * Build pie/donut chart configuration with dynamic radius and alignment
 * This matches SQL chart behavior
 *
 * @param panelSchema - Panel configuration schema
 * @param chartPanelRef - Reference to chart panel element
 * @param seriesData - Array of series data
 * @param isDonut - Whether this is a donut chart
 * @returns Object with radius and center position
 */
export function buildPieChartConfig(
  panelSchema: any,
  chartPanelRef: any,
  seriesData: any[] = [],
  isDonut: boolean = false,
): { radius: any; center: [string, string] } {
  const config = panelSchema.config || {};
  const chartAlign = config.chart_align;

  // Get chart dimensions
  const dimensions = getChartDimensions(chartPanelRef);

  // Calculate available dimensions accounting for legend
  const chartDimensions = calculateChartDimensions(
    panelSchema,
    dimensions.chartWidth,
    dimensions.chartHeight,
    seriesData,
  );

  // Calculate dynamic radius
  const radiusPercent = calculatePieChartRadius(
    panelSchema,
    chartDimensions.availableWidth,
    chartDimensions.availableHeight,
    dimensions.chartWidth,
    dimensions.chartHeight,
  );

  // Set radius based on chart type
  const radius = isDonut
    ? [`${Math.max(radiusPercent - 30, 40)}%`, `${radiusPercent}%`]
    : `${radiusPercent}%`;

  // Calculate center position based on alignment
  let center: [string, string] = config.center_position || ["50%", "50%"];

  // Apply chart alignment if configured
  if (chartAlign && config.legends_position === "right") {
    switch (chartAlign) {
      case "left":
        center = ["25%", "50%"];
        break;
      case "center":
        center = ["50%", "50%"];
        break;
      case "right":
        center = ["75%", "50%"];
        break;
    }
  }

  return { radius, center };
}
