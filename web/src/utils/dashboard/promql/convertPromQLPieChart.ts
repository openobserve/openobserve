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

import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { buildTooltip } from "./shared/axisBuilder";
import { buildPieChartConfig, buildLegendConfig } from "./shared/gridBuilder";
import { getSeriesColor } from "../colorPalette";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";

/**
 * Converter for pie and donut charts
 * Uses instant query values or applies aggregation to time-series data
 */
export class PieConverter implements PromQLChartConverter {
  supportedTypes = ["pie", "donut"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const chartType = panelSchema.type;
    const config = panelSchema.config || {};
    const data: any[] = [];

    // Get aggregation function (default: last)
    const aggregation = config.aggregation || "last";

    // Calculate min/max for color scaling
    let chartMin = Infinity;
    let chartMax = -Infinity;

    // Collect all values first to determine min/max
    const seriesDataCollection: Array<{
      name: string;
      value: number;
      rawValues: Array<[number, string]>;
    }> = [];

    processedData.forEach((queryData, qIndex) => {
      queryData.series.forEach((seriesData, sIndex) => {
        const value = applyAggregation(seriesData.values, aggregation);

        if (value < chartMin) chartMin = value;
        if (value > chartMax) chartMax = value;

        seriesDataCollection.push({
          name: seriesData.name,
          value,
          rawValues: seriesData.values,
        });

        extras.legends.push(seriesData.name);
      });
    });

    // Now apply colors and build data with unit formatting
    seriesDataCollection.forEach((seriesData) => {
      // Extract numeric values for color calculation
      const numericValues = seriesData.rawValues.map(([_, val]) =>
        parseFloat(val),
      );

      const color = getSeriesColor(
        config.color || null,
        seriesData.name,
        numericValues,
        chartMin,
        chartMax,
        store.state.theme,
        config.color?.colorBySeries,
      );

      data.push({
        name: seriesData.name,
        value: seriesData.value,
        itemStyle: color ? { color } : undefined,
      });
    });

    // Sort by value descending (optional, can be configured)
    if (config.sort_data !== false) {
      data.sort((a, b) => b.value - a.value);
    }

    // Get dynamic radius and center position based on legend and chart alignment
    const { radius, center } = buildPieChartConfig(
      panelSchema,
      chartPanelRef,
      data,
      chartType === "donut",
    );

    const series = [
      {
        type: "pie",

        // Dynamic radius based on available space and chart type
        radius,

        data,

        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },

        label: {
          show: config.show_label !== false,
          formatter: (params: any) => {
            // Custom formatter with unit support
            if (config.label_format) {
              // If custom format is provided, use it with unit formatting
              return config.label_format
                .replace("{b}", params.name)
                .replace(
                  "{c}",
                  formatUnitValue(
                    getUnitValue(
                      params.value,
                      config?.unit,
                      config?.unit_custom,
                      config?.decimals,
                    ),
                  ),
                )
                .replace("{d}", params.percent.toFixed(1));
            }
            // Default format: name: value (percentage%)
            const unitValue = getUnitValue(
              params.value,
              config?.unit,
              config?.unit_custom,
              config?.decimals,
            );
            return `${params.name}: ${formatUnitValue(unitValue)} (${params.percent.toFixed(1)}%)`;
          },
          fontSize: config.label_font_size || 12,
        },

        labelLine: {
          show: config.show_label_line !== false,
        },

        // Dynamic center position based on chart alignment
        center,
      },
    ];

    const result = {
      series,
      tooltip: buildTooltip(panelSchema, "item"),
      // Legend config will be applied by applyLegendConfiguration in convertPromQLChartData
      // This ensures consistent behavior with SQL charts
    };

    return result;
  }
}
