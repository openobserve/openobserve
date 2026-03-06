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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { getSeriesColor } from "../../colorPalette";
import {
  getChartDimensions,
  applyPieDonutChartAlignment,
  applyPieDonutCenterAdjustment,
  calculatePieChartContainer,
} from "../../legendConfiguration";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: pie AND donut
 *
 * Mutates `ctx.options` in place, exactly as the original switch cases did.
 */
export function applyPieDonutChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    yAxisKeys,
    chartMin,
    chartMax,
    chartPanelRef,
    hoveredSeriesState,
    defaultSeriesProps,
    getAxisDataFromKey,
    getPieChartRadius,
  } = ctx;

  if (panelSchema.type === "pie") {
    // Add more padding for pie chart
    options.grid = {
      containLabel: true,
      left: "15%",
      right: "15%",
      top: "15%",
      bottom: "15%",
    };
    options.tooltip = {
      trigger: "item",
      textStyle: {
        color: store.state.theme === "dark" ? "#fff" : "#000",
        fontSize: 12,
      },
      backgroundColor:
        store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
      formatter: function (name: any) {
        try {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          return `${name?.marker} ${name?.name} : <b>${formatUnitValue(
            getUnitValue(
              name?.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          )}</b>`;
        } catch (error) {
          return "";
        }
      },
    };
    //generate trace based on the y axis keys
    options.series = yAxisKeys?.map((key: any) => {
      const seriesObj = {
        ...defaultSeriesProps,
        data: getAxisDataFromKey(key).map((it: any, i: number) => {
          return { value: it, name: options?.xAxis[0]?.data[i] };
        }),
        itemStyle: {
          color: ["palette-classic"].includes(panelSchema.config?.color?.mode)
            ? null
            : (params: any) => {
                return (
                  getSeriesColor(
                    panelSchema?.config?.color,
                    params.name,
                    [params.value],
                    chartMin,
                    chartMax,
                    store.state.theme,
                    panelSchema?.config?.color?.colorBySeries,
                  ) ?? null
                );
              },
        },
        label: {
          show: true,
          formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
          position: "inside", // You can adjust the position of the labels
          fontSize: 10,
        },
        percentPrecision: panelSchema.config?.decimals ?? 2,
      };
      return seriesObj;
    });

    if (options.series.length > 0) {
      // Get current chart dimensions
      const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

      // Calculate responsive radius that accounts for dynamic resizing
      const pieRadius = getPieChartRadius(options.series[0].data);
      options.series[0].radius = `${pieRadius}%`;

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
          options.series[0].data || [],
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

          const finalCenter = [`${centerX}%`, `${centerY}%`];
          options.series[0].center = finalCenter;
        } else {
          // Fallback to default center when grid alignment is not used
          options.series[0].center = ["50%", "50%"];
        }
      } else {
        applyPieDonutCenterAdjustment(
          panelSchema,
          options,
          chartWidth,
          chartHeight,
        );
      }
    }

    options.xAxis = [];
    options.yAxis = [];
  } else {
    // donut
    // Add more padding for donut chart
    options.grid = {
      containLabel: true,
      left: "15%",
      right: "15%",
      top: "15%",
      bottom: "15%",
    };
    options.tooltip = {
      trigger: "item",
      textStyle: {
        color: store.state.theme === "dark" ? "#fff" : "#000",
        fontSize: 12,
      },
      backgroundColor:
        store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
      formatter: function (name: any) {
        try {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          return `${name?.marker} ${name?.name} : <b>${formatUnitValue(
            getUnitValue(
              name?.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          )}<b/>`;
        } catch (error) {
          return "";
        }
      },
    };
    //generate trace based on the y axis keys
    options.series = yAxisKeys?.map((key: any) => {
      const seriesObj = {
        ...defaultSeriesProps,
        data: getAxisDataFromKey(key).map((it: any, i: number) => {
          return { value: it, name: options?.xAxis[0]?.data[i] };
        }),
        itemStyle: {
          color: ["palette-classic"].includes(panelSchema.config?.color?.mode)
            ? null
            : (params: any) => {
                return (
                  getSeriesColor(
                    panelSchema?.config?.color,
                    params.name,
                    [params.value],
                    chartMin,
                    chartMax,
                    store.state.theme,
                    panelSchema?.config?.color?.colorBySeries,
                  ) ?? null
                );
              },
        },
        label: {
          show: true,
          formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
          position: "inside", // You can adjust the position of the labels
          fontSize: 10,
        },
        percentPrecision: panelSchema.config?.decimals ?? 2,
      };
      return seriesObj;
    });

    if (options.series.length > 0) {
      // Get current chart dimensions
      const { chartWidth, chartHeight } = getChartDimensions(chartPanelRef);

      const outerRadius: number = getPieChartRadius(options.series[0].data);

      // Adjust inner radius based on outer radius size for better proportions
      const thickness = outerRadius > 70 ? 35 : 30;
      const innterRadius = Math.max(outerRadius - thickness, 20); // Ensure minimum inner radius

      options.series[0].radius = [`${innterRadius}%`, `${outerRadius}%`];

      // Apply chart alignment and center positioning using centralized function
      applyPieDonutChartAlignment(
        panelSchema,
        options,
        chartWidth,
        chartHeight,
      );
    }

    options.xAxis = [];
    options.yAxis = [];
  }
}
