// Copyright 2023 Zinc Labs Inc.
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
import { buildCategoryXAxis, buildCategoryYAxis, buildValueAxis } from "./shared/axisBuilder";

/**
 * Converter for bar chart variants (h-bar, stacked, h-stacked)
 */
export class BarConverter implements PromQLChartConverter {
  supportedTypes = ["h-bar", "stacked", "h-stacked"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any
  ) {
    const chartType = panelSchema.type;
    const config = panelSchema.config || {};
    const isHorizontal = chartType.startsWith("h-");
    const isStacked = chartType.includes("stacked");

    const series: any[] = [];
    const categories: string[] = [];

    // Get aggregation function
    const aggregation = config.aggregation || "last";

    if (isStacked) {
      // For stacked charts, each series becomes a stack component
      // Categories are timestamps
      processedData.forEach((queryData) => {
        // Build categories from timestamps (only once)
        if (categories.length === 0) {
          queryData.timestamps.forEach(([, formatted]) => {
            categories.push(formatted.toString());
          });
        }

        queryData.series.forEach((seriesData) => {
          const data = queryData.timestamps.map(([ts]) => {
            const value = parseFloat(seriesData.data[ts] ?? "0");
            return value;
          });

          series.push({
            name: seriesData.name,
            type: "bar",
            stack: "total",
            data,
            emphasis: {
              focus: "series",
            },
            ...(config.bar_width && { barWidth: config.bar_width }),
          });

          extras.legends.push(seriesData.name);
        });
      });
    } else {
      // For non-stacked h-bar: use instant/aggregated values
      // Categories are series names
      const data: number[] = [];

      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          const value = applyAggregation(seriesData.values, aggregation);
          data.push(value);
          categories.push(seriesData.name);
        });
      });

      series.push({
        type: "bar",
        data,
        emphasis: {
          focus: "series",
        },
        ...(config.bar_width && { barWidth: config.bar_width }),
      });
    }

    // Configure axes based on orientation
    const axisConfig = isHorizontal
      ? {
          xAxis: buildValueAxis(panelSchema),
          yAxis: buildCategoryYAxis(categories, panelSchema),
        }
      : {
          xAxis: buildCategoryXAxis(categories, panelSchema),
          yAxis: buildValueAxis(panelSchema),
        };

    return {
      series,
      ...axisConfig,
      grid: {
        left: isHorizontal ? "15%" : "3%",
        right: "4%",
        bottom: "10%",
        containLabel: true,
        ...(config.axis_width && { left: config.axis_width }),
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: isHorizontal ? "shadow" : "line",
        },
      },
      ...(isStacked && {
        legend: {
          show: config.show_legend !== false,
          orient: config.legend_orient || "horizontal",
          bottom: "0%",
        },
      }),
    };
  }
}
