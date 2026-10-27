// Copyright 2026 OpenObserve Inc.
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

import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { fillMissingTimestamps } from "./shared/dataProcessor";
import { buildXAxis, buildYAxis, buildTooltip } from "./shared/axisBuilder";
import { buildDynamicGrid } from "./shared/gridBuilder";
import { getSeriesColor } from "../colorPalette";
import { buildSeriesMarkLine } from "./shared/markLines";
import { lineThicknessOf } from "../promqlChartSeriesProps";
import { getScatterSymbolSize } from "../scatterPointStyle";
import { getSeriesItemOpacity } from "../promqlChartSeriesProps";
import { barStyleSeriesProps } from "../barTrack";

/**
 * Converter for time-series charts (line, area, bar, scatter, area-stacked)
 */
export class TimeSeriesConverter implements PromQLChartConverter {
  supportedTypes = ["line", "area", "area-stacked", "bar", "scatter"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const chartType = panelSchema.type;
    const series: any[] = [];
    const config = panelSchema.config || {};

    // Calculate min/max for color scaling if needed
    let chartMin: any = Infinity;
    let chartMax: any = -Infinity;

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const numericValues = seriesData.values.map(([, val]) => parseFloat(val));
        const seriesMin = Math.min(...numericValues);
        const seriesMax = Math.max(...numericValues);

        if (seriesMin < chartMin) chartMin = seriesMin;
        if (seriesMax > chartMax) chartMax = seriesMax;
      });
    });

    // Get series props based on chart type
    const seriesProps = this.getSeriesPropsBasedOnChartType(chartType, panelSchema);

    // Build series for each query
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        // Fill data with null for missing timestamps
        const data = fillMissingTimestamps(seriesData.data, queryData.timestamps);

        // Get color for series
        let seriesColor;
        try {
          seriesColor = getSeriesColor(
            config?.color,
            seriesData.name,
            seriesData.values.map(([, val]) => val),
            chartMin,
            chartMax,
            store.state.theme,
            config?.color?.colorBySeries,
            config,
          );
        } catch (error) {
          console.warn("Failed to get series color:", error);
          seriesColor = undefined; // Fallback to default color
        }

        series.push({
          name: seriesData.name,
          type: this.getEChartsType(chartType),
          data,

          // Chart type specific properties
          ...seriesProps,

          // Label configuration
          label: {
            show: config?.label_option?.position != null,
            position: config?.label_option?.position || "None",
            rotate: config?.label_option?.rotate || 0,
          },

          // Line interpolation
          smooth: config?.line_interpolation === "smooth" || config?.line_interpolation == null,
          step: ["step-start", "step-end", "step-middle"].includes(config?.line_interpolation)
            ? config.line_interpolation.replace("step-", "")
            : false,

          // Symbol configuration
          showSymbol: config?.show_symbol ?? false,

          // Styling
          itemStyle: {
            color: seriesColor,
            ...getSeriesItemOpacity(chartType, config, false),
          },

          // Connect null values
          connectNulls: config?.connect_nulls ?? false,

          markLine: { ...buildSeriesMarkLine(panelSchema), zlevel: 2 },
        });

        // Track for legend
        extras.legends.push(seriesData.name);
      });
    });

    const hasData = series.some((s) => s.data && s.data.length > 0);

    return {
      series,
      xAxis: buildXAxis(panelSchema, store, hasData),
      yAxis: buildYAxis(panelSchema, 0, store),
      grid: buildDynamicGrid(panelSchema, chartPanelRef, series),
      tooltip: buildTooltip(panelSchema, "axis", store, extras?.hoveredSeriesState),
      // Legend config will be applied by applyLegendConfiguration in convertPromQLChartData
      // This ensures consistent behavior with SQL charts
    };
  }

  /**
   * Get ECharts series type based on our chart type
   */
  private getEChartsType(chartType: string): string {
    switch (chartType) {
      case "bar":
        return "bar";
      case "scatter":
        return "scatter";
      default:
        return "line";
    }
  }

  /**
   * Get chart-type-specific series properties
   */
  private getSeriesPropsBasedOnChartType(chartType: string, panelSchema: any): any {
    const config = panelSchema.config || {};

    switch (chartType) {
      case "area":
        return {
          areaStyle: {},
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            width: lineThicknessOf(config),
          },
        };

      case "area-stacked":
        return {
          stack: "Total",
          areaStyle: {},
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            width: lineThicknessOf(config),
          },
        };

      case "bar":
        return {
          emphasis: {
            focus: "series",
          },
          ...barStyleSeriesProps(config, { withTrack: false }),
        };

      case "scatter":
        return {
          emphasis: {
            focus: "series",
          },
          symbolSize: getScatterSymbolSize(config),
        };

      case "line":
      default:
        return {
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            width: lineThicknessOf(config),
          },
        };
    }
  }
}
