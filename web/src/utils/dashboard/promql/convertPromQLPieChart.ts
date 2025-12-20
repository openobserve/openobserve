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
    extras: any
  ) {
    console.log("=== [Pie Converter] Starting conversion ===");
    console.log("Processed Data:", processedData);
    console.log("Panel Schema:", panelSchema);

    const chartType = panelSchema.type;
    const config = panelSchema.config || {};
    const data: any[] = [];

    // Get aggregation function (default: last)
    const aggregation = config.aggregation || "last";
    console.log("Aggregation function:", aggregation);

    // Pie charts use instant query values or aggregated time-series data
    processedData.forEach((queryData, qIndex) => {
      console.log(`Processing query ${qIndex}, series count: ${queryData.series.length}`);
      queryData.series.forEach((seriesData, sIndex) => {
        console.log(`Query ${qIndex}, Series ${sIndex}:`, seriesData.name);
        console.log(`Values:`, seriesData.values);

        const value = applyAggregation(seriesData.values, aggregation);
        console.log(`Aggregated value:`, value);

        data.push({
          name: seriesData.name,
          value,
        });

        extras.legends.push(seriesData.name);
      });
    });

    console.log("Final pie data:", data);

    // Sort by value descending (optional, can be configured)
    if (config.sort_data !== false) {
      data.sort((a, b) => b.value - a.value);
    }

    const series = [
      {
        type: "pie",

        // Donut = pie with inner radius
        radius: chartType === "donut" ? ["40%", "70%"] : "70%",

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
          formatter: config.label_format || "{b}: {d}%", // {b} = name, {c} = value, {d} = percentage
          fontSize: config.label_font_size || 12,
        },

        labelLine: {
          show: config.show_label_line !== false,
        },

        // Center position
        center: config.center_position || ["50%", "50%"],
      },
    ];

    const result = {
      series,
      tooltip: {
        trigger: "item",
        formatter: config.tooltip_format || "{b}: {c} ({d}%)",
      },
      legend: {
        orient: config.legend_orient || "vertical",
        left: config.legend_position || "left",
        show: config.show_legend !== false,
      },
    };

    console.log("=== [Pie Converter] Conversion complete ===");
    console.log("Result:", result);
    return result;
  }
}
