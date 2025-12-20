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

/**
 * Converter for heatmap charts
 * Displays time-series data as a 2D heatmap with color intensity
 */
export class HeatmapConverter implements PromQLChartConverter {
  supportedTypes = ["heatmap"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any
  ) {
    const config = panelSchema.config || {};

    // Heatmap requires 3D data: [x, y, value]
    // X-axis: timestamps
    // Y-axis: series names
    // Value: metric values

    const seriesNames: string[] = [];
    const data: any[] = [];
    let maxValue = -Infinity;
    let minValue = Infinity;

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData, seriesIndex) => {
        seriesNames.push(seriesData.name);
        extras.legends.push(seriesData.name);

        queryData.timestamps.forEach(([ts, formattedTs], timeIndex) => {
          const value = parseFloat(seriesData.data[ts] ?? "0");
          data.push([timeIndex, seriesIndex, value]);

          if (value > maxValue) maxValue = value;
          if (value < minValue) minValue = value;
        });
      });
    });

    const xAxisData = processedData[0]?.timestamps.map(([, formatted]) => formatted) || [];

    return {
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: config.show_label === true,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
      xAxis: {
        type: "category",
        data: xAxisData,
        splitArea: {
          show: true,
        },
        axisLabel: {
          rotate: config.axis_label_rotate || 0,
          interval: config.axis_label_interval || "auto",
        },
      },
      yAxis: {
        type: "category",
        data: seriesNames,
        splitArea: {
          show: true,
        },
      },
      visualMap: {
        min: config.min_value ?? minValue,
        max: config.max_value ?? maxValue,
        calculable: true,
        orient: config.visual_map_orient || "horizontal",
        left: config.visual_map_position || "center",
        bottom: "0%",
        inRange: {
          color: config.color_range || ["#50a3ba", "#eac736", "#d94e5d"],
        },
      },
      tooltip: {
        position: "top",
        formatter: (params: any) => {
          const [timeIndex, seriesIndex, value] = params.data;
          return `${seriesNames[seriesIndex]}<br/>${xAxisData[timeIndex]}: ${value}`;
        },
      },
      grid: {
        left: "3%",
        right: config.visual_map_orient === "vertical" ? "15%" : "4%",
        bottom: config.visual_map_orient === "horizontal" ? "15%" : "3%",
        containLabel: true,
      },
    };
  }
}
