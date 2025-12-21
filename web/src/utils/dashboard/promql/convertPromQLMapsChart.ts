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

import { PromQLChartConverter, ProcessedPromQLData, MapsConfig } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";

/**
 * Converter for maps charts (location-based visualization)
 * Requires metrics with location name and value
 * Different from GeoMap which uses lat/lon coordinates
 */
export class MapsConverter implements PromQLChartConverter {
  supportedTypes = ["maps"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any
  ) {
    const config: MapsConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "last";

    // Get label names for location name
    const nameLabel = config.name_label || "name" || "location" || "country" || "region";

    const mapData: any[] = [];
    const errors: string[] = [];

    console.log("=== [MapsConverter] Starting conversion ===");
    console.log("Name label:", nameLabel);
    console.log("Aggregation:", aggregation);

    processedData.forEach((queryData, qIndex) => {
      console.log(`Query ${qIndex} - series count:`, queryData.series?.length);

      queryData.series.forEach((seriesData, sIndex) => {
        const locationName = seriesData.metric[nameLabel] || seriesData.name;

        if (!locationName) {
          errors.push(
            `Series "${seriesData.name}" missing location name. ` +
              `Expected label: "${nameLabel}"`
          );
          return;
        }

        const value = applyAggregation(seriesData.values, aggregation);

        console.log(`Query ${qIndex}, Series ${sIndex} - name: ${locationName}, value: ${value}`);

        mapData.push({
          name: locationName,
          value: value,
          itemStyle: {
            color: this.getColorByValue(value, config),
          },
        });

        extras.legends.push(locationName);
      });
    });

    if (errors.length > 0) {
      console.warn("Maps conversion warnings:", errors);
    }

    if (mapData.length === 0) {
      return {
        error: true,
        message: `No valid map data found. Ensure metrics have a "${nameLabel}" label with location names.`,
        series: [],
      };
    }

    console.log("=== [MapsConverter] Conversion complete ===");
    console.log("Map data points:", mapData.length);

    // Return map chart configuration
    // Uses ECharts map type with location names
    return {
      series: [
        {
          type: "map",
          map: config.map_type || "world", // Map type: world, USA, China, etc.
          roam: config.enable_roam !== false,
          data: mapData,
          emphasis: {
            label: {
              show: true,
            },
            itemStyle: {
              areaColor: config.emphasis_area_color || "#ffd700",
            },
          },
          select: {
            label: {
              show: true,
            },
            itemStyle: {
              areaColor: config.select_area_color || "#ff6b6b",
            },
          },
        },
      ],
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          if (params.value !== undefined) {
            return `${params.name}<br/>Value: ${params.value}`;
          }
          return params.name;
        },
      },
      visualMap: {
        min: config.min_value || 0,
        max: config.max_value || this.calculateMaxValue(mapData),
        text: ["High", "Low"],
        calculable: true,
        inRange: {
          color: config.color_range || ["#e0f3f7", "#006edd"],
        },
        left: "left",
        bottom: "bottom",
      },
    };
  }

  /**
   * Get color based on value and configuration
   */
  private getColorByValue(value: number, config: any): string | undefined {
    if (!config.color_thresholds) return undefined;

    for (const threshold of config.color_thresholds) {
      if (value <= threshold.value) {
        return threshold.color;
      }
    }

    return undefined;
  }

  /**
   * Calculate maximum value from map data for visualMap
   */
  private calculateMaxValue(mapData: any[]): number {
    if (mapData.length === 0) return 100;

    const values = mapData.map((item) => item.value || 0);
    return Math.max(...values);
  }
}
