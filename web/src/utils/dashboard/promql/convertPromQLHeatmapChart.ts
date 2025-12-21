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
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import { getColorPalette } from "../colorPalette";

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

    // Get color range from configuration or use theme-based palette
    let colorRange: string[];
    if (config.color_range && Array.isArray(config.color_range) && config.color_range.length > 0) {
      colorRange = config.color_range;
    } else if (config.color?.fixedColor && Array.isArray(config.color.fixedColor) && config.color.fixedColor.length > 0) {
      colorRange = config.color.fixedColor;
    } else {
      // Use theme-based color palette
      const themePalette = getColorPalette(store.state.theme);
      // Select a subset of colors for heatmap gradient
      colorRange = [themePalette[10], themePalette[5], themePalette[0]]; // Cool to warm gradient
    }

    return {
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: config.show_label === true,
            // Add unit formatting to labels if shown
            formatter: (params: any) => {
              const value = params.data[2]; // Value is at index 2 in [x, y, value]
              return formatUnitValue(
                getUnitValue(
                  value,
                  config?.unit,
                  config?.unit_custom,
                  config?.decimals
                )
              );
            },
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
          color: colorRange,
        },
        // Add unit formatting to visual map labels
        formatter: (value: number) => {
          return formatUnitValue(
            getUnitValue(
              value,
              config?.unit,
              config?.unit_custom,
              config?.decimals
            )
          );
        },
      },
      tooltip: {
        position: "top",
        formatter: (params: any) => {
          const [timeIndex, seriesIndex, value] = params.data;
          // Format value with units
          const formattedValue = formatUnitValue(
            getUnitValue(
              value,
              config?.unit,
              config?.unit_custom,
              config?.decimals
            )
          );
          return `${seriesNames[seriesIndex]}<br/>${xAxisData[timeIndex]}: <strong>${formattedValue}</strong>`;
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
